import { LoyaltyRepository } from './loyalty.repository.js';
import {
  LoyaltyRedemptionMovementType,
  LoyaltyRedemptionReleaseReason,
  LoyaltyRedemptionStatus,
  Prisma,
} from '@PrismaClient';

describe('LoyaltyRepository benefits', () => {
  it('consulta únicamente beneficios activos y devuelve campos públicos', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new LoyaltyRepository({
      loyaltyBenefit: { findMany },
    } as never);

    await expect(repository.findActiveBenefits()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: {
        id: true,
        name: true,
        pointsRequired: true,
        discountType: true,
        discountValue: true,
        active: true,
      },
      orderBy: { pointsRequired: 'asc' },
    });
  });
});

describe('LoyaltyRepository H20 saldo', () => {
  it('consulta la cuenta del usuario con saldo total y puntos reservados', async () => {
    const account = {
      id: '22222222-2222-4222-8222-222222222222',
      balance: 500,
      reservedPoints: 200,
    };
    const findUnique = vi.fn().mockResolvedValue(account);
    const repository = new LoyaltyRepository({
      loyaltyAccount: { findUnique },
    } as never);

    await expect(
      repository.findAccountByUserId('11111111-1111-4111-8111-111111111111'),
    ).resolves.toEqual(account);
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId: '11111111-1111-4111-8111-111111111111' },
      select: { id: true, balance: true, reservedPoints: true },
    });
  });
});

describe('LoyaltyRepository redemption transaction units (mocks)', () => {
  it('propaga el error al insertar RESERVED después de crear el canje', async () => {
    const redemption = {
      id: '44444444-4444-4444-8444-444444444444',
      pointsReserved: 100,
      discountAmount: new Prisma.Decimal(5),
      status: LoyaltyRedemptionStatus.RESERVED,
    };
    const movementCreate = vi.fn().mockRejectedValue(new Error('movement insert failed'));
    const tx = {
      loyaltyRedemption: { create: vi.fn().mockResolvedValue(redemption) },
      loyaltyRedemptionMovement: { create: movementCreate },
    };
    const repository = new LoyaltyRepository({} as never);

    await expect(repository.createRedemption(tx as never, {
      loyaltyAccountId: '11111111-1111-4111-8111-111111111111',
      benefitId: '22222222-2222-4222-8222-222222222222',
      orderId: '33333333-3333-4333-8333-333333333333',
      pointsReserved: 100,
      subtotalAmount: new Prisma.Decimal(10),
      discountAmount: new Prisma.Decimal(5),
    })).rejects.toThrow('movement insert failed');

    expect(tx.loyaltyRedemption.create).toHaveBeenCalledOnce();
    expect(movementCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: LoyaltyRedemptionMovementType.RESERVED }),
    }));
  });

  it('solicita la transición COMPLETED y crea un SPENT idempotente; PostgreSQL descuenta el saldo en el trigger', async () => {
    const tx = {
      loyaltyRedemption: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      loyaltyRedemptionMovement: { create: vi.fn().mockResolvedValue({}) },
    };
    const repository = new LoyaltyRepository({} as never);

    await expect(repository.completeRedemptionForPayment(tx as never, {
      redemptionId: '11111111-1111-4111-8111-111111111111',
      loyaltyAccountId: '22222222-2222-4222-8222-222222222222',
      points: 100,
      paymentId: '33333333-3333-4333-8333-333333333333',
    })).resolves.toBe(true);

    expect(tx.loyaltyRedemption.updateMany).toHaveBeenCalledWith({
      where: {
        id: '11111111-1111-4111-8111-111111111111',
        loyaltyAccountId: '22222222-2222-4222-8222-222222222222',
        status: LoyaltyRedemptionStatus.RESERVED,
        paymentId: null,
      },
      data: expect.objectContaining({
        paymentId: '33333333-3333-4333-8333-333333333333',
        status: LoyaltyRedemptionStatus.COMPLETED,
      }),
    });
    expect(tx).not.toHaveProperty('loyaltyAccount.updateMany');
    expect(tx.loyaltyRedemptionMovement.create).toHaveBeenCalledOnce();
    expect(tx.loyaltyRedemptionMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: LoyaltyRedemptionMovementType.SPENT,
        idempotencyKey: '11111111-1111-4111-8111-111111111111:SPENT',
        points: 100,
      }),
    });
  });

  it('no crea el movimiento SPENT si la transición CAS no afecta una reserva activa', async () => {
    const movementCreate = vi.fn();
    const tx = {
      loyaltyRedemption: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      loyaltyRedemptionMovement: { create: movementCreate },
    };
    const repository = new LoyaltyRepository({} as never);

    await expect(repository.completeRedemptionForPayment(tx as never, {
      redemptionId: '11111111-1111-4111-8111-111111111111',
      loyaltyAccountId: '22222222-2222-4222-8222-222222222222',
      points: 100,
      paymentId: '33333333-3333-4333-8333-333333333333',
    })).resolves.toBe(false);

    expect(movementCreate).not.toHaveBeenCalled();
  });

  it('solicita la transición RELEASED y crea un movimiento idempotente; PostgreSQL solo libera reservedPoints', async () => {
    const tx = {
      loyaltyRedemption: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      loyaltyRedemptionMovement: { create: vi.fn().mockResolvedValue({}) },
    };
    const repository = new LoyaltyRepository({} as never);

    await expect(repository.releaseRedemptionForPayment(tx as never, {
      redemptionId: '11111111-1111-4111-8111-111111111111',
      loyaltyAccountId: '22222222-2222-4222-8222-222222222222',
      points: 100,
      reason: LoyaltyRedemptionReleaseReason.PAYMENT_REJECTED,
      paymentId: '33333333-3333-4333-8333-333333333333',
    })).resolves.toBe(true);

    expect(tx.loyaltyRedemption.updateMany).toHaveBeenCalledWith({
      where: {
        id: '11111111-1111-4111-8111-111111111111',
        loyaltyAccountId: '22222222-2222-4222-8222-222222222222',
        status: LoyaltyRedemptionStatus.RESERVED,
        paymentId: null,
      },
      data: expect.objectContaining({
        paymentId: '33333333-3333-4333-8333-333333333333',
        status: LoyaltyRedemptionStatus.RELEASED,
      }),
    });
    expect(tx).not.toHaveProperty('loyaltyAccount.updateMany');
    expect(tx.loyaltyRedemptionMovement.create).toHaveBeenCalledOnce();
    expect(tx.loyaltyRedemptionMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: LoyaltyRedemptionMovementType.RELEASED,
        idempotencyKey: '11111111-1111-4111-8111-111111111111:RELEASED',
        points: 100,
      }),
    });
  });
});
