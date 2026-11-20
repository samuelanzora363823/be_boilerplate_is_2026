import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Prisma,
  LoyaltyDiscountType,
} from '@PrismaClient';

import { LoyaltyRepository } from './loyalty.repository.js';

import { UpdateLoyaltyRuleDto } from './dto/update-loyalty-rule.dto.js';
import { CreateLoyaltyBenefitDto } from './dto/create-loyalty-benefit.dto.js';

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly loyaltyRepository: LoyaltyRepository,
  ) {}

  // ==========================================
  // CONSULTA DE PUNTOS (H20)
  // ==========================================

  async getBalance(userId: string) {
    const account =
      await this.loyaltyRepository.findAccountByUserId(userId);

    if (!account) {
      throw new NotFoundException(
        'El cliente no tiene una cuenta de puntos.',
      );
    }

    return { balance: account.balance };
  }

  async getMovements(userId: string) {
    const account =
      await this.loyaltyRepository.findAccountByUserId(userId);

    if (!account) {
      throw new NotFoundException(
        'El cliente no tiene una cuenta de puntos.',
      );
    }

    return this.loyaltyRepository.findMovements(account.id);
  }

  // ==========================================
  // ACUMULACIÓN DE PUNTOS (H20)
  // ==========================================

  async registerPurchasePoints(
    userId: string,
    paymentReference: string,
    amountPaid: number,
    pointsPerDollar: number,
  ) {
    if (
      !Number.isFinite(amountPaid) ||
      !Number.isFinite(pointsPerDollar) ||
      amountPaid <= 0 ||
      pointsPerDollar <= 0 ||
      !paymentReference.trim()
    ) {
      throw new BadRequestException(
        'Los datos de acumulación de puntos no son válidos.',
      );
    }

    const points = Math.floor(amountPaid * pointsPerDollar);

    if (points <= 0) {
      return { credited: false, points: 0 };
    }

    const balance = await this.loyaltyRepository.creditPoints(
      userId,
      paymentReference,
      points,
    );

    if (balance === null) {
      return { credited: false, points: 0 };
    }

    return { credited: true, points, balance };
  }

  // Procesar puntos después de aprobar un pago.
  async processApprovedPayment(
    userId: string | null,
    paymentId: string,
    amount: number,
  ): Promise<void> {
    if (!userId) {
      return;
    }

    // Obtener la regla global vigente.
    const rule =
      await this.loyaltyRepository.getOrCreateRule();

    await this.registerPurchasePoints(
      userId,
      paymentId,
      amount,
      Number(rule.pointsPerDollar),
    );
  }

  // ==========================================
  // REGLAS DE ACUMULACIÓN (H22)
  // ==========================================

  // Consultar la configuración actual.
  async getRule() {
    const rule =
      await this.loyaltyRepository.getOrCreateRule();

    return {
      pointsPerDollar: Number(rule.pointsPerDollar),
      updatedAt: rule.updatedAt,
    };
  }

  // Actualizar la tasa de acumulación.
  async updateRule(
    dto: UpdateLoyaltyRuleDto,
    userId: string,
  ) {
    const pointsPerDollar = Number(dto.pointsPerDollar);

    if (
      !Number.isFinite(pointsPerDollar) ||
      pointsPerDollar <= 0
    ) {
      throw new BadRequestException(
        'La cantidad de puntos por dólar debe ser mayor que cero.',
      );
    }

    const rule =
      await this.loyaltyRepository.updateRule(
        dto.pointsPerDollar,
        userId,
      );

    return {
      message: 'Regla de acumulación actualizada correctamente.',
      pointsPerDollar: Number(rule.pointsPerDollar),
      updatedAt: rule.updatedAt,
    };
  }

  // ==========================================
  // ADMINISTRACIÓN DE BENEFICIOS (H22)
  // ==========================================

  // Consultar todos los beneficios registrados.
  async getBenefits() {
    return this.loyaltyRepository.findBenefits();
  }

  // Crear un nuevo beneficio.
  async createBenefit(
    dto: CreateLoyaltyBenefitDto,
    userId: string,
  ) {
    const name = dto.name.trim();
    const discountValue = Number(dto.discountValue);

    if (!name) {
      throw new BadRequestException(
        'El nombre del beneficio es obligatorio.',
      );
    }

    if (
      !Number.isFinite(discountValue) ||
      discountValue <= 0
    ) {
      throw new BadRequestException(
        'El valor del descuento debe ser mayor que cero.',
      );
    }

    if (
      dto.discountType === LoyaltyDiscountType.PERCENTAGE &&
      discountValue > 100
    ) {
      throw new BadRequestException(
        'El descuento porcentual no puede superar el 100%.',
      );
    }

    const existingBenefit =
      await this.loyaltyRepository.findBenefitByName(name);

    if (existingBenefit) {
      throw new ConflictException(
        'Ya existe un beneficio con ese nombre.',
      );
    }

    try {
      const benefit =
        await this.loyaltyRepository.createBenefit({
          name,
          pointsRequired: dto.pointsRequired,
          discountType: dto.discountType,
          discountValue: dto.discountValue,
          createdById: userId,
          updatedById: userId,
        });

      return {
        message: 'Beneficio creado correctamente.',
        benefit,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un beneficio con ese nombre.',
        );
      }

      throw error;
    }
  }

  // Activar o desactivar un beneficio.
  async updateBenefitStatus(
    id: string,
    isActive: boolean,
    userId: string,
  ) {
    try {
      const benefit =
        await this.loyaltyRepository.updateBenefitStatus(
          id,
          isActive,
          userId,
        );

      return {
        message: isActive
          ? 'Beneficio activado correctamente.'
          : 'Beneficio desactivado correctamente.',
        benefit,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(
          'El beneficio solicitado no existe.',
        );
      }

      throw error;
    }
  }
}