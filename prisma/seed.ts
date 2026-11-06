
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../src/generated/prisma/client.js';

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
