import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/services/prisma.service.js';
import {
  BranchComparisonQueryDto,
  PeakHoursQueryDto,
  SalesQueryDto,
  TopDishesQueryDto,
} from './dto.js';
import { armarBloques } from './peak-hours.js';
import { OFFSET_HORAS, validarPeriodo } from './period.js';

// Montos en dólares con 2 decimales (Épica 10).
const dinero = (valor: Prisma.Decimal) => valor.toDecimalPlaces(2).toNumber();

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

  // H27: ventas totales por sucursal en el período. Una venta es un
  // comprobante (solo existe cuando el pago está aprobado, H18 y H19);
  // el período se filtra por la fecha de emisión del comprobante.
  async sales(query: SalesQueryDto) {
    const periodo = validarPeriodo(query.from, query.to);

    await this.validarSucursalOpcional(query.branchId);

    const grupos = await this.prisma.receipt.groupBy({
      by: ['branchId'],
      where: {
        issuedAt: { gte: periodo.desde, lt: periodo.hasta },
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
      _sum: { subtotal: true, discount: true, tax: true, total: true },
      _count: { _all: true },
    });

    const nombres = new Map(
      (
        await this.prisma.branch.findMany({
          where: { id: { in: grupos.map((g) => g.branchId) } },
          select: { id: true, name: true },
        })
      ).map((b) => [b.id, b.name]),
    );

    const cero = new Prisma.Decimal(0);
    const branches = grupos
      .map((g) => ({
        branchId: g.branchId,
        branchName: nombres.get(g.branchId) ?? '',
        receiptCount: g._count._all,
        // Subtotal sin IVA = suma de subtotal menos suma de descuentos.
        subtotal: dinero((g._sum.subtotal ?? cero).minus(g._sum.discount ?? cero)),
        tax: dinero(g._sum.tax ?? cero),
        totalSales: dinero(g._sum.total ?? cero),
      }))
      .sort(
        (a, b) =>
          b.totalSales - a.totalSales ||
          a.branchName.localeCompare(b.branchName, 'es'),
      );

    return {
      from: periodo.from,
      to: periodo.to,
      totalSales: dinero(
        grupos.reduce((suma, g) => suma.plus(g._sum.total ?? cero), cero),
      ),
      receiptCount: branches.reduce((suma, b) => suma + b.receiptCount, 0),
      branches,
    };
  }

  // Sucursal opcional de H27 y H28: si se envía, debe existir.
  private async validarSucursalOpcional(branchId: string | undefined) {
    if (branchId === undefined) return;
    const existe =
      UUID.test(branchId) &&
      (await this.prisma.branch.findUnique({
        where: { id: branchId },
        select: { id: true },
      }));
    if (!existe) throw new NotFoundException('La sucursal no existe.');
  }

  // H28: los 10 platillos con más unidades vendidas en el período. Se
  // parte de los comprobantes y se llega a los pedidos por el pago: los
  // de la cuenta de mesa (accountId) o el pedido para llevar (orderId).
  // Los pedidos cancelados no cuentan aunque la cuenta esté pagada.
  async topDishes(query: TopDishesQueryDto) {
    const periodo = validarPeriodo(query.from, query.to);
    await this.validarSucursalOpcional(query.branchId);

    const filtroSucursal = query.branchId
      ? Prisma.sql`AND r.branch_id = ${query.branchId}::uuid`
      : Prisma.empty;

    const filas = await this.prisma.$queryRaw<
      { dishId: string; dishName: string; category: string; unitsSold: number; revenue: Prisma.Decimal }[]
    >(Prisma.sql`
      SELECT d.id AS "dishId", d.name AS "dishName", c.name AS category,
             SUM(oi.quantity)::int AS "unitsSold",
             SUM(oi.quantity * oi.unit_price) AS revenue
      FROM receipts r
      JOIN payments p ON p.id = r.payment_id
      JOIN orders o ON (o.account_id = p.account_id OR o.id = p.order_id)
      JOIN order_items oi ON oi.order_id = o.id
      JOIN dishes d ON d.id = oi.dish_id
      JOIN categories c ON c.id = d.category_id
      WHERE r.issued_at >= ${periodo.desde}
        AND r.issued_at < ${periodo.hasta}
        AND o.status::text <> 'CANCELLED'
        ${filtroSucursal}
      GROUP BY d.id, d.name, c.name`);

    // Orden: unidades, luego ingreso, luego nombre (A-Z); primeros 10.
    const items = filas
      .map((f) => ({ ...f, revenue: dinero(new Prisma.Decimal(f.revenue)) }))
      .sort(
        (a, b) =>
          b.unitsSold - a.unitsSold ||
          b.revenue - a.revenue ||
          a.dishName.localeCompare(b.dishName, 'es'),
      )
      .slice(0, 10)
      .map((f, i) => ({ position: i + 1, ...f }));

    return { from: periodo.from, to: periodo.to, items };
  }

  // H30: comparación de todas las sucursales en el período. Usa la misma
  // fórmula de ventas de H27 y el promedio de las reseñas (H23) creadas
  // en el período. Una sucursal "Requiere atención" cuando vende menos
  // del 80 % del promedio de la cadena.
  async branchComparison(query: BranchComparisonQueryDto) {
    const periodo = validarPeriodo(query.from, query.to);
    const rango = { gte: periodo.desde, lt: periodo.hasta };

    const [sucursales, ventas, resenas] = await Promise.all([
      this.prisma.branch.findMany({ select: { id: true, name: true } }),
      this.prisma.receipt.groupBy({
        by: ['branchId'],
        where: { issuedAt: rango },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.review.groupBy({
        by: ['branchId'],
        where: { createdAt: rango },
        _avg: { rating: true },
      }),
    ]);

    const ventasPor = new Map(ventas.map((v) => [v.branchId, v]));
    const notaPor = new Map(resenas.map((r) => [r.branchId, r._avg.rating]));
    const cero = new Prisma.Decimal(0);

    // Todas las sucursales registradas, con 0 si no tienen ventas.
    const filas = sucursales.map((b) => {
      const v = ventasPor.get(b.id);
      const total = v?._sum.total ?? cero;
      const comprobantes = v?._count._all ?? 0;
      const nota = notaPor.get(b.id);
      return {
        branchId: b.id,
        branchName: b.name,
        total,
        totalSales: dinero(total),
        receiptCount: comprobantes,
        averageTicket: comprobantes ? dinero(total.div(comprobantes)) : 0,
        averageRating: nota == null ? null : Math.round(nota * 10) / 10,
      };
    });

    const suma = filas.reduce((t, f) => t.plus(f.total), cero);
    const promedio = filas.length ? suma.div(filas.length) : cero;
    const chainAverageSales = dinero(promedio);
    const hayVentas = suma.greaterThan(0);

    const branches = filas
      .map(({ total, ...f }) => ({
        ...f,
        percentVsAverage: hayVentas
          ? total.div(promedio).minus(1).mul(100).toDecimalPlaces(1).toNumber()
          : 0,
        // Sin ventas en el período no se marca ninguna sucursal.
        needsAttention: hayVentas && total.lessThan(promedio.mul(0.8)),
      }))
      .sort(
        (a, b) =>
          b.totalSales - a.totalSales ||
          a.branchName.localeCompare(b.branchName, 'es'),
      );

    return { from: periodo.from, to: periodo.to, chainAverageSales, branches };
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
