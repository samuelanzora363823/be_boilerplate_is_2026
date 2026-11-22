import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseFilters } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateMovementDto, ListInventoryQueryDto } from './dto.js';
import { InventoryErrorFilter } from './inventory-error.filter.js';
import { InventoryService } from './inventory.service.js';

@ApiTags('inventario')
@ApiBearerAuth()
@Controller('inventory')
@Roles(UserRole.GERENTE)
@UseFilters(InventoryErrorFilter)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @ApiOperation({ summary: 'H15: existencias de la sucursal del gerente' })
  @Get() list(@CurrentUser() user: User, @Query() query: ListInventoryQueryDto) {
    return this.inventory.list(user, query);
  }

  @Get('alerts')
  listAlerts(@CurrentUser() user: User) {
    return this.inventory.listAlerts(user);
  }

  @Patch('alerts/:id/status')
  attendAlert(@CurrentUser() user: User, @Param('id') id: string, @Body() body: { status: string }) {
    return this.inventory.attendAlert(user, id, body?.status);
  }

  @ApiOperation({ summary: 'H14: registra una entrada o salida de un insumo' })
  @Post('movements') @HttpCode(HttpStatus.CREATED)
  createMovement(@CurrentUser() user: User, @Body() dto: CreateMovementDto) {
    return this.inventory.createMovement(user, dto);
  }
}
