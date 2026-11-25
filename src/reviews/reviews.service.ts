import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@PrismaClient';
import type { User } from '@PrismaClient';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ReviewsRepository } from './reviews.repository.js';

@Injectable()
export class ReviewsService {
  constructor(private readonly reviewsRepository: ReviewsRepository) {}

  async create(user: User, input: CreateReviewDto) {
    try {
      return await this.reviewsRepository.transaction(async (tx) => {
        if (input.accountId) {
          const account = await this.reviewsRepository.lockAccount(
            tx,
            input.accountId,
          );
          if (!account) throw new NotFoundException('Cuenta inexistente.');
          if (account.customerId !== user.id) {
            throw new ForbiddenException('La cuenta no pertenece al cliente.');
          }
          if (
            account.status !== 'PAID' ||
            account.receipt?.payment.status !== 'APPROVED'
          ) {
            throw new ConflictException(
              'La cuenta debe estar pagada y tener un pago aprobado para reseñarla.',
            );
          }

          return this.reviewsRepository.create(tx, {
            userId: user.id,
            accountId: account.id,
            branchId: account.branchId,
            rating: input.rating,
            ...(input.comment !== undefined ? { comment: input.comment } : {}),
          });
        }

        const order = await this.reviewsRepository.lockOrder(tx, input.orderId!);
        if (!order) throw new NotFoundException('Pedido inexistente.');
        if (order.customerId !== user.id) {
          throw new ForbiddenException('El pedido no pertenece al cliente.');
        }
        if (order.accountId !== null) {
          throw new ConflictException(
            'Los pedidos de una cuenta de mesa se reseñan mediante la cuenta.',
          );
        }
        if (
          order.status !== 'DELIVERED' ||
          order.receipt?.payment.status !== 'APPROVED'
        ) {
          throw new ConflictException(
            'El pedido debe estar entregado y tener un pago aprobado para reseñarlo.',
          );
        }

        return this.reviewsRepository.create(tx, {
          userId: user.id,
          orderId: order.id,
          branchId: order.branchId,
          rating: input.rating,
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe una reseña para esta compra.');
      }
      throw error;
    }
  }

  async listBranchReviews(
    user: User,
    branchId: string,
    query: { page: number; limit: number },
  ) {
    const branch = await this.reviewsRepository.findBranch(branchId);
    if (!branch) throw new NotFoundException('La sucursal no existe.');

    const assignment = await this.reviewsRepository.findBranchAssignment(
      user.id,
      branchId,
    );
    if (!assignment) {
      throw new ForbiddenException('No tienes acceso a esta sucursal.');
    }

    const result = await this.reviewsRepository.getBranchReviewPage(
      branchId,
      query.page,
      query.limit,
    );
    const averageRating = result.totalReviews === 0 || result.ratingSum === null
      ? null
      : new Prisma.Decimal(result.ratingSum)
          .dividedBy(result.totalReviews)
          .toDecimalPlaces(2)
          .toNumber();

    return {
      branchId,
      averageRating,
      totalReviews: result.totalReviews,
      page: query.page,
      limit: query.limit,
      totalPages: result.totalReviews === 0
        ? 0
        : Math.ceil(result.totalReviews / query.limit),
      reviews: result.reviews,
    };
  }
}
