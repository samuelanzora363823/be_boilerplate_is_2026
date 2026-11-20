import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import {
  LoyaltyDiscountType,
  Prisma,
} from '../generated/prisma/client.js';

import { LoyaltyService } from './loyalty.service.js';

describe('LoyaltyService - H20 y H22', () => {
  let service: LoyaltyService;
  let repository: any;

  const USER_ID = '11111111-1111-4111-8111-111111111111';
  const PAYMENT_ID = '22222222-2222-4222-8222-222222222222';
  const BENEFIT_ID = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    repository = {
      findAccountByUserId: vi.fn(),
      findMovements: vi.fn(),
      creditPoints: vi.fn(),

      getOrCreateRule: vi.fn().mockResolvedValue({
        id: 'global',
        pointsPerDollar: 2,
        updatedAt: new Date(),
      }),

      updateRule: vi.fn().mockResolvedValue({
        id: 'global',
        pointsPerDollar: 3,
        updatedAt: new Date(),
      }),

      findBenefitByName: vi.fn().mockResolvedValue(null),
      findBenefits: vi.fn().mockResolvedValue([]),

      createBenefit: vi.fn().mockResolvedValue({
        id: BENEFIT_ID,
        name: 'Descuento especial',
        pointsRequired: 100,
        discountType: LoyaltyDiscountType.PERCENTAGE,
        discountValue: 10,
        isActive: true,
      }),

      updateBenefitStatus: vi.fn().mockResolvedValue({
        id: BENEFIT_ID,
        isActive: false,
      }),
    };

    service = new LoyaltyService(repository);
  });

  // ==========================================
  // H20 - ACUMULACIÓN DE PUNTOS
  // ==========================================

  describe('registerPurchasePoints', () => {
    it('acumula puntos correctamente por una compra', async () => {
      repository.creditPoints.mockResolvedValue(150);

      const result = await service.registerPurchasePoints(
        USER_ID,
        PAYMENT_ID,
        50,
        2,
      );

      expect(repository.creditPoints).toHaveBeenCalledWith(
        USER_ID,
        PAYMENT_ID,
        100,
      );

      expect(result).toEqual({
        credited: true,
        points: 100,
        balance: 150,
      });
    });

    it('rechaza datos de acumulación inválidos', async () => {
      await expect(
        service.registerPurchasePoints(USER_ID, PAYMENT_ID, -50, 2),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.creditPoints).not.toHaveBeenCalled();
    });

    it('evita acreditar puntos cuando el pago ya fue procesado', async () => {
      repository.creditPoints.mockResolvedValue(null);

      const result = await service.registerPurchasePoints(
        USER_ID,
        PAYMENT_ID,
        50,
        2,
      );

      expect(result).toEqual({
        credited: false,
        points: 0,
      });
    });
  });

  describe('processApprovedPayment', () => {
    it('utiliza la regla global vigente para calcular los puntos', async () => {
      repository.creditPoints.mockResolvedValue(100);

      await service.processApprovedPayment(
        USER_ID,
        PAYMENT_ID,
        50,
      );

      expect(repository.getOrCreateRule).toHaveBeenCalled();

      expect(repository.creditPoints).toHaveBeenCalledWith(
        USER_ID,
        PAYMENT_ID,
        100,
      );
    });

    it('no procesa puntos cuando el pago no tiene cliente asociado', async () => {
      await service.processApprovedPayment(
        null,
        PAYMENT_ID,
        50,
      );

      expect(repository.getOrCreateRule).not.toHaveBeenCalled();
      expect(repository.creditPoints).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // H22 - REGLAS DE ACUMULACIÓN
  // ==========================================

  describe('getRule', () => {
    it('consulta la configuración global', async () => {
      const result = await service.getRule();

      expect(repository.getOrCreateRule).toHaveBeenCalled();

      expect(result.pointsPerDollar).toBe(2);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('updateRule', () => {
    it('actualiza correctamente los puntos por dólar', async () => {
      const result = await service.updateRule(
        { pointsPerDollar: '3' },
        USER_ID,
      );

      expect(repository.updateRule).toHaveBeenCalledWith(
        '3',
        USER_ID,
      );

      expect(result).toEqual({
        message: 'Regla de acumulación actualizada correctamente.',
        pointsPerDollar: 3,
        updatedAt: expect.any(Date),
      });
    });

    it('rechaza una cantidad de puntos igual a cero', async () => {
      await expect(
        service.updateRule(
          { pointsPerDollar: '0' },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.updateRule).not.toHaveBeenCalled();
    });

    it('rechaza una cantidad de puntos negativa', async () => {
      await expect(
        service.updateRule(
          { pointsPerDollar: '-2' },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.updateRule).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // H22 - ADMINISTRACIÓN DE BENEFICIOS
  // ==========================================

  describe('getBenefits', () => {
    it('consulta todos los beneficios registrados', async () => {
      const benefits = [
        {
          id: BENEFIT_ID,
          name: 'Descuento especial',
          isActive: true,
        },
      ];

      repository.findBenefits.mockResolvedValue(benefits);

      const result = await service.getBenefits();

      expect(result).toEqual(benefits);
      expect(repository.findBenefits).toHaveBeenCalled();
    });
  });

  describe('createBenefit', () => {
    const validBenefit = {
      name: 'Descuento especial',
      pointsRequired: 100,
      discountType: LoyaltyDiscountType.PERCENTAGE,
      discountValue: '10',
    };

    it('crea correctamente un beneficio', async () => {
      const result = await service.createBenefit(
        validBenefit,
        USER_ID,
      );

      expect(repository.findBenefitByName).toHaveBeenCalledWith(
        'Descuento especial',
      );

      expect(repository.createBenefit).toHaveBeenCalledWith({
        name: 'Descuento especial',
        pointsRequired: 100,
        discountType: LoyaltyDiscountType.PERCENTAGE,
        discountValue: '10',
        createdById: USER_ID,
        updatedById: USER_ID,
      });

      expect(result.message).toBe(
        'Beneficio creado correctamente.',
      );
    });

    it('rechaza un nombre vacío', async () => {
      await expect(
        service.createBenefit(
          { ...validBenefit, name: '   ' },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.createBenefit).not.toHaveBeenCalled();
    });

    it('rechaza un descuento igual a cero', async () => {
      await expect(
        service.createBenefit(
          { ...validBenefit, discountValue: '0' },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.createBenefit).not.toHaveBeenCalled();
    });

    it('rechaza descuentos porcentuales superiores al 100%', async () => {
      await expect(
        service.createBenefit(
          { ...validBenefit, discountValue: '101' },
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repository.createBenefit).not.toHaveBeenCalled();
    });

    it('rechaza nombres de beneficios duplicados', async () => {
      repository.findBenefitByName.mockResolvedValue({
        id: BENEFIT_ID,
        name: 'Descuento especial',
      });

      await expect(
        service.createBenefit(validBenefit, USER_ID),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(repository.createBenefit).not.toHaveBeenCalled();
    });

    it('permite crear beneficios con descuento fijo', async () => {
      const fixedBenefit = {
        ...validBenefit,
        discountType: LoyaltyDiscountType.FIXED,
        discountValue: '5',
      };

      await service.createBenefit(fixedBenefit, USER_ID);

      expect(repository.createBenefit).toHaveBeenCalledWith(
        expect.objectContaining({
          discountType: LoyaltyDiscountType.FIXED,
          discountValue: '5',
        }),
      );
    });
  });

  describe('updateBenefitStatus', () => {
    it('desactiva un beneficio sin eliminarlo', async () => {
      const result = await service.updateBenefitStatus(
        BENEFIT_ID,
        false,
        USER_ID,
      );

      expect(repository.updateBenefitStatus).toHaveBeenCalledWith(
        BENEFIT_ID,
        false,
        USER_ID,
      );

      expect(result.message).toBe(
        'Beneficio desactivado correctamente.',
      );
    });

    it('activa un beneficio existente', async () => {
      repository.updateBenefitStatus.mockResolvedValue({
        id: BENEFIT_ID,
        isActive: true,
      });

      const result = await service.updateBenefitStatus(
        BENEFIT_ID,
        true,
        USER_ID,
      );

      expect(result.message).toBe(
        'Beneficio activado correctamente.',
      );
    });

    it('devuelve error cuando el beneficio no existe', async () => {
      repository.updateBenefitStatus.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Registro no encontrado',
          {
            code: 'P2025',
            clientVersion: '7.10.0',
          },
        ),
      );

      await expect(
        service.updateBenefitStatus(
          BENEFIT_ID,
          false,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
