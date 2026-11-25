import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { LoyaltyDiscountType, Prisma } from '@PrismaClient';
import { LoyaltyAdminService } from './loyalty-admin.service.js';

const MANAGER_ID = '11111111-1111-4111-8111-111111111111';
const BENEFIT_ID = '22222222-2222-4222-8222-222222222222';
const RULE_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = new Date('2026-11-20T10:00:00.000Z');
const UPDATED_AT = new Date('2026-11-25T10:00:00.000Z');

function benefitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BENEFIT_ID,
    name: 'Postre gratis',
    pointsRequired: 100,
    discountType: LoyaltyDiscountType.PERCENTAGE,
    discountValue: new Prisma.Decimal('10.00'),
    active: true,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    updatedBy: { id: MANAGER_ID, email: 'gerente@test.local' },
    ...overrides,
  };
}

function setup() {
  const repository = {
    findCurrentRule: vi.fn().mockResolvedValue(null),
    updateRuleWithHistory: vi.fn(),
    findRuleHistory: vi.fn().mockResolvedValue([]),
    findAllBenefits: vi.fn().mockResolvedValue([]),
    createBenefit: vi.fn(),
    updateBenefit: vi.fn(),
    setBenefitActive: vi.fn(),
    // H20/H21: el servicio de gerente no debe tocarlos.
    creditPoints: vi.fn(),
    transaction: vi.fn(),
    reservePoints: vi.fn(),
    createRedemption: vi.fn(),
  };
  return { repository, service: new LoyaltyAdminService(repository as never) };
}

const validBenefit = {
  name: 'Postre gratis',
  pointsRequired: 100,
  discountType: LoyaltyDiscountType.PERCENTAGE,
  discountValue: 10,
};

