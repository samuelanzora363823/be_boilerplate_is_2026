import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListBranchReviewsDto } from './list-branch-reviews.dto.js';

describe('ListBranchReviewsDto', () => {
  it('usa page=1 y limit=10 de forma predeterminada', async () => {
    const dto = plainToInstance(ListBranchReviewsDto, {});
    const errors = await validate(dto);

    expect(dto).toMatchObject({ page: 1, limit: 10 });
    expect(errors).toHaveLength(0);
  });

  it('transforma parámetros enteros de query string', async () => {
    const dto = plainToInstance(ListBranchReviewsDto, {
      page: '3',
      limit: '20',
    });
    const errors = await validate(dto);

    expect(dto).toMatchObject({ page: 3, limit: 20 });
    expect(errors).toHaveLength(0);
  });

  it.each([
    { page: '0', limit: '10' },
    { page: '-1', limit: '10' },
    { page: '1.5', limit: '10' },
    { page: 'abc', limit: '10' },
    { page: '1', limit: '0' },
    { page: '1', limit: '51' },
    { page: '1', limit: '2.5' },
  ])('rechaza parámetros inválidos %#', async (query) => {
    const dto = plainToInstance(ListBranchReviewsDto, query);
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });
});
