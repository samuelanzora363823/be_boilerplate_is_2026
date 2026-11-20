import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

import { NotificationsModule } from '../notifications/notifications.module.js';

import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { TakeawayController } from './takeaway.controller.js';
import { TakeawayService } from './takeaway.service.js';
import { KitchenGateway } from './kitchen.gateway.js';
import { KitchenController } from './kitchen.controller.js';
import { KitchenReadyController } from './kitchen-ready.controller.js';
import { KitchenDeliveryController } from './kitchen-delivery.controller.js';
import { KitchenOutOfStockController } from './kitchen-out-of-stock.controller.js';
import { KitchenService } from './kitchen.service.js';
import { LoyaltyModule } from '../loyalty/loyalty.module.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
    NotificationsModule,
    LoyaltyModule,
  ],
  controllers: [
    OrdersController,
    TakeawayController,
    KitchenController,
    KitchenReadyController,
    KitchenDeliveryController,
    KitchenOutOfStockController,
    PaymentsController,
  ],
  providers: [
    OrdersService,
    TakeawayService,
    KitchenGateway,
    KitchenService,
    PaymentsService,
  ],
})
export class OrdersModule {}
