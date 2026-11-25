import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { horasDeAtencion } from './peak-hours.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OFFSET_MS = 6 * 60 * 60 * 1000;
const HORA_MS = 60 * 60 * 1000;
const MINUTO_MS = 60 * 1000;

@Injectable()
export class OccupancyService {
  constructor(private readonly prisma: PrismaService) {}

  async getOccupancy(user: User, branchId: string, date: string) {
    if (!UUID.test(branchId)) {
      throw new BadRequestException(
        'El identificador de sucursal no es válido.',
      );
    }

    // Validar el formato y que la fecha exista en el calendario.
    const fecha = date ? new Date(`${date}T00:00:00.000Z`) : new Date(NaN);
    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(fecha.getTime()) ||
      fecha.toISOString().slice(0, 10) !== date
    ) {
      throw new BadRequestException(
        'La fecha debe tener el formato YYYY-MM-DD y ser una fecha válida.',
      );
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
        openingTime: true,
        closingTime: true,
      },
    });

    if (!branch) {
      throw new NotFoundException('La sucursal no existe.');
    }

    // El gerente solo puede consultar sucursales vinculadas a su usuario.
    const assignment = await this.prisma.staffBranch.findUnique({
      where: {
        userId_branchId: {
          userId: user.id,
          branchId,
        },
      },
      select: { userId: true },
    });

    if (!assignment) {
      throw new ForbiddenException(
        'No tiene acceso a la sucursal seleccionada.',
      );
    }

    const tables = await this.prisma.restaurantTable.findMany({
      where: { branchId },
      select: { id: true },
    });
    const tableIds = new Set(tables.map((table) => table.id));
    const totalTables = tableIds.size;

    if (totalTables === 0) {
      return {
        branchId,
        date,
        totalTables: 0,
        slots: [],
        message:
          'No es posible calcular la ocupación porque la sucursal no tiene mesas registradas.',
      };
    }

    const hours = horasDeAtencion(branch.openingTime, branch.closingTime);

    if (hours.length === 0) {
      return {
        branchId,
        date,
        totalTables,
        slots: [],
        message: 'La sucursal no tiene bloques horarios para la fecha seleccionada.',
      };
    }

    // La fecha seleccionada se interpreta en la zona horaria de El Salvador
    // (UTC-6), igual que las fechas de las reservas.
    const startOfDay = new Date(fecha.getTime() + OFFSET_MS);
    const firstBlock = new Date(startOfDay.getTime() + hours[0] * HORA_MS);

    // Se consulta desde el día anterior para incluir reservas iniciadas antes
    // del primer bloque y que aún se encuentren activas durante ese bloque.
    const reservations = await this.prisma.reservation.findMany({
      where: {
        branchId,
        status: 'CONFIRMED',
        dateTime: {
          gte: new Date(firstBlock.getTime() - 24 * HORA_MS),
          lt: new Date(startOfDay.getTime() + 2 * 24 * HORA_MS),
        },
      },
      select: {
        tableId: true,
        dateTime: true,
        durationMinutes: true,
      },
    });

    let previousHour = -1;
    let dayOffset = 0;

    const slots = hours.map((hour) => {
      if (previousHour !== -1 && hour < previousHour) {
        dayOffset++;
      }
      previousHour = hour;

      const blockStart = new Date(
        startOfDay.getTime() + dayOffset * 24 * HORA_MS + hour * HORA_MS,
      );
      const blockEnd = new Date(blockStart.getTime() + HORA_MS);

      // Una mesa se cuenta una sola vez por bloque, incluso si hay más de
      // una reserva confirmada que se traslapa con ese mismo bloque.
      const reservedTableIds = new Set(
        reservations
          .filter((reservation) => {
            if (!tableIds.has(reservation.tableId)) return false;

            const reservationStart = reservation.dateTime;
            const reservationEnd = new Date(
              reservationStart.getTime() +
                reservation.durationMinutes * MINUTO_MS,
            );

            return reservationStart < blockEnd && reservationEnd > blockStart;
          })
          .map((reservation) => reservation.tableId),
      );

      const reservedTables = Math.min(totalTables, reservedTableIds.size);
      const occupancy = Math.min(
        100,
        Math.max(
          0,
          Number(((reservedTables / totalTables) * 100).toFixed(2)),
        ),
      );

      return {
        startTime: `${String(hour).padStart(2, '0')}:00`,
        endTime: `${String((hour + 1) % 24).padStart(2, '0')}:00`,
        reservedTables,
        occupancy,
      };
    });

    return {
      branchId,
      date,
      totalTables,
      slots,
    };
  }
}
