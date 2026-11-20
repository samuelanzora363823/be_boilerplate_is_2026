import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';

import { UserRole } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

import { CreateTakeawayOrderDto } from './dto.js';
import { TakeawayService } from './takeaway.service.js';
import { CreateTakeawayPaymentDto } from './payments.dto.js';
import { PaymentsService } from './payments.service.js';

@Controller('orders/takeaway')
@Roles(UserRole.CLIENTE)
export class TakeawayController {
  constructor(
    private readonly service: TakeawayService,
    private readonly payments: PaymentsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: User,
    @Body() dto: CreateTakeawayOrderDto,
  ) {
    return this.service.create(user, dto);
  }

  @Get('mine')
  mine(@CurrentUser() user: User) {
    return this.service.mine(user);
  }

  // H19: consultar detalle de un pedido propio.
  @Get(':id')
  detail(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(user, id);
  }

  // H19: pagar en línea un pedido para llevar.
  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  pay(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTakeawayPaymentDto,
  ) {
    return this.payments.payTakeawayOrder(user, id, dto);
  }
}