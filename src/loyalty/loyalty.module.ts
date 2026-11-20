import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';
import { LoyaltyRepository } from './loyalty.repository.js';

@Module({
  controllers: [LoyaltyController],
  providers: [LoyaltyService, LoyaltyRepository],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
