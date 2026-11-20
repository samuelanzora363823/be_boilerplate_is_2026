import { Controller, Get, Patch, Param, ParseUUIDPipe } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../generated/prisma/client.js';
import { KitchenService } from './kitchen.service.js';

@Controller('kitchen')
@Roles(UserRole.COCINA)
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('orders')
  orders(@CurrentUser() user: User) {
    return this.kitchen.orders(user);
  }

  @Patch('orders/:id/take')
  take(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.kitchen.take(user, id);
  }
}
