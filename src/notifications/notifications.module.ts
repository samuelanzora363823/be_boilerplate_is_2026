import { Module } from '@nestjs/common';
import { PrismaModule } from '@Prisma';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

// H25: crear avisos solo es posible desde el servicio interno.
// H26: el controlador expone únicamente la bandeja (consultar y marcar leídas).
@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
