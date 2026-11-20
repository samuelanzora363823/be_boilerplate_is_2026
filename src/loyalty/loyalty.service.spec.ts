import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  LoyaltyDiscountType,
  LoyaltyRedemptionStatus,
  Prisma,
} from '@PrismaClient';
import { LoyaltyService } from './loyalty.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const BENEFIT_ID = '33333333-3333-4333-8333-333333333333';
const REDEMPTION_ID = '44444444-4444-4444-8444-444444444444';

function setup(options: {
  benefit?: Record<string, unknown> | null;
  tableAccount?: Record<string, unknown> | null;
  reserved?: { available: number } | null;
  loyaltyAccount?: {
    id: string;
    userId: string;
    balance: number;
    reservedPoints: number;
  } | null;
  takeawayOrder?: Record<string, unknown> | null;
  activeRedemption?: { id: string } | null;
} = {}) {
  const benefit = 'benefit' in options ? options.benefit : {
    id: BENEFIT_ID,
    active: true,
    pointsRequired: 100,
    discountType: LoyaltyDiscountType.PERCENTAGE,
    discountValue: new Prisma.Decimal(50),
  };
  const tx = {};
  const repository = {
    findActiveBenefits: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    lockLoyaltyAccount: vi.fn().mockResolvedValue(
      'loyaltyAccount' in options ? options.loyaltyAccount : {
        id: ACCOUNT_ID,
        userId: USER_ID,
        balance: 500,
        reservedPoints: 0,
      },
    ),
    lockBenefit: vi.fn().mockResolvedValue(benefit),
    lockTableAccount: vi.fn().mockResolvedValue(
      'tableAccount' in options ? options.tableAccount : {
        id: '55555555-5555-4555-8555-555555555555',
        customerId: USER_ID,
        status: 'OPEN',
        orders: [{ items: [{ subtotal: new Prisma.Decimal('10.05') }] }],
      },
    ),
    lockTakeawayOrder: vi.fn().mockResolvedValue(
      'takeawayOrder' in options ? options.takeawayOrder : {
        id: '66666666-6666-4666-8666-666666666666',
        customerId: USER_ID,
        accountId: null,
        status: 'PENDING_PAYMENT',
        items: [{ subtotal: new Prisma.Decimal('10.05') }],
      },
    ),
    findActiveRedemption: vi.fn().mockResolvedValue(options.activeRedemption ?? null),
    findExpiredRedemptionForPurchase: vi.fn().mockResolvedValue(null),
    releaseExpiredRedemptionInTransaction: vi.fn().mockResolvedValue(true),
    reservePoints: vi.fn().mockResolvedValue(options.reserved ?? { available: 400 }),
    createRedemption: vi.fn().mockImplementation(async (_client, data) => ({
      id: REDEMPTION_ID,
      pointsReserved: data.pointsReserved,
      discountAmount: data.discountAmount,
      status: LoyaltyRedemptionStatus.RESERVED,
    })),
  };
  return {
    repository,
    tx,
    service: new LoyaltyService(repository as never),
  };
}

