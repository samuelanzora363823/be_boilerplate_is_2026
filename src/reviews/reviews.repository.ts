import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import { Prisma } from '@PrismaClient';

@Injectable()
export class ReviewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }

  async lockAccount(tx: Prisma.TransactionClient, accountId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "accounts"
      WHERE "id" = ${accountId}::uuid
      FOR UPDATE
    `;
    if (!rows.length) return null;

    return tx.account.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        customerId: true,
        branchId: true,
        status: true,
        receipt: {
          select: {
            payment: { select: { status: true } },
          },
        },
      },
    });
  }

  async lockOrder(tx: Prisma.TransactionClient, orderId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders"
      WHERE "id" = ${orderId}::uuid
      FOR UPDATE
    `;
    if (!rows.length) return null;

    return tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        customerId: true,
        branchId: true,
        accountId: true,
        status: true,
        receipt: {
          select: {
            payment: { select: { status: true } },
          },
        },
      },
    });
  }

  create(
    tx: Prisma.TransactionClient,
    data: {
      userId: string;
      accountId?: string;
      orderId?: string;
      branchId: string;
      rating: number;
      comment?: string;
    },
  ) {
    return tx.review.create({
      data,
      select: {
        id: true,
        userId: true,
        accountId: true,
        orderId: true,
        branchId: true,
        rating: true,
        comment: true,
        createdAt: true,
      },
    });
  }
}
