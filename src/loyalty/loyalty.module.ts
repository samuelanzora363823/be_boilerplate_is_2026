import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';
import { LoyaltyRepository } from './loyalty.repository.js';
import { LoyaltyExpirationService } from './loyalty-expiration.service.js';

@Module({
  controllers: [LoyaltyController],
  providers: [LoyaltyService, LoyaltyRepository, LoyaltyExpirationService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
