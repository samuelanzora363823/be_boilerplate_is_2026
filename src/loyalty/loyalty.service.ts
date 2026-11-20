import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LoyaltyDiscountType,
  LoyaltyRedemptionReleaseReason,
  Prisma,
} from '@PrismaClient';
import { LoyaltyRepository } from './loyalty.repository.js';
import type { CreateRedemptionDto } from './dto/create-redemption.dto.js';

// H22's configurable rule is not in this branch yet; retain its default rate.
const DEFAULT_POINTS_PER_DOLLAR = 1;

@Injectable()
export class LoyaltyService {
  constructor(private readonly loyaltyRepository: LoyaltyRepository) {}

  async getBenefits() {
    return { items: await this.loyaltyRepository.findActiveBenefits() };
  }

  findReservedRedemptionForPurchase(
    tx: Prisma.TransactionClient,
    purchase: { accountId?: string; orderId?: string },
  ) {
    return this.loyaltyRepository.findReservedRedemptionForPurchase(tx, purchase);
  }

  lockLoyaltyAccountForPayment(
    tx: Prisma.TransactionClient,
    options: { loyaltyAccountId?: string; userId?: string },
  ) {
    return this.loyaltyRepository.lockLoyaltyAccountForPayment(tx, options);
  }

  async completeRedemptionForPayment(
    tx: Prisma.TransactionClient,
    data: {
      redemptionId: string;
      loyaltyAccountId: string;
      points: number;
      paymentId: string;
    },
  ) {
    const completed = await this.loyaltyRepository.completeRedemptionForPayment(
      tx,
      data,
    );
    if (!completed) {
      throw new ConflictException('El canje cambió durante el pago. Intenta nuevamente.');
    }
  }

  async releaseRedemptionForPayment(
    tx: Prisma.TransactionClient,
    data: {
      redemptionId: string;
      loyaltyAccountId: string;
      points: number;
      reason: LoyaltyRedemptionReleaseReason;
      paymentId?: string;
    },
  ) {
    const released = await this.loyaltyRepository.releaseRedemptionForPayment(
      tx,
      data,
    );
    if (!released) {
      throw new ConflictException('El canje cambió durante el pago. Intenta nuevamente.');
    }
  }

  releaseExpiredRedemptionInTransaction(
    tx: Prisma.TransactionClient,
    redemptionId: string,
    expiresAt = new Date(),
  ) {
    return this.loyaltyRepository.releaseExpiredRedemptionInTransaction(
      tx,
      redemptionId,
      expiresAt,
    );
  }

  async releaseExpiredRedemptionById(
    redemptionId: string,
    expiresAt = new Date(),
  ) {
    return this.loyaltyRepository.releaseExpiredRedemptionById(
      redemptionId,
      expiresAt,
    );
  }

