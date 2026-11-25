import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoyaltyDiscountType } from '@PrismaClient';
import { CreateLoyaltyBenefitDto } from './create-loyalty-benefit.dto.js';
import { UpdateLoyaltyBenefitDto } from './update-loyalty-benefit.dto.js';
import { UpdateLoyaltyBenefitStatusDto } from './update-loyalty-benefit-status.dto.js';
import { UpdateLoyaltyRuleDto } from './update-loyalty-rule.dto.js';

const validBenefit = {
  name: 'Postre gratis',
  pointsRequired: 100,
  discountType: LoyaltyDiscountType.PERCENTAGE,
  discountValue: 12.5,
};

// Igual que el ValidationPipe global: transforma y después valida.
async function errorsOf<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((error) => error.property);
}

describe('DTO H22 de beneficios', () => {
  it.each([CreateLoyaltyBenefitDto, UpdateLoyaltyBenefitDto])(
    '%p acepta un beneficio válido y recorta el nombre',
    async (cls) => {
      const dto = plainToInstance(cls, { ...validBenefit, name: '  Postre  ' });
      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto.name).toBe('Postre');
    },
  );

  it('acepta nombres de 80 caracteres y rechaza los de 81', async () => {
    expect(await errorsOf(CreateLoyaltyBenefitDto, { ...validBenefit, name: 'a'.repeat(80) })).toEqual([]);
    expect(await errorsOf(CreateLoyaltyBenefitDto, { ...validBenefit, name: 'a'.repeat(81) })).toEqual(['name']);
  });

  it.each([
    ['name', ''],
    ['name', '   '],
    ['name', 123],
    ['pointsRequired', 0],
    ['pointsRequired', -1],
    ['pointsRequired', 1.5],
    ['pointsRequired', '100'],
    ['discountType', 'Percent'],
    ['discountValue', 0],
    ['discountValue', -1],
    ['discountValue', 1.234],
    ['discountValue', '10'],
  ])('rechaza %s = %j', async (field, value) => {
    expect(
      await errorsOf(CreateLoyaltyBenefitDto, { ...validBenefit, [field]: value }),
    ).toContain(field);
  });

  it('exige todos los campos al editar', async () => {
    expect(await errorsOf(UpdateLoyaltyBenefitDto, { name: 'Solo nombre' })).toEqual(
      expect.arrayContaining(['pointsRequired', 'discountType', 'discountValue']),
    );
  });
});

describe('DTO H22 de regla y estado', () => {
  it('acepta una tasa positiva con hasta 2 decimales', async () => {
    expect(await errorsOf(UpdateLoyaltyRuleDto, { pointsPerDollar: 1.25 })).toEqual([]);
  });

  it.each([0, -1, 1.234, '2', null, Number.NaN])(
    'rechaza la tasa %j',
    async (pointsPerDollar) => {
      expect(await errorsOf(UpdateLoyaltyRuleDto, { pointsPerDollar })).toEqual([
        'pointsPerDollar',
      ]);
    },
  );

  it('el estado exige un booleano', async () => {
    expect(await errorsOf(UpdateLoyaltyBenefitStatusDto, { active: false })).toEqual([]);
    expect(await errorsOf(UpdateLoyaltyBenefitStatusDto, { active: 'true' })).toEqual(['active']);
    expect(await errorsOf(UpdateLoyaltyBenefitStatusDto, {})).toEqual(['active']);
  });
});
