import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/services/prisma.service.js';
import type { User } from '../generated/prisma/client.js';
import { NotificationSource } from '../generated/prisma/client.js';
import { CreateReservationDto, UpdateReservationDto } from './dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class ReservationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // =====================================================
  // H10 - CREAR RESERVA
  // =====================================================

  async create(user: User, dto: CreateReservationDto) {
    const reservationDate = new Date(dto.dateTime);

    if (Number.isNaN(reservationDate.getTime())) {
      throw new BadRequestException('La fecha no es válida');
    }

    if (reservationDate <= new Date()) {
      throw new BadRequestException(
        'No se pueden realizar reservas en fechas pasadas',
      );
    }

    if (!Number.isInteger(dto.peopleCount) || dto.peopleCount < 1) {
      throw new BadRequestException('La cantidad de personas no es válida');
    }

    const durationMinutes = 90;
    const reservationEnd = new Date(
      reservationDate.getTime() + durationMinutes * 60 * 1000,
    );

    const getLocalTime = (date: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/El_Salvador',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(date);

    const reservationTime = getLocalTime(reservationDate);
    const reservationEndTime = getLocalTime(reservationEnd);

    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM branches
        WHERE id = ${dto.branchId}::uuid
        FOR UPDATE
      `;

      const branch = await tx.branch.findUnique({
        where: { id: dto.branchId },
      });

      if (!branch || !branch.isActive) {
        throw new NotFoundException(
          'La sucursal no existe o está inactiva',
        );
      }

      if (
        reservationTime < branch.openingTime ||
        reservationEndTime > branch.closingTime ||
        reservationEndTime <= reservationTime
      ) {
        throw new BadRequestException(
          'La reserva está fuera del horario de atención',
        );
      }

      const availableTables = await tx.restaurantTable.findMany({
        where: {
          branchId: dto.branchId,
          capacity: {
            gte: dto.peopleCount,
          },
          status: 'FREE',
          accounts: {
            none: {
              status: 'OPEN',
            },
          },
        },
        orderBy: {
          capacity: 'asc',
        },
      });

      if (availableTables.length === 0) {
        throw new ConflictException(
          'No hay mesas disponibles con capacidad suficiente',
        );
      }

      const existingReservations = await tx.reservation.findMany({
        where: {
          branchId: dto.branchId,
          status: 'CONFIRMED',
          dateTime: {
            gte: new Date(
              reservationDate.getTime() - 90 * 60 * 1000,
            ),
            lt: reservationEnd,
          },
        },
      });

      const occupiedTableIds = new Set(
        existingReservations
          .filter((reservation) => {
            const existingStart = reservation.dateTime;
            const existingEnd = new Date(
              existingStart.getTime() +
                reservation.durationMinutes * 60 * 1000,
            );

            return (
              existingStart < reservationEnd &&
              existingEnd > reservationDate
            );
          })
          .map((reservation) => reservation.tableId),
      );

      const selectedTable = availableTables.find(
        (table) => !occupiedTableIds.has(table.id),
      );

      if (!selectedTable) {
        throw new ConflictException(
          'No hay mesas disponibles para ese horario',
        );
      }

      return tx.reservation.create({
        data: {
          userId: user.id,
          branchId: dto.branchId,
          tableId: selectedTable.id,
          dateTime: reservationDate,
          durationMinutes,
          peopleCount: dto.peopleCount,
          status: 'CONFIRMED',
        },
        include: {
          table: true,
          branch: true,
        },
      });
    });

    await this.notifications.send({
      recipientIds: [user.id],
      title: 'Reserva confirmada',
      message: `Tu reserva ha sido confirmada para ${reservationDate.toLocaleString('es-SV', {
        timeZone: 'America/El_Salvador',
      })}. Mesa número ${result.table.number}.`,
      sourceModule: NotificationSource.RESERVAS,
      referenceType: 'Reservation',
      referenceId: result.id,
    });

    return {
      id: result.id,
      branchId: result.branchId,
      tableId: result.tableId,
      tableNumber: result.table.number,
      dateTime: result.dateTime,
      durationMinutes: result.durationMinutes,
      peopleCount: result.peopleCount,
      status: result.status,
    };
  }

  // =====================================================
  // H12 - CONSULTAR MIS RESERVAS
  // =====================================================

  async findMyReservations(user: User) {
    const reservations = await this.db.reservation.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        dateTime: 'asc',
      },
    });

    return {
      items: reservations.map((reservation) => ({
        id: reservation.id,
        branchId: reservation.branchId,
        tableId: reservation.tableId,
        dateTime: reservation.dateTime,
        durationMinutes: reservation.durationMinutes,
        peopleCount: reservation.peopleCount,
        status: reservation.status,
      })),
    };
  }

  // =====================================================
  // H12 - MODIFICAR RESERVA
  // =====================================================

  async update(user: User, id: string, dto: UpdateReservationDto) {
    if (dto.dateTime === undefined && dto.peopleCount === undefined) {
      throw new BadRequestException(
        'Debes proporcionar una fecha, hora o cantidad de personas para modificar',
      );
    }

    if (
      dto.peopleCount !== undefined &&
      (!Number.isInteger(dto.peopleCount) || dto.peopleCount < 1)
    ) {
      throw new BadRequestException(
        'La cantidad de personas no es válida',
      );
    }

    return this.db.$transaction(async (tx) => {
      const initialReservation = await tx.reservation.findUnique({
        where: { id },
      });

      if (!initialReservation) {
        throw new NotFoundException('La reserva no existe');
      }

      if (initialReservation.userId !== user.id) {
        throw new ForbiddenException(
          'No puedes modificar una reserva que pertenece a otro cliente',
        );
      }

      // Bloquear la sucursal para coordinar con la creación de reservas.
      await tx.$queryRaw`
        SELECT id
        FROM branches
        WHERE id = ${initialReservation.branchId}::uuid
        FOR UPDATE
      `;

      // Consultar nuevamente la reserva después del bloqueo.
      const reservation = await tx.reservation.findUnique({
        where: { id },
      });

      if (!reservation) {
        throw new NotFoundException('La reserva no existe');
      }

      if (reservation.userId !== user.id) {
        throw new ForbiddenException(
          'No puedes modificar una reserva que pertenece a otro cliente',
        );
      }

      if (reservation.status !== 'CONFIRMED') {
        throw new ConflictException(
          'No puedes modificar una reserva que ya fue cancelada o completada',
        );
      }

      if (reservation.dateTime <= new Date()) {
        throw new ConflictException(
          'No puedes modificar una reserva cuya fecha ya ha comenzado',
        );
      }

      const newDate = dto.dateTime
        ? new Date(dto.dateTime)
        : reservation.dateTime;

      if (Number.isNaN(newDate.getTime()) || newDate <= new Date()) {
        throw new BadRequestException(
          'La nueva fecha de reserva no es válida',
        );
      }

      const newPeopleCount =
        dto.peopleCount ?? reservation.peopleCount;

      const branch = await tx.branch.findUnique({
        where: { id: reservation.branchId },
      });

      if (!branch || !branch.isActive) {
        throw new NotFoundException(
          'La sucursal no existe o está inactiva',
        );
      }

      const newEnd = new Date(
        newDate.getTime() +
          reservation.durationMinutes * 60 * 1000,
      );

      const getLocalTime = (date: Date) =>
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'America/El_Salvador',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(date);

      const startTime = getLocalTime(newDate);
      const endTime = getLocalTime(newEnd);

      if (
        startTime < branch.openingTime ||
        endTime > branch.closingTime ||
        endTime <= startTime
      ) {
        throw new BadRequestException(
          'La nueva reserva está fuera del horario de atención',
        );
      }

      // Buscar mesas con capacidad suficiente y sin cuentas abiertas.
      const availableTables = await tx.restaurantTable.findMany({
        where: {
          branchId: reservation.branchId,
          capacity: {
            gte: newPeopleCount,
          },
          status: 'FREE',
          accounts: {
            none: {
              status: 'OPEN',
            },
          },
        },
        orderBy: {
          capacity: 'asc',
        },
      });

      if (availableTables.length === 0) {
        throw new ConflictException(
          'No existen mesas con capacidad suficiente',
        );
      }

      // Buscar reservas que puedan cruzarse con el nuevo horario.
      const existingReservations = await tx.reservation.findMany({
        where: {
          branchId: reservation.branchId,
          status: 'CONFIRMED',
          id: {
            not: reservation.id,
          },
          dateTime: {
            gte: new Date(
              newDate.getTime() - 90 * 60 * 1000,
            ),
            lt: newEnd,
          },
        },
      });

      const occupiedTableIds = new Set(
        existingReservations
          .filter((existing) => {
            const existingStart = existing.dateTime;
            const existingEnd = new Date(
              existingStart.getTime() +
                existing.durationMinutes * 60 * 1000,
            );

            return (
              existingStart < newEnd &&
              existingEnd > newDate
            );
          })
          .map((existing) => existing.tableId),
      );

      const selectedTable = availableTables.find(
        (table) => !occupiedTableIds.has(table.id),
      );

      if (!selectedTable) {
        throw new ConflictException(
          'No hay mesas disponibles para la nueva fecha, hora o cantidad de personas',
        );
      }

      // Actualizar únicamente después de validar disponibilidad.
      const updatedReservation = await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          dateTime: newDate,
          peopleCount: newPeopleCount,
          tableId: selectedTable.id,
        },
      });

      return {
        id: updatedReservation.id,
        dateTime: updatedReservation.dateTime,
        durationMinutes: updatedReservation.durationMinutes,
        peopleCount: updatedReservation.peopleCount,
        tableId: updatedReservation.tableId,
        status: updatedReservation.status,
      };
    });
  }

  // =====================================================
  // H12 - CANCELAR RESERVA
  // =====================================================

  async cancel(user: User, id: string) {
    return this.db.$transaction(async (tx) => {
      const initialReservation = await tx.reservation.findUnique({
        where: { id },
      });

      if (!initialReservation) {
        throw new NotFoundException('La reserva no existe');
      }

      if (initialReservation.userId !== user.id) {
        throw new ForbiddenException(
          'No puedes cancelar una reserva que pertenece a otro cliente',
        );
      }

      // Bloquear la sucursal para coordinar con otras operaciones.
      await tx.$queryRaw`
        SELECT id
        FROM branches
        WHERE id = ${initialReservation.branchId}::uuid
        FOR UPDATE
      `;

      const reservation = await tx.reservation.findUnique({
        where: { id },
      });

      if (!reservation) {
        throw new NotFoundException('La reserva no existe');
      }

      if (reservation.userId !== user.id) {
        throw new ForbiddenException(
          'No puedes cancelar una reserva que pertenece a otro cliente',
        );
      }

      if (reservation.status !== 'CONFIRMED') {
        throw new ConflictException(
          'La reserva ya fue cancelada o completada',
        );
      }

      const twoHours = 2 * 60 * 60 * 1000;
      const timeUntilReservation =
        reservation.dateTime.getTime() - Date.now();

      if (timeUntilReservation < twoHours) {
        throw new ConflictException(
          'Solo puedes cancelar una reserva con al menos 2 horas de anticipación',
        );
      }

      const cancelledReservation = await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          status: 'CANCELLED',
        },
      });

      return {
        id: cancelledReservation.id,
        status: cancelledReservation.status,
      };
    });
  }
}
