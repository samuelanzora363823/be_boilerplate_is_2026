import { Module } from '@nestjs/common';
import { PrismaModule } from '@Prisma';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({
  // NotificationsModule queda disponible para la alerta de H16.
  imports: [PrismaModule, NotificationsModule],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
