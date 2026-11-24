import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../prisma/services/prisma.service.js';
import { KitchenGateway } from './kitchen.gateway.js';
import {
  CreateTableOrderDto,
  OpenAccountDto,
  UpdateTableOrderDto,
} from './dto.js';
import type { User } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    private readonly db: PrismaService,
    private readonly kitchen: KitchenGateway,
    private readonly loyalty: LoyaltyService,
  ) {}

  async onModuleInit() {
    await this.kitchen.start();
  }

  private async branch(user: User) {
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

  /**
   * Serializes table-order changes with H21 reservations. Lock order is
   * LoyaltyAccount -> Account -> Order -> Redemption.
   */
  private async lockTableOrderForMutation(
    tx: Prisma.TransactionClient,
    orderId: string,
  ) {
    const initial = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, accountId: true },
    });
    if (!initial) throw new NotFoundException('Pedido inexistente');
    let preflightCustomerId: string | null | undefined;

    if (initial.accountId) {
      const owner = await tx.account.findUnique({
        where: { id: initial.accountId },
        select: { customerId: true },
      });
      preflightCustomerId = owner?.customerId;
      if (owner?.customerId) {
        await this.loyalty.lockLoyaltyAccountForPayment(tx, {
          userId: owner.customerId,
        });
      }
      await tx.$queryRaw`
        SELECT "id" FROM "accounts"
        WHERE "id" = ${initial.accountId}::uuid
        FOR UPDATE
      `;
    }

    await tx.$queryRaw`
      SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE
    `;

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, account: { include: { table: true } } },
    });
    if (!order) throw new NotFoundException('Pedido inexistente');
    if (order.accountId !== initial.accountId) {
      throw new ConflictException('La cuenta del pedido cambió durante la operación');
    }
    if (initial.accountId && order.account?.customerId !== preflightCustomerId) {
      throw new ConflictException('El cliente de la cuenta cambió durante la operación');
    }

    return order;
  }

  private async assertNoReservedRedemption(
    tx: Prisma.TransactionClient,
    accountId: string,
  ) {
    const reservedRedemption = await tx.loyaltyRedemption.findFirst({
      where: { accountId, status: 'RESERVED' },
      select: { id: true, expiresAt: true },
    });
    if (reservedRedemption) {
      if (reservedRedemption.expiresAt <= new Date()) {
        await this.loyalty.releaseExpiredRedemptionInTransaction(
          tx,
          reservedRedemption.id,
          new Date(),
        );
        const stillReserved = await tx.loyaltyRedemption.findFirst({
          where: { accountId, status: 'RESERVED' },
          select: { id: true },
        });
        if (!stillReserved) return;
      }
      throw new ConflictException(
        'No se puede modificar una compra con un canje de puntos reservado',
      );
    }
  }

  async myBranch(user: User) {
    const branchId = await this.branch(user);
    const branch = await this.db.branch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
        name: true,
        isActive: true,
        openingTime: true,
        closingTime: true,
      },
    });

    if (!branch || !branch.isActive) {
      throw new NotFoundException('La sucursal asignada no está disponible');
    }

    return {
      id: branch.id,
      name: branch.name,
      openingTime: branch.openingTime,
      closingTime: branch.closingTime,
    };
  }

  async tables(user: User) {
    const branchId = await this.branch(user);

    return this.db.restaurantTable.findMany({
      where: { branchId },
      orderBy: { number: 'asc' },
      select: {
        id: true,
        number: true,
        capacity: true,
        status: true,
        accounts: {
          where: { status: 'OPEN' },
          select: { id: true },
        },
      },
    });
  }

  async menu(user: User) {
    const branchId = await this.branch(user);

    return this.db.dish.findMany({
      where: {
        status: 'ACTIVE',
        branchDishes: {
          some: {
            branchId,
            stockStatus: 'ACTIVE',
          },
        },
      },
      select: {
        id: true,
        name: true,
        price: true,
        imageUrl: true,
        category: {
          select: { name: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async open(user: User, input: OpenAccountDto) {
    const branchId = await this.branch(user);

    let customerId: string | undefined;

    if (input.customerEmail) {
      const customer = await this.db.user.findUnique({
        where: {
          email: input.customerEmail.trim().toLowerCase(),
        },
      });

      if (!customer || customer.role !== 'CLIENTE') {
        throw new NotFoundException('Cliente no encontrado');
      }

      customerId = customer.id;
    }

    // Se serializa con H10: crear una reserva también bloquea la sucursal.
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM branches WHERE id = ${branchId}::uuid FOR UPDATE
        `;

        const table = await tx.restaurantTable.findUnique({
          where: { id: input.tableId },
        });

        if (!table || table.branchId !== branchId) {
          throw new NotFoundException('Mesa no existe en tu sucursal');
        }

        const current = await tx.account.findFirst({
          where: {
            tableId: table.id,
            status: 'OPEN',
          },
        });

        if (current) {
          if (
            customerId &&
            current.customerId &&
            current.customerId !== customerId
          ) {
            throw new ConflictException(
              'La cuenta ya está asociada a otro cliente',
            );
          }

          return current;
        }

        if (table.status !== 'FREE') {
          throw new ConflictException('Mesa no disponible');
        }

        // La apertura de cuenta representa la ocupación en este momento.
        // Se rechaza si una reserva confirmada incluye el instante actual.
        const now = new Date();
        const activeReservation = await tx.reservation.findFirst({
          where: {
            tableId: table.id,
            status: 'CONFIRMED',
            dateTime: { lte: now },
          },
          select: {
            dateTime: true,
            durationMinutes: true,
          },
          orderBy: { dateTime: 'desc' },
        });

        if (activeReservation) {
          const reservationEnd = new Date(
            activeReservation.dateTime.getTime() +
              activeReservation.durationMinutes * 60_000,
          );
          if (reservationEnd > now) {
            throw new ConflictException(
              'La mesa tiene una reserva confirmada para este horario',
            );
          }
        }

        const account = await tx.account.create({
          data: {
            branchId,
            tableId: table.id,
            waiterId: user.id,
            customerId,
          },
        });

        await tx.restaurantTable.update({
          where: { id: table.id },
          data: { status: 'OCCUPIED' },
        });

        return account;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('La mesa ya tiene una cuenta abierta');
      }

      throw e;
    }
  }

  async order(user: User, input: CreateTableOrderDto) {
    const branchId = await this.branch(user);

    if (!input.items?.length) {
      throw new BadRequestException('El pedido no puede estar vacío');
    }

    const ids = input.items.map((i) => i.dishId);

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'No repitas platillos; suma sus cantidades',
      );
    }

    const result = await this.db.$transaction(async (tx) => {
      const preflightAccount = await tx.account.findUnique({
        where: { id: input.accountId },
        select: { customerId: true },
      });
      if (preflightAccount?.customerId) {
        await this.loyalty.lockLoyaltyAccountForPayment(tx, {
          userId: preflightAccount.customerId,
        });
      }
      // Match H21's account lock so a new order cannot change a reserved subtotal.
      await tx.$queryRaw`
        SELECT "id" FROM "accounts"
        WHERE "id" = ${input.accountId}::uuid
        FOR UPDATE
      `;
      const account = await tx.account.findUnique({
        where: { id: input.accountId },
        include: { table: true },
      });

      if (!account) {
        throw new NotFoundException('Cuenta inexistente');
      }
      if (account.customerId !== preflightAccount?.customerId) {
        throw new ConflictException('El cliente de la cuenta cambió durante la operación');
      }

      if (account.branchId !== branchId || account.waiterId !== user.id) {
        throw new ForbiddenException(
          'Cuenta fuera de tu sucursal o asignación',
        );
      }

      if (account.status !== 'OPEN' || account.table.status !== 'OCCUPIED') {
        throw new ConflictException('Cuenta no abierta');
      }

      await this.assertNoReservedRedemption(tx, account.id);

      const dishes = await tx.dish.findMany({
        where: {
          id: { in: ids },
          status: 'ACTIVE',
          branchDishes: {
            some: {
              branchId,
              stockStatus: 'ACTIVE',
            },
          },
        },
      });

      if (dishes.length !== ids.length) {
        throw new ConflictException(
          'Uno o más platillos están agotados, deshabilitados o no existen en esta sucursal',
        );
      }

      const byId = new Map(dishes.map((dish) => [dish.id, dish]));

      const total = input.items.reduce(
        (sum, item) =>
          sum.plus(byId.get(item.dishId)!.price.mul(item.quantity)),
        new Prisma.Decimal(0),
      );

      const order = await tx.order.create({
        data: {
          accountId: account.id,
          branchId,
          total,
          items: {
            create: input.items.map((item) => ({
              dishId: item.dishId,
              quantity: item.quantity,
              notes: item.notes?.trim() || null,
              unitPrice: byId.get(item.dishId)!.price,
              subtotal: byId.get(item.dishId)!.price.mul(item.quantity),
            })),
          },
        },
        include: {
          items: {
            include: {
              dish: {
                select: { name: true },
              },
            },
          },
          account: {
            include: {
              table: {
                select: { number: true },
              },
            },
          },
        },
      });

      await tx.account.update({
        where: { id: account.id },
        data: {
          total: { increment: total },
        },
      });

      return order;
    });

    // H5 permite pedidos sin cuenta.
    // H4 exige una cuenta de mesa para notificar a cocina.
    if (!result.account) {
      throw new ConflictException(
        'El pedido de mesa no tiene una cuenta asociada',
      );
    }

    this.kitchen.notify(branchId, {
      id: result.id,
      tableNumber: result.account.table.number,
      status: result.status,
      createdAt: result.createdAt,
      items: result.items.map((item) => ({
        dishId: item.dishId,
        name: item.dish.name,
        quantity: item.quantity,
        notes: item.notes,
      })),
    });

    return result;
  }
  // H6: solo el mesero responsable puede consultar los pedidos de su cuenta.
  async accountOrders(user: User, accountId: string) {
    const branchId = await this.branch(user);
    const account = await this.db.account.findUnique({
      where: { id: accountId },
    });
    if (!account) throw new NotFoundException('Cuenta inexistente');
    if (account.branchId !== branchId || account.waiterId !== user.id)
      throw new ForbiddenException('No tienes acceso a esta cuenta');
    return this.db.order.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        total: true,
        createdAt: true,
        items: {
          select: {
            id: true,
            dishId: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
            notes: true,
            dish: { select: { name: true } },
          },
        },
      },
    });
  }

  async update(user: User, orderId: string, input: UpdateTableOrderDto) {
    const branchId = await this.branch(user);
    if (!input.items?.length)
      throw new BadRequestException('Debes enviar al menos un platillo');
    const ids = input.items.map((item) => item.itemId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException('No repitas ítems');
    const result = await this.db.$transaction(async (tx) => {
      const order = await this.lockTableOrderForMutation(tx, orderId);
      if (
        !order.account ||
        order.branchId !== branchId ||
        order.account.waiterId !== user.id
      )
        throw new ForbiddenException('Pedido fuera de tu asignación');
      if (
        order.status !== 'RECEIVED' ||
        order.items.some((item) => item.status !== 'RECEIVED')
      )
        throw new ConflictException('El pedido ya no está Recibido');
      if (order.account.status !== 'OPEN')
        throw new ConflictException('La cuenta ya no está abierta');
      await this.assertNoReservedRedemption(tx, order.account.id);
      if (
        ids.length !== order.items.length ||
        order.items.some((item) => !ids.includes(item.id))
      )
        throw new BadRequestException(
          'Debes incluir todos los ítems existentes',
        );
      const quantities = new Map(
        input.items.map((item) => [item.itemId, item.quantity]),
      );
      const newTotal = order.items.reduce(
        (sum, item) => sum.plus(item.unitPrice.mul(quantities.get(item.id)!)),
        new Prisma.Decimal(0),
      );
      for (const item of order.items) {
        const quantity = quantities.get(item.id)!;
        await tx.orderItem.update({
          where: { id: item.id },
          data: { quantity, subtotal: item.unitPrice.mul(quantity) },
        });
      }
      await tx.order.update({
        where: { id: orderId },
        data: { total: newTotal },
      });
      // La cuenta agrega pedidos; recalculamos usando la diferencia de este pedido.
      await tx.account.update({
        where: { id: order.account.id },
        data: { total: { increment: newTotal.minus(order.total) } },
      });
      return {
        id: order.id,
        branchId,
        tableNumber: order.account.table.number,
        status: order.status,
        total: newTotal,
        items: order.items.map((item) => ({
          id: item.id,
          dishId: item.dishId,
          quantity: quantities.get(item.id)!,
          subtotal: item.unitPrice.mul(quantities.get(item.id)!),
        })),
      };
    });
    this.kitchen.orderUpdated(branchId, result);
    return result;
  }

  async cancel(user: User, orderId: string) {
    const branchId = await this.branch(user);
    const result = await this.db.$transaction(async (tx) => {
      const order = await this.lockTableOrderForMutation(tx, orderId);
      if (
        !order.account ||
        order.branchId !== branchId ||
        order.account.waiterId !== user.id
      )
        throw new ForbiddenException('Pedido fuera de tu asignación');
      if (
        order.status !== 'RECEIVED' ||
        order.items.some((item) => item.status !== 'RECEIVED')
      )
        throw new ConflictException('El pedido ya no está Recibido');
      if (order.account.status !== 'OPEN')
        throw new ConflictException('La cuenta ya no está abierta');
      await this.assertNoReservedRedemption(tx, order.account.id);
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      });
      await tx.orderItem.updateMany({
        where: { orderId },
        data: { status: 'CANCELLED' },
      });
      await tx.account.update({
        where: { id: order.account.id },
        data: { total: { decrement: order.total } },
      });
      return {
        id: order.id,
        branchId,
        tableNumber: order.account.table.number,
        status: 'CANCELLED' as const,
      };
    });
    this.kitchen.orderCancelled(branchId, result);
    return result;
  }

  // H17: consultar el detalle completo de una cuenta.
  async accountDetail(user: User, accountId: string) {
    const branchId = await this.branch(user);

    const account = await this.db.account.findUnique({
      where: { id: accountId },
      include: {
        table: true,
        customer: {
          select: {
            id: true,
            email: true,
          },
        },
        receipt: {
          select: {
            id: true,
            receiptNumber: true,
          },
        },
        orders: {
          where: {
            status: { not: 'CANCELLED' },
          },
          orderBy: { createdAt: 'asc' },
          include: {
            items: {
              include: {
                dish: {
                  select: {
                    name: true,
                  },
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

    if (account.branchId !== branchId || account.waiterId !== user.id) {
      throw new ForbiddenException('No tienes acceso a esta cuenta');
    }

    const subtotal = account.orders.reduce(
      (sum, order) =>
        sum.plus(
          order.items.reduce(
            (itemSum, item) => itemSum.plus(item.subtotal),
            new Prisma.Decimal(0),
          ),
        ),
      new Prisma.Decimal(0),
    ).toDecimalPlaces(2);

    // Mantener el detalle sincronizado con el descuento reservado que aplicará
    // PaymentsService al procesar el cobro de esta misma cuenta.
    const redemption = await this.db.loyaltyRedemption.findFirst({
      where: {
        accountId: account.id,
        status: 'RESERVED',
        expiresAt: { gt: new Date() },
      },
      select: { discountAmount: true },
    });
    const discount = (redemption?.discountAmount ?? new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    if (discount.lt(0) || discount.gt(subtotal)) {
      throw new ConflictException('El descuento reservado no es compatible con el total de la cuenta.');
    }
    const taxableAmount = subtotal.minus(discount);
    const tax = taxableAmount.mul(new Prisma.Decimal('0.13')).toDecimalPlaces(2);
    const total = taxableAmount.plus(tax).toDecimalPlaces(2);

    return {
      accountId: account.id,
      status: account.status,
      branchId: account.branchId,
      tableId: account.tableId,
      tableNumber: account.table.number,
      customer: account.customer,
      receipt: account.receipt,
      orders: account.orders.map((order) => ({
        orderId: order.id,
        status: order.status,
        items: order.items.map((item) => ({
          orderId: order.id,
          productId: item.dishId,
          productName: item.dish.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
          status: item.status,
        })),
      })),
      subtotal: subtotal.toDecimalPlaces(2),
      discount,
      tax,
      total,
    };
  }

  // H17: buscar un cliente mediante su correo electrónico.
  async customerLookup(user: User, email: string) {
    await this.branch(user);

    if (!email || !email.trim()) {
      throw new BadRequestException('Debes proporcionar un correo electrónico');
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new BadRequestException('El correo electrónico no es válido');
    }

    const customer = await this.db.user.findUnique({
      where: {
        email: normalizedEmail,
      },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    if (!customer || customer.role !== 'CLIENTE' || !customer.isActive) {
      throw new NotFoundException('Cliente no encontrado');
    }

    return {
      customerId: customer.id,
      email: customer.email,
    };
  }

  // H17: validar si una cuenta puede iniciar el proceso de cobro.
  async closeAccount(user: User, accountId: string) {
    const branchId = await this.branch(user);

    const account = await this.db.account.findUnique({
      where: { id: accountId },
      include: {
        orders: {
          select: {
            id: true,
            status: true,
            items: { select: { subtotal: true } },
          },
        },
      },
    });

    if (!account) {
      throw new NotFoundException('Cuenta inexistente');
    }

    if (account.branchId !== branchId || account.waiterId !== user.id) {
      throw new ForbiddenException('No tienes acceso a esta cuenta');
    }

    if (account.status !== 'OPEN') {
      throw new ConflictException('La cuenta no está abierta');
    }

    if (account.orders.length === 0) {
      throw new ConflictException(
        'No se puede cobrar una cuenta sin pedidos asociados',
      );
    }

    const activeOrders = account.orders.filter(
      (order) => order.status !== 'CANCELLED',
    );

    if (activeOrders.length === 0) {
      throw new ConflictException(
        'La cuenta no tiene pedidos activos para cobrar',
      );
    }

    const pendingOrders = activeOrders.filter(
      (order) => order.status !== 'DELIVERED',
    );

    if (pendingOrders.length > 0) {
      throw new ConflictException(
        'No se puede cerrar la cuenta porque existen pedidos pendientes de entrega',
      );
    }

    const subtotal = activeOrders.reduce(
      (sum, order) => sum.plus(
        order.items.reduce(
          (itemSum, item) => itemSum.plus(item.subtotal),
          new Prisma.Decimal(0),
        ),
      ),
      new Prisma.Decimal(0),
    ).toDecimalPlaces(2);

    const redemption = await this.db.loyaltyRedemption.findFirst({
      where: {
        accountId: account.id,
        status: 'RESERVED',
        expiresAt: { gt: new Date() },
      },
      select: { discountAmount: true },
    });
    const discount = (redemption?.discountAmount ?? new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    if (discount.lt(0) || discount.gt(subtotal)) {
      throw new ConflictException('El descuento reservado no es compatible con el total de la cuenta.');
    }
    const taxableAmount = subtotal.minus(discount);
    const tax = taxableAmount.mul(new Prisma.Decimal('0.13')).toDecimalPlaces(2);
    const total = taxableAmount.plus(tax).toDecimalPlaces(2);

    return {
      accountId: account.id,
      status: account.status,
      subtotal,
      discount,
      tax,
      total,
      canPay: true,
    };
  }
}
