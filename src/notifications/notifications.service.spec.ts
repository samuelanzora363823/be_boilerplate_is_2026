import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationSource } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/services/prisma.service.js';
import { NotificationsService } from './notifications.service.js';
import type { SendNotificationInput } from './notifications.service.js';

const CLIENTE = '11111111-1111-4111-8111-111111111111';
const MESERO = '22222222-2222-4222-8222-222222222222';

function crearServicio(usuariosActivos: string[]) {
  const creadas: unknown[] = [];
  const db = {
    user: {
      findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in.filter((id) => usuariosActivos.includes(id)).map((id) => ({ id })),
        ),
      ),
    },
    notification: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const fila = { id: `n${creadas.length + 1}`, status: 'NO_LEIDA', createdAt: new Date(), readAt: null, ...data };
        return fila;
      }),
    },
    $transaction: vi.fn((operaciones: unknown[]) => {
      creadas.push(...operaciones);
      return Promise.resolve(operaciones);
    }),
  };

  return { service: new NotificationsService(db as unknown as PrismaService), db, creadas };
}

const base: SendNotificationInput = {
  recipientIds: [CLIENTE],
  title: 'Reservación confirmada',
  message: 'Tu reservación para 4 personas en Escalón el 10/11/2026 a las 19:00 está confirmada.',
  sourceModule: NotificationSource.RESERVAS,
  referenceType: 'Reservation',
  referenceId: 'res-1',
};

describe('NotificationsService (H25)', () => {
  it('crea una notificación No leída por destinatario en una sola transacción', async () => {
    const { service, db } = crearServicio([CLIENTE, MESERO]);

    const resultado = await service.send({ ...base, recipientIds: [CLIENTE, MESERO] });

    expect(resultado).toHaveLength(2);
    expect(resultado.map((n) => n.recipientId)).toEqual([CLIENTE, MESERO]);
    expect(resultado.every((n) => n.status === 'NO_LEIDA')).toBe(true);
    expect(resultado.every((n) => n.createdAt instanceof Date)).toBe(true);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('acepta un aviso sin referencia', async () => {
    const { service } = crearServicio([CLIENTE]);

    const [notificacion] = await service.send({ ...base, referenceType: null, referenceId: null });

    expect(notificacion.referenceType).toBeNull();
    expect(notificacion.referenceId).toBeNull();
  });

  it.each([
    ['lista de destinatarios vacía', { recipientIds: [] }],
    ['más de 50 destinatarios', { recipientIds: Array.from({ length: 51 }, (_, i) => `id-${i}`) }],
    ['destinatarios repetidos', { recipientIds: [CLIENTE, CLIENTE] }],
    ['título vacío', { title: '   ' }],
    ['título de más de 100 caracteres', { title: 'a'.repeat(101) }],
    ['mensaje vacío', { message: '' }],
    ['mensaje de más de 500 caracteres', { message: 'a'.repeat(501) }],
    ['módulo de origen fuera del enum', { sourceModule: 'PAGOS' as NotificationSource }],
    ['tipo de referencia no permitido', { referenceType: 'Payment' as never }],
    ['referenceType sin referenceId', { referenceType: 'Order' as const, referenceId: null }],
  ])('rechaza con 400 y sin crear nada: %s', async (_caso, cambio) => {
    const { service, db } = crearServicio([CLIENTE]);

    await expect(service.send({ ...base, ...cambio })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('acepta los límites exactos de título (100) y mensaje (500)', async () => {
    const { service } = crearServicio([CLIENTE]);

    await expect(
      service.send({ ...base, title: 'a'.repeat(100), message: 'b'.repeat(500) }),
    ).resolves.toHaveLength(1);
  });

  it.each([
    ['un destinatario no existe', [CLIENTE, '33333333-3333-4333-8333-333333333333']],
    ['un destinatario está inactivo', [CLIENTE, MESERO]],
    ['el identificador no es válido', ['no-es-un-id']],
  ])('rechaza con 404 y sin crear ninguna notificación si %s', async (_caso, recipientIds) => {
    const { service, db } = crearServicio([CLIENTE]);

    await expect(service.send({ ...base, recipientIds })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('solo consulta destinatarios activos (User.isActive)', async () => {
    const { service, db } = crearServicio([CLIENTE]);

    await service.send(base);

    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
    );
  });
});
