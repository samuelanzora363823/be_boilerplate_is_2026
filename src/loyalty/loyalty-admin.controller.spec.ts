import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LoyaltyDiscountType, UserRole, type User } from '@PrismaClient';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { LoyaltyAdminController } from './loyalty-admin.controller.js';

const MANAGER_ID = '11111111-1111-4111-8111-111111111111';
const BENEFIT_ID = '22222222-2222-4222-8222-222222222222';

describe('LoyaltyAdminController H22', () => {
  const context = (handler: unknown, role: UserRole) => ({
    getHandler: () => handler,
    getClass: () => LoyaltyAdminController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: MANAGER_ID, role } }),
    }),
  }) as never;

  // Los manejadores se leen como datos (metadatos de rol), no se invocan.
  const prototype = LoyaltyAdminController.prototype as unknown as Record<
    string,
    unknown
  >;
  const handlers = [
    'getRule',
    'updateRule',
    'getRuleHistory',
    'listBenefits',
    'createBenefit',
    'updateBenefit',
    'setBenefitStatus',
  ].map((name) => prototype[name]);

  it('restringe todas las rutas al rol GERENTE', () => {
    const guard = new RolesGuard(new Reflector());

    expect(Reflect.getMetadata(ROLES_KEY, LoyaltyAdminController)).toEqual([
      UserRole.GERENTE,
    ]);
    for (const handler of handlers) {
      expect(guard.canActivate(context(handler, UserRole.GERENTE))).toBe(true);
      for (const role of [UserRole.CLIENTE, UserRole.MESERO, UserRole.COCINA]) {
        expect(() => guard.canActivate(context(handler, role))).toThrow(
          ForbiddenException,
        );
      }
    }
  });

  it('delega al servicio con el id del gerente autenticado', async () => {
    const service = {
      getRuleConfig: vi.fn().mockResolvedValue('rule'),
      updateRuleConfig: vi.fn().mockResolvedValue('updated'),
      getRuleHistory: vi.fn().mockResolvedValue('history'),
      listAllBenefits: vi.fn().mockResolvedValue('list'),
      createBenefit: vi.fn().mockResolvedValue('created'),
      updateBenefit: vi.fn().mockResolvedValue('edited'),
      setBenefitActive: vi.fn().mockResolvedValue('status'),
    };
    const controller = new LoyaltyAdminController(service as never);
    const user = { id: MANAGER_ID, role: UserRole.GERENTE } as User;
    const benefit = {
      name: 'Postre',
      pointsRequired: 100,
      discountType: LoyaltyDiscountType.FIXED,
      discountValue: 5,
    };

    await expect(controller.getRule()).resolves.toBe('rule');
    await expect(controller.updateRule(user, { pointsPerDollar: 2 })).resolves.toBe('updated');
    await expect(controller.getRuleHistory()).resolves.toBe('history');
    await expect(controller.listBenefits()).resolves.toBe('list');
    await expect(controller.createBenefit(user, benefit)).resolves.toBe('created');
    await expect(controller.updateBenefit(user, BENEFIT_ID, benefit)).resolves.toBe('edited');
    await expect(
      controller.setBenefitStatus(user, BENEFIT_ID, { active: false }),
    ).resolves.toBe('status');

    expect(service.updateRuleConfig).toHaveBeenCalledWith({ pointsPerDollar: 2 }, MANAGER_ID);
    expect(service.createBenefit).toHaveBeenCalledWith(benefit, MANAGER_ID);
    expect(service.updateBenefit).toHaveBeenCalledWith(BENEFIT_ID, benefit, MANAGER_ID);
    expect(service.setBenefitActive).toHaveBeenCalledWith(BENEFIT_ID, false, MANAGER_ID);
  });
});
