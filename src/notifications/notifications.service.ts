import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { NotificationSource } from '../generated/prisma/client.js';
import type { Notification } from '../generated/prisma/client.js';

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
