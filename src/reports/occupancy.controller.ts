import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';

import { UserRole } from '../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from '../generated/prisma/client.js';

import { OccupancyQueryDto } from './occupancy.dto.js';
import { OccupancyService } from './occupancy.service.js';

@Controller('branches/:branchId/occupancy')
@Roles(UserRole.GERENTE)
export class OccupancyController {
  constructor(private readonly occupancyService: OccupancyService) {}

  @Get()
  getOccupancy(
    @CurrentUser() user: User,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: OccupancyQueryDto,
  ) {
    return this.occupancyService.getOccupancy(
      user,
      branchId,
      query.date,
    );
  }
}

