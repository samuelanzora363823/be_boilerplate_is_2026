import { Controller, Get, Param, Patch, Query, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '../generated/prisma/client.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ListNotificationsQueryDto } from './dto.js';
import { NotificationsErrorFilter } from './notifications-error.filter.js';
import { NotificationsService } from './notifications.service.js';

// H26: bandeja de cualquier rol autenticado. Solo consulta y marca como leídas;
// crear avisos sigue siendo exclusivo del servicio interno (H25).
@ApiTags('notificaciones')
@ApiBearerAuth()
@Controller('notifications')
@UseFilters(NotificationsErrorFilter)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @ApiOperation({ summary: 'H26: avisos del usuario de la sesión, del más reciente al más antiguo' })
  @Get() list(@CurrentUser() user: User, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(user, query);
  }

  @ApiOperation({ summary: 'H26: cantidad de avisos No leída' })
  @Get('unread-count') unreadCount(@CurrentUser() user: User) {
    return this.notifications.unreadCount(user);
  }

  @ApiOperation({ summary: 'H26: marca como leídos todos los avisos No leída' })
  @Patch('read-all') readAll(@CurrentUser() user: User) {
    return this.notifications.readAll(user);
  }

  @ApiOperation({ summary: 'H26: marca un aviso propio como leído' })
  @Patch(':id/read') read(@CurrentUser() user: User, @Param('id') id: string) {
    return this.notifications.read(user, id);
  }
}
