import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { OccupancyService } from './occupancy.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';

function fixture(options?: {
  tables?: { id: string }[];
  reservations?: {
    tableId: string;
    dateTime: Date;
    durationMinutes: number;
  }[];
  assignment?: { userId: string } | null;
}) {
  const db = {
    branch: {
      findUnique: vi.fn().mockResolvedValue({
        id: BRANCH_ID,
        openingTime: '12:00',
        closingTime: '14:00',
      }),
    },
    staffBranch: {
      findUnique: vi
        .fn()
        .mockResolvedValue(options?.assignment === undefined
          ? { userId: USER_ID }
          : options.assignment),
    },
    restaurantTable: {
      findMany: vi.fn().mockResolvedValue(
        options?.tables ?? [
          { id: 'table-1' },
          { id: 'table-2' },
          { id: 'table-3' },
        ],
      ),
    },
    reservation: {
      findMany: vi.fn().mockResolvedValue(options?.reservations ?? []),
    },
  };

  return {
    db,
    service: new OccupancyService(db as never),
  };
}

const gerente = { id: USER_ID } as never;
const fecha = '2026-11-24';

describe('OccupancyService (H13)', () => {
  it('calcula bloques de una hora y cuenta una mesa una sola vez si sus reservas se traslapan', async () => {
    const { service, db } = fixture({
      reservations: [
        // Mesa 1 se traslapa con el bloque 12:00–13:00.
        {
          tableId: 'table-1',
          dateTime: new Date('2026-11-24T17:30:00.000Z'),
          durationMinutes: 90,
        },
        // Otra reserva de la misma mesa también se traslapa con 12:00–13:00
        // y continúa hasta el bloque 13:00–14:00.
        {
          tableId: 'table-1',
          dateTime: new Date('2026-11-24T18:15:00.000Z'),
          durationMinutes: 90,
        },
        // Mesa 2 se traslapa con ambos bloques.
        {
          tableId: 'table-2',
          dateTime: new Date('2026-11-24T18:45:00.000Z'),
          durationMinutes: 90,
        },
      ],
    });

    const result = await service.getOccupancy(gerente, BRANCH_ID, fecha);

    expect(result).toEqual({
      branchId: BRANCH_ID,
      date: fecha,
      totalTables: 3,
      slots: [
        {
          startTime: '12:00',
          endTime: '13:00',
          reservedTables: 2,
          occupancy: 66.67,
        },
        {
          startTime: '13:00',
          endTime: '14:00',
          reservedTables: 2,
          occupancy: 66.67,
        },
      ],
    });
    expect(db.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId: BRANCH_ID,
          status: 'CONFIRMED',
        }),
      }),
    );
  });

  it('devuelve todos los bloques con cero cuando no existen reservas confirmadas', async () => {
    const { service } = fixture();

    const result = await service.getOccupancy(gerente, BRANCH_ID, fecha);

    expect(result.slots).toEqual([
      {
        startTime: '12:00',
        endTime: '13:00',
        reservedTables: 0,
        occupancy: 0,
      },
      {
        startTime: '13:00',
        endTime: '14:00',
        reservedTables: 0,
        occupancy: 0,
      },
    ]);
  });

  it('devuelve un mensaje y no divide entre cero cuando la sucursal no tiene mesas', async () => {
    const { service, db } = fixture({ tables: [] });

    const result = await service.getOccupancy(gerente, BRANCH_ID, fecha);

    expect(result).toMatchObject({
      totalTables: 0,
      slots: [],
      message:
        'No es posible calcular la ocupación porque la sucursal no tiene mesas registradas.',
    });
    expect(db.reservation.findMany).not.toHaveBeenCalled();
  });

  it('rechaza la consulta si el gerente no está asignado a la sucursal', async () => {
    const { service } = fixture({ assignment: null });

    await expect(
      service.getOccupancy(gerente, BRANCH_ID, fecha),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['', '24/11/2026', '2026-02-30', '2026-13-01'])(
    'rechaza una fecha inválida: %s',
    async (invalidDate) => {
      const { service, db } = fixture();

      await expect(
        service.getOccupancy(gerente, BRANCH_ID, invalidDate),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.branch.findUnique).not.toHaveBeenCalled();
    },
  );
});
