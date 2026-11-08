import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { NotificationSource, NotificationStatus } from '../generated/prisma/client.js';
import type { Notification, User } from '../generated/prisma/client.js';
import { ListNotificationsQueryDto } from './dto.js';

// Registros que pueden originar un aviso (tabla de eventos de la Épica 9).
export const REFERENCE_TYPES = ['Order', 'Dish', 'Reservation', 'InventoryAlert'] as const;

export interface SendNotificationInput {
  recipientIds: string[];
  title: string;
  message: string;
  sourceModule: NotificationSource;
  referenceType?: (typeof REFERENCE_TYPES)[number] | null;
  referenceId?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// H25: servicio interno único de avisos. No expone endpoint HTTP;
// lo usan los módulos de Cocina, Reservas e Inventario.
@Injectable()
export class NotificationsService {
  constructor(private readonly db: PrismaService) {}

  async send(input: SendNotificationInput): Promise<Notification[]> {
    this.validate(input);

    const recipients = await this.db.user.findMany({
      where: {
        id: { in: input.recipientIds.filter((id) => UUID.test(id)) },
        isActive: true,
      },
      select: { id: true },
    });

    if (recipients.length !== input.recipientIds.length) {
      throw new NotFoundException('Algún destinatario no existe o está inactivo');
    }

    // Todas las notificaciones de una misma llamada van en una sola transacción.
    return this.db.$transaction(
      input.recipientIds.map((recipientId) =>
        this.db.notification.create({
          data: {
            recipientId,
            title: input.title,
            message: input.message,
            sourceModule: input.sourceModule,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
          },
        }),
      ),
    );
  }

  // ==========================================
  // H26 - BANDEJA DE NOTIFICACIONES
  // Siempre se filtra por el usuario de la sesión (recipientId).
  // ==========================================

  async list(user: User, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where = {
      recipientId: user.id,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceModule ? { sourceModule: query.sourceModule } : {}),
    };

    const [rows, total] = await this.db.$transaction([
      this.db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.notification.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        message: row.message,
        sourceModule: row.sourceModule,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        status: row.status,
        createdAt: row.createdAt,
        readAt: row.readAt,
      })),
      total,
      page,
      limit,
    };
  }

  async unreadCount(user: User) {
    const count = await this.db.notification.count({
      where: { recipientId: user.id, status: NotificationStatus.NO_LEIDA },
    });
    return { count };
  }

  async read(user: User, id: string) {
    // Solo el dueño cambia su aviso y solo de No leída a Leída.
    await this.db.notification.updateMany({
      where: { id, recipientId: user.id, status: NotificationStatus.NO_LEIDA },
      data: { status: NotificationStatus.LEIDA, readAt: new Date() },
    });

    const notification = await this.db.notification.findFirst({
      where: { id, recipientId: user.id },
      select: { id: true, status: true, readAt: true },
    });

    // Un aviso de otro usuario responde igual que uno inexistente.
    if (!notification) {
      throw new NotFoundException('El aviso no existe');
    }

    return notification;
  }

  async readAll(user: User) {
    const { count } = await this.db.notification.updateMany({
      where: { recipientId: user.id, status: NotificationStatus.NO_LEIDA },
      data: { status: NotificationStatus.LEIDA, readAt: new Date() },
    });
    return { updated: count };
  }

  private validate(input: SendNotificationInput) {
    const { recipientIds, title, message, sourceModule, referenceType, referenceId } = input;

    if (!Array.isArray(recipientIds) || recipientIds.length < 1 || recipientIds.length > 50) {
      throw new BadRequestException('La lista de destinatarios debe tener de 1 a 50 elementos');
    }

    if (new Set(recipientIds).size !== recipientIds.length) {
      throw new BadRequestException('La lista de destinatarios no puede tener repetidos');
    }

    if (typeof title !== 'string' || !title.trim() || title.length > 100) {
      throw new BadRequestException('El título debe tener de 1 a 100 caracteres');
    }

    if (typeof message !== 'string' || !message.trim() || message.length > 500) {
      throw new BadRequestException('El mensaje debe tener de 1 a 500 caracteres');
    }

    if (!Object.values(NotificationSource).includes(sourceModule)) {
      throw new BadRequestException('El módulo de origen no es válido');
    }

    if (referenceType != null && !REFERENCE_TYPES.includes(referenceType)) {
      throw new BadRequestException('El tipo de referencia no es válido');
    }

    if (referenceType != null && !referenceId) {
      throw new BadRequestException('referenceId es obligatorio cuando se envía referenceType');
    }
  }
}
