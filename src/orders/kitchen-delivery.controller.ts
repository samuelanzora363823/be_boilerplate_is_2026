
import {
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

@Controller()
@Roles(UserRole.MESERO)
export class KitchenDeliveryController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('orders/ready-for-delivery')
  readyForDelivery(@CurrentUser() user: User) {
    return this.kitchen.readyForDelivery(user);
  }

  @Patch('kitchen/orders/:id/delivery')
  markDelivered(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) orderId: string,
  ) {
    return this.kitchen.markDelivered(user, orderId);
  }
}
