
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { TakeawayController } from './takeaway.controller.js';
import { TakeawayService } from './takeaway.service.js';
import { KitchenGateway } from './kitchen.gateway.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [OrdersController, TakeawayController],
  providers: [OrdersService, TakeawayService, KitchenGateway],
})
export class OrdersModule {}
