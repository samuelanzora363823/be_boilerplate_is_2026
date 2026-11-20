import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';

import { UserRole } from '../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../generated/prisma/client.js';
import { KitchenService } from './kitchen.service.js';

interface ReadyStatusDto {
  status: 'Listo';
}

@Controller('kitchen/orders')
@Roles(UserRole.COCINA)
export class KitchenReadyController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('in-preparation')
  getOrdersInPreparation(@CurrentUser() user: User) {
    return this.kitchen.getOrdersInPreparation(user);
  }

  @Patch(':orderId/items/:itemId/status')
  markItemReady(
    @CurrentUser() user: User,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: ReadyStatusDto,
  ) {
    return this.kitchen.markItemReady(user, orderId, itemId, body.status);
  }

  @Patch(':id/status')
  markOrderReady(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() body: ReadyStatusDto,
  ) {
    return this.kitchen.markOrderReady(user, orderId, body.status);
  }
}
