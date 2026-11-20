import { Prisma } from '@PrismaClient';
import { ReviewsRepository } from './reviews.repository.js';

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';

describe('ReviewsRepository.getBranchReviewPage', () => {
  it('aggregates all branch reviews and paginates in descending date and id order', async () => {
    const pageRows = [
      { id: 'review-c', rating: 5, comment: null, createdAt: new Date() },
    ];
    const transactionClient = {
      review: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { rating: 13 },
          _count: { _all: 3 },
        }),
        findMany: vi.fn().mockResolvedValue(pageRows),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (
        callback: (client: typeof transactionClient) => unknown,
        options: { isolationLevel: Prisma.TransactionIsolationLevel },
      ) => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        });
        return callback(transactionClient);
      }),
    };
    const repository = new ReviewsRepository(prisma as never);

    await expect(
      repository.getBranchReviewPage(BRANCH_ID, 2, 2),
    ).resolves.toEqual({
      ratingSum: 13,
      totalReviews: 3,
      reviews: pageRows,
    });
    expect(transactionClient.review.aggregate).toHaveBeenCalledWith({
      where: { branchId: BRANCH_ID },
      _sum: { rating: true },
      _count: { _all: true },
    });
    expect(transactionClient.review.findMany).toHaveBeenCalledWith({
      where: { branchId: BRANCH_ID },
      select: { id: true, rating: true, comment: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 2,
      take: 2,
    });
  });
});
