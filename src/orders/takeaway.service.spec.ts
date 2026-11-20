import type { User } from '../generated/prisma/client.js';
import { TakeawayService } from './takeaway.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('TakeawayService.mine', () => {
  it('reports hasReview from the Order.review relation and preserves existing fields', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'order-with-review',
        orderNumber: 'SV-1',
        status: 'DELIVERED',
        total: '12.50',
        createdAt: new Date('2026-11-20T10:00:00.000Z'),
        review: { id: 'review-id' },
      },
      {
        id: 'order-without-review',
        orderNumber: 'SV-2',
        status: 'DELIVERED',
        total: '8.00',
        createdAt: new Date('2026-11-20T11:00:00.000Z'),
        review: null,
      },
    ]);
    const service = new TakeawayService({ order: { findMany } } as never);

    const result = await service.mine({ id: USER_ID } as User);

    expect(result).toEqual([
      {
        id: 'order-with-review',
        orderNumber: 'SV-1',
        status: 'DELIVERED',
        total: '12.50',
        createdAt: new Date('2026-11-20T10:00:00.000Z'),
        hasReview: true,
      },
      {
        id: 'order-without-review',
        orderNumber: 'SV-2',
        status: 'DELIVERED',
        total: '8.00',
        createdAt: new Date('2026-11-20T11:00:00.000Z'),
        hasReview: false,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { customerId: USER_ID, accountId: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        createdAt: true,
        review: { select: { id: true } },
      },
    });
  });
});
