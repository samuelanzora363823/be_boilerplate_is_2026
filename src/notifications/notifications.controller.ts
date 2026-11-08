import { Controller, Get, Param, Patch, Query, UseFilters } from '@nestjs/common';
import type { User } from '../generated/prisma/client.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ListNotificationsQueryDto } from './dto.js';
import { NotificationsErrorFilter } from './notifications-error.filter.js';
import { NotificationsService } from './notifications.service.js';

// H26: bandeja de cualquier rol autenticado. Solo consulta y marca como leídas;
// crear avisos sigue siendo exclusivo del servicio interno (H25).
@Controller('notifications')
@UseFilters(NotificationsErrorFilter)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get() list(@CurrentUser() user: User, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user, query);
  }

  @Get('unread-count') unreadCount(@CurrentUser() user: User) {
    return this.notifications.unreadCount(user);
  }

  @Patch('read-all') readAll(@CurrentUser() user: User) {
    return this.notifications.readAll(user);
  }

  @Patch(':id/read') read(@CurrentUser() user: User, @Param('id') id: string) {
    return this.notifications.read(user, id);
  }
}
