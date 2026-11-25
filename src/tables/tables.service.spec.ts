import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TablesService } from './tables.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';

describe('TablesService - H11 disponibilidad', () => {
  const requestedDate = new Date('2026-11-24T16:00:00.000Z');

  function fixture() {
    const db = {
      branch: {
        findUnique: vi.fn().mockResolvedValue({ id: BRANCH_ID, isActive: true }),
      },
      staffBranch: {
        findUnique: vi.fn().mockResolvedValue({ userId: USER_ID }),
      },
      restaurantTable: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'table-free', number: 1, capacity: 2, accounts: [], reservations: [] },
          { id: 'table-open', number: 2, capacity: 4, accounts: [{ id: 'account-1' }], reservations: [] },
          {
            id: 'table-reserved',
            number: 3,
            capacity: 6,
            accounts: [],
            reservations: [
              { dateTime: new Date('2026-11-24T15:30:00.000Z'), durationMinutes: 90 },
            ],
          },
        ]),
      },
    };
    return { db, service: new TablesService(db as never) };
  }

  it('devuelve número, capacidad, estado y disponibilidad de cada mesa', async () => {
    const { service } = fixture();

    const result = await service.getAvailability(
      { id: USER_ID } as never,
      BRANCH_ID,
      requestedDate.toISOString(),
    );

    expect(result.items).toEqual([
      { id: 'table-free', number: 1, capacity: 2, status: 'Libre', available: true },
      { id: 'table-open', number: 2, capacity: 4, status: 'Ocupada', available: false },
      { id: 'table-reserved', number: 3, capacity: 6, status: 'Reservada', available: false },
    ]);
  });

  it('rechaza una fecha y hora inválidas', async () => {
    const { service } = fixture();
    await expect(
      service.getAvailability({ id: USER_ID } as never, BRANCH_ID, 'no-es-fecha'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza una sucursal inexistente o inactiva', async () => {
    const { db, service } = fixture();
    db.branch.findUnique.mockResolvedValue({ id: BRANCH_ID, isActive: false });
    await expect(
      service.getAvailability({ id: USER_ID } as never, BRANCH_ID, requestedDate.toISOString()),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza consultar una sucursal sin asignación', async () => {
    const { db, service } = fixture();
    db.staffBranch.findUnique.mockResolvedValue(null);
    await expect(
      service.getAvailability({ id: USER_ID } as never, BRANCH_ID, requestedDate.toISOString()),
    ).rejects.toThrow(ForbiddenException);
  });
});
