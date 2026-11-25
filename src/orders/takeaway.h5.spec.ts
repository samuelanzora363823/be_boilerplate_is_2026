import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { TakeawayService } from './takeaway.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const DISH_ID = '33333333-3333-4333-8333-333333333333';

describe('TakeawayService - H5', () => {
  const user = { id: USER_ID } as never;

  const createFixture = () => {
    const branch = {
      id: BRANCH_ID,
      code: 'SV',
      isActive: true,
      openingTime: '00:00',
      closingTime: '23:59',
    };

    const tx = {
      branch: {
        findUnique: vi.fn().mockResolvedValue(branch),
        update: vi.fn().mockResolvedValue({
          takeawayCounter: 15,
        }),
      },
      dish: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: DISH_ID,
            price: new Prisma.Decimal('5.50'),
          },
        ]),
      },
      order: {
        create: vi.fn().mockResolvedValue({
          id: 'order-id',
          orderNumber: 'SV-15',
          status: 'PENDING_PAYMENT',
        }),
      },
    };

    const db = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => unknown) =>
          callback(tx),
      ),
    };

    const service = new TakeawayService(db as never);

    return { service, tx, db };
  };

  it('rechaza platillos repetidos', async () => {
    const { service } = createFixture();

    await expect(
      service.create(user, {
        branchId: BRANCH_ID,
        items: [
          { dishId: DISH_ID, quantity: 1 },
          { dishId: DISH_ID, quantity: 2 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza sucursales inexistentes o inactivas', async () => {
    const { service, tx } = createFixture();

    tx.branch.findUnique.mockResolvedValue({
      id: BRANCH_ID,
      isActive: false,
    });

    await expect(
      service.create(user, {
        branchId: BRANCH_ID,
        items: [{ dishId: DISH_ID, quantity: 1 }],
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza pedidos fuera del horario', async () => {
    const { service, tx } = createFixture();

    tx.branch.findUnique.mockResolvedValue({
      id: BRANCH_ID,
      code: 'SV',
      isActive: true,
      openingTime: '00:00',
      closingTime: '00:00',
    });

    await expect(
      service.create(user, {
        branchId: BRANCH_ID,
        items: [{ dishId: DISH_ID, quantity: 1 }],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rechaza platillos no disponibles', async () => {
    const { service, tx } = createFixture();

    tx.dish.findMany.mockResolvedValue([]);

    await expect(
      service.create(user, {
        branchId: BRANCH_ID,
        items: [{ dishId: DISH_ID, quantity: 1 }],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('crea un pedido para llevar pendiente de pago', async () => {
    const { service, tx } = createFixture();

    const result = await service.create(user, {
      branchId: BRANCH_ID,
      items: [{ dishId: DISH_ID, quantity: 2 }],
    });

    expect(result).toEqual({
      orderId: 'order-id',
      orderNumber: 'SV-15',
      status: 'Pendiente Pago',
    });

    expect(tx.order.create).toHaveBeenCalledOnce();
  });

  it('calcula el total y genera el correlativo', async () => {
    const { service, tx } = createFixture();

    await service.create(user, {
      branchId: BRANCH_ID,
      items: [{ dishId: DISH_ID, quantity: 3 }],
    });

    expect(tx.branch.update).toHaveBeenCalledWith({
      where: { id: BRANCH_ID },
      data: {
        takeawayCounter: { increment: 1 },
      },
      select: {
        takeawayCounter: true,
      },
    });

    const createData = tx.order.create.mock.calls[0][0].data;

    expect(createData.total.toString()).toBe('16.5');
    expect(createData.orderNumber).toBe('SV-15');
    expect(createData.status).toBe('PENDING_PAYMENT');
    expect(createData.customerId).toBe(USER_ID);
  });
});
