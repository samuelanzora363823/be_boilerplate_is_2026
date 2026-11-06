import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { CreateTakeawayOrderDto } from './dto.js';
@Injectable()
export class TakeawayService {
  constructor(private readonly db: PrismaService) {}
  async mine(user: User) {
    return this.db.order.findMany({ where: { customerId: user.id, accountId: null }, orderBy: { createdAt: 'desc' }, select: { id: true, orderNumber: true, status: true, total: true, createdAt: true } });
  }
  async create(user: User, input: CreateTakeawayOrderDto) {
    const ids = input.items.map(item => item.dishId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('No repitas platillos; suma sus cantidades');
    // Hora del servidor interpretada en la zona horaria de El Salvador.
    const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/El_Salvador', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    return this.db.$transaction(async tx => {
      const branch = await tx.branch.findUnique({ where: { id: input.branchId } });
      if (!branch || !branch.isActive) throw new NotFoundException('Sucursal no disponible');
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(branch.openingTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(branch.closingTime)) throw new ConflictException('Horario de sucursal no configurado');
      const open = branch.openingTime <= branch.closingTime ? now >= branch.openingTime && now < branch.closingTime : now >= branch.openingTime || now < branch.closingTime;
      if (!open) throw new ConflictException('Fuera del horario de atención');
      if (!branch.code) throw new ConflictException('Código de sucursal no configurado');
      const dishes = await tx.dish.findMany({ where: { id: { in: ids }, status: 'ACTIVE', branchDishes: { some: { branchId: branch.id, stockStatus: 'ACTIVE' } } } });
      if (dishes.length !== ids.length) throw new ConflictException('Platillo no disponible en esta sucursal');
      const byId = new Map(dishes.map(d => [d.id, d]));
      const total = input.items.reduce((sum, item) => sum.plus(byId.get(item.dishId)!.price.mul(item.quantity)), new Prisma.Decimal(0));
      // El incremento es atómico y evita duplicar correlativos en solicitudes simultáneas.
      const updated = await tx.branch.update({ where: { id: branch.id }, data: { takeawayCounter: { increment: 1 } }, select: { takeawayCounter: true } });
      const orderNumber = `${branch.code}-${updated.takeawayCounter}`;
      const order = await tx.order.create({ data: { branchId: branch.id, customerId: user.id, orderNumber, status: 'PENDING_PAYMENT', total, items: { create: input.items.map(item => ({ dishId: item.dishId, quantity: item.quantity, notes: item.notes?.trim() || null, unitPrice: byId.get(item.dishId)!.price, subtotal: byId.get(item.dishId)!.price.mul(item.quantity) })) } }, select: { id: true, orderNumber: true, status: true } });
      // No emitir new_order: cocina solo recibe pedidos confirmados por el módulo de pagos.
      return { orderId: order.id, orderNumber: order.orderNumber, status: 'Pendiente Pago' };
    });
  }
}
