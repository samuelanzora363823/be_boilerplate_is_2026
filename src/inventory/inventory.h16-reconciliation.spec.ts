import { Prisma } from '../generated/prisma/client.js';
import { InventoryService } from './inventory.service.js';

describe('H16 - reconciliación de alertas', () => {
  it('crea una alerta faltante para stock bajo sin generar duplicados al volver a consultar', async () => {
    const branchId = '10000000-0000-4000-8000-000000000002';
    const supplyId = 'supply-test';
    const existing: Array<{ supplyId: string; cycleOpen: boolean }> = [];
    const tx = {
      branchInventory: {
        findMany: vi.fn().mockResolvedValue([{
          supplyId, quantity: new Prisma.Decimal(1), minimumStock: new Prisma.Decimal(2),
        }]),
      },
      inventoryAlert: {
        findMany: vi.fn(async () => existing.filter((row) => row.cycleOpen)),
        updateMany: vi.fn(),
        createMany: vi.fn(async ({ data }: { data: Array<{ supplyId: string }> }) => {
          for (const row of data) {
            if (!existing.some((item) => item.supplyId === row.supplyId && item.cycleOpen)) {
              existing.push({ supplyId: row.supplyId, cycleOpen: true });
            }
          }
          return { count: data.length };
        }),
      },
    };
    const db = {
      staffBranch: { findMany: vi.fn().mockResolvedValue([{ branch: { id: branchId, name: 'Escalón' } }]) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
      inventoryAlert: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new InventoryService(db as never, {} as never);
    const user = { id: 'user-test' } as never;

    await service.listAlerts(user);
    await service.listAlerts(user);

    expect(tx.inventoryAlert.createMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryAlert.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ branchId, supplyId })],
      skipDuplicates: true,
    }));
  });
});
