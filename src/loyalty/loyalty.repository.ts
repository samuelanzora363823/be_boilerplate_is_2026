import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import {
  LoyaltyDiscountType,
  LoyaltyMovementType,
  LoyaltyRedemptionReleaseReason,
  LoyaltyRedemptionMovementType,
  LoyaltyRedemptionStatus,
  Prisma,
} from '@PrismaClient';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

// H22: campos que el gerente ve de cada beneficio.
const ADMIN_BENEFIT_SELECT = {
  id: true,
  name: true,
  pointsRequired: true,
  discountType: true,
  discountValue: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  updatedBy: { select: { id: true, email: true } },
} satisfies Prisma.LoyaltyBenefitSelect;

export type AdminBenefitRow = Prisma.LoyaltyBenefitGetPayload<{
  select: typeof ADMIN_BENEFIT_SELECT;
}>;

export interface BenefitInput {
  name: string;
  pointsRequired: number;
  discountType: LoyaltyDiscountType;
  discountValue: Prisma.Decimal;
}

// H22: resultado de escribir un beneficio; el servicio lo traduce a HTTP.
export type BenefitWriteResult =
  | { status: 'ok'; benefit: AdminBenefitRow }
  | { status: 'duplicate' }
  | { status: 'not_found' };

@Injectable()
export class LoyaltyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccountByUserId(userId: string) {
    return this.prisma.loyaltyAccount.findUnique({
      where: { userId },
      select: {
        id: true,
        balance: true,
        reservedPoints: true,
      },
    });
  }

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

  findActiveBenefits() {
    return this.prisma.loyaltyBenefit.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        pointsRequired: true,
        discountType: true,
        discountValue: true,
        active: true,
      },
      orderBy: { pointsRequired: 'asc' },
    });
  }

  async lockBenefit(tx: Prisma.TransactionClient, benefitId: string) {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "loyalty_benefits"
      WHERE "id" = ${benefitId}::uuid
      FOR SHARE
    `;
    return tx.loyaltyBenefit.findUnique({
      where: { id: benefitId },
      select: {
        id: true,
        pointsRequired: true,
        discountType: true,
        discountValue: true,
        active: true,
      },
    });
  }

  transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }

  async lockLoyaltyAccount(tx: Prisma.TransactionClient, userId: string) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "loyalty_accounts"
      WHERE "user_id" = ${userId}::uuid
      FOR UPDATE
    `;
    if (!locked.length) return null;

    return tx.loyaltyAccount.findUnique({
      where: { id: locked[0].id },
      select: { id: true, userId: true, balance: true, reservedPoints: true },
    });
  }

  async lockTableAccount(tx: Prisma.TransactionClient, accountId: string) {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "accounts" WHERE "id" = ${accountId}::uuid FOR UPDATE
    `;
    return tx.account.findUnique({
      where: { id: accountId },
      include: {
        orders: {
          where: { status: { not: 'CANCELLED' } },
          select: { items: { select: { subtotal: true } } },
        },
      },
    });
  }

  async lockTakeawayOrder(tx: Prisma.TransactionClient, orderId: string) {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE
    `;
    return tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerId: true,
        accountId: true,
        status: true,
        items: { select: { subtotal: true } },
      },
    });
  }

  findActiveRedemption(
    tx: Prisma.TransactionClient,
    purchase: { accountId?: string; orderId?: string },
  ) {
    return tx.loyaltyRedemption.findFirst({
      where: {
        status: {
          in: [LoyaltyRedemptionStatus.RESERVED, LoyaltyRedemptionStatus.COMPLETED],
        },
        ...(purchase.accountId ? { accountId: purchase.accountId } : {}),
        ...(purchase.orderId ? { orderId: purchase.orderId } : {}),
      },
      select: { id: true },
    });
  }

  findExpiredRedemptionForPurchase(
    tx: Prisma.TransactionClient,
    purchase: { accountId?: string; orderId?: string },
    expiresAt: Date,
  ) {
    return tx.loyaltyRedemption.findFirst({
      where: {
        status: LoyaltyRedemptionStatus.RESERVED,
        expiresAt: { lte: expiresAt },
        paymentId: null,
        ...(purchase.accountId ? { accountId: purchase.accountId } : {}),
        ...(purchase.orderId ? { orderId: purchase.orderId } : {}),
      },
      select: { id: true },
    });
  }

  findExpiredRedemptionCandidates(expiresAt: Date, limit = 100) {
    return this.prisma.loyaltyRedemption.findMany({
      where: {
        status: LoyaltyRedemptionStatus.RESERVED,
        expiresAt: { lte: expiresAt },
        paymentId: null,
      },
      select: { id: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  /**
   * Release an expired canje when the caller already owns LoyaltyAccount and
   * purchase locks. This locks/revalidates the redemption last, matching the
   * global LoyaltyAccount -> purchase -> Redemption order.
   */
  async releaseExpiredRedemptionInTransaction(
    tx: Prisma.TransactionClient,
    redemptionId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "loyalty_redemptions"
      WHERE "id" = ${redemptionId}::uuid
      FOR UPDATE
    `;
    if (!locked.length) return false;

    const redemption = await tx.loyaltyRedemption.findUnique({
      where: { id: redemptionId },
      select: {
        id: true,
        loyaltyAccountId: true,
        pointsReserved: true,
        status: true,
        expiresAt: true,
        paymentId: true,
      },
    });
    if (
      !redemption ||
      redemption.status !== LoyaltyRedemptionStatus.RESERVED ||
      redemption.expiresAt > expiresAt ||
      redemption.paymentId !== null
    ) {
      return false;
    }

    return this.releaseExpiredRedemptionState(tx, redemption);
  }

  /**
   * Scheduled entry point. The initial read is deliberately unlocked; then
   * each transaction takes LoyaltyAccount, purchase, and redemption locks in
   * that order and revalidates the expiration before changing state.
   */
  async releaseExpiredRedemptionById(
    redemptionId: string,
    expiresAt = new Date(),
  ): Promise<boolean> {
    return this.transaction(async (tx) => {
      const candidate = await tx.loyaltyRedemption.findUnique({
        where: { id: redemptionId },
        select: {
          id: true,
          loyaltyAccountId: true,
          accountId: true,
          orderId: true,
          status: true,
          expiresAt: true,
          paymentId: true,
        },
      });
      if (
        !candidate ||
        candidate.status !== LoyaltyRedemptionStatus.RESERVED ||
        candidate.expiresAt > expiresAt ||
        candidate.paymentId !== null
      ) {
        return false;
      }

      const accountLock = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "loyalty_accounts"
        WHERE "id" = ${candidate.loyaltyAccountId}::uuid
        FOR UPDATE
      `;
      if (!accountLock.length) return false;

      if (candidate.accountId) {
        const purchaseLock = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "accounts"
          WHERE "id" = ${candidate.accountId}::uuid
          FOR UPDATE
        `;
        if (!purchaseLock.length) return false;
      } else if (candidate.orderId) {
        const purchaseLock = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "orders"
          WHERE "id" = ${candidate.orderId}::uuid
          FOR UPDATE
        `;
        if (!purchaseLock.length) return false;
      } else {
        return false;
      }

      return this.releaseExpiredRedemptionInTransaction(
        tx,
        candidate.id,
        expiresAt,
      );
    });
  }

  private async releaseExpiredRedemptionState(
    tx: Prisma.TransactionClient,
    redemption: {
      id: string;
      loyaltyAccountId: string;
      pointsReserved: number;
    },
  ): Promise<boolean> {
    return this.releaseRedemptionForPayment(tx, {
      redemptionId: redemption.id,
      loyaltyAccountId: redemption.loyaltyAccountId,
      points: redemption.pointsReserved,
      reason: LoyaltyRedemptionReleaseReason.EXPIRED,
    });
  }

  findReservedRedemptionForPurchase(
    tx: Prisma.TransactionClient,
    purchase: { accountId?: string; orderId?: string },
  ) {
    return tx.loyaltyRedemption.findFirst({
      where: {
        status: LoyaltyRedemptionStatus.RESERVED,
        ...(purchase.accountId ? { accountId: purchase.accountId } : {}),
        ...(purchase.orderId ? { orderId: purchase.orderId } : {}),
      },
      select: {
        id: true,
        loyaltyAccountId: true,
        accountId: true,
        orderId: true,
        pointsReserved: true,
        discountAmount: true,
        expiresAt: true,
        status: true,
        loyaltyAccount: { select: { userId: true } },
      },
    });
  }

  async lockLoyaltyAccountForPayment(
    tx: Prisma.TransactionClient,
    options: { loyaltyAccountId?: string; userId?: string },
  ) {
    const locked = options.loyaltyAccountId
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "loyalty_accounts"
          WHERE "id" = ${options.loyaltyAccountId}::uuid
          FOR UPDATE
        `
      : options.userId
        ? await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "loyalty_accounts"
            WHERE "user_id" = ${options.userId}::uuid
            FOR UPDATE
          `
        : [];

    if (!locked.length) return null;
    return tx.loyaltyAccount.findUnique({
      where: { id: locked[0].id },
      select: { id: true, userId: true, balance: true, reservedPoints: true },
    });
  }

  async completeRedemptionForPayment(
    tx: Prisma.TransactionClient,
    data: {
      redemptionId: string;
      loyaltyAccountId: string;
      points: number;
      paymentId: string;
    },
  ): Promise<boolean> {
    // The PostgreSQL redemption trigger atomically decrements balance and
    // reserved_points for this RESERVED -> COMPLETED transition.
    const redemptionUpdate = await tx.loyaltyRedemption.updateMany({
      where: {
        id: data.redemptionId,
        loyaltyAccountId: data.loyaltyAccountId,
        status: LoyaltyRedemptionStatus.RESERVED,
        paymentId: null,
      },
      data: {
        paymentId: data.paymentId,
        status: LoyaltyRedemptionStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
    if (redemptionUpdate.count !== 1) return false;

    await tx.loyaltyRedemptionMovement.create({
      data: {
        redemptionId: data.redemptionId,
        loyaltyAccountId: data.loyaltyAccountId,
        type: LoyaltyRedemptionMovementType.SPENT,
        points: data.points,
        idempotencyKey: `${data.redemptionId}:${LoyaltyRedemptionMovementType.SPENT}`,
      },
    });
    return true;
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
  ): Promise<boolean> {
    // The PostgreSQL redemption trigger releases reserved_points only for
    // this RESERVED -> RELEASED transition; balance is left untouched.
    const redemptionUpdate = await tx.loyaltyRedemption.updateMany({
      where: {
        id: data.redemptionId,
        loyaltyAccountId: data.loyaltyAccountId,
        status: LoyaltyRedemptionStatus.RESERVED,
        paymentId: null,
      },
      data: {
        paymentId: data.paymentId ?? null,
        status: LoyaltyRedemptionStatus.RELEASED,
        releaseReason: data.reason,
        releasedAt: new Date(),
      },
    });
    if (redemptionUpdate.count !== 1) return false;

    await tx.loyaltyRedemptionMovement.create({
      data: {
        redemptionId: data.redemptionId,
        loyaltyAccountId: data.loyaltyAccountId,
        type: LoyaltyRedemptionMovementType.RELEASED,
        points: data.points,
        idempotencyKey: `${data.redemptionId}:${LoyaltyRedemptionMovementType.RELEASED}`,
      },
    });
    return true;
  }

  async reservePoints(
    tx: Prisma.TransactionClient,
    loyaltyAccountId: string,
    points: number,
  ): Promise<{ available: number } | null> {
    const rows = await tx.$queryRaw<Array<{ balance: number; reserved_points: number }>>`
      UPDATE "loyalty_accounts"
      SET "reserved_points" = "reserved_points" + ${points}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${loyaltyAccountId}::uuid
        AND "reserved_points" + ${points} <= "balance"
      RETURNING "balance", "reserved_points"
    `;

    if (!rows.length) return null;
    return { available: rows[0].balance - rows[0].reserved_points };
  }

  async createRedemption(
    tx: Prisma.TransactionClient,
    data: {
      loyaltyAccountId: string;
      benefitId: string;
      accountId?: string;
      orderId?: string;
      pointsReserved: number;
      subtotalAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
    },
  ) {
    const createdAt = new Date();
    const redemption = await tx.loyaltyRedemption.create({
      data: {
        ...data,
        status: LoyaltyRedemptionStatus.RESERVED,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1000),
      },
      select: { id: true, pointsReserved: true, discountAmount: true, status: true },
    });

    await tx.loyaltyRedemptionMovement.create({
      data: {
        redemptionId: redemption.id,
        loyaltyAccountId: data.loyaltyAccountId,
        type: LoyaltyRedemptionMovementType.RESERVED,
        points: data.pointsReserved,
        idempotencyKey: `${redemption.id}:${LoyaltyRedemptionMovementType.RESERVED}`,
      },
    });

    return redemption;
  }

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
  // H22: configuración de reglas y beneficios
  // ==========================================

  // Regla global vigente. Si no existe, quien llama usa la tasa por defecto.
  findCurrentRule() {
    return this.prisma.loyaltyRule.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, pointsPerDollar: true, updatedAt: true },
    });
  }

  // Actualiza la tasa y registra el cambio en una sola transacción. El bloqueo
  // consultivo serializa a los gerentes que guardan a la vez, de modo que la
  // regla global no se duplica y cada historial guarda el valor anterior real.
  updateRuleWithHistory(
    pointsPerDollar: Prisma.Decimal,
    changedById: string,
    defaultPointsPerDollar: Prisma.Decimal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1 AS locked
        FROM pg_advisory_xact_lock(hashtext('nucleo_digital:loyalty_rules'))
      `;

      const current = await tx.loyaltyRule.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true, pointsPerDollar: true },
      });

      const rule = current
        ? await tx.loyaltyRule.update({
            where: { id: current.id },
            data: { pointsPerDollar },
            select: { id: true, pointsPerDollar: true, updatedAt: true },
          })
        : await tx.loyaltyRule.create({
            data: { pointsPerDollar },
            select: { id: true, pointsPerDollar: true, updatedAt: true },
          });

      await tx.loyaltyRuleHistory.create({
        data: {
          loyaltyRuleId: rule.id,
          previousPoints: current?.pointsPerDollar ?? defaultPointsPerDollar,
          newPoints: pointsPerDollar,
          changedById,
        },
      });

      return rule;
    });
  }

  findRuleHistory(limit: number) {
    return this.prisma.loyaltyRuleHistory.findMany({
      orderBy: { changedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        previousPoints: true,
        newPoints: true,
        changedAt: true,
        changedBy: { select: { id: true, email: true } },
      },
    });
  }

  // A diferencia de findActiveBenefits (H21), incluye los inactivos.
  findAllBenefits() {
    return this.prisma.loyaltyBenefit.findMany({
      orderBy: [{ active: 'desc' }, { pointsRequired: 'asc' }, { name: 'asc' }],
      select: ADMIN_BENEFIT_SELECT,
    });
  }

  createBenefit(
    data: BenefitInput,
    userId: string,
  ): Promise<BenefitWriteResult> {
    return this.writeBenefit(async (tx) => {
      if (await this.benefitNameTaken(tx, data.name)) {
        return { status: 'duplicate' };
      }
      const benefit = await tx.loyaltyBenefit.create({
        data: { ...data, createdById: userId, updatedById: userId },
        select: ADMIN_BENEFIT_SELECT,
      });
      return { status: 'ok', benefit };
    });
  }

  updateBenefit(
    id: string,
    data: BenefitInput,
    userId: string,
  ): Promise<BenefitWriteResult> {
    return this.writeBenefit(async (tx) => {
      if (!(await this.lockBenefitForUpdate(tx, id))) {
        return { status: 'not_found' };
      }
      if (await this.benefitNameTaken(tx, data.name, id)) {
        return { status: 'duplicate' };
      }
      const benefit = await tx.loyaltyBenefit.update({
        where: { id },
        data: { ...data, updatedById: userId },
        select: ADMIN_BENEFIT_SELECT,
      });
      return { status: 'ok', benefit };
    });
  }

  // Desactivar no borra el beneficio ni toca sus canjes: H21 deja de
  // ofrecerlo y rechaza canjes nuevos, pero los existentes se conservan.
  setBenefitActive(
    id: string,
    active: boolean,
    userId: string,
  ): Promise<BenefitWriteResult> {
    return this.writeBenefit(async (tx) => {
      if (!(await this.lockBenefitForUpdate(tx, id))) {
        return { status: 'not_found' };
      }
      const benefit = await tx.loyaltyBenefit.update({
        where: { id },
        data: { active, updatedById: userId },
        select: ADMIN_BENEFIT_SELECT,
      });
      return { status: 'ok', benefit };
    });
  }

  // El bloqueo consultivo serializa altas y ediciones para que la comparación
  // de nombres sin distinguir mayúsculas no tenga carreras.
  private async writeBenefit(
    callback: (tx: Prisma.TransactionClient) => Promise<BenefitWriteResult>,
  ): Promise<BenefitWriteResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT 1 AS locked
          FROM pg_advisory_xact_lock(hashtext('nucleo_digital:loyalty_benefits'))
        `;
        return callback(tx);
      });
    } catch (error) {
      // Respaldo: índice único loyalty_benefits_name_key.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return { status: 'duplicate' };
      }
      throw error;
    }
  }

  // FOR UPDATE espera a los canjes en curso de H21 (que toman FOR SHARE).
  private async lockBenefitForUpdate(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "loyalty_benefits"
      WHERE "id" = ${id}::uuid
      FOR UPDATE
    `;
    return rows.length > 0;
  }

  private async benefitNameTaken(
    tx: Prisma.TransactionClient,
    name: string,
    excludeId?: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "loyalty_benefits"
      WHERE lower("name") = lower(${name})
        AND (${excludeId ?? null}::uuid IS NULL OR "id" <> ${excludeId ?? null}::uuid)
      LIMIT 1
    `;
    return rows.length > 0;
  }
}
