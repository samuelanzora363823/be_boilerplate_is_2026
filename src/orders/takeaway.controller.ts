import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { CreateTakeawayOrderDto } from './dto.js';
import { TakeawayService } from './takeaway.service.js';
@Controller('orders/takeaway')
@Roles(UserRole.CLIENTE)
export class TakeawayController {
  constructor(private readonly service: TakeawayService) {}
  @Post() @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: User, @Body() dto: CreateTakeawayOrderDto) { return this.service.create(user, dto); }
  @Get('mine') mine(@CurrentUser() user: User) { return this.service.mine(user); }
}
