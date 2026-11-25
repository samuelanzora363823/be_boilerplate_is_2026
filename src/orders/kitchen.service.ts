import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  DishStatus,
  NotificationSource,
  UserRole,
} from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { KitchenGateway } from './kitchen.gateway.js';

@Injectable()
export class KitchenService {
  constructor(
    private readonly db: PrismaService,
    private readonly kitchen: KitchenGateway,
    private readonly notifications: NotificationsService,
  ) {}

  // H7: obtiene la sucursal cuando el usuario tiene una sola asignacion.
  private async branch(user: User): Promise<string> {
    const assignments = await this.db.staffBranch.findMany({
      where: { userId: user.id },
      select: { branchId: true },
    });

    if (assignments.length !== 1) {
      throw new ForbiddenException(
        'El personal debe estar asignado a una sola sucursal',
      );
    }

    return assignments[0].branchId;
  }

  // H8: verifica que el usuario pertenezca a la sucursal de la comanda.
  private async checkBranch(user: User, branchId: string) {
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
  }

  // H7: consulta las comandas recibidas.
  async orders(user: User) {
    const branchId = await this.branch(user);

    const orders = await this.db.order.findMany({
      where: {
        branchId,
        status: 'RECEIVED',
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
              select: {
                number: true,
              },
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

  // H7: toma una comanda evitando que dos usuarios la tomen simultaneamente.
  // La comanda y sus platillos pasan a IN_PREPARATION en la misma transaccion
  // para que H8 pueda marcar cada platillo como listo.
  async take(user: User, id: string) {
    const branchId = await this.branch(user);

    const order = await this.db.$transaction(async (tx) => {
      const existing = await tx.order.findFirst({
        where: {
          id,
          branchId,
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (!existing) {
        throw new NotFoundException('Comanda no encontrada');
      }

      // Actualizacion condicional: el UPDATE bloquea la fila del pedido y una
      // toma concurrente reevalua el estado tras el commit, obteniendo count 0.
      const result = await tx.order.updateMany({
        where: {
          id,
          branchId,
          status: 'RECEIVED',
        },
        data: {
          status: 'IN_PREPARATION',
        },
      });

      if (result.count === 0) {
        throw new ConflictException(
          'La comanda ya fue tomada o no esta disponible',
        );
      }

      // Solo los platillos recibidos; los cancelados conservan su estado.
      await tx.orderItem.updateMany({
        where: {
          orderId: id,
          status: 'RECEIVED',
        },
        data: {
          status: 'IN_PREPARATION',
        },
      });

      return existing;
    });

    this.kitchen.orderUpdated(branchId, {
      id: order.id,
      status: 'En preparacion',
    });

    return {
      id: order.id,
      status: 'En preparacion',
    };
  }

  // H8: consulta comandas en preparacion de todas las sucursales asignadas.

  // H8/H9: consulta comandas en preparacion y disponibilidad de platillos por sucursal.
  async getOrdersInPreparation(user: User) {
    if (user.role !== UserRole.COCINA) {
      throw new ForbiddenException(
        'Solo el personal de cocina puede consultar comandas',
      );
    }

    const assignments = await this.db.staffBranch.findMany({
      where: { userId: user.id },
      select: { branchId: true },
    });

    const branchIds = assignments.map(
      (assignment) => assignment.branchId,
    );

    if (branchIds.length === 0) {
      return [];
    }

    return this.db.order.findMany({
      where: {
        branchId: { in: branchIds },
        status: 'IN_PREPARATION',
      },
      include: {
        items: {
          include: {
            dish: {
              select: {
                name: true,
                branchDishes: {
                  where: {
                    branchId: { in: branchIds },
                  },
                  select: {
                    branchId: true,
                    stockStatus: true,
                  },
                },
              },
            },
          },
        },
        account: {
          include: {
            table: {
              select: {
                number: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  // H8: marca un platillo como listo.
  async markItemReady(
    user: User,
    orderId: string,
    itemId: string,
    status: 'Listo',
  ) {
    if (user.role !== UserRole.COCINA) {
      throw new ForbiddenException(
        'Solo cocina puede realizar esta accion',
      );
    }

    if (status !== 'Listo') {
      throw new ConflictException('Estado solicitado no permitido');
    }

    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM orders
        WHERE id = ${orderId}::uuid
        FOR UPDATE
      `;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new NotFoundException('Comanda inexistente');
      }

      await this.checkBranch(user, order.branchId);

      if (order.status !== 'IN_PREPARATION') {
        throw new ConflictException(
          'La comanda no esta en preparacion',
        );
      }

      const item = order.items.find((entry) => entry.id === itemId);

      if (!item) {
        throw new NotFoundException(
          'El platillo no pertenece a esta comanda',
        );
      }

      if (item.status !== 'IN_PREPARATION') {
        throw new ConflictException(
          'El platillo no esta en preparacion o ya fue terminado',
        );
      }

      const updated = await tx.orderItem.update({
        where: { id: itemId },
        data: { status: 'READY' },
      });

      return {
        id: order.id,
        branchId: order.branchId,
        itemId: updated.id,
        status: 'Listo',
      };
    });

    this.kitchen.orderUpdated(result.branchId, result);

    return {
      id: result.itemId,
      orderId: result.id,
      status: result.status,
    };
  }

  // H8: marca la comanda completa como lista cuando todos sus platillos terminaron.
  async markOrderReady(
    user: User,
    orderId: string,
    status: 'Listo',
  ) {
    if (user.role !== UserRole.COCINA) {
      throw new ForbiddenException(
        'Solo cocina puede realizar esta accion',
      );
    }

    if (status !== 'Listo') {
      throw new ConflictException('Estado solicitado no permitido');
    }

    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM orders
        WHERE id = ${orderId}::uuid
        FOR UPDATE
      `;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          account: {
            select: {
              waiterId: true,
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException('Comanda inexistente');
      }

      await this.checkBranch(user, order.branchId);

      if (order.status !== 'IN_PREPARATION') {
        throw new ConflictException(
          'La comanda no esta en preparacion',
        );
      }

      if (
        order.items.length === 0 ||
        order.items.some((item) => item.status !== 'READY')
      ) {
        throw new ConflictException(
          'No se puede marcar la comanda lista: hay platillos pendientes',
        );
      }

      if (!order.account?.waiterId) {
        throw new ConflictException(
          'La comanda no tiene un mesero responsable asignado',
        );
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'READY' },
      });

      return {
        id: order.id,
        branchId: order.branchId,
        waiterId: order.account.waiterId,
      };
    });

    await this.notifications.send({
      recipientIds: [result.waiterId],
      title: 'Comanda lista',
      message: `La comanda ${result.id} esta lista para entregar.`,
      sourceModule: NotificationSource.COCINA,
      referenceType: 'Order',
      referenceId: result.id,
    });

    this.kitchen.orderUpdated(result.branchId, {
      id: result.id,
      status: 'Listo',
    });

    return {
      id: result.id,
      status: 'Listo',
    };
  }

  // H8: consulta las comandas listas asignadas al mesero.
  async readyForDelivery(user: User) {
    if (user.role !== UserRole.MESERO) {
      throw new ForbiddenException(
        'Solo meseros pueden consultar entregas',
      );
    }

    const assignments = await this.db.staffBranch.findMany({
      where: { userId: user.id },
      select: { branchId: true },
    });

    if (assignments.length !== 1) {
      throw new ForbiddenException(
        'El mesero debe estar asignado a una sola sucursal',
      );
    }

    const branchId = assignments[0].branchId;

    return this.db.order.findMany({
      where: {
        branchId,
        status: 'READY',
        account: {
          waiterId: user.id,
        },
      },
      include: {
        items: {
          include: {
            dish: {
              select: {
                name: true,
              },
            },
          },
        },
        account: {
          include: {
            table: {
              select: {
                number: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'asc',
      },
    });
  }

  // H8: confirma la entrega de una comanda por su mesero responsable.
  async markDelivered(user: User, orderId: string) {
    if (user.role !== UserRole.MESERO) {
      throw new ForbiddenException(
        'Solo un mesero puede confirmar la entrega',
      );
    }

    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM orders
        WHERE id = ${orderId}::uuid
        FOR UPDATE
      `;

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          account: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Comanda inexistente');
      }

      await this.checkBranch(user, order.branchId);

      if (!order.account || order.account.waiterId !== user.id) {
        throw new ForbiddenException(
          'No eres el mesero responsable de esta comanda',
        );
      }

      if (order.status !== 'READY') {
        throw new ConflictException(
          'Solo se pueden entregar comandas listas',
        );
      }

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'DELIVERED' },
      });

      return {
        id: order.id,
        status: 'Entregado',
      };
    });

    this.kitchen.orderUpdated(
      (await this.db.order.findUnique({
        where: { id: orderId },
        select: { branchId: true },
      }))!.branchId,
      result,
    );

    return result;
  }

  // H9: marca un platillo como agotado en una sucursal y notifica a los meseros afectados.
  async markOutOfStock(
    user: User,
    dishId: string,
    branchId: string,
  ) {
    if (user.role !== UserRole.COCINA) {
      throw new ForbiddenException(
        'Solo el personal de cocina puede realizar esta accion',
      );
    }

    await this.checkBranch(user, branchId);

    const result = await this.db.$transaction(async (tx) => {
      const branchDish = await tx.branchDish.findUnique({
        where: {
          branchId_dishId: {
            branchId,
            dishId,
          },
        },
        include: {
          dish: {
            select: {
              name: true,
            },
          },
        },
      });

      if (!branchDish) {
        throw new NotFoundException(
          'El platillo no existe o no esta registrado en esta sucursal',
        );
      }

      await tx.branchDish.update({
        where: {
          branchId_dishId: {
            branchId,
            dishId,
          },
        },
        data: {
          stockStatus: DishStatus.OUT_OF_STOCK,
        },
      });

      const affectedOrders = await tx.order.findMany({
        where: {
          branchId,
          status: {
            in: ['RECEIVED', 'IN_PREPARATION', 'READY'],
          },
          items: {
            some: {
              dishId,
              status: {
                not: 'CANCELLED',
              },
            },
          },
        },
        select: {
          id: true,
          orderNumber: true,
          account: {
            select: {
              waiterId: true,
            },
          },
        },
      });

      const recipientIds = [
        ...new Set(
          affectedOrders
            .map((order) => order.account?.waiterId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      return {
        dishName: branchDish.dish.name,
        recipientIds,
        affectedOrders,
      };
    });

    if (result.recipientIds.length > 0) {
      const orderNumbers = result.affectedOrders
        .map((order) => order.orderNumber)
        .join(', ');

      await this.notifications.send({
        recipientIds: result.recipientIds,
        title: 'Platillo agotado',
        message:
          `El platillo ${result.dishName} fue marcado como agotado. ` +
          `Revisa las comandas afectadas: ${orderNumbers}.`,
        sourceModule: NotificationSource.COCINA,
        referenceType: 'Dish',
        referenceId: dishId,
      });
    }

    return {
      dishId,
      branchId,
      stockStatus: 'Agotado',
    };
  }
}
