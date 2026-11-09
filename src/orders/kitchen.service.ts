import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/services/prisma.service.js';
import type { User } from '../generated/prisma/client.js';
import { OrderStatus } from '../generated/prisma/client.js';

@Injectable()
export class KitchenService {
  constructor(private readonly prisma: PrismaService) {}

  private async branch(user: User): Promise<string> {
    const assignments = await this.prisma.staffBranch.findMany({
      where: { userId: user.id },
      select: { branchId: true },
    });

    if (assignments.length !== 1) {
      throw new ForbiddenException(
        'El personal de cocina debe estar asignado a una sola sucursal',
      );
    }

    return assignments[0].branchId;
  }

  async orders(user: User) {
    const branchId = await this.branch(user);

    const orders = await this.prisma.order.findMany({
      where: {
        branchId,
        status: OrderStatus.RECEIVED,
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        account: {
          select: {
            table: {
              select: { number: true },
            },
          },
        },
        items: {
          select: {
            notes: true,
          },
        },
      },
    });

 return {
  items: orders.map((order) => ({
    id: order.id,
    tableNumber: order.account?.table.number.toString() ?? null,
    orderNumber: order.orderNumber,
    notes:
      order.items
        .map((item) => item.notes)
        .filter((note): note is string => Boolean(note))
        .join('; ') || null,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
  })),
};
  }

  async take(user: User, id: string) {
    const branchId = await this.branch(user);

    const order = await this.prisma.order.findFirst({
      where: {
        id,
        branchId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Comanda no encontrada');
    }

    const result = await this.prisma.order.updateMany({
      where: {
        id,
        branchId,
        status: OrderStatus.RECEIVED,
      },
      data: {
        status: OrderStatus.IN_PREPARATION,
      },
    });

    if (result.count === 0) {
      throw new ConflictException(
        'La comanda ya fue tomada o no está disponible',
      );
    }

    return {
      id: order.id,
      status: 'En preparación',
    };
  }
}