describe('LoyaltyAdminService H22 regla de acumulación', () => {
  it('sin regla guardada responde la tasa por defecto sin crear registros', async () => {
    const { repository, service } = setup();

    await expect(service.getRuleConfig()).resolves.toEqual({
      pointsPerDollar: 1,
      updatedAt: null,
    });
    expect(repository.updateRuleWithHistory).not.toHaveBeenCalled();
  });

  it('consulta la regla global guardada como número', async () => {
    const { repository, service } = setup();
    repository.findCurrentRule.mockResolvedValue({
      id: RULE_ID,
      pointsPerDollar: new Prisma.Decimal('1.50'),
      updatedAt: UPDATED_AT,
    });

    await expect(service.getRuleConfig()).resolves.toEqual({
      pointsPerDollar: 1.5,
      updatedAt: UPDATED_AT.toISOString(),
    });
  });

  it('actualiza la tasa registrando al gerente responsable', async () => {
    const { repository, service } = setup();
    repository.updateRuleWithHistory.mockResolvedValue({
      id: RULE_ID,
      pointsPerDollar: new Prisma.Decimal('2.25'),
      updatedAt: UPDATED_AT,
    });

    await expect(
      service.updateRuleConfig({ pointsPerDollar: 2.25 }, MANAGER_ID),
    ).resolves.toEqual({ pointsPerDollar: 2.25, updatedAt: UPDATED_AT.toISOString() });

    const [rate, changedById, defaultRate] =
      repository.updateRuleWithHistory.mock.calls[0];
    expect(rate).toEqual(new Prisma.Decimal('2.25'));
    expect(changedById).toBe(MANAGER_ID);
    expect(defaultRate).toEqual(new Prisma.Decimal(1));
  });

  it.each([0, -1, 1.234])(
    'rechaza una tasa inválida (%s) sin escribir',
    async (pointsPerDollar) => {
      const { repository, service } = setup();

      await expect(
        service.updateRuleConfig({ pointsPerDollar }, MANAGER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.updateRuleWithHistory).not.toHaveBeenCalled();
    },
  );

  it('devuelve el historial con valores anterior, nuevo y responsable', async () => {
    const { repository, service } = setup();
    repository.findRuleHistory.mockResolvedValue([
      {
        id: 'h1',
        previousPoints: new Prisma.Decimal('1.00'),
        newPoints: new Prisma.Decimal('1.50'),
        changedAt: UPDATED_AT,
        changedBy: { id: MANAGER_ID, email: 'gerente@test.local' },
      },
    ]);

    await expect(service.getRuleHistory()).resolves.toEqual({
      items: [
        {
          id: 'h1',
          previousPointsPerDollar: 1,
          newPointsPerDollar: 1.5,
          changedAt: UPDATED_AT.toISOString(),
          changedBy: { id: MANAGER_ID, email: 'gerente@test.local' },
        },
      ],
    });
    expect(repository.findRuleHistory).toHaveBeenCalledWith(50);
  });
});

describe('LoyaltyAdminService H22 beneficios', () => {
  it('lista todos los beneficios, incluidos los inactivos', async () => {
    const { repository, service } = setup();
    repository.findAllBenefits.mockResolvedValue([
      benefitRow(),
      benefitRow({ id: 'b2', name: 'Bebida', active: false, updatedBy: null }),
    ]);

    const result = await service.listAllBenefits();

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      id: BENEFIT_ID,
      name: 'Postre gratis',
      pointsRequired: 100,
      discountType: LoyaltyDiscountType.PERCENTAGE,
      discountValue: 10,
      active: true,
      createdAt: CREATED_AT.toISOString(),
      updatedAt: UPDATED_AT.toISOString(),
      updatedBy: { id: MANAGER_ID, email: 'gerente@test.local' },
    });
    expect(result.items[1]).toMatchObject({ active: false, updatedBy: null });
  });

  it('crea un beneficio porcentual con el gerente como responsable', async () => {
    const { repository, service } = setup();
    repository.createBenefit.mockResolvedValue({ status: 'ok', benefit: benefitRow() });

    const result = await service.createBenefit(
      { ...validBenefit, name: '  Postre gratis  ' },
      MANAGER_ID,
    );

    expect(result).toMatchObject({ id: BENEFIT_ID, active: true, discountValue: 10 });
    const [input, userId] = repository.createBenefit.mock.calls[0];
    expect(input).toEqual({
      name: 'Postre gratis',
      pointsRequired: 100,
      discountType: LoyaltyDiscountType.PERCENTAGE,
      discountValue: new Prisma.Decimal(10),
    });
    expect(userId).toBe(MANAGER_ID);
  });

  it('permite descuentos fijos mayores que 100', async () => {
    const { repository, service } = setup();
    repository.createBenefit.mockResolvedValue({
      status: 'ok',
      benefit: benefitRow({
        discountType: LoyaltyDiscountType.FIXED,
        discountValue: new Prisma.Decimal('150.00'),
      }),
    });

    await expect(
      service.createBenefit(
        { ...validBenefit, discountType: LoyaltyDiscountType.FIXED, discountValue: 150 },
        MANAGER_ID,
      ),
    ).resolves.toMatchObject({ discountType: LoyaltyDiscountType.FIXED, discountValue: 150 });
  });

  it('acepta un porcentaje de exactamente 100', async () => {
    const { repository, service } = setup();
    repository.createBenefit.mockResolvedValue({ status: 'ok', benefit: benefitRow() });

    await service.createBenefit({ ...validBenefit, discountValue: 100 }, MANAGER_ID);
    expect(repository.createBenefit).toHaveBeenCalled();
  });

  it.each([
    ['nombre vacío', { name: '   ' }],
    ['puntos en cero', { pointsRequired: 0 }],
    ['puntos decimales', { pointsRequired: 1.5 }],
    ['descuento en cero', { discountValue: 0 }],
    ['descuento negativo', { discountValue: -5 }],
    ['descuento con 3 decimales', { discountValue: 1.234 }],
    ['porcentaje mayor que 100', { discountValue: 100.01 }],
  ])('rechaza %s sin escribir', async (_caso, overrides) => {
    const { repository, service } = setup();

    await expect(
      service.createBenefit({ ...validBenefit, ...overrides }, MANAGER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createBenefit).not.toHaveBeenCalled();
  });

  it('rechaza nombres duplicados con 409', async () => {
    const { repository, service } = setup();
    repository.createBenefit.mockResolvedValue({ status: 'duplicate' });

    await expect(
      service.createBenefit({ ...validBenefit, name: 'POSTRE GRATIS' }, MANAGER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('edita un beneficio y registra al gerente', async () => {
    const { repository, service } = setup();
    repository.updateBenefit.mockResolvedValue({
      status: 'ok',
      benefit: benefitRow({ name: 'Postre doble', pointsRequired: 200 }),
    });

    await expect(
      service.updateBenefit(
        BENEFIT_ID,
        { ...validBenefit, name: 'Postre doble', pointsRequired: 200 },
        MANAGER_ID,
      ),
    ).resolves.toMatchObject({ name: 'Postre doble', pointsRequired: 200 });
    expect(repository.updateBenefit).toHaveBeenCalledWith(
      BENEFIT_ID,
      expect.objectContaining({ name: 'Postre doble', pointsRequired: 200 }),
      MANAGER_ID,
    );
  });

  it('la edición valida igual que el alta', async () => {
    const { repository, service } = setup();

    await expect(
      service.updateBenefit(BENEFIT_ID, { ...validBenefit, discountValue: 101 }, MANAGER_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateBenefit).not.toHaveBeenCalled();
  });

  it('la edición responde 404 si el beneficio no existe y 409 si el nombre se repite', async () => {
    const { repository, service } = setup();
    repository.updateBenefit.mockResolvedValueOnce({ status: 'not_found' });
    repository.updateBenefit.mockResolvedValueOnce({ status: 'duplicate' });

    await expect(
      service.updateBenefit(BENEFIT_ID, validBenefit, MANAGER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateBenefit(BENEFIT_ID, validBenefit, MANAGER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('desactiva un beneficio sin eliminarlo y registra quién lo hizo', async () => {
    const { repository, service } = setup();
    repository.setBenefitActive.mockResolvedValue({
      status: 'ok',
      benefit: benefitRow({ active: false }),
    });

    await expect(
      service.setBenefitActive(BENEFIT_ID, false, MANAGER_ID),
    ).resolves.toMatchObject({
      id: BENEFIT_ID,
      active: false,
      updatedAt: UPDATED_AT.toISOString(),
      updatedBy: { id: MANAGER_ID, email: 'gerente@test.local' },
    });
    expect(repository.setBenefitActive).toHaveBeenCalledWith(BENEFIT_ID, false, MANAGER_ID);
  });

  it('activa un beneficio existente', async () => {
    const { repository, service } = setup();
    repository.setBenefitActive.mockResolvedValue({ status: 'ok', benefit: benefitRow() });

    await expect(
      service.setBenefitActive(BENEFIT_ID, true, MANAGER_ID),
    ).resolves.toMatchObject({ active: true });
  });

  it('cambiar el estado de un beneficio inexistente responde 404', async () => {
    const { repository, service } = setup();
    repository.setBenefitActive.mockResolvedValue({ status: 'not_found' });

    await expect(
      service.setBenefitActive(BENEFIT_ID, false, MANAGER_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('no toca saldos, canjes ni acreditaciones de H20/H21', async () => {
    const { repository, service } = setup();
    repository.createBenefit.mockResolvedValue({ status: 'ok', benefit: benefitRow() });
    repository.setBenefitActive.mockResolvedValue({ status: 'ok', benefit: benefitRow() });

    await service.createBenefit(validBenefit, MANAGER_ID);
    await service.setBenefitActive(BENEFIT_ID, false, MANAGER_ID);

    expect(repository.creditPoints).not.toHaveBeenCalled();
    expect(repository.transaction).not.toHaveBeenCalled();
    expect(repository.reservePoints).not.toHaveBeenCalled();
    expect(repository.createRedemption).not.toHaveBeenCalled();
  });
});
