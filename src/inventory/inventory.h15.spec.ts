import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { ListInventoryQueryDto } from './dto.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

const BRANCH = { id: '10000000-0000-4000-8000-000000000002', name: 'Escalón' };
const GERENTE = { id: 'gerente-1', role: UserRole.GERENTE } as never;
const ACTUALIZADO = new Date('2026-11-20T15:30:00Z');

function fila(nombre: string, existencias: number, minimo: number) {
  return {
    id: `inv-${nombre}`,
    supplyId: nombre.toLowerCase(),
    quantity: new Prisma.Decimal(existencias),
    minimumStock: new Prisma.Decimal(minimo),
    updatedAt: ACTUALIZADO,
    supply: { name: nombre, unit: 'KG' },
  };
}

function crearServicio(filas: ReturnType<typeof fila>[], porAgotarse = 0) {
  const db = {
    staffBranch: { findMany: vi.fn().mockResolvedValue([{ branch: BRANCH }]) },
    branchInventory: {
      fields: { minimumStock: 'minimum_stock' },
      findMany: vi.fn((args: unknown) => ({ op: 'findMany', args })),
      count: vi.fn((args: unknown) => ({ op: 'count', args })),
    },
    $transaction: vi.fn().mockResolvedValue([filas, filas.length, porAgotarse]),
  };
  return { service: new InventoryService(db as never, {} as never), db };
}

function contexto(role: UserRole) {
  return {
    getHandler: () => InventoryController.prototype.list,
    getClass: () => InventoryController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  } as never;
}

describe('H15. Consulta de existencias de inventario', () => {
  it('AC1: devuelve nombre, unidad, existencias, stock mínimo, estado y fecha de última actualización', async () => {
    const { service } = crearServicio([fila('Tomate', 10, 4)]);

    const { data } = await service.list(GERENTE, {});

    expect(data[0]).toMatchObject({ name: 'Tomate', unit: 'KG', quantity: 10, minimumStock: 4, lowStock: false, updatedAt: ACTUALIZADO });
  });

  it('AC2: el estado es Por agotarse cuando las existencias son menores o iguales al mínimo (el igual cuenta)', async () => {
    const { service } = crearServicio([fila('Arroz', 4, 4), fila('Queso', 3, 4), fila('Tomate', 5, 4)]);

    const { data } = await service.list(GERENTE, {});

    expect(data.map((d) => [d.name, d.lowStock])).toEqual([['Arroz', true], ['Queso', true], ['Tomate', false]]);
  });

  it('AC3: ordena por nombre A-Z, en páginas de 20 y cuenta los insumos Por agotarse', async () => {
    const { service, db } = crearServicio([fila('Arroz', 1, 4)], 1);

    const respuesta = await service.list(GERENTE, { page: 2 });

    expect(db.branchInventory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { supply: { name: 'asc' } }, skip: 20, take: 20,
    }));
    expect(respuesta).toMatchObject({ page: 2, limit: 20, lowStockCount: 1 });
  });

  it('AC4: busca por nombre sin mayúsculas ni acentos, máximo 50 caracteres, y filtra Solo por agotarse', async () => {
    const { service, db } = crearServicio([]);

    await service.list(GERENTE, { search: '  JALAPEÑO Picánte ', lowStock: 'true' });

    const where = (db.branchInventory.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.supply).toEqual({ searchName: { contains: 'jalapeno picante' } });
    expect(where.quantity).toEqual({ lte: 'minimum_stock' });
    const errores = await validate(plainToInstance(ListInventoryQueryDto, { search: 'x'.repeat(51) }));
    expect(errores[0].constraints).toEqual({ maxLength: 'La búsqueda admite máximo 50 caracteres.' });
  });

  it('AC5: cada consulta vuelve a leer la base (al abrir, buscar, filtrar, actualizar o regresar de H14)', async () => {
    const { service, db } = crearServicio([fila('Tomate', 10, 4)]);

    await service.list(GERENTE, {});
    await service.list(GERENTE, { search: 'tom' });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
  });

  it('AC6: sin insumos o sin coincidencias devuelve una lista vacía con total 0 (la pantalla muestra el mensaje)', async () => {
    const { service } = crearServicio([]);

    const respuesta = await service.list(GERENTE, { search: 'no existe' });

    expect(respuesta).toMatchObject({ data: [], total: 0 });
  });

  it('AC7: la sucursal sale de la sesión y no se acepta una sucursal enviada por el cliente', async () => {
    const { service, db } = crearServicio([]);

    const respuesta = await service.list(GERENTE, {});

    expect(db.staffBranch.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'gerente-1' } }));
    expect((db.branchInventory.findMany.mock.calls[0][0] as { where: { branchId: string } }).where.branchId).toBe(BRANCH.id);
    expect(respuesta.branch).toEqual(BRANCH);
    const errores = await validate(plainToInstance(ListInventoryQueryDto, { branchId: 'otra' }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errores[0].property).toBe('branchId');
  });

  it('AC8: no permite consultar a Mesero, Cocina y Cliente (403); solo entra el Gerente', () => {
    const guard = new RolesGuard(new Reflector());
    expect(Reflect.getMetadata(ROLES_KEY, InventoryController)).toEqual([UserRole.GERENTE]);
    expect(guard.canActivate(contexto(UserRole.GERENTE))).toBe(true);
    for (const rol of [UserRole.MESERO, UserRole.COCINA, UserRole.CLIENTE]) {
      expect(() => guard.canActivate(contexto(rol))).toThrow(ForbiddenException);
    }
  });
});
