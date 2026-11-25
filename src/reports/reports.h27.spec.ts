import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

const ESCALON = '10000000-0000-4000-8000-000000000002';
const SANTA_ELENA = '10000000-0000-4000-8000-000000000001';
const D = (n: number) => new Prisma.Decimal(n);

function crearServicio(grupos: { branchId: string; subtotal: number; discount: number; tax: number; total: number; count: number }[]) {
  const prisma = {
    branch: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ([ESCALON, SANTA_ELENA].includes(where.id) ? { id: where.id } : null)),
      findMany: vi.fn().mockResolvedValue([{ id: ESCALON, name: 'Escalón' }, { id: SANTA_ELENA, name: 'Santa Elena' }]),
    },
    receipt: {
      groupBy: vi.fn().mockResolvedValue(grupos.map((g) => ({
        branchId: g.branchId,
        _sum: { subtotal: D(g.subtotal), discount: D(g.discount), tax: D(g.tax), total: D(g.total) },
        _count: { _all: g.count },
      }))),
    },
  };
  return { service: new ReportsService(prisma as never), prisma };
}

function contexto(role: UserRole) {
  return {
    getHandler: () => ReportsController.prototype.sales,
    getClass: () => ReportsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  } as never;
}

describe('H27. Reporte de ventas totales por período', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T16:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('AC1: filtra por período (fechas de El Salvador) y por una sucursal o todas', async () => {
    const { service, prisma } = crearServicio([]);

    await service.sales({ from: '2026-11-01', to: '2026-11-20' });
    await service.sales({ from: '2026-11-01', to: '2026-11-20', branchId: ESCALON });

    expect(prisma.receipt.groupBy.mock.calls[0][0].where).toEqual({
      issuedAt: { gte: new Date('2026-11-01T06:00:00Z'), lt: new Date('2026-11-21T06:00:00Z') },
    });
    expect(prisma.receipt.groupBy.mock.calls[1][0].where.branchId).toBe(ESCALON);
    await expect(service.sales({ from: '2026-11-01', to: '2026-11-20', branchId: '00000000-0000-4000-8000-000000000000' }))
      .rejects.toThrow(NotFoundException);
  });

  it('AC2: ventas totales = suma de Receipt.total (IVA incluido, descuentos aplicados)', async () => {
    const { service } = crearServicio([
      { branchId: ESCALON, subtotal: 100, discount: 10, tax: 11.7, total: 101.7, count: 2 },
      { branchId: SANTA_ELENA, subtotal: 50, discount: 0, tax: 6.5, total: 56.5, count: 1 },
    ]);

    const reporte = await service.sales({ from: '2026-11-01', to: '2026-11-20' });

    expect(reporte.totalSales).toBe(158.2);
    expect(reporte.receiptCount).toBe(3);
  });

  it('AC3: tabla por sucursal con comprobantes, subtotal sin IVA, IVA y ventas, de mayor a menor y por nombre en empate', async () => {
    const { service } = crearServicio([
      { branchId: SANTA_ELENA, subtotal: 50, discount: 0, tax: 6.5, total: 56.5, count: 1 },
      { branchId: ESCALON, subtotal: 60, discount: 10, tax: 6.5, total: 56.5, count: 2 },
    ]);

    const { branches } = await service.sales({ from: '2026-11-01', to: '2026-11-20' });

    expect(branches).toEqual([
      { branchId: ESCALON, branchName: 'Escalón', receiptCount: 2, subtotal: 50, tax: 6.5, totalSales: 56.5 },
      { branchId: SANTA_ELENA, branchName: 'Santa Elena', receiptCount: 1, subtotal: 50, tax: 6.5, totalSales: 56.5 },
    ]);
  });

  it('AC4: sin ventas en el período devuelve totales en 0 y la tabla vacía', async () => {
    const { service } = crearServicio([]);

    expect(await service.sales({ from: '2026-01-01', to: '2026-01-31' }))
      .toMatchObject({ totalSales: 0, receiptCount: 0, branches: [] });
  });

  it('AC5: no genera el reporte con inicial posterior a la final, final posterior a hoy o más de 366 días', async () => {
    const { service, prisma } = crearServicio([]);
    const casos: [string, string, string][] = [
      ['2026-11-20', '2026-11-01', 'La fecha inicial no puede ser posterior a la fecha final.'],
      ['2026-11-01', '2026-11-23', 'La fecha final no puede ser posterior a hoy.'],
      ['2025-11-01', '2026-11-20', 'El período no puede superar 366 días.'],
    ];
    for (const [from, to, mensaje] of casos) {
      await expect(service.sales({ from, to })).rejects.toThrow(BadRequestException);
      await service.sales({ from, to }).catch((e: BadRequestException) =>
        expect((e.getResponse() as { message: string }).message).toBe(mensaje));
    }
    expect(prisma.receipt.groupBy).not.toHaveBeenCalled();
  });

  it('AC6: no permite el reporte a Mesero, Cocina y Cliente (403); lo consulta el Gerente', () => {
    const guard = new RolesGuard(new Reflector());
    expect(Reflect.getMetadata(ROLES_KEY, ReportsController)).toEqual([UserRole.GERENTE]);
    expect(guard.canActivate(contexto(UserRole.GERENTE))).toBe(true);
    for (const rol of [UserRole.MESERO, UserRole.COCINA, UserRole.CLIENTE]) {
      expect(() => guard.canActivate(contexto(rol))).toThrow(ForbiddenException);
    }
  });
});
