import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import {
  OrderItemStatus,
  OrderStatus,
  UserRole,
} from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/services/prisma.service.js';
import { KitchenService } from './kitchen.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';

describe('KitchenService - H7', () => {
  const user = {
    id: USER_ID,
  } as User;

  function createService(options: {
    assignments?: { branchId: string }[];
    orders?: any[];
    existingOrder?: { id: string; status: OrderStatus } | null;
    updateMany?: () => Promise<{ count: number }>;
    itemUpdateMany?: (args: any) => Promise<{ count: number }>;
  } = {}) {
    const order = {
      findMany: vi.fn().mockResolvedValue(options.orders ?? []),
      findFirst: vi.fn().mockResolvedValue(
        options.existingOrder === undefined
          ? { id: ORDER_ID, status: OrderStatus.RECEIVED }
          : options.existingOrder,
      ),
      updateMany: vi.fn(
        options.updateMany ?? (() => Promise.resolve({ count: 1 })),
      ),
    };

    const orderItem = {
      updateMany: vi.fn(
        options.itemUpdateMany ?? (() => Promise.resolve({ count: 2 })),
      ),
    };

    const tx = { order, orderItem };

    const db = {
      staffBranch: {
        findMany: vi.fn().mockResolvedValue(
          options.assignments ?? [{ branchId: BRANCH_ID }],
        ),
      },
      order,
      orderItem,
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };

    const kitchen = {
      orderUpdated: vi.fn(),
    };

    return {
      service: new KitchenService(
        db as any,
        kitchen as any,
        {} as any,
      ),
      db,
      kitchen,
    };
  }

  it('lista las comandas recibidas ordenadas por fecha ascendente', async () => {
    const fecha = new Date('2026-11-08T10:00:00.000Z');

    const { service, db } = createService({
      orders: [
        {
          id: ORDER_ID,
          orderNumber: 'COM-001',
          status: OrderStatus.RECEIVED,
          createdAt: fecha,
          account: { table: { number: 4 } },
          items: [{ notes: 'Sin cebolla' }, { notes: null }],
        },
      ],
    });

    const result = await service.orders(user);

    expect(result.items).toEqual([
      {
        id: ORDER_ID,
        tableNumber: '4',
        orderNumber: 'COM-001',
        notes: 'Sin cebolla',
        status: OrderStatus.RECEIVED,
        createdAt: fecha.toISOString(),
      },
    ]);

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          branchId: BRANCH_ID,
          status: OrderStatus.RECEIVED,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  });

  it('devuelve una lista vacia cuando no hay comandas recibidas', async () => {
    const { service } = createService();

    await expect(service.orders(user)).resolves.toEqual({ items: [] });
  });

  it('rechaza usuarios sin exactamente una sucursal asignada', async () => {
    const { service } = createService({ assignments: [] });

    await expect(service.orders(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('cambia la comanda y sus platillos a En preparacion en una transaccion', async () => {
    const { service, db, kitchen } = createService();

    const result = await service.take(user, ORDER_ID);

    expect(result).toEqual({
      id: ORDER_ID,
      status: 'En preparacion',
    });

    expect(db.$transaction).toHaveBeenCalledTimes(1);

    expect(db.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: ORDER_ID,
        branchId: BRANCH_ID,
        status: OrderStatus.RECEIVED,
      },
      data: {
        status: OrderStatus.IN_PREPARATION,
      },
    });

    expect(db.orderItem.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: ORDER_ID,
        status: OrderItemStatus.RECEIVED,
      },
      data: {
        status: OrderItemStatus.IN_PREPARATION,
      },
    });

    // La comanda se toma antes de actualizar sus platillos.
    expect(db.order.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.orderItem.updateMany.mock.invocationCallOrder[0],
    );

    expect(kitchen.orderUpdated).toHaveBeenCalledWith(BRANCH_ID, {
      id: ORDER_ID,
      status: 'En preparacion',
    });
  });

  it('devuelve 404 cuando la comanda no existe en la sucursal', async () => {
    const { service, db, kitchen } = createService({ existingOrder: null });

    await expect(service.take(user, ORDER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(db.order.updateMany).not.toHaveBeenCalled();
    expect(db.orderItem.updateMany).not.toHaveBeenCalled();
    expect(kitchen.orderUpdated).not.toHaveBeenCalled();
  });

  it('devuelve 409 sin tocar platillos cuando la comanda ya fue tomada', async () => {
    const { service, db, kitchen } = createService({
      existingOrder: { id: ORDER_ID, status: OrderStatus.IN_PREPARATION },
      updateMany: () => Promise.resolve({ count: 0 }),
    });

    await expect(service.take(user, ORDER_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(db.orderItem.updateMany).not.toHaveBeenCalled();
    expect(kitchen.orderUpdated).not.toHaveBeenCalled();
  });

  it('devuelve 409 y no actualiza platillos de una comanda cancelada', async () => {
    const { service, db, kitchen } = createService({
      existingOrder: { id: ORDER_ID, status: OrderStatus.CANCELLED },
      updateMany: () => Promise.resolve({ count: 0 }),
    });

    await expect(service.take(user, ORDER_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(db.orderItem.updateMany).not.toHaveBeenCalled();
    expect(kitchen.orderUpdated).not.toHaveBeenCalled();
  });

  it('conserva cancelados los platillos cancelados de una comanda tomada', async () => {
    const items = [
      { id: 'item-1', orderId: ORDER_ID, status: OrderItemStatus.RECEIVED },
      { id: 'item-2', orderId: ORDER_ID, status: OrderItemStatus.CANCELLED },
      { id: 'item-3', orderId: ORDER_ID, status: OrderItemStatus.RECEIVED },
    ];

    // Simula el filtro de PostgreSQL aplicando el where recibido.
    const { service } = createService({
      itemUpdateMany: async ({ where, data }) => {
        const matching = items.filter(
          (item) =>
            item.orderId === where.orderId && item.status === where.status,
        );
        matching.forEach((item) => {
          item.status = data.status;
        });
        return { count: matching.length };
      },
    });

    await service.take(user, ORDER_ID);

    expect(items.map((item) => item.status)).toEqual([
      OrderItemStatus.IN_PREPARATION,
      OrderItemStatus.CANCELLED,
      OrderItemStatus.IN_PREPARATION,
    ]);
  });

  it('permite que solo una solicitud tome una comanda simultaneamente', async () => {
    let status: OrderStatus = OrderStatus.RECEIVED;

    const { service, db } = createService({
      updateMany: async () => {
        if (status !== OrderStatus.RECEIVED) {
          return { count: 0 };
        }

        status = OrderStatus.IN_PREPARATION;
        return { count: 1 };
      },
    });

    const results = await Promise.allSettled([
      service.take(user, ORDER_ID),
      service.take(user, ORDER_ID),
    ]);

    const successful = results.filter(
      (result) => result.status === 'fulfilled',
    );

    const rejected = results.filter(
      (result) => result.status === 'rejected',
    );

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    if (rejected[0].status === 'rejected') {
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
    }

    expect(status).toBe(OrderStatus.IN_PREPARATION);

    // Solo la toma ganadora actualiza los platillos.
    expect(db.orderItem.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('KitchenService - H8', () => {
  const kitchenUser = {
    id: 'kitchen-1',
    role: UserRole.COCINA,
  } as User;

  const orderId = '11111111-1111-4111-8111-111111111111';
  const itemId = '22222222-2222-4222-8222-222222222222';
  const branchId = '33333333-3333-4333-8333-333333333333';

  let service: KitchenService;
  let tx: any;
  let db: any;
  let kitchen: any;
  let notifications: any;

  beforeEach(() => {
    tx = {
      $queryRaw: vi.fn(),
      order: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      orderItem: {
        update: vi.fn(),
      },
    };

    db = {
      $transaction: vi.fn(async (callback) => callback(tx)),
      staffBranch: {
        findUnique: vi.fn().mockResolvedValue({
          userId: kitchenUser.id,
          branchId,
        }),
        findMany: vi.fn(),
      },
      order: {
        findMany: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ branchId }),
      },
    };

    kitchen = {
      orderUpdated: vi.fn(),
    };

    notifications = {
      send: vi.fn().mockResolvedValue([]),
    };

    service = new KitchenService(db, kitchen, notifications);
  });

  it('marca un platillo en preparacion como listo', async () => {
    tx.order.findUnique.mockResolvedValue({
      id: orderId,
      branchId,
      status: 'IN_PREPARATION',
      items: [{ id: itemId, status: 'IN_PREPARATION' }],
    });

    tx.orderItem.update.mockResolvedValue({
      id: itemId,
      status: 'READY',
    });

    const result = await service.markItemReady(
      kitchenUser,
      orderId,
      itemId,
      'Listo',
    );

    expect(tx.orderItem.update).toHaveBeenCalledWith({
      where: { id: itemId },
      data: { status: 'READY' },
    });

    expect(result).toEqual({
      id: itemId,
      orderId,
      status: 'Listo',
    });

    expect(kitchen.orderUpdated).toHaveBeenCalled();
  });

  it('rechaza marcar un platillo si la comanda no esta en preparacion', async () => {
    tx.order.findUnique.mockResolvedValue({
      id: orderId,
      branchId,
      status: 'RECEIVED',
      items: [{ id: itemId, status: 'IN_PREPARATION' }],
    });

    await expect(
      service.markItemReady(kitchenUser, orderId, itemId, 'Listo'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('rechaza la operacion si el usuario no pertenece a la sucursal', async () => {
    db.staffBranch.findUnique.mockResolvedValue(null);

    tx.order.findUnique.mockResolvedValue({
      id: orderId,
      branchId,
      status: 'IN_PREPARATION',
      items: [{ id: itemId, status: 'IN_PREPARATION' }],
    });

    await expect(
      service.markItemReady(kitchenUser, orderId, itemId, 'Listo'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });

  it('marca la comanda lista cuando todos sus platillos estan listos', async () => {
    tx.order.findUnique.mockResolvedValue({
      id: orderId,
      branchId,
      status: 'IN_PREPARATION',
      items: [{ id: itemId, status: 'READY' }],
      account: { waiterId: 'waiter-1' },
    });

    tx.order.update.mockResolvedValue({});

    const result = await service.markOrderReady(
      kitchenUser,
      orderId,
      'Listo',
    );

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'READY' },
    });

    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['waiter-1'],
        sourceModule: 'COCINA',
        referenceType: 'Order',
        referenceId: orderId,
      }),
    );

    expect(result).toEqual({
      id: orderId,
      status: 'Listo',
    });
  });

  it('rechaza marcar lista una comanda con platillos pendientes', async () => {
    tx.order.findUnique.mockResolvedValue({
      id: orderId,
      branchId,
      status: 'IN_PREPARATION',
      items: [
        { id: itemId, status: 'READY' },
        { id: 'item-2', status: 'IN_PREPARATION' },
      ],
      account: { waiterId: 'waiter-1' },
    });

    await expect(
      service.markOrderReady(kitchenUser, orderId, 'Listo'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.order.update).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('rechaza marcar lista una comanda sin mesero responsable', async () => {
    tx.order.findUnique.mockResolvedValue({
      id: orderId,
      branchId,
      status: 'IN_PREPARATION',
      items: [{ id: itemId, status: 'READY' }],
      account: null,
    });

    await expect(
      service.markOrderReady(kitchenUser, orderId, 'Listo'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('permite al mesero consultar sus comandas listas', async () => {
    const waiter = {
      id: 'waiter-1',
      role: UserRole.MESERO,
    } as User;

    db.staffBranch.findMany.mockResolvedValue([{ branchId }]);
    db.order.findMany.mockResolvedValue([
      { id: orderId, status: 'READY' },
    ]);

    const result = await service.readyForDelivery(waiter);

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          branchId,
          status: 'READY',
          account: { waiterId: waiter.id },
        },
      }),
    );

    expect(result).toHaveLength(1);
  });

  it('rechaza entregar una comanda que no esta lista', async () => {
    const waiter = {
      id: 'waiter-1',
      role: UserRole.MESERO,
    } as User;

    tx.order.findUnique.mockResolvedValue({
      id: orderId,
      branchId,
      status: 'IN_PREPARATION',
      account: { waiterId: waiter.id },
    });

    await expect(
      service.markDelivered(waiter, orderId),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('rechaza la entrega si el mesero no es responsable', async () => {
    const waiter = {
      id: 'waiter-2',
      role: UserRole.MESERO,
    } as User;

    tx.order.findUnique.mockResolvedValue({
      id: orderId,
      branchId,
      status: 'READY',
      account: { waiterId: 'waiter-1' },
    });

    await expect(
      service.markDelivered(waiter, orderId),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('marca como entregada una comanda lista', async () => {
    const waiter = {
      id: 'waiter-1',
      role: UserRole.MESERO,
    } as User;

    tx.order.findUnique.mockResolvedValue({
      id: orderId,
      branchId,
      status: 'READY',
      account: { waiterId: waiter.id },
    });

    tx.order.update.mockResolvedValue({});

    const result = await service.markDelivered(waiter, orderId);

    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: orderId },
      data: { status: 'DELIVERED' },
    });

    expect(result).toEqual({
      id: orderId,
      status: 'Entregado',
    });

    expect(kitchen.orderUpdated).toHaveBeenCalled();
  });

  it('consulta las comandas en preparacion de las sucursales asignadas', async () => {
    const orders = [
      {
        id: orderId,
        status: 'IN_PREPARATION',
      },
    ];

    db.staffBranch.findMany.mockResolvedValue([{ branchId }]);
    db.order.findMany.mockResolvedValue(orders);

    const result = await service.getOrdersInPreparation(kitchenUser);

    expect(db.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          branchId: { in: [branchId] },
          status: 'IN_PREPARATION',
        },
      }),
    );

    expect(result).toEqual(orders);
  });

  it('rechaza consultar comandas si el usuario no es de cocina', async () => {
    const waiter = {
      id: 'waiter-1',
      role: UserRole.MESERO,
    } as User;

    await expect(
      service.getOrdersInPreparation(waiter),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.staffBranch.findMany).not.toHaveBeenCalled();
    expect(db.order.findMany).not.toHaveBeenCalled();
  });

  it('devuelve una lista vacia si cocina no tiene sucursales asignadas', async () => {
    db.staffBranch.findMany.mockResolvedValue([]);

    const result = await service.getOrdersInPreparation(kitchenUser);

    expect(result).toEqual([]);
    expect(db.order.findMany).not.toHaveBeenCalled();
  });
});

describe('KitchenService - H9', () => {
  const kitchenUser = {
    id: USER_ID,
    role: UserRole.COCINA,
  } as User;

  const waiterUser = {
    id: '55555555-5555-4555-8555-555555555555',
    role: UserRole.MESERO,
  } as User;

  const dishId = '66666666-6666-4666-8666-666666666666';

  let service: KitchenService;
  let db: any;
  let tx: any;
  let notifications: any;

  beforeEach(() => {
    tx = {
      branchDish: {
        findUnique: vi.fn().mockResolvedValue({
          branchId: BRANCH_ID,
          dishId,
          dish: {
            name: 'Hamburguesa clasica',
          },
        }),
        update: vi.fn().mockResolvedValue({
          stockStatus: 'OUT_OF_STOCK',
        }),
      },
      order: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    db = {
      staffBranch: {
        findUnique: vi.fn().mockResolvedValue({
          userId: USER_ID,
          branchId: BRANCH_ID,
        }),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    notifications = {
      send: vi.fn().mockResolvedValue([]),
    };

    service = new KitchenService(
      db,
      {} as any,
      notifications,
    );
  });

  it('marca un platillo como agotado en la sucursal seleccionada', async () => {
    const result = await service.markOutOfStock(
      kitchenUser,
      dishId,
      BRANCH_ID,
    );

    expect(tx.branchDish.update).toHaveBeenCalledWith({
      where: {
        branchId_dishId: {
          branchId: BRANCH_ID,
          dishId,
        },
      },
      data: {
        stockStatus: 'OUT_OF_STOCK',
      },
    });

    expect(result).toEqual({
      dishId,
      branchId: BRANCH_ID,
      stockStatus: 'Agotado',
    });

    expect(db.$transaction).toHaveBeenCalled();
  });

  it('rechaza marcar agotado si el usuario no pertenece a cocina', async () => {
    await expect(
      service.markOutOfStock(waiterUser, dishId, BRANCH_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.staffBranch.findUnique).not.toHaveBeenCalled();
    expect(tx.branchDish.update).not.toHaveBeenCalled();
  });

  it('rechaza la operacion si el usuario no tiene acceso a la sucursal', async () => {
    db.staffBranch.findUnique.mockResolvedValue(null);

    await expect(
      service.markOutOfStock(kitchenUser, dishId, BRANCH_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(tx.branchDish.update).not.toHaveBeenCalled();
  });

  it('devuelve 404 si el platillo no esta registrado en la sucursal', async () => {
    tx.branchDish.findUnique.mockResolvedValue(null);

    await expect(
      service.markOutOfStock(kitchenUser, dishId, BRANCH_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(tx.branchDish.update).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('notifica una sola vez a cada mesero con comandas activas afectadas', async () => {
    tx.order.findMany.mockResolvedValue([
      {
        id: ORDER_ID,
        orderNumber: 'COM-001',
        account: {
          waiterId: 'waiter-1',
        },
      },
      {
        id: '77777777-7777-4777-8777-777777777777',
        orderNumber: 'COM-002',
        account: {
          waiterId: 'waiter-1',
        },
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        orderNumber: 'COM-003',
        account: {
          waiterId: 'waiter-2',
        },
      },
    ]);

    await service.markOutOfStock(
      kitchenUser,
      dishId,
      BRANCH_ID,
    );

    expect(tx.order.findMany).toHaveBeenCalledWith({
      where: {
        branchId: BRANCH_ID,
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

    expect(notifications.send).toHaveBeenCalledTimes(1);

    expect(notifications.send).toHaveBeenCalledWith({
      recipientIds: ['waiter-1', 'waiter-2'],
      title: 'Platillo agotado',
      message:
        'El platillo Hamburguesa clasica fue marcado como agotado. ' +
        'Revisa las comandas afectadas: COM-001, COM-002, COM-003.',
      sourceModule: 'COCINA',
      referenceType: 'Dish',
      referenceId: dishId,
    });
  });

  it('no envia notificaciones cuando no hay comandas afectadas', async () => {
    tx.order.findMany.mockResolvedValue([]);

    const result = await service.markOutOfStock(
      kitchenUser,
      dishId,
      BRANCH_ID,
    );

    expect(notifications.send).not.toHaveBeenCalled();

    expect(result).toEqual({
      dishId,
      branchId: BRANCH_ID,
      stockStatus: 'Agotado',
    });
  });
});
