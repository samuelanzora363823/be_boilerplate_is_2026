import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { OrdersService } from './orders.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const user = { id: USER_ID, role: 'MESERO' } as never;

function createFixture(options: {
  accountStatus?: string;
  orders?: Array<{
    id: string;
    status: string;
    items: Array<{ subtotal: Prisma.Decimal }>;
  }>;
  discount?: string | null;
  branchId?: string;
  waiterId?: string;
} = {}) {
  const account = {
    id: ACCOUNT_ID,
    branchId: options.branchId ?? BRANCH_ID,
    waiterId: options.waiterId ?? USER_ID,
    tableId: '44444444-4444-4444-8444-444444444444',
    status: options.accountStatus ?? 'OPEN',
    table: { number: 3 },
    customer: null,
    receipt: null,
    orders: options.orders ?? [
      {
        id: '55555555-5555-4555-8555-555555555555',
        status: 'DELIVERED',
        items: [{ subtotal: new Prisma.Decimal('10.00'), dish: { name: 'Hamburguesa' } }],
      },
    ],
  };
  const db = {
    staffBranch: {
      findMany: vi.fn().mockResolvedValue([{ branchId: BRANCH_ID }]),
    },
    account: {
      findUnique: vi.fn().mockResolvedValue(account),
    },
    loyaltyRedemption: {
      findFirst: vi.fn().mockResolvedValue(
        options.discount === null || options.discount === undefined
          ? null
          : { discountAmount: new Prisma.Decimal(options.discount) },
      ),
    },
  };
  const service = new OrdersService(db as never, {} as never, {} as never);
  return { service, db, account };
}

describe('OrdersService - H17 cierre de cuenta', () => {
  it('devuelve importes del backend con descuento reservado e IVA del 13 %', async () => {
    const { service } = createFixture({ discount: '2.00' });

    const result = await service.accountDetail(user, ACCOUNT_ID);

    expect(Number(result.subtotal)).toBe(10);
    expect(Number(result.discount)).toBe(2);
    expect(Number(result.tax)).toBe(1.04);
    expect(Number(result.total)).toBe(9.04);
  });

  it('permite iniciar cobro solo con pedidos entregados y devuelve el mismo desglose', async () => {
    const { service } = createFixture({ discount: '2.00' });

    const result = await service.closeAccount(user, ACCOUNT_ID);

    expect(result.canPay).toBe(true);
    expect(Number(result.subtotal)).toBe(10);
    expect(Number(result.discount)).toBe(2);
    expect(Number(result.tax)).toBe(1.04);
    expect(Number(result.total)).toBe(9.04);
    expect(result.status).toBe('OPEN');
  });

  it('rechaza iniciar cobro cuando no hay pedidos activos', async () => {
    const { service } = createFixture({
      orders: [{
        id: '55555555-5555-4555-8555-555555555555',
        status: 'CANCELLED',
        items: [],
      }],
    });

    await expect(service.closeAccount(user, ACCOUNT_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza iniciar cobro si algún pedido no fue entregado', async () => {
    const { service } = createFixture({
      orders: [{
        id: '55555555-5555-4555-8555-555555555555',
        status: 'READY',
        items: [{ subtotal: new Prisma.Decimal('10.00') }],
      }],
    });

    await expect(service.closeAccount(user, ACCOUNT_ID)).rejects.toBeInstanceOf(ConflictException);
  });

  it('impide consultar una cuenta de otra sucursal', async () => {
    const { service } = createFixture({ branchId: '99999999-9999-4999-8999-999999999999' });

    await expect(service.accountDetail(user, ACCOUNT_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
