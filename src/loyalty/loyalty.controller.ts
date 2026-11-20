import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';

import { UserRole, type User } from '@PrismaClient';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

import { LoyaltyService } from './loyalty.service.js';

import { UpdateLoyaltyRuleDto } from './dto/update-loyalty-rule.dto.js';
import { CreateLoyaltyBenefitDto } from './dto/create-loyalty-benefit.dto.js';
import { UpdateLoyaltyBenefitStatusDto } from './dto/update-loyalty-benefit-status.dto.js';

@Controller('loyalty')
export class LoyaltyController {
  constructor(
    private readonly loyaltyService: LoyaltyService,
  ) {}

  // ==========================================
  // CONSULTA DE PUNTOS (H20)
  // ==========================================

  @Get('points/balance')
  @Roles(UserRole.CLIENTE)
  getBalance(@CurrentUser() user: User) {
    return this.loyaltyService.getBalance(user.id);
  }

  @Get('points/movements')
  @Roles(UserRole.CLIENTE)
  getMovements(@CurrentUser() user: User) {
    return this.loyaltyService.getMovements(user.id);
  }

  // ==========================================
  // CONFIGURACIÓN DE REGLAS (H22)
  // ==========================================

  @Get('rules')
  @Roles(UserRole.GERENTE_GENERAL)
  getRule() {
    return this.loyaltyService.getRule();
  }

  @Put('rules')
  @Roles(UserRole.GERENTE_GENERAL)
  updateRule(
    @Body() dto: UpdateLoyaltyRuleDto,
    @CurrentUser() user: User,
  ) {
    return this.loyaltyService.updateRule(
      dto,
      user.id,
    );
  }

  // ==========================================
  // ADMINISTRACIÓN DE BENEFICIOS (H22)
  // ==========================================

  // Consultar todos los beneficios.
  @Get('benefits')
  @Roles(UserRole.GERENTE_GENERAL)
  getBenefits() {
    return this.loyaltyService.getBenefits();
  }

  // Crear un beneficio.
  @Post('benefits')
  @Roles(UserRole.GERENTE_GENERAL)
  createBenefit(
    @Body() dto: CreateLoyaltyBenefitDto,
    @CurrentUser() user: User,
  ) {
    return this.loyaltyService.createBenefit(
      dto,
      user.id,
    );
  }

  // Activar o desactivar un beneficio.
  @Patch('benefits/:id/status')
  @Roles(UserRole.GERENTE_GENERAL)
  updateBenefitStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLoyaltyBenefitStatusDto,
    @CurrentUser() user: User,
  ) {
    return this.loyaltyService.updateBenefitStatus(
      id,
      dto.isActive,
      user.id,
    );
  }
}