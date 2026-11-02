
import { Module } from '@nestjs/common';
import { PrismaModule } from '@Prisma';
import { MenuController } from './menu.controller.js';
import { MenuService } from './menu.service.js';
import { DishRepository } from './repositories/dish.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [MenuController],
  providers: [MenuService, DishRepository],
})
export class MenuModule {}
