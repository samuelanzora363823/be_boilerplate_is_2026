import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/services/prisma.service.js';
import { KitchenService } from './kitchen.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';

const user = { id: USER_ID } as User;

function crearServicio(opciones: {
  assignments?: { branchId: string }[];
  orders?: any[];
  existingOrder?: { id: string; status: OrderStatus } | null;
  updateMany?: () => Promise<{ count: number }>;
} = {}) {
  const db = {
    staffBranch: {
      findMany: vi.fn().mockResolvedValue(
        opciones.assignments ?? [{ branchId: BRANCH_ID }],
      ),
    },
    order: {
      findMany: vi.fn().mockResolvedValue(opciones.orders ?? []),
      findFirst: vi.fn().mockResolvedValue(
        opciones.existingOrder === undefined
          ? { id: ORDER_ID, status: OrderStatus.RECEIVED }
          : opciones.existingOrder,
      ),
      updateMany: vi.fn(
        opciones.updateMany ?? (() => Promise.resolve({ count: 1 })),
      ),
    },
  };

  return {
    service: new KitchenService(db as unknown as PrismaService),
    db,
  };
}

describe('KitchenService (H7)', () => {
  it('lista las comandas recibidas ordenadas por fecha ascendente', async () => {
    const fecha = new Date('2026-11-08T10:00:00.000Z');

    const { service, db } = crearServicio({
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

    const resultado = await service.orders(user);

    expect(resultado.items).toEqual([
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

  it('devuelve una lista vacía cuando no hay comandas recibidas', async () => {
    const { service } = crearServicio();

    await expect(service.orders(user)).resolves.toEqual({ items: [] });
  });

  it('rechaza usuarios sin exactamente una sucursal asignada', async () => {
    const { service } = crearServicio({ assignments: [] });

    await expect(service.orders(user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('cambia el estado de una comanda recibida a En preparación', async () => {
    const { service, db } = crearServicio();

    const resultado = await service.take(user, ORDER_ID);

    expect(resultado).toEqual({
      id: ORDER_ID,
      status: 'En preparación',
    });

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
  });

  it('devuelve 404 cuando la comanda no existe en la sucursal', async () => {
    const { service, db } = crearServicio({ existingOrder: null });

    await expect(service.take(user, ORDER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(db.order.updateMany).not.toHaveBeenCalled();
  });

  it('devuelve 409 cuando la comanda ya no está disponible', async () => {
    const { service } = crearServicio({
      updateMany: () => Promise.resolve({ count: 0 }),
    });

    await expect(service.take(user, ORDER_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('permite que solo una solicitud tome una comanda simultáneamente', async () => {
    let estado = OrderStatus.RECEIVED;

    const { service, db } = crearServicio({
      updateMany: async () => {
        if (estado !== OrderStatus.RECEIVED) {
          return { count: 0 };
        }

        estado = OrderStatus.IN_PREPARATION;
        return { count: 1 };
      },
    });

    const resultados = await Promise.allSettled([
      service.take(user, ORDER_ID),
      service.take(user, ORDER_ID),
    ]);

    const exitosas = resultados.filter(
      (resultado) => resultado.status === 'fulfilled',
    );

    const rechazadas = resultados.filter(
      (resultado) => resultado.status === 'rejected',
    );

    expect(exitosas).toHaveLength(1);
    expect(rechazadas).toHaveLength(1);

    if (rechazadas[0].status === 'rejected') {
      expect(rechazadas[0].reason).toBeInstanceOf(ConflictException);
    }

    expect(estado).toBe(OrderStatus.IN_PREPARATION);
    expect(db.order.updateMany).toHaveBeenCalledTimes(2);
  });
});
