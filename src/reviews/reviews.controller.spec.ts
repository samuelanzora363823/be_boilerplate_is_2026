import { BadRequestException, ForbiddenException, ParseUUIDPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@PrismaClient';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { ReviewsController } from './reviews.controller.js';

describe('ReviewsController H24 authorization metadata', () => {
  const handler = ReviewsController.prototype.listBranchReviews;
  const context = (role: UserRole) => ({
    getHandler: () => handler,
    getClass: () => ReviewsController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'manager-id', role } }),
    }),
  }) as never;

  it('allows GERENTE on the branch reviews route', () => {
    const guard = new RolesGuard(new Reflector());

    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.GERENTE]);
    expect(guard.canActivate(context(UserRole.GERENTE))).toBe(true);
  });

  it('rejects non-gerente roles on the branch reviews route', () => {
    const guard = new RolesGuard(new Reflector());

    expect(() => guard.canActivate(context(UserRole.CLIENTE))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a malformed branchId as HTTP 400', async () => {
    const pipe = new ParseUUIDPipe();

    await expect(
      pipe.transform('not-a-uuid', {
        type: 'param',
        metatype: String,
        data: 'branchId',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
