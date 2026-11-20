import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../generated/prisma/client.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

const GERENTE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_GERENTE_ID = '22222222-2222-4222-8222-222222222222';
const FIRST_BRANCH = { id: '33333333-3333-4333-8333-333333333333', name: 'Centro' };
const SECOND_BRANCH = { id: '44444444-4444-4444-8444-444444444444', name: 'Norte' };

describe('assigned branch listing', () => {
  it('authorizes GERENTE and rejects other roles', () => {
    const handler = ReportsController.prototype.assignedBranches;
    const guard = new RolesGuard(new Reflector());
    const contextFor = (role: UserRole) => ({
      getHandler: () => handler,
      getClass: () => ReportsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: GERENTE_ID, role } }),
      }),
    }) as never;

    expect(Reflect.getMetadata(ROLES_KEY, ReportsController)).toEqual([
      UserRole.GERENTE,
    ]);
    expect(guard.canActivate(contextFor(UserRole.GERENTE))).toBe(true);
    expect(() => guard.canActivate(contextFor(UserRole.CLIENTE))).toThrow(
      ForbiddenException,
    );
  });

  it('returns only the assigned branch ids and names for that user', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { branch: FIRST_BRANCH },
      { branch: SECOND_BRANCH },
    ]);
    const service = new ReportsService({
      staffBranch: { findMany },
    } as never);

    await expect(service.assignedBranches(GERENTE_ID)).resolves.toEqual([
      FIRST_BRANCH,
      SECOND_BRANCH,
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: GERENTE_ID },
      select: { branch: { select: { id: true, name: true } } },
    });
  });

  it('returns an empty list when the manager has no assignments', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ReportsService({
      staffBranch: { findMany },
    } as never);

    await expect(service.assignedBranches(GERENTE_ID)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: GERENTE_ID } }),
    );
  });

  it('isolates results by the authenticated user id', async () => {
    const findMany = vi.fn(async ({ where }: { where: { userId: string } }) =>
      where.userId === GERENTE_ID
        ? [{ branch: FIRST_BRANCH }]
        : [{ branch: SECOND_BRANCH }],
    );
    const service = new ReportsService({
      staffBranch: { findMany },
    } as never);

    await expect(service.assignedBranches(GERENTE_ID)).resolves.toEqual([
      FIRST_BRANCH,
    ]);
    await expect(service.assignedBranches(OTHER_GERENTE_ID)).resolves.toEqual([
      SECOND_BRANCH,
    ]);
    expect(findMany.mock.calls.map(([args]) => args.where.userId)).toEqual([
      GERENTE_ID,
      OTHER_GERENTE_ID,
    ]);
  });
});
