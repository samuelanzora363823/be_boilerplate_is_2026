import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';
import { LoyaltyRepository } from './loyalty.repository.js';
import { LoyaltyExpirationService } from './loyalty-expiration.service.js';
import { LoyaltyAdminController } from './loyalty-admin.controller.js';
import { LoyaltyAdminService } from './loyalty-admin.service.js';

@Module({
  controllers: [LoyaltyController, LoyaltyAdminController],
  providers: [
    LoyaltyService,
    LoyaltyRepository,
    LoyaltyExpirationService,
    LoyaltyAdminService,
  ],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
