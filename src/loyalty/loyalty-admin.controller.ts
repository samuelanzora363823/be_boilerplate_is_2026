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
import { CreateLoyaltyBenefitDto } from './dto/create-loyalty-benefit.dto.js';
import { UpdateLoyaltyBenefitStatusDto } from './dto/update-loyalty-benefit-status.dto.js';
import { UpdateLoyaltyBenefitDto } from './dto/update-loyalty-benefit.dto.js';
import { UpdateLoyaltyRuleDto } from './dto/update-loyalty-rule.dto.js';
import { LoyaltyAdminService } from './loyalty-admin.service.js';

// H22: administración del programa de lealtad. Solo el Gerente; las rutas de
// Cliente de H20/H21 siguen en LoyaltyController (/loyalty/...).
@Controller('loyalty/admin')
@Roles(UserRole.GERENTE)
export class LoyaltyAdminController {
  constructor(private readonly loyaltyAdminService: LoyaltyAdminService) {}

  @Get('rules')
  getRule() {
    return this.loyaltyAdminService.getRuleConfig();
  }

  @Put('rules')
  updateRule(@CurrentUser() user: User, @Body() body: UpdateLoyaltyRuleDto) {
    return this.loyaltyAdminService.updateRuleConfig(body, user.id);
  }

  @Get('rules/history')
  getRuleHistory() {
    return this.loyaltyAdminService.getRuleHistory();
  }

  @Get('benefits')
  listBenefits() {
    return this.loyaltyAdminService.listAllBenefits();
  }

  @Post('benefits')
  createBenefit(
    @CurrentUser() user: User,
    @Body() body: CreateLoyaltyBenefitDto,
  ) {
    return this.loyaltyAdminService.createBenefit(body, user.id);
  }

  @Put('benefits/:id')
  updateBenefit(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateLoyaltyBenefitDto,
  ) {
    return this.loyaltyAdminService.updateBenefit(id, body, user.id);
  }

  @Patch('benefits/:id/status')
  setBenefitStatus(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateLoyaltyBenefitStatusDto,
  ) {
    return this.loyaltyAdminService.setBenefitActive(id, body.active, user.id);
  }
}
