
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../prisma/services/prisma.service.js';
import { KitchenGateway } from './kitchen.gateway.js';
import { CreateTableOrderDto, OpenAccountDto } from './dto.js';
import type { User } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly kitchen: KitchenGateway,
  ) {}

  async onModuleInit() {
    await this.kitchen.start();
  }

  private async branch(user: User) {
    const assignments = await this.db.staffBranch.findMany({
      where: { userId: user.id },
      select: { branchId: true },
    });

    if (assignments.length !== 1) {
      throw new ForbiddenException(
        'El mesero debe estar asignado a una sola sucursal',
      );
    }

    return assignments[0].branchId;
  }

  async tables(user: User) {
    const branchId = await this.branch(user);

    return this.db.restaurantTable.findMany({
      where: { branchId },
      orderBy: { number: 'asc' },
      select: {
        id: true,
        number: true,
        capacity: true,
        status: true,
        accounts: {
          where: { status: 'OPEN' },
          select: { id: true },
        },
      },
    });
  }

  async menu(user: User) {
    const branchId = await this.branch(user);

    return this.db.dish.findMany({
      where: {
        status: 'ACTIVE',
        branchDishes: {
          some: {
            branchId,
            stockStatus: 'ACTIVE',
          },
        },
      },
      select: {
        id: true,
        name: true,
        price: true,
        category: {
          select: { name: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async open(user: User, input: OpenAccountDto) {
    const branchId = await this.branch(user);

    const table = await this.db.restaurantTable.findUnique({
      where: { id: input.tableId },
    });

    if (!table || table.branchId !== branchId) {
      throw new NotFoundException('Mesa no existe en tu sucursal');
    }

    let customerId: string | undefined;

    if (input.customerEmail) {
      const customer = await this.db.user.findUnique({
        where: {
          email: input.customerEmail.trim().toLowerCase(),
        },
      });

      if (!customer || customer.role !== 'CLIENTE') {
        throw new NotFoundException('Cliente no encontrado');
      }

      customerId = customer.id;
    }

    // El índice parcial único impide dos cuentas abiertas
    // simultáneamente para la misma mesa.
    try {
      return await this.db.$transaction(async (tx) => {
        const current = await tx.account.findFirst({
          where: {
            tableId: table.id,
            status: 'OPEN',
          },
        });

        if (current) {
          if (
            customerId &&
            current.customerId &&
            current.customerId !== customerId
          ) {
            throw new ConflictException(
              'La cuenta ya está asociada a otro cliente',
            );
          }

          return current;
        }

        if (table.status !== 'FREE') {
          throw new ConflictException('Mesa no disponible');
        }

        const account = await tx.account.create({
          data: {
            branchId,
            tableId: table.id,
            waiterId: user.id,
            customerId,
          },
        });

        await tx.restaurantTable.update({
          where: { id: table.id },
          data: { status: 'OCCUPIED' },
        });

        return account;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'La mesa ya tiene una cuenta abierta',
        );
      }

      throw e;
    }
  }

  async order(user: User, input: CreateTableOrderDto) {
    const branchId = await this.branch(user);

    if (!input.items?.length) {
      throw new BadRequestException(
        'El pedido no puede estar vacío',
      );
    }

    const ids = input.items.map((i) => i.dishId);

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'No repitas platillos; suma sus cantidades',
      );
    }

    const result = await this.db.$transaction(async (tx) => {
      const account = await tx.account.findUnique({
        where: { id: input.accountId },
        include: { table: true },
      });

      if (!account) {
        throw new NotFoundException('Cuenta inexistente');
      }

      if (
        account.branchId !== branchId ||
        account.waiterId !== user.id
      ) {
        throw new ForbiddenException(
          'Cuenta fuera de tu sucursal o asignación',
        );
      }

      if (
        account.status !== 'OPEN' ||
        account.table.status !== 'OCCUPIED'
      ) {
        throw new ConflictException('Cuenta no abierta');
      }

      const dishes = await tx.dish.findMany({
        where: {
          id: { in: ids },
          status: 'ACTIVE',
          branchDishes: {
            some: {
              branchId,
              stockStatus: 'ACTIVE',
            },
          },
        },
      });

      if (dishes.length !== ids.length) {
        throw new ConflictException(
          'Uno o más platillos están agotados, deshabilitados o no existen en esta sucursal',
        );
      }

      const byId = new Map(
        dishes.map((dish) => [dish.id, dish]),
      );

      const total = input.items.reduce(
        (sum, item) =>
          sum.plus(
            byId.get(item.dishId)!.price.mul(item.quantity),
          ),
        new Prisma.Decimal(0),
      );

      const order = await tx.order.create({
        data: {
          accountId: account.id,
          branchId,
          total,
          items: {
            create: input.items.map((item) => ({
              dishId: item.dishId,
              quantity: item.quantity,
              notes: item.notes?.trim() || null,
              unitPrice: byId.get(item.dishId)!.price,
              subtotal: byId
                .get(item.dishId)!
                .price.mul(item.quantity),
            })),
          },
        },
        include: {
          items: {
            include: {
              dish: {
                select: { name: true },
              },
            },
          },
          account: {
            include: {
              table: {
                select: { number: true },
              },
            },
          },
        },
      });

      await tx.account.update({
        where: { id: account.id },
        data: {
          total: { increment: total },
        },
      });

      return order;
    });

    // H5 permite pedidos sin cuenta.
    // H4 exige una cuenta de mesa para notificar a cocina.
    if (!result.account) {
      throw new ConflictException(
        'El pedido de mesa no tiene una cuenta asociada',
      );
    }

    this.kitchen.notify(branchId, {
      id: result.id,
      tableNumber: result.account.table.number,
      status: result.status,
      createdAt: result.createdAt,
      items: result.items.map((item) => ({
        dishId: item.dishId,
        name: item.dish.name,
        quantity: item.quantity,
        notes: item.notes,
      })),
    });

    return result;
  }
}
