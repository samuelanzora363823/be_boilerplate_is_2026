import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { OccupancyController } from './occupancy.controller.js';
import { OccupancyService } from './occupancy.service.js';

// Reportes H27-H29 y consulta de ocupación H13.
@Module({
  controllers: [
    ReportsController,
    OccupancyController,
  ],
  providers: [
    ReportsService,
    OccupancyService,
  ],
})
export class ReportsModule {}
