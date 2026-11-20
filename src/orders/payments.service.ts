import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
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
  private calculateAmounts(subtotal: Prisma.Decimal) {
    const discount = new Prisma.Decimal(0);
    const taxableAmount = subtotal.minus(discount);
    const tax = taxableAmount.mul(0.13).toDecimalPlaces(2);
    const total = taxableAmount.plus(tax).toDecimalPlaces(2);

    return {
      subtotal: subtotal.toDecimalPlaces(2),
      discount,
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

      if (account.status !== 'OPEN') {
        throw new ConflictException('La cuenta no está abierta');
      }

      if (
        account.orders.length === 0 ||
        account.orders.some((order) => order.status !== 'DELIVERED')
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

    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(
        'El pedido no está pendiente de pago',
      );
    }

    return {
      type: 'ORDER' as const,
      order,
    };
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

      await this.delay(2000);
    }

    if (
      input.method === PaymentMethod.CASH &&
      input.amountReceived === undefined
    ) {
      throw new BadRequestException(
        'Debes indicar el efectivo recibido',
      );
    }

    // Procesamiento transaccional.
    const result = await this.db.$transaction(async (tx) => {
      const target = await this.getPaymentTarget(
        tx,
        input,
        branchId,
        user,
      );

      // Obtener productos de la cuenta o pedido.
      const items =
        target.type === 'ACCOUNT'
          ? target.account.orders.flatMap((order) =>
              order.items.map((item) => ({
                productName: item.dish.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice.toNumber(),
                subtotal: item.subtotal.toNumber(),
              })),
            )
          : target.order.items.map((item) => ({
              productName: item.dish.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice.toNumber(),
              subtotal: item.subtotal.toNumber(),
            }));

      if (items.length === 0) {
        throw new ConflictException(
          'No existen productos para cobrar',
        );
      }

      // Calcular importes desde la base de datos.
      const subtotal = items.reduce(
        (sum, item) => sum.plus(item.subtotal),
        new Prisma.Decimal(0),
      );

      const amounts = this.calculateAmounts(subtotal);

      let paymentStatus:  PaymentStatus = PaymentStatus.APPROVED;
      let amountReceived: Prisma.Decimal | null = null;
      let change = new Prisma.Decimal(0);

      // Validar efectivo.
      if (input.method === PaymentMethod.CASH) {
        amountReceived = new Prisma.Decimal(
          input.amountReceived!,
        );

        if (amountReceived.lt(amounts.total)) {
          throw new BadRequestException(
            'El efectivo recibido es insuficiente',
          );
        }

        change = amountReceived.minus(amounts.total);
      }

      // Simulación de tarjeta.
      if (
        input.method === PaymentMethod.CARD &&
        input.cardLast4 === '0002'
      ) {
        paymentStatus = PaymentStatus.REJECTED;
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
        return {
          rejected: true as const,
          paymentId: payment.id,
        };
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
        customerId:
  target.type === 'ACCOUNT'
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
          throw new ForbiddenException(
            'No tiene permiso para consultar este pedido',
          );
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

        const items = order.items.map((item) => ({
          productName: item.dish.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toNumber(),
          subtotal: item.subtotal.toNumber(),
        }));

        const subtotal = items.reduce(
          (sum, item) => sum.plus(item.subtotal),
          new Prisma.Decimal(0),
        );

        const amounts = this.calculateAmounts(subtotal);

        const paymentStatus =
          input.cardLast4 === '0002'
            ? PaymentStatus.REJECTED
            : PaymentStatus.APPROVED;

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
          return {
            rejected: true as const,
            paymentId: payment.id,
          };
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
