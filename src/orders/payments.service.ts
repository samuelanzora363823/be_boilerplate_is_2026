import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  LoyaltyRedemptionReleaseReason,
  PaymentMethod,
  PaymentStatus,
  UserRole,
  Prisma,
} from '../generated/prisma/client.js';

import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { KitchenGateway } from './kitchen.gateway.js';
import { CreatePaymentDto } from './payments.dto.js';
import { CreateTakeawayPaymentDto } from './payments.dto.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly kitchen: KitchenGateway,
    private readonly loyalty: LoyaltyService,
  ) {}

  // Obtener la sucursal del mesero.
  private async branch(user: User): Promise<string> {
    const assignments = await this.db.staffBranch.findMany({
      where: { userId: user.id },
      select: { branchId: true },
    });

    if (assignments.length !== 1) {
      throw new ForbiddenException(
        'El mesero debe estar asignado a una sola sucursal',
      );
    }

    return assignments[0].branchId;
  }

  // Simular procesamiento de tarjeta.
  private async delay(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  // Calcular subtotal, descuento, IVA y total.
  private calculateAmounts(
    subtotal: Prisma.Decimal,
    discount = new Prisma.Decimal(0),
  ) {
    const roundedSubtotal = subtotal.toDecimalPlaces(2);
    const roundedDiscount = discount.toDecimalPlaces(2);
    if (roundedDiscount.lt(0) || roundedDiscount.gt(roundedSubtotal)) {
      throw new ConflictException('El canje tiene un descuento incompatible con la compra.');
    }
    const taxableAmount = roundedSubtotal.minus(roundedDiscount);
    const tax = taxableAmount.mul(new Prisma.Decimal('0.13')).toDecimalPlaces(2);
    const total = taxableAmount.plus(tax).toDecimalPlaces(2);

    return {
      subtotal: roundedSubtotal,
      discount: roundedDiscount,
      tax,
      total,
    };
  }

  // Obtener y validar la cuenta o pedido.
  private async getPaymentTarget(
    tx: Prisma.TransactionClient,
    input: { accountId?: string; orderId?: string },
    branchId: string,
    user: User,
    validateEligibility = true,
  ) {
    if (Boolean(input.accountId) === Boolean(input.orderId)) {
      throw new BadRequestException(
        'Debes proporcionar una cuenta o un pedido, nunca ambos',
      );
    }

    if (input.accountId) {
      const account = await tx.account.findUnique({
        where: { id: input.accountId },
        include: {
          table: true,
          orders: {
            where: { status: { not: 'CANCELLED' } },
            include: {
              items: {
                include: {
                  dish: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!account) {
        throw new NotFoundException('Cuenta inexistente');
      }

      if (
        account.branchId !== branchId ||
        account.waiterId !== user.id
      ) {
        throw new ForbiddenException('No tienes acceso a esta cuenta');
      }

      if (validateEligibility && account.status !== 'OPEN') {
        throw new ConflictException('La cuenta no está abierta');
      }

      if (
        validateEligibility &&
        (account.orders.length === 0 ||
          account.orders.some((order) => order.status !== 'DELIVERED'))
      ) {
        throw new ConflictException(
          'La cuenta tiene pedidos pendientes de entrega',
        );
      }

      return {
        type: 'ACCOUNT' as const,
        account,
      };
    }

    const order = await tx.order.findUnique({
      where: { id: input.orderId! },
      include: {
        items: {
          include: {
            dish: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Pedido inexistente');
    }

    if (order.branchId !== branchId) {
      throw new ForbiddenException(
        'El pedido no pertenece a tu sucursal',
      );
    }

    if (order.accountId !== null) {
      throw new BadRequestException(
        'Este pedido pertenece a una cuenta y no puede cobrarse individualmente',
      );
    }

    if (validateEligibility && order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(
        'El pedido no está pendiente de pago',
      );
    }

    return {
      type: 'ORDER' as const,
      order,
    };
  }

  private async lockPurchaseForPayment(
    tx: Prisma.TransactionClient,
    purchase: { accountId?: string; orderId?: string },
  ) {
    if (purchase.accountId) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "accounts"
        WHERE "id" = ${purchase.accountId}::uuid
        FOR UPDATE
      `;
      if (!rows.length) throw new NotFoundException('Cuenta inexistente');
      return;
    }

    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "orders"
      WHERE "id" = ${purchase.orderId!}::uuid
      FOR UPDATE
    `;
    if (!rows.length) throw new NotFoundException('Pedido inexistente');
  }

  private async prepareRedemptionForPayment(
    tx: Prisma.TransactionClient,
    purchase: { accountId?: string; orderId?: string },
    customerId: string | null,
  ) {
    // Initial lookup is intentionally unlocked. If a reservation exists, lock
    // its points account before the purchase, matching H21's reservation order.
    const initial = await this.loyalty.findReservedRedemptionForPurchase(
      tx,
      purchase,
    );
    const loyaltyAccount = await this.loyalty.lockLoyaltyAccountForPayment(tx, {
      ...(initial
        ? { loyaltyAccountId: initial.loyaltyAccountId }
        : customerId
          ? { userId: customerId }
          : {}),
    });

    await this.lockPurchaseForPayment(tx, purchase);

    const current = await this.loyalty.findReservedRedemptionForPurchase(
      tx,
      purchase,
    );
    if (initial && (!current || current.id !== initial.id)) {
      throw new ConflictException('El canje cambió mientras se iniciaba el pago.');
    }

    if (
      current &&
      (current.accountId !== (purchase.accountId ?? null) ||
        current.orderId !== (purchase.orderId ?? null))
    ) {
      throw new ConflictException('El canje no corresponde a esta compra.');
    }

    const freshCustomerId = purchase.accountId
      ? (await tx.account.findUnique({
          where: { id: purchase.accountId },
          select: { customerId: true },
        }))?.customerId ?? null
      : (await tx.order.findUnique({
          where: { id: purchase.orderId! },
          select: { customerId: true },
        }))?.customerId ?? null;
    if (freshCustomerId !== customerId) {
      throw new ConflictException('El propietario de la compra cambió durante el pago.');
    }

    if (current) {
      if (
        !loyaltyAccount ||
        current.loyaltyAccountId !== loyaltyAccount.id ||
        current.loyaltyAccount.userId !== customerId
      ) {
        throw new ConflictException('El canje no pertenece al cliente de la compra.');
      }
    }

    return {
      redemption: current,
      expired: Boolean(current && current.expiresAt <= new Date()),
    };
  }

  private async releaseExpiredRedemption(
    tx: Prisma.TransactionClient,
    redemption: NonNullable<
      Awaited<ReturnType<LoyaltyService['findReservedRedemptionForPurchase']>>
    >,
  ) {
    const released = await this.loyalty.releaseExpiredRedemptionInTransaction(
      tx,
      redemption.id,
      new Date(),
    );
    if (!released) {
      throw new ConflictException('La reserva vencida cambió durante el pago.');
    }
  }

  // H18: registrar pago y generar comprobante.
  async registerPayment(user: User, input: CreatePaymentDto) {
    if (user.role !== UserRole.MESERO) {
      throw new ForbiddenException(
        'Solo un mesero puede registrar pagos',
      );
    }

    const branchId = await this.branch(user);

    // Validar método de pago.
    if (input.method === PaymentMethod.CARD) {
      if (!input.cardLast4) {
        throw new BadRequestException(
          'Debes proporcionar los últimos cuatro dígitos de la tarjeta',
        );
      }

      if (!['4242', '0002'].includes(input.cardLast4)) {
        throw new BadRequestException(
          'La tarjeta de prueba debe terminar en 4242 o 0002',
        );
      }

      if (input.amountReceived !== undefined) {
        throw new BadRequestException(
          'No debes enviar efectivo recibido para un pago con tarjeta',
        );
      }

      await this.delay(2000);
    } else if (input.method === PaymentMethod.CASH) {
      if (input.amountReceived === undefined) {
        throw new BadRequestException(
          'Debes indicar el efectivo recibido',
        );
      }

      if (input.cardLast4 !== undefined) {
        throw new BadRequestException(
          'No debes enviar datos de tarjeta para un pago en efectivo',
        );
      }
    } else {
      throw new BadRequestException('Método de pago no válido');
    }

    // Procesamiento transaccional.
    const result = await this.db.$transaction(async (tx) => {
      const preflightTarget = await this.getPaymentTarget(
        tx,
        input,
        branchId,
        user,
        false,
      );
      const purchase = preflightTarget.type === 'ACCOUNT'
        ? { accountId: preflightTarget.account.id }
        : { orderId: preflightTarget.order.id };
      const customerId = preflightTarget.type === 'ACCOUNT'
        ? preflightTarget.account.customerId
        : preflightTarget.order.customerId;
      const reservation = await this.prepareRedemptionForPayment(
        tx,
        purchase,
        customerId,
      );

      // Read the purchase again while its row lock is held. Expired canjes
      // are released even when the purchase is no longer payable.
      let target = await this.getPaymentTarget(
        tx,
        input,
        branchId,
        user,
        false,
      );
      if (!reservation.expired) {
        target = await this.getPaymentTarget(tx, input, branchId, user);
      }

      const pricedItems =
        target.type === 'ACCOUNT'
          ? target.account.orders.flatMap((order) =>
              order.items.map((item) => ({
                productName: item.dish.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                subtotal: item.subtotal,
              })),
            )
          : target.order.items.map((item) => ({
              productName: item.dish.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              subtotal: item.subtotal,
            }));

      if (pricedItems.length === 0) {
        throw new ConflictException(
          'No existen productos para cobrar',
        );
      }

      const subtotal = pricedItems.reduce(
        (sum, item) => sum.plus(item.subtotal),
        new Prisma.Decimal(0),
      );

      const discount = reservation.redemption?.discountAmount ?? new Prisma.Decimal(0);
      const amounts = this.calculateAmounts(subtotal, discount);

      if (
        reservation.redemption &&
        (reservation.expired || reservation.redemption.expiresAt <= new Date())
      ) {
        await this.releaseExpiredRedemption(tx, reservation.redemption);
        return { expired: true as const };
      }

      // Keep the existing insufficient-cash behavior: no payment is attempted,
      // but an already-expired reservation has been released above.
      let amountReceived: Prisma.Decimal | null = null;
      let change = new Prisma.Decimal(0);
      if (input.method === PaymentMethod.CASH) {
        amountReceived = new Prisma.Decimal(input.amountReceived!);
        if (amountReceived.lt(amounts.total)) {
          throw new BadRequestException(
            'El efectivo recibido es insuficiente',
          );
        }
        change = amountReceived.minus(amounts.total);
      }

      if (
        reservation.redemption &&
        (reservation.expired || reservation.redemption.expiresAt <= new Date())
      ) {
        await this.releaseExpiredRedemption(tx, reservation.redemption);
        return { expired: true as const };
      }

      const items = pricedItems.map((item) => ({
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice.toNumber(),
        subtotal: item.subtotal.toNumber(),
      }));

      let paymentStatus: PaymentStatus = PaymentStatus.APPROVED;

      // Simulación de tarjeta.
      if (
        input.method === PaymentMethod.CARD &&
        input.cardLast4 === '0002'
      ) {
        paymentStatus = PaymentStatus.REJECTED;
      }

      if (
        reservation.redemption &&
        reservation.redemption.expiresAt <= new Date()
      ) {
        await this.releaseExpiredRedemption(tx, reservation.redemption);
        return { expired: true as const };
      }

      // Registrar intento de pago.
      const payment = await tx.payment.create({
        data: {
          branchId,
          accountId:
            target.type === 'ACCOUNT'
              ? target.account.id
              : null,
          orderId:
            target.type === 'ORDER'
              ? target.order.id
              : null,
          userId: user.id,
          method: input.method,
          status: paymentStatus,
          amount: amounts.total,
          amountReceived,
          change,
          cardLast4:
            input.method === PaymentMethod.CARD
              ? input.cardLast4
              : null,
        },
      });

      // Si el pago es rechazado, no cerrar ni generar comprobante.
      if (paymentStatus === PaymentStatus.REJECTED) {
        if (reservation.redemption) {
          await this.loyalty.releaseRedemptionForPayment(tx, {
            redemptionId: reservation.redemption.id,
            loyaltyAccountId: reservation.redemption.loyaltyAccountId,
            points: reservation.redemption.pointsReserved,
            reason: LoyaltyRedemptionReleaseReason.PAYMENT_REJECTED,
            paymentId: payment.id,
          });
        }
        return {
          rejected: true as const,
          paymentId: payment.id,
        };
      }

      if (reservation.redemption) {
        await this.loyalty.completeRedemptionForPayment(tx, {
          redemptionId: reservation.redemption.id,
          loyaltyAccountId: reservation.redemption.loyaltyAccountId,
          points: reservation.redemption.pointsReserved,
          paymentId: payment.id,
        });
      }

      // Incrementar correlativo de comprobantes por sucursal.
      const branchUpdate = await tx.branch.update({
        where: { id: branchId },
        data: {
          receiptCounter: { increment: 1 },
        },
        select: {
          receiptCounter: true,
          code: true,
        },
      });

      // Generar comprobante.
      const receipt = await tx.receipt.create({
        data: {
          branchId,
          paymentId: payment.id,
          accountId:
            target.type === 'ACCOUNT'
              ? target.account.id
              : null,
          orderId:
            target.type === 'ORDER'
              ? target.order.id
              : null,
          receiptNumber: branchUpdate.receiptCounter,
          subtotal: amounts.subtotal,
          discount: amounts.discount,
          tax: amounts.tax,
          total: amounts.total,
          paymentMethod: input.method,
          items: items as Prisma.InputJsonValue,
        },
      });

      // Cerrar cuenta y liberar mesa.
      if (target.type === 'ACCOUNT') {
        await tx.account.update({
          where: { id: target.account.id },
          data: { status: 'PAID' },
        });

        await tx.restaurantTable.update({
          where: { id: target.account.tableId },
          data: { status: 'FREE' },
        });
      } else {
        // Confirmar pedido para llevar.
        await tx.order.update({
          where: { id: target.order.id },
          data: { status: 'RECEIVED' },
        });
      }

      return {
        rejected: false as const,
        paymentId: payment.id,
        customerId: target.type === 'ACCOUNT'
          ? target.account.customerId
          : target.order.customerId,
        receipt: {
          id: receipt.id,
          number: receipt.receiptNumber,
          branchCode: branchUpdate.code,
          issuedAt: receipt.issuedAt,
          subtotal: receipt.subtotal,
          discount: receipt.discount,
          tax: receipt.tax,
          total: receipt.total,
          paymentMethod: receipt.paymentMethod,
          items,
        },
        change,
        orderNotification:
          target.type === 'ORDER'
            ? {
                id: target.order.id,
                orderNumber: target.order.orderNumber,
                status: 'RECEIVED',
                items: target.order.items.map((item) => ({
                  dishId: item.dishId,
                  name: item.dish.name,
                  quantity: item.quantity,
                  notes: item.notes,
                })),
              }
            : null,
      };
    });

    if ('expired' in result && result.expired) {
      throw new ConflictException('La reserva del canje venció; solicita un nuevo canje.');
    }

    // Respuesta de pago rechazado.
    if (result.rejected) {
      return {
        paymentId: result.paymentId,
        status: 'REJECTED',
        message: 'Pago rechazado. Intente con otro método de pago',
      };
    }

    // Procesar fidelidad únicamente después de aprobar el pago.
    await this.loyalty.processApprovedPayment(
      result.customerId,
      result.paymentId,
      result.receipt.total.toNumber(),
    );

    // Notificar a cocina únicamente después de confirmar el pago.
    if (result.orderNotification) {
      this.kitchen.notify(branchId, result.orderNotification);
    }

    return {
      paymentId: result.paymentId,
      status: 'APPROVED',
      message: 'Pago realizado correctamente',
      receipt: result.receipt,
      change: result.change,
    };
  }

  // H19: pago en línea de pedidos para llevar realizado por clientes.
  async payTakeawayOrder(
    user: User,
    orderId: string,
    input: CreateTakeawayPaymentDto,
  ) {
    if (user.role !== UserRole.CLIENTE) {
      throw new ForbiddenException(
        'Solo un cliente puede pagar su pedido',
      );
    }

    await this.delay(2000);

    try {
      const result = await this.db.$transaction(async (tx) => {
        const initialOrder = await tx.order.findUnique({
          where: { id: orderId },
          select: { id: true, customerId: true, accountId: true },
        });

        if (!initialOrder) {
          throw new NotFoundException('Pedido inexistente');
        }

        if (initialOrder.customerId !== user.id || initialOrder.accountId !== null) {
          throw new ForbiddenException(
            'No tiene permiso para consultar este pedido',
          );
        }

        const reservation = await this.prepareRedemptionForPayment(
          tx,
          { orderId },
          initialOrder.customerId,
        );

        if (reservation.expired && reservation.redemption) {
          await this.releaseExpiredRedemption(tx, reservation.redemption);
          return { expired: true as const };
        }

        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            items: {
              include: {
                dish: {
                  select: { name: true },
                },
              },
            },
          },
        });

        if (!order) {
          throw new NotFoundException('Pedido inexistente');
        }

        if (order.customerId !== user.id || order.accountId !== null) {
          throw new ConflictException('El pedido cambió durante el pago.');
        }

        if (order.status !== 'PENDING_PAYMENT') {
          throw new ConflictException(
            'El pedido no está pendiente de pago',
          );
        }

        if (order.items.length === 0) {
          throw new ConflictException(
            'No existen productos para cobrar',
          );
        }

        const pricedItems = order.items.map((item) => ({
          productName: item.dish.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        }));

        const subtotal = pricedItems.reduce(
          (sum, item) => sum.plus(item.subtotal),
          new Prisma.Decimal(0),
        );

        const amounts = this.calculateAmounts(
          subtotal,
          reservation.redemption?.discountAmount ?? new Prisma.Decimal(0),
        );

        const items = pricedItems.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toNumber(),
          subtotal: item.subtotal.toNumber(),
        }));

        const paymentStatus =
          input.cardLast4 === '0002'
            ? PaymentStatus.REJECTED
            : PaymentStatus.APPROVED;

        if (
          reservation.redemption &&
          reservation.redemption.expiresAt <= new Date()
        ) {
          await this.releaseExpiredRedemption(tx, reservation.redemption);
          return { expired: true as const };
        }

        const payment = await tx.payment.create({
          data: {
            branchId: order.branchId,
            orderId: order.id,
            userId: user.id,
            method: PaymentMethod.CARD,
            status: paymentStatus,
            amount: amounts.total,
            cardLast4: input.cardLast4,
          },
        });

        if (paymentStatus === PaymentStatus.REJECTED) {
          if (reservation.redemption) {
            await this.loyalty.releaseRedemptionForPayment(tx, {
              redemptionId: reservation.redemption.id,
              loyaltyAccountId: reservation.redemption.loyaltyAccountId,
              points: reservation.redemption.pointsReserved,
              reason: LoyaltyRedemptionReleaseReason.PAYMENT_REJECTED,
              paymentId: payment.id,
            });
          }
          return {
            rejected: true as const,
            paymentId: payment.id,
          };
        }

        if (reservation.redemption) {
          await this.loyalty.completeRedemptionForPayment(tx, {
            redemptionId: reservation.redemption.id,
            loyaltyAccountId: reservation.redemption.loyaltyAccountId,
            points: reservation.redemption.pointsReserved,
            paymentId: payment.id,
          });
        }

        const branchUpdate = await tx.branch.update({
          where: { id: order.branchId },
          data: {
            receiptCounter: { increment: 1 },
          },
          select: {
            receiptCounter: true,
            code: true,
            name: true,
          },
        });

        const receipt = await tx.receipt.create({
          data: {
            branchId: order.branchId,
            paymentId: payment.id,
            orderId: order.id,
            receiptNumber: branchUpdate.receiptCounter,
            subtotal: amounts.subtotal,
            discount: amounts.discount,
            tax: amounts.tax,
            total: amounts.total,
            paymentMethod: PaymentMethod.CARD,
            items: items as Prisma.InputJsonValue,
          },
        });

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'RECEIVED',
          },
        });

        return {
          rejected: false as const,
          paymentId: payment.id,
          branchId: order.branchId,
          customerId: order.customerId,
          receipt: {
            id: receipt.id,
            number: receipt.receiptNumber,
            branch: {
              name: branchUpdate.name,
              code: branchUpdate.code,
            },
            issuedAt: receipt.issuedAt,
            subtotal: receipt.subtotal,
            discount: receipt.discount,
            tax: receipt.tax,
            total: receipt.total,
            paymentMethod: receipt.paymentMethod,
            items,
            order: {
              id: order.id,
              orderNumber: order.orderNumber,
            },
          },
          orderNotification: {
            id: order.id,
            orderNumber: order.orderNumber,
            status: 'RECEIVED',
            items: order.items.map((item) => ({
              dishId: item.dishId,
              name: item.dish.name,
              quantity: item.quantity,
              notes: item.notes,
            })),
          },
        };
      });

      if ('expired' in result && result.expired) {
        throw new ConflictException('La reserva del canje venció; solicita un nuevo canje.');
      }

      if (result.rejected) {
        return {
          paymentId: result.paymentId,
          status: 'REJECTED',
          message: 'Pago rechazado. Intente con otro método de pago',
        };
      }

      // Integración con el servicio interno de fidelidad.
      await this.loyalty.processApprovedPayment(
        result.customerId,
        result.paymentId,
        result.receipt.total.toNumber(),
      );

      // Cocina recibe el pedido después de confirmar el pago.
      this.kitchen.notify(
        result.branchId,
        result.orderNotification,
      );

      return {
        paymentId: result.paymentId,
        status: 'APPROVED',
        message: 'Pago aprobado',
        receipt: result.receipt,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Este pedido ya tiene un pago aprobado',
        );
      }

      throw error;
    }
  }

  // H18: consultar un comprobante generado.
  // H18: historial paginado de comprobantes de la sucursal.
  async listReceipts(user: User, pageInput?: string, limitInput?: string) {
    if (user.role !== UserRole.MESERO) {
      throw new ForbiddenException(
        'Solo un mesero puede consultar comprobantes',
      );
    }

    const branchId = await this.branch(user);
    const page = pageInput === undefined ? 1 : Number(pageInput);
    const limit = limitInput === undefined ? 10 : Number(limitInput);

    if (
      !Number.isInteger(page) || page < 1 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100
    ) {
      throw new BadRequestException(
        'La página debe ser positiva y el límite debe estar entre 1 y 100',
      );
    }

    const where = {
      branchId,
      payment: { status: PaymentStatus.APPROVED },
      OR: [
        { accountId: null },
        { account: { is: { waiterId: user.id } } },
      ],
    };

    const [rows, total] = await this.db.$transaction([
      this.db.receipt.findMany({
        where,
        include: {
          branch: { select: { name: true, code: true } },
          payment: { select: { status: true, method: true } },
          order: { select: { id: true, orderNumber: true } },
        },
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.receipt.count({ where }),
    ]);

    return {
      data: rows.map((receipt) => ({
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        issuedAt: receipt.issuedAt,
        branch: receipt.branch,
        subtotal: receipt.subtotal,
        discount: receipt.discount,
        tax: receipt.tax,
        total: receipt.total,
        paymentMethod: receipt.paymentMethod,
        paymentStatus: receipt.payment.status,
        order: receipt.order,
      })),
      total,
      page,
      limit,
    };
  }

  async getReceipt(user: User, receiptId: string) {
    if (user.role !== UserRole.MESERO) {
      throw new ForbiddenException(
        'Solo un mesero puede consultar comprobantes',
      );
    }

    const branchId = await this.branch(user);

    const receipt = await this.db.receipt.findUnique({
      where: { id: receiptId },
      include: {
        branch: {
          select: {
            name: true,
            code: true,
          },
        },
        payment: {
          select: {
            status: true,
            method: true,
          },
        },
        account: {
          select: {
            waiterId: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
          },
        },
      },
    });

    if (!receipt || receipt.branchId !== branchId) {
      throw new NotFoundException('Comprobante no encontrado');
    }

    if (receipt.payment.status !== PaymentStatus.APPROVED) {
      throw new ConflictException(
        'El comprobante no corresponde a un pago aprobado',
      );
    }

    if (
      receipt.account &&
      receipt.account.waiterId !== user.id
    ) {
      throw new ForbiddenException(
        'No tienes acceso a este comprobante',
      );
    }

    return {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      issuedAt: receipt.issuedAt,
      branch: receipt.branch,
      subtotal: receipt.subtotal,
      discount: receipt.discount,
      tax: receipt.tax,
      total: receipt.total,
      paymentMethod: receipt.paymentMethod,
      paymentStatus: receipt.payment.status,
      items: receipt.items,
      order: receipt.order,
    };
  }
}
