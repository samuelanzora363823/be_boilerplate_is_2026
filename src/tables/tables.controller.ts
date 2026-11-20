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

import { TablesService } from './tables.service.js';

@Controller('branches/:branchId/tables')
@Roles(UserRole.MESERO)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get('availability')
  getAvailability(
    @CurrentUser() user: User,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query('dateTime') dateTime: string,
  ) {
    return this.tablesService.getAvailability(user, branchId, dateTime);
  }
}
