import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '@PrismaClient';
import { ReviewsService } from './reviews.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const user = { id: USER_ID, role: 'GERENTE' } as User;
const query = { page: 2, limit: 2 };

function setup(options: {
  branch?: { id: string } | null;
  assignment?: { userId: string; branchId: string } | null;
  pageResult?: {
    ratingSum: number | null;
    totalReviews: number;
    reviews: unknown[];
  };
} = {}) {
  const repository = {
    transaction: vi.fn(async (callback: (tx: never) => unknown) => callback({} as never)),
    findBranch: vi.fn().mockResolvedValue(
      'branch' in options ? options.branch : { id: BRANCH_ID },
    ),
    findBranchAssignment: vi.fn().mockResolvedValue(
      'assignment' in options
        ? options.assignment
        : { userId: USER_ID, branchId: BRANCH_ID },
    ),
    getBranchReviewPage: vi.fn().mockResolvedValue(
      options.pageResult ?? { ratingSum: 17, totalReviews: 4, reviews: [] },
    ),
    lockAccount: vi.fn(),
    lockOrder: vi.fn(),
    create: vi.fn(),
  };

  return {
    repository,
    service: new ReviewsService(repository as never),
  };
}

describe('ReviewsService.listBranchReviews', () => {
  it('permite a un gerente asignado y devuelve promedio, total y página', async () => {
    const reviews = [
      { id: 'review-1', rating: 5, comment: 'Muy bien', createdAt: new Date() },
      { id: 'review-2', rating: 4, comment: null, createdAt: new Date() },
    ];
    const { repository, service } = setup({
      pageResult: { ratingSum: 26, totalReviews: 6, reviews },
    });

    await expect(
      service.listBranchReviews(user, BRANCH_ID, query),
    ).resolves.toEqual({
      branchId: BRANCH_ID,
      averageRating: 4.33,
      totalReviews: 6,
      page: 2,
      limit: 2,
      totalPages: 3,
      reviews,
    });
    expect(repository.findBranchAssignment).toHaveBeenCalledWith(USER_ID, BRANCH_ID);
    expect(repository.getBranchReviewPage).toHaveBeenCalledWith(BRANCH_ID, 2, 2);
  });

  it('responde 404 si la sucursal no existe', async () => {
    const { repository, service } = setup({ branch: null });

    await expect(
      service.listBranchReviews(user, BRANCH_ID, query),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findBranchAssignment).not.toHaveBeenCalled();
    expect(repository.getBranchReviewPage).not.toHaveBeenCalled();
  });

  it('responde 403 si el gerente no tiene asignación', async () => {
    const { repository, service } = setup({ assignment: null });

    await expect(
      service.listBranchReviews(user, BRANCH_ID, query),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.getBranchReviewPage).not.toHaveBeenCalled();
  });

  it('devuelve null, cero reseñas, lista vacía y cero páginas si la sucursal no tiene reseñas', async () => {
    const { service } = setup({
      pageResult: { ratingSum: null, totalReviews: 0, reviews: [] },
    });

    await expect(
      service.listBranchReviews(user, BRANCH_ID, { page: 1, limit: 10 }),
    ).resolves.toEqual({
      branchId: BRANCH_ID,
      averageRating: null,
      totalReviews: 0,
      page: 1,
      limit: 10,
      totalPages: 0,
      reviews: [],
    });
  });

  it('redondea el promedio decimal a dos posiciones', async () => {
    const { service } = setup({
      pageResult: { ratingSum: 107, totalReviews: 40, reviews: [] },
    });

    await expect(
      service.listBranchReviews(user, BRANCH_ID, { page: 1, limit: 10 }),
    ).resolves.toMatchObject({ averageRating: 2.68 });
  });
});
