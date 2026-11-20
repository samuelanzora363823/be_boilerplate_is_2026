import { Controller, Get } from '@nestjs/common';
import { UserRole, type User } from '@PrismaClient';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { LoyaltyService } from './loyalty.service.js';

@Controller('loyalty/points')
@Roles(UserRole.CLIENTE)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('balance')
  getBalance(@CurrentUser() user: User) {
    return this.loyaltyService.getBalance(user.id);
  }

  @Get('movements')
  getMovements(@CurrentUser() user: User) {
    return this.loyaltyService.getMovements(user.id);
  }
}
