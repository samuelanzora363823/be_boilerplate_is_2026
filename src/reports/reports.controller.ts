import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client.js';
import type { User } from '../generated/prisma/client.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  BranchComparisonQueryDto,
  PeakHoursQueryDto,
  SalesQueryDto,
  TopDishesQueryDto,
} from './dto.js';
import { ReportsErrorFilter } from './reports-error.filter.js';
import { ReportsService } from './reports.service.js';

// Épica 10: los reportes los consulta el Gerente (decisión del equipo:
// no se usa un rol Gerente general aparte).
@ApiTags('reportes')
@ApiBearerAuth()
@Controller()
@Roles(UserRole.GERENTE)
@UseFilters(ReportsErrorFilter)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('branches')
  @ApiOperation({ summary: 'Lista las sucursales para los filtros de los reportes (H27 a H29)' })
  branches() {
    return this.reports.branches();
  }

  @Get('branches/assigned-to-me')
  assignedBranches(@CurrentUser() user: User) {
    return this.reports.assignedBranches(user.id);
  }

  @Get('reports/sales')
  @ApiOperation({ summary: 'H27: ventas totales por sucursal y período' })
  sales(@Query() query: SalesQueryDto) {
    return this.reports.sales(query);
  }

  @Get('reports/top-dishes')
  @ApiOperation({ summary: 'H28: 10 platillos más vendidos del período' })
  topDishes(@Query() query: TopDishesQueryDto) {
    return this.reports.topDishes(query);
  }

  @Get('reports/branch-comparison')
  @ApiOperation({ summary: 'H30: comparación de desempeño entre sucursales' })
  branchComparison(@Query() query: BranchComparisonQueryDto) {
    return this.reports.branchComparison(query);
  }

  @Get('reports/peak-hours')
  @ApiOperation({ summary: 'H29: pedidos por hora y horas pico de una sucursal' })
  peakHours(@Query() query: PeakHoursQueryDto) {
    return this.reports.peakHours(query);
  }
}