  async requestRedemption(userId: string, input: CreateRedemptionDto) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.requestRedemptionAttempt(userId, input);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          if (this.isDuplicatePurchaseConstraint(error)) {
            throw new ConflictException('La compra ya tiene un canje activo.');
          }
          throw new ConflictException(
            'No se pudo registrar el canje por un conflicto de unicidad.',
          );
        }

        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034'
        ) {
          if (attempt < 3) continue;
          throw new ConflictException(
            'La operación encontró un conflicto de concurrencia. Intenta nuevamente.',
          );
        }

        throw error;
      }
    }

    throw new ConflictException(
      'La operación encontró un conflicto de concurrencia. Intenta nuevamente.',
    );
  }

  private isDuplicatePurchaseConstraint(
    error: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = error.meta?.target;
    const targets = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
    const normalized = targets.join(',').toLowerCase();
    return (
      normalized.includes('loyalty_redemptions_one_account_use') ||
      normalized.includes('loyalty_redemptions_one_order_use') ||
      normalized.includes('accountid') ||
      normalized.includes('account_id') ||
      normalized.includes('orderid') ||
      normalized.includes('order_id')
    );
  }

  private requestRedemptionAttempt(
    userId: string,
    input: CreateRedemptionDto,
  ) {
    return this.loyaltyRepository.transaction(async (tx) => {
        // Lock order follows H21 persistence: points account, then purchase.
        let loyaltyAccount = await this.loyaltyRepository.lockLoyaltyAccount(
          tx,
          userId,
        );

        const benefit = await this.loyaltyRepository.lockBenefit(
          tx,
          input.benefitId,
        );
        if (!benefit) throw new NotFoundException('Beneficio inexistente.');
        if (!benefit.active) {
          throw new ConflictException('El beneficio no está activo.');
        }
        if (benefit.pointsRequired <= 0) {
          throw new ConflictException('El beneficio tiene una configuración inválida.');
        }

        let subtotal: Prisma.Decimal;
        let purchase: { accountId?: string; orderId?: string };

        if (input.accountId) {
          const account = await this.loyaltyRepository.lockTableAccount(
            tx,
            input.accountId,
          );
          if (!account) throw new NotFoundException('Cuenta de mesa inexistente.');
          if (!account.customerId || account.customerId !== userId) {
            throw new ForbiddenException('La cuenta de mesa no pertenece al cliente.');
          }
          if (account.status !== 'OPEN') {
            throw new ConflictException('La cuenta de mesa no está abierta.');
          }
          subtotal = account.orders.reduce(
            (ordersTotal, order) =>
              ordersTotal.plus(
                order.items.reduce(
                  (itemsTotal, item) => itemsTotal.plus(item.subtotal),
                  new Prisma.Decimal(0),
                ),
              ),
            new Prisma.Decimal(0),
          );
          purchase = { accountId: account.id };
        } else {
          const order = await this.loyaltyRepository.lockTakeawayOrder(
            tx,
            input.orderId!,
          );
          if (!order) throw new NotFoundException('Pedido inexistente.');
          if (!order.customerId || order.customerId !== userId) {
            throw new ForbiddenException('El pedido no pertenece al cliente.');
          }
          if (order.accountId !== null) {
            throw new ConflictException('El pedido está asociado a una cuenta de mesa.');
          }
          if (order.status !== 'PENDING_PAYMENT') {
            throw new ConflictException('El pedido no está pendiente de pago.');
          }
          subtotal = order.items.reduce(
            (sum, item) => sum.plus(item.subtotal),
            new Prisma.Decimal(0),
          );
          purchase = { orderId: order.id };
        }

        if (subtotal.lte(0)) {
          throw new ConflictException('La compra no tiene un subtotal válido.');
        }

        const expiredRedemption =
          await this.loyaltyRepository.findExpiredRedemptionForPurchase(
            tx,
            purchase,
            new Date(),
          );
        if (expiredRedemption) {
          const released = await this.loyaltyRepository.releaseExpiredRedemptionInTransaction(
            tx,
            expiredRedemption.id,
            new Date(),
          );
          if (released) {
            loyaltyAccount = await this.loyaltyRepository.lockLoyaltyAccount(
              tx,
              userId,
            );
          }
        }

        if (await this.loyaltyRepository.findActiveRedemption(tx, purchase)) {
          throw new ConflictException('La compra ya tiene un canje activo.');
        }

        // Compra y propiedad se validan antes del saldo, incluso si no existe
        // una LoyaltyAccount para este usuario.
        if (!loyaltyAccount) {
          throw new ConflictException('El cliente no tiene una cuenta de puntos.');
        }
        const availableBefore = loyaltyAccount.balance - loyaltyAccount.reservedPoints;
        if (availableBefore < benefit.pointsRequired) {
          throw new ConflictException('No tienes puntos suficientes para este beneficio.');
        }

        const discountAmount = this.calculateDiscount(
          subtotal,
          benefit.discountType,
          benefit.discountValue,
        );
        if (discountAmount.gt(subtotal)) {
          throw new ConflictException('El descuento supera el subtotal de la compra.');
        }

        const reservation = await this.loyaltyRepository.reservePoints(
          tx,
          loyaltyAccount.id,
          benefit.pointsRequired,
        );
        if (!reservation) {
          throw new ConflictException('No tienes puntos suficientes para este beneficio.');
        }

        const redemption = await this.loyaltyRepository.createRedemption(tx, {
          loyaltyAccountId: loyaltyAccount.id,
          benefitId: benefit.id,
          ...purchase,
          pointsReserved: benefit.pointsRequired,
          subtotalAmount: subtotal.toDecimalPlaces(2),
          discountAmount,
        });

        return {
          id: redemption.id,
          pointsRedeemed: redemption.pointsReserved,
          balance: reservation.available,
          discountApplied: redemption.discountAmount.toNumber(),
          status: 'RESERVADO' as const,
        };
    });
  }

  private calculateDiscount(
    subtotal: Prisma.Decimal,
    discountType: LoyaltyDiscountType,
    configuredValue: Prisma.Decimal,
  ): Prisma.Decimal {
    const zero = new Prisma.Decimal(0);
    let discount: Prisma.Decimal;

    if (discountType === LoyaltyDiscountType.PERCENTAGE) {
      const percentage = Prisma.Decimal.min(
        Prisma.Decimal.max(configuredValue, zero),
        new Prisma.Decimal(100),
      );
      discount = subtotal.mul(percentage).div(100);
    } else {
      discount = Prisma.Decimal.max(configuredValue, zero);
    }

    return Prisma.Decimal.min(
      discount.toDecimalPlaces(2),
      subtotal,
    );
  }

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

  // Procesar los puntos de fidelidad después de un pago aprobado.
  async processApprovedPayment(
    userId: string | null,
    paymentId: string,
    amount: number,
  ): Promise<void> {
    if (!userId) {
      return;
    }

    await this.registerPurchasePoints(
      userId,
      paymentId,
      amount,
      DEFAULT_POINTS_PER_DOLLAR,
    );
  }
}
