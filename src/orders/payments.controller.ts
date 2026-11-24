import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Post,
} from '@nestjs/common';

import { UserRole } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

import { CreatePaymentDto } from './payments.dto.js';
import { PaymentsService } from './payments.service.js';

@Controller()
@Roles(UserRole.MESERO)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // H18: registrar un pago.
  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  registerPayment(
    @CurrentUser() user: User,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.payments.registerPayment(user, dto);
  }

  // H18: consultar historial paginado de comprobantes.
  @Get('receipts')
  listReceipts(
    @CurrentUser() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payments.listReceipts(user, page, limit);
  }

  // H18: consultar comprobante.
  @Get('receipts/:id')
  getReceipt(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payments.getReceipt(user, id);
  }
}
