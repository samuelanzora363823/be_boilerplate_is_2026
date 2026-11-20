import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import {
  Prisma,
  LoyaltyMovementType,
  LoyaltyDiscountType,
} from '@PrismaClient';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class LoyaltyRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================
  // CUENTA DE PUNTOS (H20)
  // ==========================================

  findAccountByUserId(userId: string) {
    return this.prisma.loyaltyAccount.findUnique({
      where: { userId },
      select: {
        id: true,
        balance: true,
      },
    });
  }

  // ==========================================
  // MOVIMIENTOS DE PUNTOS (H20)
  // ==========================================

  findMovements(accountId: string) {
    return this.prisma.loyaltyMovement.findMany({
      where: { loyaltyAccountId: accountId },
      select: {
        id: true,
        type: true,
        points: true,
        description: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================
  // ACUMULACIÓN DE PUNTOS (H20)
  // ==========================================

  async creditPoints(
    userId: string,
    paymentReference: string,
    points: number,
  ): Promise<number | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const account = await tx.loyaltyAccount.upsert({
          where: { userId },
          create: { userId, balance: 0 },
          update: {},
          select: { id: true },
        });

        // La restricción UNIQUE de paymentReference evita duplicaciones.
        await tx.loyaltyMovement.create({
          data: {
            loyaltyAccountId: account.id,
            type: LoyaltyMovementType.EARNED,
            points,
            paymentReference,
            description: 'Puntos acumulados por compra',
          },
        });

        const updatedAccount = await tx.loyaltyAccount.update({
          where: { id: account.id },
          data: { balance: { increment: points } },
          select: { balance: true },
        });

        return updatedAccount.balance;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return null;
      }

      throw error;
    }
  }

  // ==========================================
  // REGLAS DE ACUMULACIÓN (H22)
  // ==========================================

  // Consultar o crear la configuración global.
  getOrCreateRule() {
    return this.prisma.loyaltyRule.upsert({
      where: {
        id: 'global',
      },
      create: {
        id: 'global',
        pointsPerDollar: 1,
      },
      update: {},
    });
  }

  // Actualizar la cantidad de puntos por dólar.
  updateRule(
    pointsPerDollar: string,
    updatedById: string,
  ) {
    return this.prisma.loyaltyRule.upsert({
      where: {
        id: 'global',
      },
      create: {
        id: 'global',
        pointsPerDollar,
        updatedById,
      },
      update: {
        pointsPerDollar,
        updatedById,
      },
    });
  }

  // ==========================================
  // ADMINISTRACIÓN DE BENEFICIOS (H22)
  // ==========================================

  // Buscar beneficios por nombre, sin distinguir mayúsculas.
  findBenefitByName(name: string) {
    return this.prisma.loyaltyBenefit.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
      },
    });
  }

  // Consultar todos los beneficios.
  findBenefits() {
    return this.prisma.loyaltyBenefit.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Crear un nuevo beneficio.
  createBenefit(data: {
    name: string;
    pointsRequired: number;
    discountType: LoyaltyDiscountType;
    discountValue: string;
    createdById: string;
    updatedById: string;
  }) {
    return this.prisma.loyaltyBenefit.create({
      data,
    });
  }

  // Activar o desactivar un beneficio sin eliminarlo.
  updateBenefitStatus(
    id: string,
    isActive: boolean,
    updatedById: string,
  ) {
    return this.prisma.loyaltyBenefit.update({
      where: {
        id,
      },
      data: {
        isActive,
        updatedById,
      },
    });
  }
}