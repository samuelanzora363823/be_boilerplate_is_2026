import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { isISO8601 } from 'class-validator';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/services/prisma.service.js';

type AvailabilityStatus = 'Libre' | 'Ocupada' | 'Reservada';

@Injectable()
export class TablesService {
  constructor(private readonly db: PrismaService) {}

  async getAvailability(user: User, branchId: string, dateTime: string) {
    if (!dateTime || !isISO8601(dateTime)) {
      throw new BadRequestException('La fecha y hora no son válidas');
    }

    const requestedDate = new Date(dateTime);
    if (Number.isNaN(requestedDate.getTime())) {
      throw new BadRequestException('La fecha y hora no son válidas');
    }

    const branch = await this.db.branch.findUnique({
      where: { id: branchId },
      select: { id: true, isActive: true },
    });

    if (!branch || !branch.isActive) {
      throw new NotFoundException('La sucursal no existe o está inactiva');
    }

    const assignment = await this.db.staffBranch.findUnique({
      where: {
        userId_branchId: {
          userId: user.id,
          branchId,
        },
      },
      select: { userId: true },
    });

    if (!assignment) {
      throw new ForbiddenException('No tienes acceso a esta sucursal');
    }

    const tables = await this.db.restaurantTable.findMany({
      where: { branchId },
      orderBy: { number: 'asc' },
      include: {
        accounts: {
          where: { status: 'OPEN' },
          select: { id: true },
        },
        reservations: {
          where: {
            status: 'CONFIRMED',
            dateTime: { lte: requestedDate },
          },
          select: {
            dateTime: true,
            durationMinutes: true,
          },
        },
      },
    });

    return {
      items: tables.map((table) => {
        const hasOpenAccount = table.accounts.length > 0;
        const hasReservation = table.reservations.some((reservation) => {
          const reservationEnd = new Date(
            reservation.dateTime.getTime() + reservation.durationMinutes * 60_000,
          );
          return reservationEnd > requestedDate;
        });

        let status: AvailabilityStatus = 'Libre';
        if (hasOpenAccount) status = 'Ocupada';
        else if (hasReservation) status = 'Reservada';

        return {
          id: table.id,
          number: table.number,
          capacity: table.capacity,
          status,
          available: status === 'Libre',
        };
      }),
    };
  }
}
