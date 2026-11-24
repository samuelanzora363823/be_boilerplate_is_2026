import { ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const TABLE_ID = '33333333-3333-4333-8333-333333333333';

describe('OrdersService - H11 protección de mesas reservadas', () => {
  function fixture(reservation: { dateTime: Date; durationMinutes: number } | null) {
    const table = { id: TABLE_ID, branchId: BRANCH_ID, status: 'FREE' };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      restaurantTable: {
        findUnique: vi.fn().mockResolvedValue(table),
        update: vi.fn().mockResolvedValue({ ...table, status: 'OCCUPIED' }),
      },
      account: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'account-1', tableId: TABLE_ID }),
      },
      reservation: {
        findFirst: vi.fn().mockResolvedValue(reservation),
      },
    };
    const db = {
      staffBranch: {
        findMany: vi.fn().mockResolvedValue([{ branchId: BRANCH_ID }]),
      },
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new OrdersService(
      db as never,
      { start: vi.fn() } as never,
      { lockLoyaltyAccountForPayment: vi.fn() } as never,
    );
    return { service, tx };
  }

  it('rechaza abrir una cuenta cuando una reserva confirmada incluye el momento actual', async () => {
    const activeReservation = {
      dateTime: new Date(Date.now() - 30 * 60_000),
      durationMinutes: 90,
    };
    const { service, tx } = fixture(activeReservation);

    await expect(
      service.open({ id: USER_ID } as never, { tableId: TABLE_ID }),
    ).rejects.toThrow(ConflictException);

    expect(tx.account.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
  });

  it('permite abrir una cuenta cuando no existe una reserva activa', async () => {
    const { service, tx } = fixture(null);

    const result = await service.open(
      { id: USER_ID } as never,
      { tableId: TABLE_ID },
    );

    expect(result).toEqual({ id: 'account-1', tableId: TABLE_ID });
    expect(tx.account.create).toHaveBeenCalledOnce();
    expect(tx.restaurantTable.update).toHaveBeenCalledOnce();
  });
});
