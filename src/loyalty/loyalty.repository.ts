import { Injectable } from '@nestjs/common';
import { PrismaService } from '@Prisma/services';
import { Prisma, LoyaltyMovementType } from '@PrismaClient';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class LoyaltyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccountByUserId(userId: string) {
    return this.prisma.loyaltyAccount.findUnique({
      where: { userId },
      select: {
        id: true,
        balance: true,
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
}
