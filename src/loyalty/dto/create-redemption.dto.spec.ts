import { validate } from 'class-validator';
import { CreateRedemptionDto } from './create-redemption.dto.js';

const BENEFIT_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';

function dto(values: Partial<CreateRedemptionDto>) {
  return Object.assign(new CreateRedemptionDto(), values);
}

describe('CreateRedemptionDto (unit)', () => {
  it('rechaza ambos identificadores de compra', async () => {
    const errors = await validate(dto({
      benefitId: BENEFIT_ID,
      accountId: ACCOUNT_ID,
      orderId: ORDER_ID,
    }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza la ausencia de ambos identificadores', async () => {
    const errors = await validate(dto({ benefitId: BENEFIT_ID }));
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza UUID inválidos', async () => {
    const errors = await validate(dto({
      benefitId: 'not-a-uuid',
      accountId: ACCOUNT_ID,
    }));
    expect(errors.some((error) => error.property === 'benefitId')).toBe(true);
  });

  it('trata null como ausencia: dos null se rechazan y uno con el otro UUID se acepta', async () => {
    const bothNull = await validate(dto({
      benefitId: BENEFIT_ID,
      accountId: null as unknown as string,
      orderId: null as unknown as string,
    }));
    expect(bothNull.length).toBeGreaterThan(0);

    const oneNull = await validate(dto({
      benefitId: BENEFIT_ID,
      accountId: null as unknown as string,
      orderId: ORDER_ID,
    }));
    expect(oneNull).toHaveLength(0);
  });
});