describe('LoyaltyService H21', () => {
  it('devuelve beneficios activos en items, incluso si la lista está vacía', async () => {
    const { repository, service } = setup();
    await expect(service.getBenefits()).resolves.toEqual({ items: [] });
    expect(repository.findActiveBenefits).toHaveBeenCalledOnce();
  });

  it('reserva puntos, congela subtotal/descuento y devuelve saldo disponible', async () => {
    const { repository, service } = setup();
    const result = await service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    });

    expect(result).toEqual({
      id: REDEMPTION_ID,
      pointsRedeemed: 100,
      balance: 400,
      discountApplied: 5.03,
      status: 'RESERVADO',
    });
    expect(repository.reservePoints).toHaveBeenCalledWith(
      expect.anything(),
      ACCOUNT_ID,
      100,
    );
    const savedData = repository.createRedemption.mock.calls[0][1];
    expect(savedData.subtotalAmount.toString()).toBe('10.05');
    expect(savedData.discountAmount.toString()).toBe('5.03');
  });

  it('limita descuentos porcentuales al 100 % y al subtotal', async () => {
    const { service } = setup({
      benefit: {
        id: BENEFIT_ID,
        active: true,
        pointsRequired: 100,
        discountType: LoyaltyDiscountType.PERCENTAGE,
        discountValue: new Prisma.Decimal(150),
      },
    });
    const result = await service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    });
    expect(result.discountApplied).toBe(10.05);
  });

  it('limita al subtotal un descuento fijo mayor que la compra', async () => {
    const { service } = setup({
      benefit: {
        id: BENEFIT_ID,
        active: true,
        pointsRequired: 100,
        discountType: LoyaltyDiscountType.FIXED,
        discountValue: new Prisma.Decimal('20.00'),
      },
    });
    const result = await service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      orderId: '66666666-6666-4666-8666-666666666666',
    });
    expect(result.discountApplied).toBe(10.05);
  });

  it('devuelve 404 si el beneficio no existe', async () => {
    const { service } = setup({ benefit: null });
    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('devuelve 409 si el beneficio está inactivo', async () => {
    const { service } = setup({
      benefit: {
        id: BENEFIT_ID,
        active: false,
        pointsRequired: 100,
        discountType: LoyaltyDiscountType.FIXED,
        discountValue: new Prisma.Decimal(2),
      },
    });
    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('comprueba propiedad antes del saldo y devuelve 404 para compra inexistente', async () => {
    const { service } = setup({
      loyaltyAccount: null,
      tableAccount: null,
    });
    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('comprueba propiedad antes del saldo y devuelve 403 para compra ajena', async () => {
    const { service } = setup({
      loyaltyAccount: null,
      tableAccount: {
        id: '55555555-5555-4555-8555-555555555555',
        customerId: '77777777-7777-4777-8777-777777777777',
        status: 'OPEN',
        orders: [{ items: [{ subtotal: new Prisma.Decimal(10) }] }],
      },
    });
    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza una cuenta de mesa sin cliente', async () => {
    const { service } = setup({
      tableAccount: {
        id: '55555555-5555-4555-8555-555555555555',
        customerId: null,
        status: 'OPEN',
        orders: [{ items: [{ subtotal: new Prisma.Decimal(10) }] }],
      },
    });
    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('devuelve 409 para compra no elegible y canje duplicado', async () => {
    const ineligible = setup({
      takeawayOrder: {
        id: '66666666-6666-4666-8666-666666666666',
        customerId: USER_ID,
        accountId: '55555555-5555-4555-8555-555555555555',
        status: 'PENDING_PAYMENT',
        items: [{ subtotal: new Prisma.Decimal(10) }],
      },
    });
    await expect(ineligible.service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      orderId: '66666666-6666-4666-8666-666666666666',
    })).rejects.toBeInstanceOf(ConflictException);

    const duplicate = setup({ activeRedemption: { id: REDEMPTION_ID } });
    await expect(duplicate.service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toBeInstanceOf(ConflictException);
    expect(duplicate.repository.reservePoints).not.toHaveBeenCalled();
  });

  it('rechaza si el saldo disponible no alcanza antes de crear el canje', async () => {
    const { repository, service } = setup();
    repository.lockLoyaltyAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      userId: USER_ID,
      balance: 100,
      reservedPoints: 50,
    });
    await expect(
      service.requestRedemption(USER_ID, {
        benefitId: BENEFIT_ID,
        accountId: '55555555-5555-4555-8555-555555555555',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.reservePoints).not.toHaveBeenCalled();
    expect(repository.createRedemption).not.toHaveBeenCalled();
  });

  it('libera un canje vencido antes de volver a calcular saldo disponible', async () => {
    const { repository, service, tx } = setup({ reserved: { available: 0 } });
    repository.lockLoyaltyAccount
      .mockResolvedValueOnce({
        id: ACCOUNT_ID,
        userId: USER_ID,
        balance: 100,
        reservedPoints: 100,
      })
      .mockResolvedValueOnce({
        id: ACCOUNT_ID,
        userId: USER_ID,
        balance: 100,
        reservedPoints: 0,
      });
    repository.findExpiredRedemptionForPurchase.mockResolvedValue({
      id: 'expired-redemption',
    });
    repository.findActiveRedemption.mockResolvedValue(null);

    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).resolves.toMatchObject({ balance: 0 });

    expect(repository.releaseExpiredRedemptionInTransaction).toHaveBeenCalledWith(
      tx,
      'expired-redemption',
      expect.any(Date),
    );
    expect(repository.reservePoints).toHaveBeenCalledOnce();
  });

  // Unit mock: verifies the movement error escapes the transaction callback.
  // A PostgreSQL integration test is required to prove physical rollback.
  it('propaga el fallo al registrar RESERVED dentro de la transacción', async () => {
    const { repository, service, tx } = setup();
    repository.createRedemption.mockRejectedValue(new Error('movement insert failed'));
    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toThrow('movement insert failed');
    expect(repository.transaction).toHaveBeenCalledOnce();
    expect(repository.reservePoints).toHaveBeenCalledWith(tx, ACCOUNT_ID, 100);
    expect(repository.createRedemption).toHaveBeenCalledWith(tx, expect.anything());
  });

  it('clasifica P2002 del índice parcial como canje duplicado', async () => {
    const { repository, service } = setup();
    const uniqueError = new Prisma.PrismaClientKnownRequestError(
      'unique constraint',
      { code: 'P2002', clientVersion: 'test', meta: { target: ['accountId'] } },
    );
    repository.transaction.mockRejectedValue(uniqueError);

    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toThrow('La compra ya tiene un canje activo.');
  });

  it('no etiqueta otra restricción P2002 como canje duplicado', async () => {
    const { repository, service } = setup();
    const uniqueError = new Prisma.PrismaClientKnownRequestError(
      'unique constraint',
      { code: 'P2002', clientVersion: 'test', meta: { target: ['paymentId'] } },
    );
    repository.transaction.mockRejectedValue(uniqueError);

    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toThrow('conflicto de unicidad');
    expect(repository.transaction).toHaveBeenCalledOnce();
  });

  it('reintenta una transacción P2034 y puede completar el segundo intento', async () => {
    const { repository, service, tx } = setup();
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'write conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    repository.transaction
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async (callback) => callback(tx));

    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).resolves.toMatchObject({ id: REDEMPTION_ID });
    expect(repository.transaction).toHaveBeenCalledTimes(2);
  });

  it('devuelve conflicto de concurrencia tras tres errores P2034', async () => {
    const { repository, service } = setup();
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'deadlock',
      { code: 'P2034', clientVersion: 'test' },
    );
    repository.transaction.mockRejectedValue(conflict);

    await expect(service.requestRedemption(USER_ID, {
      benefitId: BENEFIT_ID,
      accountId: '55555555-5555-4555-8555-555555555555',
    })).rejects.toThrow('conflicto de concurrencia');
    expect(repository.transaction).toHaveBeenCalledTimes(3);
  });
});
