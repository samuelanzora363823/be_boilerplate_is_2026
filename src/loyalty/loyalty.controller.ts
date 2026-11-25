import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole, type User } from '@PrismaClient';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreateRedemptionDto } from './dto/create-redemption.dto.js';
import { LoyaltyService } from './loyalty.service.js';

@Controller('loyalty')
@Roles(UserRole.CLIENTE)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('benefits')
  getBenefits() {
    return this.loyaltyService.getBenefits();
  }

  @Post('redemptions')
  requestRedemption(
    @CurrentUser() user: User,
    @Body() body: CreateRedemptionDto,
  ) {
    return this.loyaltyService.requestRedemption(user.id, body);
  }

  @Get('points/balance')
  getBalance(@CurrentUser() user: User) {
    return this.loyaltyService.getBalance(user.id);
  }

  @Get('points/movements')
  getMovements(@CurrentUser() user: User) {
    return this.loyaltyService.getMovements(user.id);
  }
}
