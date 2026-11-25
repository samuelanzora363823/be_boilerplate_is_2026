import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, type User } from '@PrismaClient';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { LoyaltyController } from './loyalty.controller.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('LoyaltyController H20 saldo y movimientos', () => {
  const context = (handler: unknown, role: UserRole) => ({
    getHandler: () => handler,
    getClass: () => LoyaltyController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: USER_ID, role } }),
    }),
  }) as never;

  it('restringe saldo y movimientos al rol CLIENTE', () => {
    const guard = new RolesGuard(new Reflector());

    expect(Reflect.getMetadata(ROLES_KEY, LoyaltyController)).toEqual([UserRole.CLIENTE]);
    for (const handler of [
      LoyaltyController.prototype.getBalance,
      LoyaltyController.prototype.getMovements,
    ]) {
      expect(guard.canActivate(context(handler, UserRole.CLIENTE))).toBe(true);
      for (const role of [UserRole.MESERO, UserRole.COCINA, UserRole.GERENTE]) {
        expect(() => guard.canActivate(context(handler, role))).toThrow(ForbiddenException);
      }
    }
  });

  it('consulta con el id del usuario autenticado', async () => {
    const service = {
      getBalance: vi.fn().mockResolvedValue({
        totalPoints: 0,
        reservedPoints: 0,
        availablePoints: 0,
        balance: 0,
      }),
      getMovements: vi.fn().mockResolvedValue([]),
    };
    const controller = new LoyaltyController(service as never);
    const user = { id: USER_ID, role: UserRole.CLIENTE } as User;

    await expect(controller.getBalance(user)).resolves.toEqual({
      totalPoints: 0,
      reservedPoints: 0,
      availablePoints: 0,
      balance: 0,
    });
    await expect(controller.getMovements(user)).resolves.toEqual([]);
    expect(service.getBalance).toHaveBeenCalledWith(USER_ID);
    expect(service.getMovements).toHaveBeenCalledWith(USER_ID);
  });
});
