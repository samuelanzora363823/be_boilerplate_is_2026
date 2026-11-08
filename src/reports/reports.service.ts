import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/services/prisma.service.js';
import { PeakHoursQueryDto } from './dto.js';
import { armarBloques } from './peak-hours.js';
import { OFFSET_HORAS, validarPeriodo } from './period.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Sucursales para los filtros de H27 a H29, ordenadas por nombre.
  async branches() {
    const data = await this.prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return { data };
  }

  // H29: pedidos por hora de la sucursal en el período.
  async peakHours(query: PeakHoursQueryDto) {
    if (!query.branchId) {
      throw new BadRequestException({
        message: 'Seleccione una sucursal.',
        field: 'branchId',
      });
    }
    const periodo = validarPeriodo(query.from, query.to);

    const branch = UUID.test(query.branchId)
      ? await this.prisma.branch.findUnique({
          where: { id: query.branchId },
          select: { id: true, name: true, openingTime: true, closingTime: true },
        })
      : null;
    if (!branch) throw new NotFoundException('La sucursal no existe.');

    // Hora de creación convertida a UTC-6; se excluyen Cancelado y
    // Pendiente Pago (pedidos para llevar que nunca se pagaron, H5).
    const filas = await this.prisma.$queryRaw<{ hour: number; count: number }[]>(
      Prisma.sql`
        SELECT EXTRACT(HOUR FROM o.created_at - make_interval(hours => ${OFFSET_HORAS}))::int AS hour,
               COUNT(*)::int AS count
        FROM orders o
        WHERE o.branch_id = ${branch.id}::uuid
          AND o.status::text NOT IN ('CANCELLED', 'PENDING_PAYMENT')
          AND o.created_at >= ${periodo.desde}
          AND o.created_at < ${periodo.hasta}
        GROUP BY 1`,
    );

    const conteos = new Map(filas.map((f) => [f.hour, f.count]));
    const totalOrders = filas.reduce((suma, f) => suma + f.count, 0);

    return {
      branchId: branch.id,
      branchName: branch.name,
      from: periodo.from,
      to: periodo.to,
      totalOrders,
      hours: armarBloques(branch.openingTime, branch.closingTime, conteos),
    };
  }
}
