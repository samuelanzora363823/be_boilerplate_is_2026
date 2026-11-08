import { Controller, Get, Query, UseFilters } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PeakHoursQueryDto } from './dto.js';
import { ReportsErrorFilter } from './reports-error.filter.js';
import { ReportsService } from './reports.service.js';

// Épica 10: solo el Gerente general consulta los reportes.
@Controller()
@Roles(UserRole.GERENTE_GENERAL)
@UseFilters(ReportsErrorFilter)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('branches')
  branches() {
    return this.reports.branches();
  }

  @Get('reports/peak-hours')
  peakHours(@Query() query: PeakHoursQueryDto) {
    return this.reports.peakHours(query);
  }
}
