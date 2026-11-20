import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoyaltyRepository } from './loyalty.repository.js';

// H22's configurable rule is not in this branch yet; retain its default rate.
const DEFAULT_POINTS_PER_DOLLAR = 1;

@Injectable()
export class LoyaltyService {
  constructor(private readonly loyaltyRepository: LoyaltyRepository) {}

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
