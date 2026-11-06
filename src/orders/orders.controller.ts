import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../generated/prisma/client.js';
import { OpenAccountDto, CreateTableOrderDto } from './dto.js';
import { OrdersService } from './orders.service.js';
@Controller()
@Roles(UserRole.MESERO)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get('tables/my-branch') tables(@CurrentUser() user: User) { return this.orders.tables(user); }
  @Get('orders/table/menu') menu(@CurrentUser() user: User) { return this.orders.menu(user); }
  @Post('accounts') @HttpCode(HttpStatus.CREATED) open(@CurrentUser() user: User, @Body() dto: OpenAccountDto) { return this.orders.open(user, dto); }
  @Post('orders/table') @HttpCode(HttpStatus.CREATED) order(@CurrentUser() user: User, @Body() dto: CreateTableOrderDto) { return this.orders.order(user, dto); }
}
