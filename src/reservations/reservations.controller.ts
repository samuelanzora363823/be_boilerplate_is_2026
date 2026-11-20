import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { UserRole } from '../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../generated/prisma/client.js';

import { ReservationsService } from './reservations.service.js';
import {
  CreateReservationDto,
  UpdateReservationDto,
} from './dto.js';

@Controller()
@Roles(UserRole.CLIENTE)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  // H10 - Crear reserva
  @Post('reservations')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: User, @Body() dto: CreateReservationDto) {
    return this.reservations.create(user, dto);
  }

  // H12 - Consultar reservas del cliente autenticado
  @Get('reservations/me')
  findMyReservations(@CurrentUser() user: User) {
    return this.reservations.findMyReservations(user);
  }

  // H12 - Modificar una reserva
  @Patch('reservations/:id')
  @HttpCode(HttpStatus.OK)
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.reservations.update(user, id, dto);
  }

  // H12 - Cancelar una reserva
  @Patch('reservations/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reservations.cancel(user, id);
  }
}
