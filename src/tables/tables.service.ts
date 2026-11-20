import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { isISO8601 } from 'class-validator';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/services/prisma.service.js';

@Injectable()
export class TablesService {
  constructor(private readonly db: PrismaService) {}

  async getAvailability(
    user: User,
    branchId: string,
    dateTime: string,
  ) {
    // Validar fecha y hora
    if (!dateTime || !isISO8601(dateTime)) {
      throw new BadRequestException(
        'La fecha y hora no son válidas',
      );
    }

    const requestedDate = new Date(dateTime);

    // Verificar que la sucursal exista
    const branch = await this.db.branch.findUnique({
      where: { id: branchId },
      select: { id: true },
    });

    if (!branch) {
      throw new NotFoundException('La sucursal no existe');
    }

    // Verificar que el mesero tenga acceso a la sucursal
    const assignment = await this.db.staffBranch.findUnique({
      where: {
        userId_branchId: {
          userId: user.id,
          branchId,
        },
      },
    });

    if (!assignment) {
      throw new ForbiddenException(
        'No tienes acceso a esta sucursal',
      );
    }

    // Consultar mesas, cuentas abiertas y reservas confirmadas
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
            dateTime: {
              lte: requestedDate,
            },
          },
          select: {
            id: true,
            dateTime: true,
            durationMinutes: true,
          },
        },
      },
    });

    // Construir respuesta con el estado de cada mesa
    return {
      items: tables.map((table) => {
        const hasOpenAccount = table.accounts.length > 0;

        const hasReservation = table.reservations.some(
          (reservation) => {
            const reservationEnd = new Date(
              reservation.dateTime.getTime() +
                reservation.durationMinutes * 60 * 1000,
            );

            return reservationEnd > requestedDate;
          },
        );

        let status: 'FREE' | 'OCCUPIED' | 'RESERVED' = 'FREE';

        if (hasOpenAccount) {
          status = 'OCCUPIED';
        } else if (hasReservation) {
          status = 'RESERVED';
        }

        return {
          id: table.id,
          number: table.number,
          capacity: table.capacity,
          status,
          available: status === 'FREE',
        };
      }),
    };
  }
}
