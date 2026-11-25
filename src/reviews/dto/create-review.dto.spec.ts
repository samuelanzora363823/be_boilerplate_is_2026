import { validate } from 'class-validator';
import { CreateReviewDto } from './create-review.dto.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';

function reviewDto(values: Record<string, unknown>) {
  return Object.assign(new CreateReviewDto(), values);
}

describe('CreateReviewDto', () => {
  it.each([0, 6, 1.5, '5'])('rechaza rating inválido: %s', async (rating) => {
    const errors = await validate(reviewDto({ orderId: ORDER_ID, rating }));
    expect(errors.some((error) => error.property === 'rating')).toBe(true);
  });

  it('rechaza comentarios de más de 500 caracteres', async () => {
    const errors = await validate(
      reviewDto({ accountId: ACCOUNT_ID, rating: 5, comment: 'x'.repeat(501) }),
    );
    expect(errors.some((error) => error.property === 'comment')).toBe(true);
  });

  it('requiere exactamente una cuenta o un pedido y valida sus UUID', async () => {
    const noPurchase = await validate(reviewDto({ rating: 4 }));
    const bothPurchases = await validate(
      reviewDto({ accountId: ACCOUNT_ID, orderId: ORDER_ID, rating: 4 }),
    );
    const invalidUuid = await validate(
      reviewDto({ orderId: 'not-uuid', rating: 4 }),
    );

    expect(noPurchase).not.toHaveLength(0);
    expect(bothPurchases).not.toHaveLength(0);
    expect(invalidUuid.some((error) => error.property === 'orderId')).toBe(true);
  });

  it('rechaza campos de identidad o fecha enviados por el cliente', async () => {
    const errors = await validate(
      reviewDto({
        orderId: ORDER_ID,
        rating: 4,
        userId: ACCOUNT_ID,
        branchId: ACCOUNT_ID,
        createdAt: new Date().toISOString(),
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['userId', 'branchId', 'createdAt']),
    );
  });
});
