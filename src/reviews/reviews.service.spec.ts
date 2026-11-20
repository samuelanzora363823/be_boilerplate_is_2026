import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@PrismaClient';
import type { User } from '@PrismaClient';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ReviewsService } from './reviews.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';
const BRANCH_ID = '55555555-5555-4555-8555-555555555555';
const REVIEW_ID = '66666666-6666-4666-8666-666666666666';
const user = { id: USER_ID, role: 'CLIENTE' } as User;

function setup() {
  const tx = {} as never;
  const repository = {
    transaction: vi.fn(async (callback: (tx: never) => unknown) => callback(tx)),
    lockAccount: vi.fn(),
    lockOrder: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: REVIEW_ID }),
  };
  return {
    tx,
    repository,
    service: new ReviewsService(repository as never),
  };
}

const approvedReceipt = { payment: { status: 'APPROVED' } };

describe('ReviewsService', () => {
  it('devuelve 404 si la compra no existe', async () => {
    const { repository, service } = setup();
    repository.lockOrder.mockResolvedValue(null);

    await expect(
      service.create(user, { orderId: ORDER_ID, rating: 5 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('devuelve 403 si la compra pertenece a otro cliente', async () => {
    const { repository, service } = setup();
    repository.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: OTHER_USER_ID,
      accountId: null,
      status: 'DELIVERED',
      receipt: approvedReceipt,
      branchId: BRANCH_ID,
    });

    await expect(
      service.create(user, { orderId: ORDER_ID, rating: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'PENDING_PAYMENT', receipt: approvedReceipt },
    { status: 'DELIVERED', receipt: null },
    { status: 'DELIVERED', receipt: { payment: { status: 'REJECTED' } } },
  ])('rechaza pedido no pagado o no completado: %o', async (state) => {
    const { repository, service } = setup();
    repository.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: USER_ID,
      accountId: null,
      branchId: BRANCH_ID,
      ...state,
    });

    await expect(
      service.create(user, { orderId: ORDER_ID, rating: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rechaza pedidos de mesa para que la reseña se asocie a la cuenta', async () => {
    const { repository, service } = setup();
    repository.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: USER_ID,
      accountId: ACCOUNT_ID,
      branchId: BRANCH_ID,
      status: 'DELIVERED',
      receipt: approvedReceipt,
    });

    await expect(
      service.create(user, { orderId: ORDER_ID, rating: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('crea una reseña para un pedido para llevar con identidad y sucursal derivadas', async () => {
    const { repository, service, tx } = setup();
    repository.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: USER_ID,
      accountId: null,
      branchId: BRANCH_ID,
      status: 'DELIVERED',
      receipt: approvedReceipt,
    });

    await service.create(user, {
      orderId: ORDER_ID,
      rating: 5,
      comment: 'Excelente',
    });

    expect(repository.create).toHaveBeenCalledWith(tx, {
      userId: USER_ID,
      orderId: ORDER_ID,
      branchId: BRANCH_ID,
      rating: 5,
      comment: 'Excelente',
    });
  });

  it('valida propiedad, pago y estado para cuenta de mesa', async () => {
    const { repository, service, tx } = setup();
    repository.lockAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      customerId: USER_ID,
      branchId: BRANCH_ID,
      status: 'PAID',
      receipt: approvedReceipt,
    });

    await service.create(user, {
      accountId: ACCOUNT_ID,
      rating: 4,
    });

    expect(repository.create).toHaveBeenCalledWith(tx, {
      userId: USER_ID,
      accountId: ACCOUNT_ID,
      branchId: BRANCH_ID,
      rating: 4,
    });
  });

  it('rechaza cuenta no pagada o sin pago aprobado', async () => {
    const { repository, service } = setup();
    repository.lockAccount.mockResolvedValue({
      id: ACCOUNT_ID,
      customerId: USER_ID,
      branchId: BRANCH_ID,
      status: 'PAID',
      receipt: { payment: { status: 'REJECTED' } },
    });

    await expect(
      service.create(user, { accountId: ACCOUNT_ID, rating: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('traduce P2002 de los índices únicos a HTTP 409', async () => {
    const { repository, service } = setup();
    repository.lockOrder.mockResolvedValue({
      id: ORDER_ID,
      customerId: USER_ID,
      accountId: null,
      branchId: BRANCH_ID,
      status: 'DELIVERED',
      receipt: approvedReceipt,
    });
    repository.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['order_id'] },
      }),
    );

    await expect(
      service.create(user, { orderId: ORDER_ID, rating: 5 }),
    ).rejects.toThrow('Ya existe una reseña para esta compra.');
  });
});
