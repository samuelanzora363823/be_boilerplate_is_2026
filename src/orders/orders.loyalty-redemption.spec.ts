import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

describe('OrdersService H21 reserved-redemption guard (unit with mocks)', () => {
  it('rejects order edits when its account has a RESERVED redemption', async () => {
    const rawLockSql: string[] = [];
    const tx = {
      $queryRaw: vi.fn(async (query: TemplateStringsArray) => {
        rawLockSql.push(query.join(' '));
        return [];
      }),
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: ORDER_ID, accountId: ACCOUNT_ID })
          .mockResolvedValueOnce({
            id: ORDER_ID,
            accountId: ACCOUNT_ID,
            branchId: 'branch-id',
            status: 'RECEIVED',
            items: [],
            account: {
              id: ACCOUNT_ID,
              customerId: 'customer-id',
              waiterId: 'waiter-id',
              status: 'OPEN',
            },
          }),
      },
      account: {
        findUnique: vi.fn().mockResolvedValue({ customerId: 'customer-id' }),
      },
      loyaltyRedemption: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'reserved-redemption',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    };
    const db = {
      staffBranch: {
        findMany: vi.fn().mockResolvedValue([{ branchId: 'branch-id' }]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const loyalty = {
      lockLoyaltyAccountForPayment: vi.fn().mockResolvedValue({ id: 'loyalty-id' }),
      releaseExpiredRedemptionInTransaction: vi.fn().mockResolvedValue(true),
    };
    const service = new OrdersService(db as never, {} as never, loyalty as never);

    await expect(service.update(
      { id: 'waiter-id' } as never,
      ORDER_ID,
      { items: [{}] } as never,
    )).rejects.toBeInstanceOf(ConflictException);

    expect(loyalty.lockLoyaltyAccountForPayment).toHaveBeenCalledOnce();
    expect(rawLockSql[0]).toContain('accounts');
    expect(rawLockSql[1]).toContain('orders');
    expect(tx.loyaltyRedemption.findFirst).toHaveBeenCalledWith({
      where: { accountId: ACCOUNT_ID, status: 'RESERVED' },
      select: { id: true, expiresAt: true },
    });
  });

  it('libera la reserva vencida bajo los bloqueos actuales antes de continuar la edición', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ id: ORDER_ID, accountId: ACCOUNT_ID })
          .mockResolvedValueOnce({
            id: ORDER_ID,
            accountId: ACCOUNT_ID,
            branchId: 'branch-id',
            status: 'RECEIVED',
            items: [],
            account: {
              id: ACCOUNT_ID,
              customerId: 'customer-id',
              waiterId: 'waiter-id',
              status: 'OPEN',
            },
          }),
      },
      account: {
        findUnique: vi.fn().mockResolvedValue({ customerId: 'customer-id' }),
      },
      loyaltyRedemption: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'expired-redemption',
            expiresAt: new Date(Date.now() - 1000),
          })
          .mockResolvedValueOnce(null),
      },
    };
    const db = {
      staffBranch: {
        findMany: vi.fn().mockResolvedValue([{ branchId: 'branch-id' }]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const loyalty = {
      lockLoyaltyAccountForPayment: vi.fn().mockResolvedValue({ id: 'loyalty-id' }),
      releaseExpiredRedemptionInTransaction: vi.fn().mockResolvedValue(true),
    };
    const service = new OrdersService(db as never, {} as never, loyalty as never);

    await expect(service.update(
      { id: 'waiter-id' } as never,
      ORDER_ID,
      { items: [{}] } as never,
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(loyalty.releaseExpiredRedemptionInTransaction).toHaveBeenCalledWith(
      tx,
      'expired-redemption',
      expect.any(Date),
    );
    expect(
      loyalty.lockLoyaltyAccountForPayment.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
  });
});
