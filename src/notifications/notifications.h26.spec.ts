import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NotificationSource, NotificationStatus } from '../generated/prisma/client.js';
import { ListNotificationsQueryDto } from './dto.js';
import { NotificationsService } from './notifications.service.js';

const CLIENTE = { id: 'cliente-1' } as never;
const OTRO = { id: 'otro-1' } as never;

type Aviso = { id: string; recipientId: string; title: string; message: string; sourceModule: NotificationSource; status: NotificationStatus; createdAt: Date; readAt: Date | null; referenceType: null; referenceId: null };

function aviso(id: string, recipientId: string, horas: number, status: NotificationStatus = NotificationStatus.NO_LEIDA, sourceModule: NotificationSource = NotificationSource.COCINA): Aviso {
  return { id, recipientId, title: `Aviso ${id}`, message: 'Pedido listo', sourceModule, status, createdAt: new Date(Date.UTC(2026, 10, 20, horas)), readAt: null, referenceType: null, referenceId: null };
}

// Base en memoria con el mismo filtrado que haría Prisma.
function crearServicio(avisos: Aviso[]) {
  const coincide = (n: Aviso, where: Partial<Aviso>) =>
    Object.entries(where).every(([k, v]) => n[k as keyof Aviso] === v);
  const db = {
    notification: {
      findMany: vi.fn(async ({ where, skip, take }: { where: Partial<Aviso>; skip: number; take: number }) =>
        avisos.filter((n) => coincide(n, where)).sort((a, b) => +b.createdAt - +a.createdAt).slice(skip, skip + take)),
      count: vi.fn(async ({ where }: { where: Partial<Aviso> }) => avisos.filter((n) => coincide(n, where)).length),
      updateMany: vi.fn(async ({ where, data }: { where: Partial<Aviso>; data: Partial<Aviso> }) => {
        const filas = avisos.filter((n) => coincide(n, where));
        filas.forEach((n) => Object.assign(n, data));
        return { count: filas.length };
      }),
      findFirst: vi.fn(async ({ where }: { where: Partial<Aviso> }) => avisos.find((n) => coincide(n, where)) ?? null),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { service: new NotificationsService(db as never), avisos };
}

describe('H26. Bandeja de notificaciones', () => {
  it('AC1: cada aviso trae título, mensaje, módulo de origen, fecha de creación y estado', async () => {
    const { service } = crearServicio([aviso('a', 'cliente-1', 10)]);

    const { data } = await service.list(CLIENTE, {});

    expect(data[0]).toMatchObject({ title: 'Aviso a', message: 'Pedido listo', sourceModule: 'COCINA', status: 'NO_LEIDA' });
    expect(data[0].createdAt).toBeInstanceOf(Date);
  });

  it('AC2: ordena del más reciente al más antiguo en páginas de 10', async () => {
    const lista = Array.from({ length: 12 }, (_, i) => aviso(`a${i}`, 'cliente-1', i));
    const { service } = crearServicio(lista);

    const primera = await service.list(CLIENTE, {});
    const segunda = await service.list(CLIENTE, { page: 2 });

    expect(primera.data).toHaveLength(10);
    expect(primera.data[0].id).toBe('a11');
    expect(segunda.data.map((n) => n.id)).toEqual(['a1', 'a0']);
    expect(primera).toMatchObject({ total: 12, limit: 10 });
  });

  it('AC3: filtra por estado y por módulo; sin filtro devuelve Todas', async () => {
    const { service } = crearServicio([
      aviso('a', 'cliente-1', 1),
      aviso('b', 'cliente-1', 2, NotificationStatus.LEIDA, NotificationSource.RESERVAS),
    ]);

    expect((await service.list(CLIENTE, {})).total).toBe(2);
    expect((await service.list(CLIENTE, { status: 'LEIDA' })).data.map((n) => n.id)).toEqual(['b']);
    expect((await service.list(CLIENTE, { sourceModule: NotificationSource.COCINA })).data.map((n) => n.id)).toEqual(['a']);
    const errores = await validate(plainToInstance(ListNotificationsQueryDto, { status: 'BORRADA' }));
    expect(errores[0].property).toBe('status');
  });

  it('AC4: el contador del encabezado devuelve la cantidad de avisos No leída del usuario', async () => {
    const { service } = crearServicio([
      aviso('a', 'cliente-1', 1), aviso('b', 'cliente-1', 2),
      aviso('c', 'cliente-1', 3, NotificationStatus.LEIDA), aviso('d', 'otro-1', 4),
    ]);

    expect(await service.unreadCount(CLIENTE)).toEqual({ count: 2 });
  });

  it('AC5: abrir un aviso lo pasa a Leída con fecha de lectura y "Marcar todas" cambia todos los No leída', async () => {
    const { service, avisos } = crearServicio([aviso('a', 'cliente-1', 1), aviso('b', 'cliente-1', 2), aviso('c', 'cliente-1', 3)]);

    const leido = await service.read(CLIENTE, 'a');
    const todas = await service.readAll(CLIENTE);

    expect(leido.status).toBe('LEIDA');
    expect(leido.readAt).toBeInstanceOf(Date);
    expect(todas).toEqual({ updated: 2 });
    expect(avisos.every((n) => n.status === 'LEIDA')).toBe(true);
  });

  it('AC6: un aviso Leída no vuelve a No leída y conserva su fecha de lectura al abrirlo otra vez', async () => {
    const { service } = crearServicio([aviso('a', 'cliente-1', 1)]);

    const primera = await service.read(CLIENTE, 'a');
    const fecha = primera.readAt;
    const segunda = await service.read(CLIENTE, 'a');

    expect(segunda).toMatchObject({ status: 'LEIDA', readAt: fecha });
  });

  it('AC7: un usuario no ve ni marca avisos de otro: responde que el aviso no existe', async () => {
    const { service, avisos } = crearServicio([aviso('ajeno', 'otro-1', 1)]);

    await expect(service.read(CLIENTE, 'ajeno')).rejects.toThrow(new NotFoundException('El aviso no existe'));
    expect((await service.list(CLIENTE, {})).data).toEqual([]);
    expect(avisos[0].status).toBe('NO_LEIDA');
    expect((await service.list(OTRO, {})).total).toBe(1);
  });

  it('AC8: sin avisos con los filtros elegidos devuelve una lista vacía (la pantalla muestra "No tienes notificaciones.")', async () => {
    const { service } = crearServicio([aviso('a', 'cliente-1', 1)]);

    expect(await service.list(CLIENTE, { sourceModule: NotificationSource.INVENTARIO })).toMatchObject({ data: [], total: 0 });
  });

  it('AC9: un rol sin eventos (Cocina) ve la bandeja vacía y el contador en 0', async () => {
    const { service } = crearServicio([aviso('a', 'cliente-1', 1)]);
    const cocina = { id: 'cocina-1' } as never;

    expect(await service.list(cocina, {})).toMatchObject({ data: [], total: 0 });
    expect(await service.unreadCount(cocina)).toEqual({ count: 0 });
  });
});
