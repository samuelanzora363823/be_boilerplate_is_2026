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

@Injectable()
export class OccupancyService {
  constructor(private readonly prisma: PrismaService) {}

  async getOccupancy(user: User, branchId: string, date: string) {
    // Validar identificador y fecha.
    if (!UUID.test(branchId)) {
      throw new BadRequestException('El identificador de sucursal no es válido.');
    }

    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date
    ) {
      throw new BadRequestException(
        'La fecha debe tener el formato YYYY-MM-DD.',
      );
    }

    // Verificar que la sucursal exista.
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

    // Verificar que el gerente esté asignado a la sucursal.
    const assignment = await this.prisma.staffBranch.findUnique({
      where: {
        userId_branchId: {
          userId: user.id,
          branchId,
        },
      },
    });

    if (!assignment) {
      throw new ForbiddenException(
        'No tienes acceso a esta sucursal.',
      );
    }

    // Consultar el total de mesas.
    const tables = await this.prisma.restaurantTable.findMany({
      where: { branchId },
      select: { id: true },
    });

    const totalTables = tables.length;

    // Generar los bloques horarios.
    const hours = horasDeAtencion(
      branch.openingTime,
      branch.closingTime,
    );

    if (totalTables === 0) {
      return {
        branchId,
        date,
        message: 'La sucursal no tiene mesas registradas.',
        items: [],
      };
    }

    if (hours.length === 0) {
      return {
        branchId,
        date,
        items: [],
      };
    }

    // Convertir la fecha local de El Salvador a UTC.
    const localMidnight = new Date(`${date}T00:00:00.000Z`);
    const startOfDay = new Date(
      localMidnight.getTime() + OFFSET_MS,
    );

    const firstBlock = new Date(
      startOfDay.getTime() + hours[0] * HORA_MS,
    );

    const reservations = await this.prisma.reservation.findMany({
      where: {
        branchId,
        status: 'CONFIRMED',
        dateTime: {
          gte: new Date(firstBlock.getTime() - 24 * HORA_MS),
          lt: new Date(
            startOfDay.getTime() + 2 * 24 * HORA_MS,
          ),
        },
      },
      select: {
        tableId: true,
        dateTime: true,
        durationMinutes: true,
      },
    });

    // Construir los bloques y calcular la ocupación.
    let previousHour = -1;
    let dayOffset = 0;

    const items = hours.map((hour) => {
      // Detectar cuando el horario continúa después de medianoche.
      if (previousHour !== -1 && hour < previousHour) {
        dayOffset++;
      }

      previousHour = hour;

      const blockStart = new Date(
        startOfDay.getTime() +
          dayOffset * 24 * HORA_MS +
          hour * HORA_MS,
      );

      const blockEnd = new Date(
        blockStart.getTime() + HORA_MS,
      );

      // Usar un Set para no contar una mesa más de una vez.
      const reservedTableIds = new Set(
        reservations
          .filter((reservation) => {
            const reservationStart = reservation.dateTime;
            const reservationEnd = new Date(
              reservationStart.getTime() +
                reservation.durationMinutes * 60 * 1000,
            );

            return (
              reservationStart < blockEnd &&
              reservationEnd > blockStart
            );
          })
          .map((reservation) => reservation.tableId),
      );

      const reservedTables = reservedTableIds.size;

      const occupancyPercentage = Number(
        ((reservedTables / totalTables) * 100).toFixed(2),
      );

      return {
        startTime: `${String(hour).padStart(2, '0')}:00`,
        endTime: `${String((hour + 1) % 24).padStart(2, '0')}:00`,
        reservedTables,
        totalTables,
        occupancyPercentage,
      };
    });

    return {
      branchId,
      date,
      items,
    };
  }
}

