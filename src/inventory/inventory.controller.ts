import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseFilters } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CreateMovementDto, ListInventoryQueryDto } from './dto.js';
import { InventoryErrorFilter } from './inventory-error.filter.js';
import { InventoryService } from './inventory.service.js';

@Controller('inventory')
@Roles(UserRole.GERENTE)
@UseFilters(InventoryErrorFilter)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get() list(@CurrentUser() user: User, @Query() query: ListInventoryQueryDto) {
    return this.inventory.list(user, query.limit ?? 100);
  }

  @Post('movements') @HttpCode(HttpStatus.CREATED)
  createMovement(@CurrentUser() user: User, @Body() dto: CreateMovementDto) {
    return this.inventory.createMovement(user, dto);
  }
}
