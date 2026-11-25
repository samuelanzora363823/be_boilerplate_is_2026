import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MovementType, Prisma, UserRole } from '../generated/prisma/client.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateMovementDto } from './dto.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

const BRANCH = { id: '10000000-0000-4000-8000-000000000002', name: 'Escalón' };
const GERENTE = { id: 'gerente-1', role: UserRole.GERENTE } as never;

// Inventario en memoria de un insumo de la sucursal del gerente.
function crearServicio(existencias: number, minimo = 2) {
  const fila = {
    id: 'inv-1',
    supplyId: 'tomate',
    quantity: new Prisma.Decimal(existencias),
    minimumStock: new Prisma.Decimal(minimo),
    supply: { name: 'Tomate', unit: 'KG' },
  };
  const movimientos: Record<string, unknown>[] = [];
  const tx = {
    branchInventory: {
      // Solo actualiza si la condición de existencias se cumple (como en SQL).
      updateMany: vi.fn(async ({ where, data }: { where: { quantity?: { gte: Prisma.Decimal } }; data: { quantity: { increment?: Prisma.Decimal; decrement?: Prisma.Decimal } } }) => {
        if (where.quantity && fila.quantity.lt(where.quantity.gte)) return { count: 0 };
        fila.quantity = data.quantity.increment
          ? fila.quantity.plus(data.quantity.increment)
          : fila.quantity.minus(data.quantity.decrement!);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ ...fila })),
    },
    inventoryMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const movimiento = { id: `mov-${movimientos.length + 1}`, createdAt: new Date(), ...data };
        movimientos.push(movimiento);
        return movimiento;
      }),
    },
    inventoryAlert: {
      updateMany: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'alerta-1' }),
    },
  };
  const db = {
    staffBranch: { findMany: vi.fn().mockResolvedValue([{ branch: BRANCH }]) },
    branchInventory: { findUnique: vi.fn(async () => ({ ...fila })) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'gerente-1' }]) },
  };
  const notifications = { send: vi.fn().mockResolvedValue([]) };
  const service = new InventoryService(db as never, notifications as never);
  return { service, db, tx, fila, movimientos, notifications };
}

async function erroresDe(datos: Record<string, unknown>) {
  const dto = plainToInstance(CreateMovementDto, datos);
  const errores = await validate(dto);
  return Object.fromEntries(errores.map((e) => [e.property, Object.values(e.constraints ?? {})[0]]));
}

function contexto(role: UserRole) {
  return {
    getHandler: () => InventoryController.prototype.createMovement,
    getClass: () => InventoryController,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
  } as never;
}

const valido = { supplyId: 'tomate', type: MovementType.ENTRADA, quantity: 5, reason: 'Compra semanal' };

