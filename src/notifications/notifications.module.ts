import { Module } from '@nestjs/common';
import { PrismaModule } from '@Prisma';
import { NotificationsService } from './notifications.service.js';

// H25: sin controlador, para que nadie cree avisos desde fuera del backend.
@Module({
  imports: [PrismaModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
