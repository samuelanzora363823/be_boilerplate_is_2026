import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoyaltyDiscountType, Prisma } from '@PrismaClient';
import type { CreateLoyaltyBenefitDto } from './dto/create-loyalty-benefit.dto.js';
import type { UpdateLoyaltyBenefitDto } from './dto/update-loyalty-benefit.dto.js';
import type { UpdateLoyaltyRuleDto } from './dto/update-loyalty-rule.dto.js';
import {
  DEFAULT_POINTS_PER_DOLLAR,
  RULE_HISTORY_LIMIT,
} from './loyalty.constants.js';
import {
  LoyaltyRepository,
  type AdminBenefitRow,
  type BenefitInput,
  type BenefitWriteResult,
} from './loyalty.repository.js';

export interface LoyaltyRuleConfig {
  pointsPerDollar: number;
  // null mientras no se haya guardado una regla y rija la tasa por defecto.
  updatedAt: string | null;
}

export interface AdminBenefit {
  id: string;
  name: string;
  pointsRequired: number;
  discountType: LoyaltyDiscountType;
  discountValue: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: { id: string; email: string } | null;
}

const MAX_PERCENTAGE = new Prisma.Decimal(100);

/**
 * H22: configuración del programa de lealtad por parte del gerente.
 * - Una regla global de puntos por dólar con historial de cambios.
 * - Alta, edición y activación de beneficios; el canje sigue en H21.
 * Los cambios solo afectan operaciones futuras: H20 lee la tasa al acreditar
 * y H21 congela puntos y descuento al reservar cada canje.
 */
@Injectable()
export class LoyaltyAdminService {
  constructor(private readonly loyaltyRepository: LoyaltyRepository) {}

  async getRuleConfig(): Promise<LoyaltyRuleConfig> {
    const rule = await this.loyaltyRepository.findCurrentRule();
    if (!rule) {
      return { pointsPerDollar: DEFAULT_POINTS_PER_DOLLAR, updatedAt: null };
    }
    return {
      pointsPerDollar: rule.pointsPerDollar.toNumber(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  async updateRuleConfig(
    input: UpdateLoyaltyRuleDto,
    userId: string,
  ): Promise<LoyaltyRuleConfig> {
    const pointsPerDollar = new Prisma.Decimal(input.pointsPerDollar);
    if (pointsPerDollar.lte(0) || pointsPerDollar.decimalPlaces() > 2) {
      throw new BadRequestException(
        'Los puntos por dólar deben ser mayores que cero y tener máximo 2 decimales.',
      );
    }

    const rule = await this.loyaltyRepository.updateRuleWithHistory(
      pointsPerDollar,
      userId,
      new Prisma.Decimal(DEFAULT_POINTS_PER_DOLLAR),
    );
    return {
      pointsPerDollar: rule.pointsPerDollar.toNumber(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }

  async getRuleHistory() {
    const history = await this.loyaltyRepository.findRuleHistory(
      RULE_HISTORY_LIMIT,
    );
    return {
      items: history.map((entry) => ({
        id: entry.id,
        previousPointsPerDollar: entry.previousPoints.toNumber(),
        newPointsPerDollar: entry.newPoints.toNumber(),
        changedAt: entry.changedAt.toISOString(),
        changedBy: entry.changedBy,
      })),
    };
  }

  async listAllBenefits() {
    const benefits = await this.loyaltyRepository.findAllBenefits();
    return { items: benefits.map((benefit) => this.toAdminBenefit(benefit)) };
  }

  async createBenefit(
    input: CreateLoyaltyBenefitDto,
    userId: string,
  ): Promise<AdminBenefit> {
    const result = await this.loyaltyRepository.createBenefit(
      this.toBenefitInput(input),
      userId,
    );
    return this.unwrap(result);
  }

  async updateBenefit(
    id: string,
    input: UpdateLoyaltyBenefitDto,
    userId: string,
  ): Promise<AdminBenefit> {
    const result = await this.loyaltyRepository.updateBenefit(
      id,
      this.toBenefitInput(input),
      userId,
    );
    return this.unwrap(result);
  }

  async setBenefitActive(
    id: string,
    active: boolean,
    userId: string,
  ): Promise<AdminBenefit> {
    const result = await this.loyaltyRepository.setBenefitActive(
      id,
      active,
      userId,
    );
    return this.unwrap(result);
  }

  // Valida lo que depende de varios campos y normaliza a Decimal.
  private toBenefitInput(input: CreateLoyaltyBenefitDto): BenefitInput {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new BadRequestException('El nombre es obligatorio.');
    }
    if (!Number.isInteger(input.pointsRequired) || input.pointsRequired < 1) {
      throw new BadRequestException(
        'Los puntos requeridos deben ser un entero mayor que cero.',
      );
    }

    const discountValue = new Prisma.Decimal(input.discountValue);
    if (discountValue.lte(0) || discountValue.decimalPlaces() > 2) {
      throw new BadRequestException(
        'El descuento debe ser mayor que cero y tener máximo 2 decimales.',
      );
    }
    if (
      input.discountType === LoyaltyDiscountType.PERCENTAGE &&
      discountValue.gt(MAX_PERCENTAGE)
    ) {
      throw new BadRequestException(
        'El descuento porcentual no puede ser mayor que 100.',
      );
    }

    return {
      name,
      pointsRequired: input.pointsRequired,
      discountType: input.discountType,
      discountValue,
    };
  }

  private unwrap(result: BenefitWriteResult): AdminBenefit {
    if (result.status === 'duplicate') {
      throw new ConflictException('Ya existe un beneficio con ese nombre.');
    }
    if (result.status === 'not_found') {
      throw new NotFoundException('Beneficio inexistente.');
    }
    return this.toAdminBenefit(result.benefit);
  }

  private toAdminBenefit(benefit: AdminBenefitRow): AdminBenefit {
    return {
      id: benefit.id,
      name: benefit.name,
      pointsRequired: benefit.pointsRequired,
      discountType: benefit.discountType,
      discountValue: benefit.discountValue.toNumber(),
      active: benefit.active,
      createdAt: benefit.createdAt.toISOString(),
      updatedAt: benefit.updatedAt.toISOString(),
      updatedBy: benefit.updatedBy,
    };
  }
}
