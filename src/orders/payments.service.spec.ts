import { ConflictException } from '@nestjs/common';
import {
  LoyaltyRedemptionReleaseReason,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  UserRole,
} from '../generated/prisma/client.js';
import { PaymentsService } from './payments.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const LOYALTY_ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
const REDEMPTION_ID = '66666666-6666-4666-8666-666666666666';
const PAYMENT_ID = '77777777-7777-4777-8777-777777777777';

function activeRedemption(overrides: Record<string, unknown> = {}) {
  return {
    id: REDEMPTION_ID,
    loyaltyAccountId: LOYALTY_ACCOUNT_ID,
    accountId: ACCOUNT_ID,
    orderId: null,
    pointsReserved: 100,
    expiresAt: new Date(Date.now() + 60_000),
    status: 'RESERVED',
    loyaltyAccount: { userId: USER_ID },
    ...overrides,
  };
}

function setup(options: {
  redemption?: ReturnType<typeof activeRedemption> | null;
  accountOrders?: Array<Record<string, unknown>>;
  order?: Record<string, unknown>;
} = {}) {
  const redemption = options.redemption ?? null;
  const account = {
    id: ACCOUNT_ID,
    branchId: BRANCH_ID,
    waiterId: 'waiter-id',
    customerId: USER_ID,
    status: 'OPEN',
    tableId: 'table-id',
    table: { id: 'table-id' },
    orders: options.accountOrders ?? [
      {
        id: 'table-order-1',
        status: 'DELIVERED',
        items: [
          {
            unitPrice: new Prisma.Decimal('10.00'),
            subtotal: new Prisma.Decimal('10.00'),
            quantity: 1,
            dish: { name: 'Comida' },
          },
        ],
      },
    ],
  };
  const order = options.order ?? {
    id: ORDER_ID,
    branchId: BRANCH_ID,
    customerId: USER_ID,
    accountId: null,
    status: 'PENDING_PAYMENT',
    orderNumber: 'TA-1',
    items: [
      {
        unitPrice: new Prisma.Decimal('10.00'),
        subtotal: new Prisma.Decimal('10.00'),
        quantity: 1,
        dish: { name: 'Comida' },
      },
    ],
  };

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: ACCOUNT_ID }]),
    account: {
      findUnique: vi.fn(({ select }: { select?: unknown }) =>
        select ? { customerId: account.customerId } : account,
      ),
      update: vi.fn().mockResolvedValue({}),
    },
    order: {
      findUnique: vi.fn(({ select }: { select?: Record<string, boolean> }) => {
        if (!select) return order;
        if (select.id) {
          return { id: ORDER_ID, customerId: order.customerId, accountId: null };
        }
        return { customerId: order.customerId };
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      create: vi.fn().mockResolvedValue({ id: PAYMENT_ID }),
    },
    branch: {
      update: vi.fn().mockResolvedValue({ receiptCounter: 7, code: 'SV' }),
    },
    receipt: {
      create: vi.fn().mockResolvedValue({
        id: 'receipt-id',
        receiptNumber: 7,
        issuedAt: new Date('2026-11-19T12:00:00.000Z'),
        subtotal: new Prisma.Decimal('10.00'),
        discount: new Prisma.Decimal(0),
        tax: new Prisma.Decimal('1.30'),
        total: new Prisma.Decimal('11.30'),
        paymentMethod: PaymentMethod.CARD,
      }),
    },
    restaurantTable: { update: vi.fn().mockResolvedValue({}) },
  };
  const db = {
    staffBranch: {
      findMany: vi.fn().mockResolvedValue([{ branchId: BRANCH_ID }]),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const loyalty = {
    findReservedRedemptionForPurchase: vi
      .fn()
      .mockResolvedValueOnce(redemption)
      .mockResolvedValueOnce(redemption),
    lockLoyaltyAccountForPayment: vi.fn().mockResolvedValue({
      id: LOYALTY_ACCOUNT_ID,
      userId: USER_ID,
      balance: 500,
      reservedPoints: 100,
    }),
    completeRedemptionForPayment: vi.fn().mockResolvedValue(undefined),
    releaseRedemptionForPayment: vi.fn().mockResolvedValue(undefined),
    releaseExpiredRedemptionInTransaction: vi.fn().mockResolvedValue(true),
    processApprovedPayment: vi.fn().mockResolvedValue(undefined),
  };
  const kitchen = { notify: vi.fn() };
  const service = new PaymentsService(db as never, kitchen as never, loyalty as never);
  vi.spyOn(
    service as unknown as { delay: (milliseconds: number) => Promise<void> },
    'delay',
  ).mockResolvedValue(undefined);

  return { service, db, tx, loyalty, kitchen, account, order };
}

const mesero = { id: 'waiter-id', role: UserRole.MESERO } as never;
const cliente = { id: USER_ID, role: UserRole.CLIENTE } as never;

describe('PaymentsService H18/H19 with H21 canjes (unit mocks)', () => {
  it('H18 approves without a canje using the current zero-discount amount', async () => {
    const { service, tx, loyalty } = setup();
    const result = await service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '4242',
    });

    expect(result.status).toBe('APPROVED');
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: PaymentStatus.APPROVED, amount: new Prisma.Decimal('11.30') }),
    }));
    expect(tx.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ discount: new Prisma.Decimal(0), tax: new Prisma.Decimal('1.30') }),
    }));
    expect(loyalty.completeRedemptionForPayment).not.toHaveBeenCalled();
    expect(loyalty.processApprovedPayment).toHaveBeenCalledWith(USER_ID, PAYMENT_ID, 11.3);
  });

  it('H18 applies the frozen discount and completes the redemption atomically', async () => {
    const redemption = activeRedemption({ discountAmount: new Prisma.Decimal('2.00') });
    const { service, tx, loyalty } = setup({ redemption });
    tx.receipt.create.mockResolvedValue({
      id: 'receipt-id',
      receiptNumber: 7,
      issuedAt: new Date(),
      subtotal: new Prisma.Decimal('10.00'),
      discount: new Prisma.Decimal('2.00'),
      tax: new Prisma.Decimal('1.04'),
      total: new Prisma.Decimal('9.04'),
      paymentMethod: PaymentMethod.CARD,
    });

    await service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '4242',
    });

    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: new Prisma.Decimal('9.04') }),
    }));
    expect(tx.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        subtotal: new Prisma.Decimal('10.00'),
        discount: new Prisma.Decimal('2.00'),
        tax: new Prisma.Decimal('1.04'),
        total: new Prisma.Decimal('9.04'),
      }),
    }));
    expect(loyalty.completeRedemptionForPayment).toHaveBeenCalledOnce();
    expect(loyalty.completeRedemptionForPayment).toHaveBeenCalledWith(tx, {
      redemptionId: REDEMPTION_ID,
      loyaltyAccountId: LOYALTY_ACCOUNT_ID,
      points: 100,
      paymentId: PAYMENT_ID,
    });
    expect(loyalty.findReservedRedemptionForPurchase.mock.invocationCallOrder[0])
      .toBeLessThan(loyalty.lockLoyaltyAccountForPayment.mock.invocationCallOrder[0]);
    expect(loyalty.lockLoyaltyAccountForPayment.mock.invocationCallOrder[0])
      .toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0])
      .toBeLessThan(loyalty.findReservedRedemptionForPurchase.mock.invocationCallOrder[1]);
  });

  it('H18 rejects without a canje and creates neither receipt nor closure', async () => {
    const { service, tx, loyalty } = setup();
    const result = await service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '0002',
    });

    expect(result.status).toBe('REJECTED');
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: PaymentStatus.REJECTED }),
    }));
    expect(tx.receipt.create).not.toHaveBeenCalled();
    expect(tx.account.update).not.toHaveBeenCalled();
    expect(tx.restaurantTable.update).not.toHaveBeenCalled();
    expect(loyalty.processApprovedPayment).not.toHaveBeenCalled();
  });

  it('H18 rejection releases points with PAYMENT_REJECTED exactly once', async () => {
    const { service, tx, loyalty } = setup({ redemption: activeRedemption() });
    const result = await service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '0002',
    });

    expect(result.status).toBe('REJECTED');
    expect(loyalty.releaseRedemptionForPayment).toHaveBeenCalledOnce();
    expect(loyalty.releaseRedemptionForPayment).toHaveBeenCalledWith(tx, {
      redemptionId: REDEMPTION_ID,
      loyaltyAccountId: LOYALTY_ACCOUNT_ID,
      points: 100,
      reason: LoyaltyRedemptionReleaseReason.PAYMENT_REJECTED,
      paymentId: PAYMENT_ID,
    });
    expect(tx.receipt.create).not.toHaveBeenCalled();
    expect(tx.account.update).not.toHaveBeenCalled();
  });

  it('commits EXPIRED release before returning HTTP 409 and does not create payment', async () => {
    const redemption = activeRedemption({ expiresAt: new Date(Date.now() - 1000) });
    const { service, tx, loyalty } = setup({ redemption });

    await expect(service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '4242',
    })).rejects.toBeInstanceOf(ConflictException);

    expect(loyalty.releaseExpiredRedemptionInTransaction).toHaveBeenCalledWith(
      tx,
      REDEMPTION_ID,
      expect.any(Date),
    );
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.receipt.create).not.toHaveBeenCalled();
  });

  it('H18 libera una reserva vencida antes de rechazar efectivo insuficiente', async () => {
    const redemption = activeRedemption({ expiresAt: new Date(Date.now() - 1000) });
    const { service, tx, loyalty } = setup({ redemption });

    await expect(service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CASH,
      amountReceived: 1,
    })).rejects.toBeInstanceOf(ConflictException);

    expect(loyalty.releaseExpiredRedemptionInTransaction).toHaveBeenCalledWith(
      tx,
      REDEMPTION_ID,
      expect.any(Date),
    );
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.receipt.create).not.toHaveBeenCalled();
  });

  it('H19 completes an approved canje against the takeaway order', async () => {
    const redemption = activeRedemption({
      accountId: null,
      orderId: ORDER_ID,
      discountAmount: new Prisma.Decimal('2.00'),
    });
    const { service, tx, loyalty } = setup({ redemption });
    tx.receipt.create.mockResolvedValue({
      id: 'receipt-id',
      receiptNumber: 7,
      issuedAt: new Date(),
      subtotal: new Prisma.Decimal('10.00'),
      discount: new Prisma.Decimal('2.00'),
      tax: new Prisma.Decimal('1.04'),
      total: new Prisma.Decimal('9.04'),
      paymentMethod: PaymentMethod.CARD,
    });

    const result = await service.payTakeawayOrder(cliente, ORDER_ID, { cardLast4: '4242' });
    expect(result.status).toBe('APPROVED');
    expect(loyalty.completeRedemptionForPayment).toHaveBeenCalledOnce();
    expect(tx.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ discount: new Prisma.Decimal('2.00'), tax: new Prisma.Decimal('1.04') }),
    }));
    expect(loyalty.processApprovedPayment).toHaveBeenCalledWith(USER_ID, PAYMENT_ID, 9.04);
  });

  it('H19 approves without a canje and preserves the existing total', async () => {
    const { service, tx, loyalty } = setup();
    const result = await service.payTakeawayOrder(cliente, ORDER_ID, { cardLast4: '4242' });
    expect(result.status).toBe('APPROVED');
    expect(tx.payment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount: new Prisma.Decimal('11.30') }),
    }));
    expect(loyalty.completeRedemptionForPayment).not.toHaveBeenCalled();
    expect(loyalty.processApprovedPayment).toHaveBeenCalledWith(USER_ID, PAYMENT_ID, 11.3);
  });

  it('H19 rejection without a canje leaves receipt and order unchanged', async () => {
    const { service, tx, loyalty } = setup();
    const result = await service.payTakeawayOrder(cliente, ORDER_ID, { cardLast4: '0002' });
    expect(result.status).toBe('REJECTED');
    expect(tx.receipt.create).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(loyalty.processApprovedPayment).not.toHaveBeenCalled();
  });

  it('H19 rejection releases its canje exactly once', async () => {
    const redemption = activeRedemption({ accountId: null, orderId: ORDER_ID });
    const { service, tx, loyalty } = setup({ redemption });
    await service.payTakeawayOrder(cliente, ORDER_ID, { cardLast4: '0002' });
    expect(loyalty.releaseRedemptionForPayment).toHaveBeenCalledOnce();
    expect(loyalty.releaseRedemptionForPayment).toHaveBeenCalledWith(tx, {
      redemptionId: REDEMPTION_ID,
      loyaltyAccountId: LOYALTY_ACCOUNT_ID,
      points: 100,
      reason: LoyaltyRedemptionReleaseReason.PAYMENT_REJECTED,
      paymentId: PAYMENT_ID,
    });
  });

  it('H19 expired canje is released and committed before returning 409', async () => {
    const redemption = activeRedemption({
      accountId: null,
      orderId: ORDER_ID,
      expiresAt: new Date(Date.now() - 1000),
    });
    const { service, tx, loyalty } = setup({ redemption });
    await expect(service.payTakeawayOrder(cliente, ORDER_ID, { cardLast4: '4242' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(loyalty.releaseExpiredRedemptionInTransaction).toHaveBeenCalledWith(
      tx,
      REDEMPTION_ID,
      expect.any(Date),
    );
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.receipt.create).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('no aplica un canje que pertenezca a otro cliente', async () => {
    const redemption = activeRedemption({ loyaltyAccount: { userId: 'other-user' } });
    const { service, tx, loyalty } = setup({ redemption });
    await expect(service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '4242',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(loyalty.completeRedemptionForPayment).not.toHaveBeenCalled();
  });

  it('rechaza si el canje reservado cambia entre la lectura inicial y la lectura bloqueada', async () => {
    const { service, loyalty, tx } = setup({ redemption: activeRedemption() });
    loyalty.findReservedRedemptionForPurchase
      .mockReset()
      .mockResolvedValueOnce(activeRedemption())
      .mockResolvedValueOnce(null);

    await expect(service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '4242',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('no utiliza un canje de otra compra', async () => {
    const redemption = activeRedemption({
      accountId: '88888888-8888-4888-8888-888888888888',
    });
    const { service, tx } = setup({ redemption });
    await expect(service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '4242',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('permite reintentar el pago después del rechazo, usando el canje nuevo o ninguno', async () => {
    const redemption = activeRedemption();
    const { service, tx, loyalty } = setup({ redemption });
    loyalty.findReservedRedemptionForPurchase
      .mockReset()
      .mockResolvedValueOnce(redemption)
      .mockResolvedValueOnce(redemption)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    tx.payment.create
      .mockResolvedValueOnce({ id: 'rejected-payment' })
      .mockResolvedValueOnce({ id: 'approved-payment' });
    tx.receipt.create.mockResolvedValue({
      id: 'receipt-id', receiptNumber: 8, issuedAt: new Date(),
      subtotal: new Prisma.Decimal('10.00'), discount: new Prisma.Decimal(0),
      tax: new Prisma.Decimal('1.30'), total: new Prisma.Decimal('11.30'),
      paymentMethod: PaymentMethod.CARD,
    });

    const rejected = await service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '0002',
    });
    const approved = await service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '4242',
    });

    expect(rejected.status).toBe('REJECTED');
    expect(approved.status).toBe('APPROVED');
    expect(tx.payment.create).toHaveBeenCalledTimes(2);
    expect(loyalty.releaseRedemptionForPayment).toHaveBeenCalledOnce();
    expect(loyalty.completeRedemptionForPayment).not.toHaveBeenCalled();
    expect(loyalty.processApprovedPayment).toHaveBeenCalledWith(USER_ID, 'approved-payment', 11.3);
  });

  it('suma varios pedidos de mesa con Decimal antes de descontar', async () => {
    const redemption = activeRedemption({ discountAmount: new Prisma.Decimal('3.00') });
    const { service, tx } = setup({
      redemption,
      accountOrders: [
        { status: 'DELIVERED', items: [{ unitPrice: new Prisma.Decimal('10.00'), subtotal: new Prisma.Decimal('10.00'), quantity: 1, dish: { name: 'A' } }] },
        { status: 'DELIVERED', items: [{ unitPrice: new Prisma.Decimal('20.00'), subtotal: new Prisma.Decimal('20.00'), quantity: 1, dish: { name: 'B' } }] },
      ],
    });
    tx.receipt.create.mockResolvedValue({
      id: 'receipt-id', receiptNumber: 7, issuedAt: new Date(),
      subtotal: new Prisma.Decimal('30.00'), discount: new Prisma.Decimal('3.00'),
      tax: new Prisma.Decimal('3.51'), total: new Prisma.Decimal('30.51'),
      paymentMethod: PaymentMethod.CARD,
    });

    await service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '4242',
    });

    expect(tx.receipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        subtotal: new Prisma.Decimal('30.00'),
        discount: new Prisma.Decimal('3.00'),
        tax: new Prisma.Decimal('3.51'),
        total: new Prisma.Decimal('30.51'),
      }),
    }));
  });

  it('si completar H21 falla, no continúa a receipt, cierre ni H20', async () => {
    const { service, tx, loyalty } = setup({ redemption: activeRedemption() });
    loyalty.completeRedemptionForPayment.mockRejectedValue(new Error('completion failed'));
    await expect(service.registerPayment(mesero, {
      accountId: ACCOUNT_ID,
      method: PaymentMethod.CARD,
      cardLast4: '4242',
    })).rejects.toThrow('completion failed');

    expect(tx.payment.create).toHaveBeenCalledOnce();
    expect(tx.receipt.create).not.toHaveBeenCalled();
    expect(tx.account.update).not.toHaveBeenCalled();
    expect(tx.restaurantTable.update).not.toHaveBeenCalled();
    expect(loyalty.processApprovedPayment).not.toHaveBeenCalled();
  });

  it('si H19 no puede completar H21, no crea receipt ni cambia el estado del pedido', async () => {
    const { service, tx, loyalty } = setup({
      redemption: activeRedemption({ accountId: null, orderId: ORDER_ID }),
    });
    loyalty.completeRedemptionForPayment.mockRejectedValue(new Error('completion failed'));
    await expect(service.payTakeawayOrder(cliente, ORDER_ID, { cardLast4: '4242' }))
      .rejects.toThrow('completion failed');
    expect(tx.payment.create).toHaveBeenCalledOnce();
    expect(tx.receipt.create).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(loyalty.processApprovedPayment).not.toHaveBeenCalled();
  });
});
