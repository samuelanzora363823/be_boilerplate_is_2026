import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

const ESCALON = '10000000-0000-4000-8000-000000000002';

function crearServicio(conteos: [number, number][]) {
  const prisma = {
    branch: { findUnique: vi.fn().mockResolvedValue({ id: ESCALON, name: 'Escalón', openingTime: '07:00', closingTime: '22:00' }) },
    $queryRaw: vi.fn().mockResolvedValue(conteos.map(([hour, count]) => ({ hour, count }))),
  };
  return { service: new ReportsService(prisma as never), prisma };
}

const consulta = { branchId: ESCALON, from: '2026-11-01', to: '2026-11-20' };

function contexto(role: UserRole) {
  return {
    getHandler: () => ReportsController.prototype.peakHours,
    getClass: () => ReportsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  } as never;
}

describe('H29. Reporte de horarios pico por sucursal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T16:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('AC1: la sucursal es obligatoria y el período sigue las reglas comunes', async () => {
    const { service } = crearServicio([]);

    await service.peakHours({ from: '2026-11-01', to: '2026-11-20' }).catch((e: BadRequestException) =>
      expect(e.getResponse()).toEqual({ message: 'Seleccione una sucursal.', field: 'branchId' }));
    await expect(service.peakHours({ ...consulta, to: '2026-11-23' })).rejects.toThrow(BadRequestException);
  });

  it('AC2: divide el horario de atención en bloques de 1 hora y cuenta por hora de creación en UTC-6', async () => {
    const { service, prisma } = crearServicio([[12, 4]]);

    const { hours } = await service.peakHours(consulta);

    expect(hours.map((h) => h.hour)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    expect(hours.find((h) => h.hour === 12)).toMatchObject({ label: '12:00–12:59', orderCount: 4 });
    const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('EXTRACT(HOUR FROM o.created_at - make_interval(hours =>');
    expect(sql.values).toContain(6);
  });

  it('AC3: no cuenta pedidos Cancelados ni Pendiente Pago', async () => {
    const { service, prisma } = crearServicio([]);

    await service.peakHours(consulta);

    expect((prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql).sql).toContain("NOT IN ('CANCELLED', 'PENDING_PAYMENT')");
  });

  it('AC4: marca como Hora pico los 3 bloques con más pedidos; en empate gana el más temprano', async () => {
    const { service } = crearServicio([[19, 6], [12, 6], [13, 5], [20, 5], [8, 2]]);

    const { hours, totalOrders } = await service.peakHours(consulta);

    expect(hours.filter((h) => h.isPeak).map((h) => h.hour)).toEqual([12, 13, 19]);
    expect(totalOrders).toBe(24);
  });

  it('AC5: los bloques con 0 pedidos se muestran con 0 y no se marcan como hora pico', async () => {
    const { service } = crearServicio([[9, 1]]);

    const { hours } = await service.peakHours(consulta);

    expect(hours.find((h) => h.hour === 7)).toMatchObject({ orderCount: 0, isPeak: false });
    expect(hours.filter((h) => h.isPeak).map((h) => h.hour)).toEqual([9]);
  });

  it('AC6: sin pedidos en el período el total es 0 y ningún bloque es hora pico', async () => {
    const { service } = crearServicio([]);

    const reporte = await service.peakHours(consulta);

    expect(reporte.totalOrders).toBe(0);
    expect(reporte.hours.some((h) => h.isPeak)).toBe(false);
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