describe('H14. Registro de entradas y salidas de inventario', () => {
  it('AC1: acepta un movimiento con insumo, tipo, cantidad (hasta 3 decimales) y motivo; el autor lo toma el servidor', async () => {
    expect(await erroresDe({ ...valido, quantity: 99999.999 })).toEqual({});
    const { service, tx } = crearServicio(10);

    await service.createMovement(GERENTE, { ...valido });

    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: MovementType.ENTRADA, reason: 'Compra semanal', createdById: 'gerente-1' }),
    });
  });

  it('AC2: una Entrada suma y una Salida resta, y devuelve las existencias resultantes', async () => {
    const { service } = crearServicio(10);

    const entrada = await service.createMovement(GERENTE, { ...valido, quantity: 2.5 });
    const salida = await service.createMovement(GERENTE, { ...valido, type: MovementType.SALIDA, quantity: 4 });

    expect(entrada.resultingQuantity).toBe(12.5);
    expect(salida.resultingQuantity).toBe(8.5);
    expect(salida).toMatchObject({ supplyName: 'Tomate', unit: 'KG' });
  });

  it('AC3: las salidas son manuales: solo existe el registro por el endpoint de movimientos', () => {
    const rutas = Object.getOwnPropertyNames(InventoryController.prototype);
    expect(rutas).toContain('createMovement');
    expect(rutas.filter((r) => /descont|consum/i.test(r))).toEqual([]);
  });

  it('AC4: rechaza cantidad menor o igual a 0, más de 3 decimales y motivo vacío o con menos de 3 caracteres', async () => {
    expect(await erroresDe({ ...valido, quantity: 0 })).toEqual({ quantity: 'La cantidad debe ser mayor que 0' });
    expect(await erroresDe({ ...valido, quantity: -1 })).toEqual({ quantity: 'La cantidad debe ser mayor que 0' });
    expect(await erroresDe({ ...valido, quantity: 1.2345 })).toEqual({ quantity: 'La cantidad admite máximo 3 decimales' });
    expect(await erroresDe({ ...valido, reason: '' })).toEqual({ reason: 'El motivo debe tener entre 3 y 200 caracteres' });
    expect(await erroresDe({ ...valido, reason: 'ab' })).toEqual({ reason: 'El motivo debe tener entre 3 y 200 caracteres' });
  });

  it('AC5: rechaza una Salida mayor a las existencias con el mensaje de disponible, sin dejar negativos', async () => {
    const { service, fila, movimientos } = crearServicio(3);

    await expect(service.createMovement(GERENTE, { ...valido, type: MovementType.SALIDA, quantity: 5 }))
      .rejects.toThrow(new ConflictException('No hay existencias suficientes de Tomate. Disponible: 3 kg.'));
    expect(Number(fila.quantity)).toBe(3);
    expect(movimientos).toHaveLength(0);
  });

  it('AC6: con dos salidas que juntas superan las existencias, solo se guarda la que alcanza', async () => {
    const { service, fila } = crearServicio(5);
    const salida = { ...valido, type: MovementType.SALIDA, quantity: 4 };

    const resultados = await Promise.allSettled([
      service.createMovement(GERENTE, salida),
      service.createMovement(GERENTE, salida),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(Number(fila.quantity)).toBe(1);
  });

  it('AC7: si las existencias quedan en el mínimo o debajo, crea la alerta de H16 y avisa al gerente', async () => {
    const { service, tx, notifications } = crearServicio(5, 2);

    const movimiento = await service.createMovement(GERENTE, { ...valido, type: MovementType.SALIDA, quantity: 3 });

    expect(movimiento.lowStock).toBe(true);
    expect(tx.inventoryAlert.create).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ referenceType: 'InventoryAlert', referenceId: 'alerta-1' }));
  });

  it('AC8: solo el Gerente registra, en su sucursal; los demás roles reciben 403 y un insumo de otra sucursal no existe', async () => {
    const guard = new RolesGuard(new Reflector());
    expect(Reflect.getMetadata(ROLES_KEY, InventoryController)).toEqual([UserRole.GERENTE]);
    expect(guard.canActivate(contexto(UserRole.GERENTE))).toBe(true);
    for (const rol of [UserRole.MESERO, UserRole.COCINA, UserRole.CLIENTE]) {
      expect(() => guard.canActivate(contexto(rol))).toThrow(ForbiddenException);
    }

    const { service, db } = crearServicio(5);
    db.branchInventory.findUnique.mockResolvedValueOnce(null as never);
    await expect(service.createMovement(GERENTE, { ...valido, supplyId: 'de-otra-sucursal' }))
      .rejects.toThrow(NotFoundException);
    expect(db.branchInventory.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { branchId_supplyId: { branchId: BRANCH.id, supplyId: 'de-otra-sucursal' } },
    }));
  });

  it('AC9: los movimientos no se editan ni se eliminan: no hay rutas de edición ni borrado', () => {
    const rutas = Object.getOwnPropertyNames(InventoryController.prototype);
    expect(rutas.filter((r) => /update|edit|delete|remove/i.test(r))).toEqual([]);
  });
});
