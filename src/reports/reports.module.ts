import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

// Módulo 10: reportes del gerente general (H29) y lista de sucursales
// para sus filtros (GET /branches, usado por H27 a H29).
@Module({
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
