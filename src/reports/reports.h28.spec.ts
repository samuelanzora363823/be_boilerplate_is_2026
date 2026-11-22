import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

const ESCALON = '10000000-0000-4000-8000-000000000002';

type Fila = { dishName: string; category: string; unitsSold: number; revenue: number };

function crearServicio(filas: Fila[]) {
  const prisma = {
    branch: { findUnique: vi.fn().mockResolvedValue({ id: ESCALON }) },
    $queryRaw: vi.fn().mockResolvedValue(filas.map((f, i) => ({ dishId: `d${i}`, ...f, revenue: new Prisma.Decimal(f.revenue) }))),
  };
  return { service: new ReportsService(prisma as never), prisma };
}

const sqlDe = (prisma: { $queryRaw: { mock: { calls: unknown[][] } } }) =>
  (prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql).sql.replace(/\s+/g, ' ');

function contexto(role: UserRole) {
  return {
    getHandler: () => ReportsController.prototype.topDishes,
    getClass: () => ReportsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  } as never;
}

describe('H28. Reporte de platillos más vendidos', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T16:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('AC1: filtra por período y por una sucursal o todas', async () => {
    const todas = crearServicio([]);
    await todas.service.topDishes({ from: '2026-11-01', to: '2026-11-20' });
    expect(sqlDe(todas.prisma)).not.toContain('r.branch_id =');

    const una = crearServicio([]);
    await una.service.topDishes({ from: '2026-11-01', to: '2026-11-20', branchId: ESCALON });
    expect(sqlDe(una.prisma)).toContain('r.branch_id =');
    expect((una.prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql).values).toContain(ESCALON);
  });

  it('AC2: devuelve máximo 10 platillos con posición, nombre, categoría, unidades e ingreso con 2 decimales', async () => {
    const filas = Array.from({ length: 12 }, (_, i) => ({ dishName: `P${i}`, category: 'Platos', unitsSold: 20 - i, revenue: 10.555 + i }));
    const { service } = crearServicio(filas);

    const { items } = await service.topDishes({ from: '2026-11-01', to: '2026-11-20' });

    expect(items).toHaveLength(10);
    expect(items[0]).toEqual({ position: 1, dishId: 'd0', dishName: 'P0', category: 'Platos', unitsSold: 20, revenue: 10.56 });
    expect(items[9].position).toBe(10);
  });

  it('AC3: suma las unidades de los pedidos con comprobante: de la cuenta de mesa o el pedido para llevar', async () => {
    const { service, prisma } = crearServicio([]);

    await service.topDishes({ from: '2026-11-01', to: '2026-11-20' });

    const sql = sqlDe(prisma);
    expect(sql).toContain('FROM receipts r JOIN payments p ON p.id = r.payment_id');
    expect(sql).toContain('o.account_id = p.account_id OR o.id = p.order_id');
    expect(sql).toContain('SUM(oi.quantity)');
  });

  it('AC4: en empate de unidades va primero el de mayor ingreso y después por nombre A-Z', async () => {
    const { service } = crearServicio([
      { dishName: 'Horchata', category: 'Bebidas', unitsSold: 3, revenue: 5.25 },
      { dishName: 'Ensalada', category: 'Platos', unitsSold: 3, revenue: 15 },
      { dishName: 'Limonada', category: 'Bebidas', unitsSold: 3, revenue: 5.25 },
    ]);

    const { items } = await service.topDishes({ from: '2026-11-01', to: '2026-11-20' });

    expect(items.map((i) => i.dishName)).toEqual(['Ensalada', 'Horchata', 'Limonada']);
  });

  it('AC5: no cuenta los pedidos en estado Cancelado aunque la cuenta esté pagada', async () => {
    const { service, prisma } = crearServicio([]);

    await service.topDishes({ from: '2026-11-01', to: '2026-11-20' });

    expect(sqlDe(prisma)).toContain("o.status::text <> 'CANCELLED'");
  });

  it('AC6: sin ventas en el período devuelve la lista vacía', async () => {
    const { service } = crearServicio([]);

    expect(await service.topDishes({ from: '2026-01-01', to: '2026-01-31' })).toMatchObject({ items: [] });
    await expect(service.topDishes({ from: '2026-11-20', to: '2026-11-01' })).rejects.toThrow(BadRequestException);
  });

  it('AC7: no permite el reporte a Mesero, Cocina y Cliente (403); lo consulta el Gerente', () => {
    const guard = new RolesGuard(new Reflector());
    expect(Reflect.getMetadata(ROLES_KEY, ReportsController)).toEqual([UserRole.GERENTE]);
    expect(guard.canActivate(contexto(UserRole.GERENTE))).toBe(true);
    for (const rol of [UserRole.MESERO, UserRole.COCINA, UserRole.CLIENTE]) {
      expect(() => guard.canActivate(contexto(rol))).toThrow(ForbiddenException);
    }
  });
});
