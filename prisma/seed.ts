
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { NotificationSource, NotificationStatus, PrismaClient, UnitOfMeasure, UserRole } from '../src/generated/prisma/client.js';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'Demo1234!';

const GERENTE_EMAIL = 'gerente@example.com';
const MESERO_EMAIL = 'mesero@example.com';
const COCINA_EMAIL = 'cocina@example.com';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  // ==========================================
  // USUARIO DEMO - CLIENTE
  // ==========================================

  const demoPasswordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const demo = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      passwordHash: demoPasswordHash,
      role: UserRole.CLIENTE,
    },
  });

  console.log(`Usuario demo listo: ${demo.email}`);

  // ==========================================
  // USUARIO GERENTE
  // ==========================================

  const gerentePassword = process.env.SEED_GERENTE_PASSWORD;

  if (!gerentePassword || gerentePassword.length < 8) {
    throw new Error(
      'Configura SEED_GERENTE_PASSWORD con al menos 8 caracteres.',
    );
  }

  const gerente = await prisma.user.upsert({
    where: { email: GERENTE_EMAIL },
    update: {},
    create: {
      email: GERENTE_EMAIL,
      passwordHash: await bcrypt.hash(gerentePassword, 12),
      role: UserRole.GERENTE,
    },
  });

  console.log(`Usuario gerente listo: ${gerente.email}`);
  console.log(`Rol: ${gerente.role}`);

  // ==========================================
  // USUARIO MESERO - H4
  // ==========================================

  const meseroPassword = process.env.SEED_MESERO_PASSWORD;

  if (!meseroPassword || meseroPassword.length < 8) {
    throw new Error(
      'Configura SEED_MESERO_PASSWORD con al menos 8 caracteres.',
    );
  }

  const mesero = await prisma.user.upsert({
    where: { email: MESERO_EMAIL },
    update: { role: UserRole.MESERO },
    create: {
      email: MESERO_EMAIL,
      passwordHash: await bcrypt.hash(meseroPassword, 12),
      role: UserRole.MESERO,
    },
  });

  // ==========================================
  // USUARIO COCINA - H4
  // ==========================================

  const cocinaPassword = process.env.SEED_COCINA_PASSWORD;

  if (!cocinaPassword || cocinaPassword.length < 8) {
    throw new Error(
      'Configura SEED_COCINA_PASSWORD con al menos 8 caracteres.',
    );
  }

  const cocina = await prisma.user.upsert({
    where: { email: COCINA_EMAIL },
    update: { role: UserRole.COCINA },
    create: {
      email: COCINA_EMAIL,
      passwordHash: await bcrypt.hash(cocinaPassword, 12),
      role: UserRole.COCINA,
    },
  });

  // ==========================================
  // SUCURSALES Y ASIGNACIÓN DE PERSONAL
  // ==========================================

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

  if (branches.length === 0) {
    throw new Error(
      'No hay sucursales activas. Carga las sucursales antes de ejecutar el seed H4.',
    );
  }

  // Utilizar la sucursal asignada previamente al mesero.
  const existingAssignment = await prisma.staffBranch.findFirst({
    where: { userId: mesero.id },
    include: { branch: true },
  });

  const assignedBranch =
    existingAssignment?.branch ??
    branches[0];

  await prisma.staffBranch.upsert({
    where: {
      userId_branchId: {
        userId: mesero.id,
        branchId: assignedBranch.id,
      },
    },
    update: {},
    create: {
      userId: mesero.id,
      branchId: assignedBranch.id,
    },
  });

  await prisma.staffBranch.upsert({
    where: {
      userId_branchId: {
        userId: cocina.id,
        branchId: assignedBranch.id,
      },
    },
    update: {},
    create: {
      userId: cocina.id,
      branchId: assignedBranch.id,
    },
  });

  // ==========================================
  // MESAS DE PRUEBA
  // ==========================================

  for (const branch of branches) {
    const tables = [
      [1, 2],
      [2, 4],
      [3, 6],
      [4, 8],
    ];

    for (const [number, capacity] of tables) {
      await prisma.restaurantTable.upsert({
        where: {
          branchId_number: {
            branchId: branch.id,
            number,
          },
        },
        update: {},
        create: {
          branchId: branch.id,
          number,
          capacity,
        },
      });
    }
  }

  // ==========================================
  // H14 - GERENTE POR SUCURSAL E INVENTARIO DE PRUEBA
  // ==========================================

  // El gerente necesita una sucursal para registrar movimientos de inventario.
  const gerenteAssignment = await prisma.staffBranch.findFirst({
    where: { userId: gerente.id },
  });

  if (!gerenteAssignment) {
    await prisma.staffBranch.create({
      data: { userId: gerente.id, branchId: assignedBranch.id },
    });
  }

  const supplies: Array<[string, UnitOfMeasure, number, number]> = [
    ['Tomate', UnitOfMeasure.KG, 20, 5],
    ['Queso mozzarella', UnitOfMeasure.KG, 10, 3],
    ['Harina', UnitOfMeasure.KG, 25, 10],
    ['Aceite', UnitOfMeasure.L, 8, 2],
    ['Huevos', UnitOfMeasure.UNIDAD, 120, 30],
  ];

  const normalize = (text: string) =>
    text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  for (const [name, unit, quantity, minimumStock] of supplies) {
    const supply = await prisma.supply.upsert({
      where: { name },
      update: {},
      create: { name, searchName: normalize(name), unit },
    });

    for (const branch of branches) {
      // En la sucursal del gerente el tomate inicia bajo el mínimo,
      // para probar el estado "Por agotarse".
      const initial =
        branch.id === assignedBranch.id && name === 'Tomate' ? 4 : quantity;

      await prisma.branchInventory.upsert({
        where: {
          branchId_supplyId: { branchId: branch.id, supplyId: supply.id },
        },
        update: {},
        create: {
          branchId: branch.id,
          supplyId: supply.id,
          quantity: initial,
          minimumStock,
        },
      });
    }
  }

  // ==========================================
  // H26 - AVISOS DE PRUEBA PARA LA BANDEJA
  // 3 para el cliente, 3 para el mesero y 1 para el gerente,
  // con estados No leída y Leída (tabla de eventos de la Épica 9).
  // ==========================================

  const hace = (horas: number) => new Date(Date.now() - horas * 60 * 60 * 1000);

  const avisos = [
    { id: 'seed-aviso-cliente-1', recipientId: demo.id, sourceModule: NotificationSource.COCINA, title: 'Pedido listo', message: `Tu pedido ${assignedBranch.code ?? 'SE'}-1045 está listo para recoger.`, leida: false, horas: 1 },
    { id: 'seed-aviso-cliente-2', recipientId: demo.id, sourceModule: NotificationSource.RESERVAS, title: 'Reservación confirmada', message: `Tu reservación para 4 personas en ${assignedBranch.name} el 10/11/2026 a las 19:00 está confirmada.`, leida: false, horas: 5 },
    { id: 'seed-aviso-cliente-3', recipientId: demo.id, sourceModule: NotificationSource.RESERVAS, title: 'Reservación confirmada', message: `Tu reservación para 2 personas en ${assignedBranch.name} el 01/11/2026 a las 13:00 está confirmada.`, leida: true, horas: 48 },
    { id: 'seed-aviso-mesero-1', recipientId: mesero.id, sourceModule: NotificationSource.COCINA, title: 'Pedido listo', message: 'El pedido de la mesa 4 está listo para entregar.', leida: false, horas: 1 },
    { id: 'seed-aviso-mesero-2', recipientId: mesero.id, sourceModule: NotificationSource.COCINA, title: 'Platillo agotado', message: 'Hamburguesa clásica se agotó. Revise las comandas activas que lo contienen y sustitúyalo o cancélelo.', leida: false, horas: 3 },
    { id: 'seed-aviso-mesero-3', recipientId: mesero.id, sourceModule: NotificationSource.COCINA, title: 'Pedido listo', message: 'El pedido de la mesa 2 está listo para entregar.', leida: true, horas: 24 },
    { id: 'seed-aviso-gerente-1', recipientId: gerente.id, sourceModule: NotificationSource.INVENTARIO, title: 'Insumo por agotarse', message: `Tomate llegó a su stock mínimo (4 kg) en ${assignedBranch.name}.`, leida: false, horas: 2, referenceType: 'InventoryAlert' },
  ];

  for (const aviso of avisos) {
    await prisma.notification.upsert({
      where: { id: aviso.id },
      update: {},
      create: {
        id: aviso.id,
        recipientId: aviso.recipientId,
        title: aviso.title,
        message: aviso.message,
        sourceModule: aviso.sourceModule,
        referenceType: aviso.referenceType ?? null,
        referenceId: aviso.referenceType ? 'seed-alerta-tomate' : null,
        status: aviso.leida ? NotificationStatus.LEIDA : NotificationStatus.NO_LEIDA,
        createdAt: hace(aviso.horas),
        readAt: aviso.leida ? hace(aviso.horas - 1) : null,
      },
    });
  }

  console.log(
    `Mesero listo: ${mesero.email}; sucursal asignada: ${assignedBranch.name}`,
  );

  console.log(
    `Cocina lista: ${cocina.email}; sucursal asignada: ${assignedBranch.name}`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
