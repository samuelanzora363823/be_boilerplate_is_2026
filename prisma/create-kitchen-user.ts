
import 'dotenv/config';
import bcrypt from 'bcrypt';
import {
  PrismaClient,
  UserRole,
} from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  }),
});

async function main() {
  const email = 'cocina@example.com';
  const password = process.env.SEED_COCINA_PASSWORD;

  if (!password || password.length < 8) {
    throw new Error(
      'Configura SEED_COCINA_PASSWORD con al menos 8 caracteres.',
    );
  }

  const branch = await prisma.branch.findFirst({
    where: {
      code: 'SE',
      isActive: true,
    },
  });

  if (!branch) {
    throw new Error('No se encontró la sucursal Santa Elena (SE).');
  }

  let user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: UserRole.COCINA,
      },
    });

    console.log('Usuario de cocina creado.');
  } else {
    console.log('El usuario ya existía. No se modificó.');
  }

  await prisma.staffBranch.upsert({
    where: {
      userId_branchId: {
        userId: user.id,
        branchId: branch.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      branchId: branch.id,
    },
  });

  console.log(`Sucursal asignada: ${branch.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
