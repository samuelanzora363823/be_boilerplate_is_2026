import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MovementType, NotificationSource, Prisma, UserRole } from '../generated/prisma/client.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import type { SendNotificationInput } from './notifications.service.js';

const CLIENTE = '11111111-1111-4111-8111-111111111111';
const MESERO = '22222222-2222-4222-8222-222222222222';

// Base en memoria: usuarios activos y bandeja del destinatario.
function crearServicio(usuariosActivos: string[]) {
  const guardadas: Record<string, unknown>[] = [];
  const db = {
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => usuariosActivos.includes(id)).map((id) => ({ id }))),
    },
    notification: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => ({
        id: `n${guardadas.length + 1}`, status: 'NO_LEIDA', createdAt: new Date(), readAt: null, ...data,
      })),
      findMany: vi.fn(async ({ where }: { where: { recipientId: string } }) =>
        guardadas.filter((n) => n.recipientId === where.recipientId)),
      count: vi.fn(async () => guardadas.length),
    },
    $transaction: vi.fn(async (ops: unknown[]) => {
      const filas = await Promise.all(ops);
      // Las de send() se guardan juntas; las de la bandeja solo se leen.
      if (filas.every((f) => f && typeof f === 'object' && 'recipientId' in (f as object))) {
        guardadas.push(...(filas as Record<string, unknown>[]));
      }
      return filas;
    }),
  };
  return { service: new NotificationsService(db as never), db, guardadas };
}

const base: SendNotificationInput = {
  recipientIds: [CLIENTE],
  title: 'Reservación confirmada',
  message: 'Tu reservación para 4 personas está confirmada.',
  sourceModule: NotificationSource.RESERVAS,
  referenceType: 'Reservation',
  referenceId: 'res-1',
};

describe('H25. Servicio interno de envío de notificaciones', () => {
  it('AC1: recibe de 1 a 50 destinatarios, título de 1 a 100, mensaje de 1 a 500, módulo del enum y referencia opcional', async () => {
    const cincuenta = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const { service } = crearServicio(cincuenta);

    await expect(service.send({ ...base, recipientIds: cincuenta, title: 't'.repeat(100), message: 'm'.repeat(500) })).resolves.toHaveLength(50);
    await expect(service.send({ ...base, recipientIds: [cincuenta[0]], referenceType: null, referenceId: null })).resolves.toHaveLength(1);
  });

  it('AC2: crea una notificación No leída con fecha por destinatario, todas en una sola transacción', async () => {
    const { service, db } = crearServicio([CLIENTE, MESERO]);

    const creadas = await service.send({ ...base, recipientIds: [CLIENTE, MESERO] });

    expect(creadas.map((n) => n.recipientId)).toEqual([CLIENTE, MESERO]);
    expect(creadas.every((n) => n.status === 'NO_LEIDA' && n.createdAt instanceof Date)).toBe(true);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('AC3: la notificación creada aparece en la siguiente consulta de la bandeja del destinatario', async () => {
    const { service } = crearServicio([CLIENTE]);

    await service.send(base);
    const bandeja = await service.list({ id: CLIENTE } as never, {});

    expect(bandeja.data.map((n) => n.title)).toEqual(['Reservación confirmada']);
  });

  it('AC4: rechaza sin crear nada título o mensaje inválidos, módulo fuera del enum, destinatarios vacíos o más de 50, y destinatarios inexistentes o inactivos', async () => {
    const { service, db } = crearServicio([CLIENTE]);
    const invalidos: Partial<SendNotificationInput>[] = [
      { title: '' }, { title: 't'.repeat(101) }, { message: '' }, { message: 'm'.repeat(501) },
      { sourceModule: 'PAGOS' as NotificationSource }, { recipientIds: [] },
      { recipientIds: Array.from({ length: 51 }, () => CLIENTE) },
    ];
    for (const cambio of invalidos) {
      await expect(service.send({ ...base, ...cambio })).rejects.toThrow(BadRequestException);
    }
    await expect(service.send({ ...base, recipientIds: [CLIENTE, MESERO] })).rejects.toThrow(NotFoundException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('AC5: no expone un endpoint HTTP de creación: el controlador solo tiene rutas de lectura y marcado', () => {
    const rutas = Object.getOwnPropertyNames(NotificationsController.prototype).filter((r) => r !== 'constructor');
    expect(rutas.sort()).toEqual(['list', 'read', 'readAll', 'unreadCount']);
  });

  it('AC6: si el envío falla, la operación del módulo que llamó no se revierte y el error queda en el log', async () => {
    const fila = { id: 'inv-1', supplyId: 'tomate', quantity: new Prisma.Decimal(5), minimumStock: new Prisma.Decimal(2), supply: { name: 'Tomate', unit: 'KG' } };
    const tx = {
      branchInventory: {
        updateMany: vi.fn(async () => { fila.quantity = fila.quantity.minus(4); return { count: 1 }; }),
        findUniqueOrThrow: vi.fn(async () => ({ ...fila })),
      },
      inventoryMovement: { create: vi.fn(async ({ data }: { data: object }) => ({ id: 'mov-1', createdAt: new Date(), ...data })) },
      inventoryAlert: { updateMany: vi.fn(), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'alerta-1' }) },
    };
    const db = {
      staffBranch: { findMany: vi.fn().mockResolvedValue([{ branch: { id: 'b1', name: 'Escalón' } }]) },
      branchInventory: { findUnique: vi.fn(async () => ({ ...fila })) },
      $transaction: vi.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'g1' }]) },
    };
    const notifications = { send: vi.fn().mockRejectedValue(new Error('caída del servicio')) };
    const inventario = new InventoryService(db as never, notifications as never);
    const log = vi.spyOn((inventario as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation(() => undefined);

    const movimiento = await inventario.createMovement({ id: 'g1', role: UserRole.GERENTE } as never, {
      supplyId: 'tomate', type: MovementType.SALIDA, quantity: 4, reason: 'Uso en cocina',
    });

    expect(movimiento.resultingQuantity).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('alerta-1'), expect.anything());
  });
});
