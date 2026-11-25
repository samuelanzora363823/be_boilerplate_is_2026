import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { OrdersService } from './orders.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const DISH_ID = '55555555-5555-4555-8555-555555555555';
const ITEM_ID = '66666666-6666-4666-8666-666666666666';

describe('OrdersService - H4 y H6', () => {
  const user = { id: USER_ID } as never;

  const createFixture = () => {
    const account = {
      id: ACCOUNT_ID,
      branchId: BRANCH_ID,
      waiterId: USER_ID,
      customerId: null,
      status: 'OPEN',
      table: { number: 5, status: 'OCCUPIED' },
    };

    const item = {
      id: ITEM_ID,
      dishId: DISH_ID,
      quantity: 1,
      status: 'RECEIVED',
      unitPrice: new Prisma.Decimal('5.50'),
    };

    const existingOrder = {
      id: ORDER_ID,
      accountId: ACCOUNT_ID,
      branchId: BRANCH_ID,
      status: 'RECEIVED',
      total: new Prisma.Decimal('5.50'),
      items: [item],
      account,
    };

    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      account: {
        findUnique: vi.fn().mockResolvedValue(account),
        update: vi.fn().mockResolvedValue(account),
      },
      dish: {
        findMany: vi.fn().mockResolvedValue([
          { id: DISH_ID, price: new Prisma.Decimal('5.50') },
        ]),
      },
      order: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            id: ORDER_ID,
            accountId: ACCOUNT_ID,
          })
          .mockResolvedValueOnce(existingOrder),
        create: vi.fn().mockResolvedValue({
          ...existingOrder,
          createdAt: new Date(),
          items: [
            {
              ...item,
              notes: null,
              dish: { name: 'Hamburguesa' },
            },
          ],
        }),
        update: vi.fn().mockResolvedValue(existingOrder),
      },
      orderItem: {
        update: vi.fn().mockResolvedValue(item),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loyaltyRedemption: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    };

    const db = {
      staffBranch: {
        findMany: vi.fn().mockResolvedValue([
          { branchId: BRANCH_ID },
        ]),
      },
      $transaction: vi.fn(async (callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };

    const kitchen = {
      notify: vi.fn(),
      orderUpdated: vi.fn(),
      orderCancelled: vi.fn(),
    };

    const loyalty = {
      lockLoyaltyAccountForPayment: vi.fn(),
      releaseExpiredRedemptionInTransaction: vi.fn(),
    };

    const service = new OrdersService(
      db as never,
      kitchen as never,
      loyalty as never,
    );

    return { service, tx, db, kitchen, account, existingOrder };
  };

  describe('H4 - Registro de pedidos', () => {
    it('rechaza pedidos vacíos', async () => {
      const { service } = createFixture();

      await expect(
        service.order(user, {
          accountId: ACCOUNT_ID,
          items: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza platillos repetidos', async () => {
      const { service } = createFixture();

      await expect(
        service.order(user, {
          accountId: ACCOUNT_ID,
          items: [
            { dishId: DISH_ID, quantity: 1 },
            { dishId: DISH_ID, quantity: 2 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza cuentas de otro mesero', async () => {
      const { service, tx } = createFixture();

      tx.account.findUnique.mockResolvedValue({
        id: ACCOUNT_ID,
        branchId: BRANCH_ID,
        waiterId: 'otro-mesero',
        customerId: null,
        status: 'OPEN',
        table: { status: 'OCCUPIED' },
      });

      await expect(
        service.order(user, {
          accountId: ACCOUNT_ID,
          items: [{ dishId: DISH_ID, quantity: 1 }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza platillos no disponibles', async () => {
      const { service, tx } = createFixture();
      tx.dish.findMany.mockResolvedValue([]);

      await expect(
        service.order(user, {
          accountId: ACCOUNT_ID,
          items: [{ dishId: DISH_ID, quantity: 1 }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('registra el pedido y notifica a cocina', async () => {
      const { service, tx, kitchen } = createFixture();

      const result = await service.order(user, {
        accountId: ACCOUNT_ID,
        items: [{ dishId: DISH_ID, quantity: 2 }],
      });

      expect(result.id).toBe(ORDER_ID);
      expect(tx.order.create).toHaveBeenCalledOnce();
      expect(tx.account.update).toHaveBeenCalledOnce();
      expect(kitchen.notify).toHaveBeenCalledOnce();

      const createData = tx.order.create.mock.calls[0][0].data;
      expect(createData.total.toString()).toBe('11');
    });
  });

  describe('H6 - Modificación y cancelación', () => {
    it('rechaza modificaciones sin ítems', async () => {
      const { service } = createFixture();

      await expect(
        service.update(user, ORDER_ID, { items: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('modifica cantidades y actualiza el total', async () => {
      const { service, tx, kitchen } = createFixture();

      const result = await service.update(user, ORDER_ID, {
        items: [{ itemId: ITEM_ID, quantity: 2 }],
      });

      expect(result.total.toString()).toBe('11');
      expect(tx.orderItem.update).toHaveBeenCalledOnce();
      expect(tx.account.update).toHaveBeenCalledOnce();
      expect(kitchen.orderUpdated).toHaveBeenCalledOnce();
    });

    it('rechaza modificar pedidos que ya no están recibidos', async () => {
      const { service, tx } = createFixture();

      tx.order.findUnique
        .mockReset()
        .mockResolvedValueOnce({
          id: ORDER_ID,
          accountId: ACCOUNT_ID,
        })
        .mockResolvedValueOnce({
          id: ORDER_ID,
          accountId: ACCOUNT_ID,
          branchId: BRANCH_ID,
          status: 'PREPARING',
          items: [],
          account: {
            id: ACCOUNT_ID,
            customerId: null,
            waiterId: USER_ID,
            status: 'OPEN',
          },
        });

      await expect(
        service.update(user, ORDER_ID, {
          items: [{ itemId: ITEM_ID, quantity: 2 }],
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('cancela el pedido y descuenta su total', async () => {
      const { service, tx, kitchen } = createFixture();

      const result = await service.cancel(user, ORDER_ID);

      expect(result.status).toBe('CANCELLED');
      expect(tx.order.update).toHaveBeenCalledWith({
        where: { id: ORDER_ID },
        data: { status: 'CANCELLED' },
      });
      expect(tx.orderItem.updateMany).toHaveBeenCalledOnce();
      expect(tx.account.update).toHaveBeenCalledOnce();
      expect(kitchen.orderCancelled).toHaveBeenCalledOnce();
    });

    it('rechaza cancelar pedidos que ya están en preparación', async () => {
      const { service, tx } = createFixture();

      tx.order.findUnique
        .mockReset()
        .mockResolvedValueOnce({
          id: ORDER_ID,
          accountId: ACCOUNT_ID,
        })
        .mockResolvedValueOnce({
          id: ORDER_ID,
          accountId: ACCOUNT_ID,
          branchId: BRANCH_ID,
          status: 'PREPARING',
          items: [],
          account: {
            id: ACCOUNT_ID,
            customerId: null,
            waiterId: USER_ID,
            status: 'OPEN',
          },
        });

      await expect(
        service.cancel(user, ORDER_ID),
      ).rejects.toThrow(ConflictException);
    });
  });
});
