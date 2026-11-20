import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';
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
@Controller()
@Roles(UserRole.GERENTE)
@UseFilters(ReportsErrorFilter)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('branches')
  branches() {
    return this.reports.branches();
  }

  @Get('reports/sales')
  sales(@Query() query: SalesQueryDto) {
    return this.reports.sales(query);
  }

  @Get('reports/top-dishes')
  topDishes(@Query() query: TopDishesQueryDto) {
    return this.reports.topDishes(query);
  }

  @Get('reports/branch-comparison')
  branchComparison(@Query() query: BranchComparisonQueryDto) {
    return this.reports.branchComparison(query);
  }

  @Get('reports/peak-hours')
  peakHours(@Query() query: PeakHoursQueryDto) {
    return this.reports.peakHours(query);
  }
}
