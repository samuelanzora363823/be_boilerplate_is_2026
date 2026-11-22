import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryAlertStatus,
  MovementType,
  NotificationSource,
  Prisma,
} from '../generated/prisma/client.js';
import { InventoryService } from './inventory.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const SUPPLY_ID = '33333333-3333-4333-8333-333333333333';
const ALERT_ID = '44444444-4444-4444-8444-444444444444';

describe('InventoryService - H16 Alertas de insumos', () => {
  const user = { id: USER_ID } as never;

  function fixture(stock = 4, minimum = 5) {
    const inventory = {
      id: 'inventory-id',
      supplyId: SUPPLY_ID,
      supply: { name: 'Harina', unit: 'KG' },
    };

    const resultInventory = {
      quantity: new Prisma.Decimal(stock),
      minimumStock: new Prisma.Decimal(minimum),
    };

    const tx = {
      branchInventory: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(resultInventory),
      },
      inventoryMovement: {
        create: vi.fn().mockResolvedValue({
          id: 'movement-id',
          type: MovementType.SALIDA,
          quantity: new Prisma.Decimal(2),
          reason: 'Uso en cocina',
          createdAt: new Date('2026-11-21T10:00:00Z'),
          createdById: USER_ID,
        }),
      },
      inventoryAlert: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: ALERT_ID }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const db = {
      staffBranch: {
        findMany: vi.fn().mockResolvedValue([
          { branch: { id: BRANCH_ID, name: 'Central' } },
        ]),
      },
      branchInventory: {
        findUnique: vi.fn().mockResolvedValue(inventory),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'manager-id' },
        ]),
      },
      inventoryAlert: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };

    const notifications = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    const service = new InventoryService(
      db as never,
      notifications as never,
    );

    const movement = {
      supplyId: SUPPLY_ID,
      type: MovementType.SALIDA,
      quantity: 2,
      reason: 'Uso en cocina',
    };

    return { service, db, tx, notifications, movement };
  }

  it('genera una alerta cuando el stock está bajo el mínimo', async () => {
    const { service, tx, movement } = fixture(4, 5);

    const result = await service.createMovement(user, movement);

    expect(result.lowStock).toBe(true);
    expect(tx.inventoryAlert.create).toHaveBeenCalledOnce();
  });

  it('genera una alerta cuando el stock es igual al mínimo', async () => {
    const { service, tx, movement } = fixture(5, 5);

    await service.createMovement(user, movement);

    expect(tx.inventoryAlert.create).toHaveBeenCalledOnce();
  });

  it('evita generar alertas duplicadas', async () => {
    const { service, tx, notifications, movement } = fixture(3, 5);

    tx.inventoryAlert.findFirst.mockResolvedValue({
      id: 'existing-alert',
    });

    await service.createMovement(user, movement);

    expect(tx.inventoryAlert.create).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('cierra el ciclo de alerta cuando se recupera el stock', async () => {
    const { service, tx, notifications, movement } = fixture(10, 5);

    const result = await service.createMovement(user, movement);

    expect(result.lowStock).toBe(false);
    expect(tx.inventoryAlert.updateMany).toHaveBeenCalledWith({
      where: {
        branchId: BRANCH_ID,
        supplyId: SUPPLY_ID,
        cycleOpen: true,
      },
      data: { cycleOpen: false },
    });
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('notifica a los gerentes de la sucursal', async () => {
    const { service, db, notifications, movement } = fixture();

    await service.createMovement(user, movement);

    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {
        role: 'GERENTE',
        isActive: true,
        staffBranches: { some: { branchId: BRANCH_ID } },
      },
      select: { id: true },
    });

    expect(notifications.send).toHaveBeenCalledWith({
      recipientIds: ['manager-id'],
      title: 'Insumo por agotarse',
      message: expect.stringContaining('Harina'),
      sourceModule: NotificationSource.INVENTARIO,
      referenceType: 'InventoryAlert',
      referenceId: ALERT_ID,
    });
  });

  it('mantiene el movimiento si falla la notificación', async () => {
    const { service, notifications, movement } = fixture();

    notifications.send.mockRejectedValue(
      new Error('Servicio no disponible'),
    );

    const result = await service.createMovement(user, movement);

    expect(result.lowStock).toBe(true);
    expect(result.id).toBe('movement-id');
  });

  it('permite marcar una alerta como atendida', async () => {
    const { service, db } = fixture();

    const result = await service.attendAlert(
      user,
      ALERT_ID,
      'Atendida',
    );

    expect(result).toEqual({
      id: ALERT_ID,
      status: 'Atendida',
    });

    expect(db.inventoryAlert.updateMany).toHaveBeenCalledWith({
      where: {
        id: ALERT_ID,
        branchId: BRANCH_ID,
        status: InventoryAlertStatus.ACTIVA,
      },
      data: { status: InventoryAlertStatus.ATENDIDA },
    });
  });

  it('rechaza estados distintos de Atendida', async () => {
    const { service } = fixture();

    await expect(
      service.attendAlert(user, ALERT_ID, 'Pendiente'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza atender dos veces la misma alerta', async () => {
    const { service, db } = fixture();

    db.inventoryAlert.updateMany.mockResolvedValue({ count: 0 });
    db.inventoryAlert.findFirst.mockResolvedValue({
      id: ALERT_ID,
    });

    await expect(
      service.attendAlert(user, ALERT_ID, 'Atendida'),
    ).rejects.toThrow(ConflictException);
  });

  it('rechaza atender alertas inexistentes', async () => {
    const { service, db } = fixture();

    db.inventoryAlert.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.attendAlert(user, ALERT_ID, 'Atendida'),
    ).rejects.toThrow(NotFoundException);
  });
});
