
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { AccountStatus, NotificationSource, NotificationStatus, OrderStatus, PaymentMethod, PaymentStatus, Prisma, PrismaClient, UnitOfMeasure, UserRole } from '../src/generated/prisma/client.js';

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

  // ==========================================
  // H29 - PEDIDOS DE PRUEBA PARA HORARIOS PICO
  // ==========================================

  // Pedidos ya entregados en los últimos días, a distintas horas
  // (UTC-6), más pedidos cancelados y pendientes de pago que el
  // reporte de horarios pico no debe contar.
  const hoyLocal = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const enHoraLocal = (diasAtras: number, hora: number, minuto: number) =>
    new Date(
      Date.UTC(
        hoyLocal.getUTCFullYear(),
        hoyLocal.getUTCMonth(),
        hoyLocal.getUTCDate() - diasAtras,
        hora + 6,
        minuto,
      ),
    );

  const pedidosPrueba: [number, number, number, OrderStatus][] = [
    [1, 12, 5, OrderStatus.DELIVERED], [1, 12, 40, OrderStatus.DELIVERED],
    [2, 12, 15, OrderStatus.DELIVERED], [3, 12, 30, OrderStatus.DELIVERED],
    [4, 12, 10, OrderStatus.DELIVERED], [5, 12, 50, OrderStatus.DELIVERED],
    [1, 13, 20, OrderStatus.DELIVERED], [2, 13, 5, OrderStatus.DELIVERED],
    [3, 13, 45, OrderStatus.DELIVERED], [4, 13, 30, OrderStatus.DELIVERED],
    [5, 13, 15, OrderStatus.DELIVERED],
    [1, 19, 10, OrderStatus.DELIVERED], [1, 19, 35, OrderStatus.DELIVERED],
    [2, 19, 20, OrderStatus.DELIVERED], [3, 19, 5, OrderStatus.DELIVERED],
    [4, 19, 50, OrderStatus.DELIVERED], [5, 19, 25, OrderStatus.DELIVERED],
    [1, 20, 15, OrderStatus.DELIVERED], [2, 20, 40, OrderStatus.DELIVERED],
    [3, 20, 10, OrderStatus.DELIVERED], [4, 20, 30, OrderStatus.DELIVERED],
    [2, 8, 15, OrderStatus.DELIVERED], [4, 8, 45, OrderStatus.DELIVERED],
    [3, 15, 30, OrderStatus.DELIVERED],
    [1, 18, 10, OrderStatus.CANCELLED], [2, 18, 20, OrderStatus.CANCELLED],
    [3, 18, 30, OrderStatus.PENDING_PAYMENT],
  ];

  for (const [i, [diasAtras, hora, minuto, status]] of pedidosPrueba.entries()) {
    const id = `29000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    await prisma.order.upsert({
      where: { id },
      update: {},
      create: {
        id,
        branchId: assignedBranch.id,
        status,
        total: 12.5,
        createdAt: enHoraLocal(diasAtras, hora, minuto),
      },
    });
  }

  // ==========================================
  // H27 - COMPROBANTES DE PRUEBA PARA EL REPORTE DE VENTAS
  // Pedidos para llevar pagados con tarjeta, con su pago aprobado y su
  // comprobante en cada sucursal, con el mismo cálculo de H18 (IVA 13 %). El correlativo de la sucursal avanza
  // igual que en un cobro real, para no repetir números.
  // ==========================================

  const ventasPrueba: [number, number, number][] = [
    // [sucursal (índice), días atrás, subtotal]
    [0, 1, 18.5], [0, 2, 32], [0, 3, 12.75], [0, 4, 45.2],
    [1, 1, 22], [1, 1, 15.5], [1, 2, 60], [1, 3, 27.3], [1, 5, 38.9], [1, 6, 9.75],
  ];
  const sucursalesVenta = [
    branches.find((b) => b.id !== assignedBranch.id) ?? assignedBranch,
    assignedBranch,
  ];

  for (const [i, [indice, diasAtras, monto]] of ventasPrueba.entries()) {
    const receiptId = `27000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const existe = await prisma.receipt.findUnique({ where: { id: receiptId } });
    if (existe) continue;

    const sucursal = sucursalesVenta[indice];
    const subtotal = new Prisma.Decimal(monto);
    const tax = subtotal.mul(0.13).toDecimalPlaces(2);
    const total = subtotal.plus(tax).toDecimalPlaces(2);
    const fecha = enHoraLocal(diasAtras, 13, i * 5);

    await prisma.$transaction(async (tx) => {
      const { receiptCounter } = await tx.branch.update({
        where: { id: sucursal.id },
        data: { receiptCounter: { increment: 1 } },
        select: { receiptCounter: true },
      });
      const order = await tx.order.create({
        data: {
          id: `27200000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
          branchId: sucursal.id,
          status: OrderStatus.DELIVERED,
          total,
          createdAt: fecha,
        },
      });
      const payment = await tx.payment.create({
        data: {
          id: `27100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
          branchId: sucursal.id,
          orderId: order.id,
          userId: mesero.id,
          method: PaymentMethod.CARD,
          status: PaymentStatus.APPROVED,
          amount: total,
          cardLast4: '4242',
          createdAt: fecha,
        },
      });
      await tx.receipt.create({
        data: {
          id: receiptId,
          branchId: sucursal.id,
          paymentId: payment.id,
          orderId: order.id,
          receiptNumber: receiptCounter,
          issuedAt: fecha,
          subtotal,
          discount: 0,
          tax,
          total,
          paymentMethod: PaymentMethod.CARD,
          items: [
            { productName: 'Consumo de prueba', quantity: 1, unitPrice: monto, subtotal: monto },
          ],
        },
      });
    });
  }

  // ==========================================
  // H28 - VENTAS CON PLATILLOS PARA EL RANKING
  // Usa los platillos activos del menú (H1): pedidos para llevar pagados
  // y una cuenta de mesa pagada con un pedido cancelado, que el reporte
  // no debe contar. Si el menú está vacío, no se crean.
  // ==========================================

  const platillos = await prisma.dish.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    take: 12,
  });

  if (platillos.length === 0) {
    console.warn('No hay platillos activos; no se crearon las ventas de prueba de H28.');
  } else {
    const p = (i: number) => platillos[i % platillos.length];
    const idH28 = (prefijo: string, n: number) =>
      `${prefijo}-0000-4000-8000-${String(n).padStart(12, '0')}`;
    let item = 0;

    // Crea pedidos con sus platillos y los cobra con un solo pago y comprobante.
    const vender = async (
      n: number,
      diasAtras: number,
      pedidos: { cancelado?: boolean; items: [number, number][] }[],
      mesa?: { tableId: string },
    ) => {
      const receiptId = idH28('28300000', n);
      if (await prisma.receipt.findUnique({ where: { id: receiptId } })) return;
      const fecha = enHoraLocal(diasAtras, 19, n);

      await prisma.$transaction(async (tx) => {
        const account = mesa
          ? await tx.account.create({
              data: {
                id: idH28('28500000', n),
                branchId: assignedBranch.id,
                tableId: mesa.tableId,
                waiterId: mesero.id,
                status: AccountStatus.PAID,
                createdAt: fecha,
              },
            })
          : null;

        let subtotal = new Prisma.Decimal(0);
        const detalle: { productName: string; quantity: number; unitPrice: number; subtotal: number }[] = [];
        let primerPedido = '';

        for (const [k, pedido] of pedidos.entries()) {
          const lineas = pedido.items.map(([indice, cantidad]) => {
            const dish = p(indice);
            return { dish, cantidad, sub: dish.price.mul(cantidad) };
          });
          const totalPedido = lineas.reduce((t, l) => t.plus(l.sub), new Prisma.Decimal(0));
          const order = await tx.order.create({
            data: {
              id: idH28('28100000', n * 10 + k),
              branchId: assignedBranch.id,
              accountId: account?.id ?? null,
              status: pedido.cancelado ? OrderStatus.CANCELLED : OrderStatus.DELIVERED,
              total: totalPedido,
              createdAt: fecha,
              items: {
                create: lineas.map((l) => ({
                  id: idH28('28400000', ++item + n * 100),
                  dishId: l.dish.id,
                  quantity: l.cantidad,
                  unitPrice: l.dish.price,
                  subtotal: l.sub,
                })),
              },
            },
          });
          if (!primerPedido) primerPedido = order.id;
          if (pedido.cancelado) continue;
          subtotal = subtotal.plus(totalPedido);
          for (const l of lineas) {
            detalle.push({
              productName: l.dish.name,
              quantity: l.cantidad,
              unitPrice: l.dish.price.toNumber(),
              subtotal: l.sub.toNumber(),
            });
          }
        }

        const tax = subtotal.mul(0.13).toDecimalPlaces(2);
        const total = subtotal.plus(tax).toDecimalPlaces(2);
        const { receiptCounter } = await tx.branch.update({
          where: { id: assignedBranch.id },
          data: { receiptCounter: { increment: 1 } },
          select: { receiptCounter: true },
        });
        const payment = await tx.payment.create({
          data: {
            id: idH28('28200000', n),
            branchId: assignedBranch.id,
            accountId: account?.id ?? null,
            orderId: account ? null : primerPedido,
            userId: mesero.id,
            method: PaymentMethod.CASH,
            status: PaymentStatus.APPROVED,
            amount: total,
            amountReceived: total,
            createdAt: fecha,
          },
        });
        await tx.receipt.create({
          data: {
            id: receiptId,
            branchId: assignedBranch.id,
            paymentId: payment.id,
            accountId: account?.id ?? null,
            orderId: account ? null : primerPedido,
            receiptNumber: receiptCounter,
            issuedAt: fecha,
            subtotal,
            discount: 0,
            tax,
            total,
            paymentMethod: PaymentMethod.CASH,
            items: detalle,
          },
        });
      });
    };

    // [índice de platillo, cantidad]
    await vender(1, 1, [{ items: [[0, 3], [3, 2]] }]);
    await vender(2, 2, [{ items: [[0, 2], [5, 4]] }]);
    await vender(3, 3, [{ items: [[1, 3], [6, 1]] }]);
    await vender(4, 4, [{ items: [[2, 5], [7, 2], [8, 1]] }]);
    await vender(5, 5, [{ items: [[9, 1], [10, 2], [11, 1]] }]);

    const mesa = await prisma.restaurantTable.findFirst({
      where: { branchId: assignedBranch.id },
      orderBy: { number: 'asc' },
    });
    if (mesa) {
      // Cuenta de mesa: el segundo pedido está cancelado y no cuenta.
      await vender(6, 2, [
        { items: [[0, 2], [4, 3]] },
        { cancelado: true, items: [[1, 10]] },
      ], { tableId: mesa.id });
    }
  }

  // ==========================================
  // H30 - TERCERA SUCURSAL, VENTAS BAJAS Y RESEÑAS
  // Al menos 3 sucursales con ventas de distinto monto, para que una
  // quede marcada como "Requiere atención", y reseñas del cliente de
  // prueba sobre sus compras (una por compra, calificación de 1 a 5).
  // ==========================================

  const santaTecla = await prisma.branch.upsert({
    where: { name: 'Santa Tecla' },
    update: {},
    create: { name: 'Santa Tecla', code: 'ST' },
  });

  const ventasSantaTecla: [number, number][] = [
    // [días atrás, subtotal]
    [2, 8.5],
    [4, 6.25],
  ];

  for (const [i, [diasAtras, monto]] of ventasSantaTecla.entries()) {
    const n = String(i + 1).padStart(12, '0');
    const receiptId = `30300000-0000-4000-8000-${n}`;
    if (await prisma.receipt.findUnique({ where: { id: receiptId } })) continue;

    const subtotal = new Prisma.Decimal(monto);
    const tax = subtotal.mul(0.13).toDecimalPlaces(2);
    const total = subtotal.plus(tax).toDecimalPlaces(2);
    const fecha = enHoraLocal(diasAtras, 12, i * 7);

    await prisma.$transaction(async (tx) => {
      const { receiptCounter } = await tx.branch.update({
        where: { id: santaTecla.id },
        data: { receiptCounter: { increment: 1 } },
        select: { receiptCounter: true },
      });
      const order = await tx.order.create({
        data: {
          id: `30100000-0000-4000-8000-${n}`,
          branchId: santaTecla.id,
          status: OrderStatus.DELIVERED,
          total,
          createdAt: fecha,
        },
      });
      const payment = await tx.payment.create({
        data: {
          id: `30200000-0000-4000-8000-${n}`,
          branchId: santaTecla.id,
          orderId: order.id,
          userId: mesero.id,
          method: PaymentMethod.CARD,
          status: PaymentStatus.APPROVED,
          amount: total,
          cardLast4: '4242',
          createdAt: fecha,
        },
      });
      await tx.receipt.create({
        data: {
          id: receiptId,
          branchId: santaTecla.id,
          paymentId: payment.id,
          orderId: order.id,
          receiptNumber: receiptCounter,
          issuedAt: fecha,
          subtotal,
          discount: 0,
          tax,
          total,
          paymentMethod: PaymentMethod.CARD,
          items: [
            { productName: 'Consumo de prueba', quantity: 1, unitPrice: monto, subtotal: monto },
          ],
        },
      });
    });
  }

  // Reseñas sobre compras pagadas (pedidos para llevar de H27 y H30).
  const resenas: [string, number, string][] = [
    // [pedido reseñado, calificación, comentario]
    ['27200000-0000-4000-8000-000000000001', 4, 'Buena atención.'],
    ['27200000-0000-4000-8000-000000000002', 5, 'Todo excelente.'],
    ['27200000-0000-4000-8000-000000000005', 5, 'Muy rápido.'],
    ['27200000-0000-4000-8000-000000000006', 4, 'Rico, volvería.'],
    ['27200000-0000-4000-8000-000000000007', 3, 'La comida llegó fría.'],
    ['30100000-0000-4000-8000-000000000001', 2, 'Tardaron mucho.'],
  ];

  for (const [i, [orderId, rating, comment]] of resenas.entries()) {
    const id = `30400000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const pedido = await prisma.order.findUnique({
      where: { id: orderId },
      select: { branchId: true, createdAt: true },
    });
    if (!pedido) continue;
    await prisma.review.upsert({
      where: { id },
      update: {},
      create: {
        id,
        userId: demo.id,
        orderId,
        branchId: pedido.branchId,
        rating,
        comment,
        createdAt: new Date(pedido.createdAt.getTime() + 60 * 60 * 1000),
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
