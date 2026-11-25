import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

const SUCURSALES = [
  { id: 'b-escalon', name: 'Escalón' },
  { id: 'b-santa-elena', name: 'Santa Elena' },
  { id: 'b-santa-tecla', name: 'Santa Tecla' },
];

function crearServicio(ventas: [string, number, number][], notas: [string, number][] = []) {
  const prisma = {
    branch: { findMany: vi.fn().mockResolvedValue(SUCURSALES) },
    receipt: {
      groupBy: vi.fn().mockResolvedValue(ventas.map(([branchId, total, count]) => ({
        branchId, _sum: { total: new Prisma.Decimal(total) }, _count: { _all: count },
      }))),
    },
    review: { groupBy: vi.fn().mockResolvedValue(notas.map(([branchId, rating]) => ({ branchId, _avg: { rating } }))) },
  };
  return { service: new ReportsService(prisma as never), prisma };
}

const periodo = { from: '2026-11-01', to: '2026-11-20' };

function contexto(role: UserRole) {
  return {
    getHandler: () => ReportsController.prototype.branchComparison,
    getClass: () => ReportsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  } as never;
}

describe('H30. Comparación de desempeño entre sucursales', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-22T16:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('AC1: incluye todas las sucursales registradas aunque no tengan ventas, con el período de las reglas comunes', async () => {
    const { service } = crearServicio([['b-escalon', 100, 2]]);

    const { branches } = await service.branchComparison(periodo);

    expect(branches.map((b) => b.branchName).sort()).toEqual(['Escalón', 'Santa Elena', 'Santa Tecla']);
    expect(branches.find((b) => b.branchName === 'Santa Tecla')).toMatchObject({ totalSales: 0, receiptCount: 0 });
    await expect(service.branchComparison({ from: '2026-11-20', to: '2026-11-01' })).rejects.toThrow(BadRequestException);
  });

  it('AC2: ventas, comprobantes, ticket promedio con 2 decimales (0 sin comprobantes) y calificación con 1 decimal o sin reseñas', async () => {
    const { service } = crearServicio([['b-escalon', 100, 3]], [['b-escalon', 4.26]]);

    const { branches } = await service.branchComparison(periodo);

    expect(branches.find((b) => b.branchName === 'Escalón')).toMatchObject({ totalSales: 100, receiptCount: 3, averageTicket: 33.33, averageRating: 4.3 });
    expect(branches.find((b) => b.branchName === 'Santa Elena')).toMatchObject({ averageTicket: 0, averageRating: null });
  });

  it('AC3: promedio de la cadena = suma de ventas ÷ número de sucursales, con 2 decimales', async () => {
    const { service } = crearServicio([['b-escalon', 302.8, 12], ['b-santa-elena', 122.56, 4], ['b-santa-tecla', 16.67, 2]]);

    const reporte = await service.branchComparison(periodo);

    expect(reporte.chainAverageSales).toBe(147.34);
    expect(reporte.branches.find((b) => b.branchName === 'Escalón')?.percentVsAverage).toBe(105.5);
  });

  it('AC4: marca "Requiere atención" solo a las sucursales con ventas menores al 80 % del promedio', async () => {
    const { service } = crearServicio([['b-escalon', 302.8, 12], ['b-santa-elena', 122.56, 4], ['b-santa-tecla', 16.67, 2]]);

    const { branches } = await service.branchComparison(periodo);

    expect(branches.filter((b) => b.needsAttention).map((b) => b.branchName)).toEqual(['Santa Tecla']);
  });

  it('AC5: ordena de mayor a menor por ventas y, en empate, por nombre A-Z', async () => {
    const { service } = crearServicio([['b-santa-tecla', 50, 1], ['b-santa-elena', 50, 1], ['b-escalon', 80, 2]]);

    const { branches } = await service.branchComparison(periodo);

    expect(branches.map((b) => b.branchName)).toEqual(['Escalón', 'Santa Elena', 'Santa Tecla']);
  });

  it('AC6: si ninguna sucursal tiene ventas no se marca ninguna', async () => {
    const { service } = crearServicio([]);

    const reporte = await service.branchComparison(periodo);

    expect(reporte.chainAverageSales).toBe(0);
    expect(reporte.branches.every((b) => b.totalSales === 0 && !b.needsAttention)).toBe(true);
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
