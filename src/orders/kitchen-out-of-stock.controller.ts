import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { UserRole } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { OutOfStockDto } from './out-of-stock.dto.js';
import { KitchenService } from './kitchen.service.js';

@Controller('kitchen/out-of-stock')
@Roles(UserRole.COCINA)
export class KitchenOutOfStockController {
  constructor(private readonly kitchen: KitchenService) {}

  @Post(':dishId')
  markOutOfStock(
    @CurrentUser() user: User,
    @Param('dishId', ParseUUIDPipe) dishId: string,
    @Body() body: OutOfStockDto,
  ) {
    return this.kitchen.markOutOfStock(user, dishId, body.branchId);
  }
}
