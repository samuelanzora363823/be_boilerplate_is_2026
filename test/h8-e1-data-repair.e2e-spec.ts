import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';

/**
 * Integración PostgreSQL de la migración de datos E1 (H8).
 *
 * No carga dotenv ni lee DATABASE_URL. Solo se ejecuta si
 * H8_TEST_DATABASE_URL apunta a la base aislada local; si la variable no está
 * definida, la suite se omite.
 *
 * Todo ocurre dentro de una transacción que termina en ROLLBACK: los datos de
 * prueba y el efecto de la migración no persisten.
 */

const EXPECTED_HOST = '127.0.0.1';
const EXPECTED_PORT = '55435';
const EXPECTED_DATABASE = 'nd_h7_h8';

const MIGRATION_SQL = readFileSync(
  fileURLToPath(
    new URL(
      '../prisma/migrations/20261126090000_h8_reparar_platillos_en_preparacion/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'RECEIVED'
  | 'IN_PREPARATION'
  | 'READY'
  | 'DELIVERED'
  | 'CANCELLED';

type ItemStatus = 'RECEIVED' | 'IN_PREPARATION' | 'READY' | 'CANCELLED';

interface FixtureItem {
  id: string;
  before: ItemStatus;
  expected: ItemStatus;
}

interface FixtureOrder {
  id: string;
  status: OrderStatus;
  items: FixtureItem[];
}

function validatedTestDatabaseUrl(): string {
  const connectionString = process.env.H8_TEST_DATABASE_URL!;
  const parsed = new URL(connectionString);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    parsed.hostname !== EXPECTED_HOST ||
    parsed.port !== EXPECTED_PORT ||
    database !== EXPECTED_DATABASE
  ) {
    throw new Error(
      `H8_TEST_DATABASE_URL debe apuntar exclusivamente a ${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}.`,
    );
  }

  return connectionString;
}

function item(before: ItemStatus, expected: ItemStatus = before): FixtureItem {
  return { id: randomUUID(), before, expected };
}

describe.skipIf(!process.env.H8_TEST_DATABASE_URL)(
  'Migración H8 de reparación de datos E1 (integración PostgreSQL)',
  () => {
    let pool: Pool;
    let client: PoolClient;

    const branchId = randomUUID();
    const categoryId = randomUUID();
    const dishId = randomUUID();

    // Matriz de alcance: solo cambian los RECEIVED de la comanda IN_PREPARATION.
    const orders: FixtureOrder[] = [
      {
        id: randomUUID(),
        status: 'IN_PREPARATION',
        items: [
          item('RECEIVED', 'IN_PREPARATION'),
          item('RECEIVED', 'IN_PREPARATION'),
          item('IN_PREPARATION'),
          item('READY'),
          item('CANCELLED'),
        ],
      },
      { id: randomUUID(), status: 'RECEIVED', items: [item('RECEIVED')] },
      {
        id: randomUUID(),
        status: 'PENDING_PAYMENT',
        items: [item('RECEIVED')],
      },
      {
        id: randomUUID(),
        status: 'READY',
        items: [item('READY'), item('RECEIVED')],
      },
      {
        id: randomUUID(),
        status: 'DELIVERED',
        items: [item('READY'), item('RECEIVED')],
      },
      {
        id: randomUUID(),
        status: 'CANCELLED',
        items: [item('CANCELLED'), item('RECEIVED')],
      },
    ];

    const allItemIds = orders.flatMap((order) =>
      order.items.map((entry) => entry.id),
    );

    async function itemStatuses(): Promise<Map<string, string>> {
      const result = await client.query<{ id: string; status: string }>(
        'SELECT "id", "status"::text AS status FROM "order_items" WHERE "id" = ANY($1::uuid[])',
        [allItemIds],
      );
      return new Map(result.rows.map((row) => [row.id, row.status]));
    }

    async function orderSnapshot() {
      const result = await client.query<{
        id: string;
        status: string;
        updated_at: Date;
      }>(
        'SELECT "id", "status"::text AS status, "updated_at" FROM "orders" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"',
        [orders.map((order) => order.id)],
      );
      return result.rows;
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: validatedTestDatabaseUrl(), max: 1 });
      client = await pool.connect();
      await client.query('BEGIN');

      await client.query(
        'INSERT INTO "branches" ("id", "name") VALUES ($1, $2)',
        [branchId, `H8 E1 test ${branchId}`],
      );
      await client.query(
        'INSERT INTO "categories" ("id", "name") VALUES ($1, $2)',
        [categoryId, `H8 E1 test ${categoryId}`],
      );
      await client.query(
        `INSERT INTO "dishes" ("id", "name", "price", "category_id", "updated_at")
         VALUES ($1, 'Platillo de prueba H8', 5.00, $2, CURRENT_TIMESTAMP)`,
        [dishId, categoryId],
      );

      for (const order of orders) {
        await client.query(
          `INSERT INTO "orders" ("id", "branch_id", "status", "total", "updated_at")
           VALUES ($1, $2, $3::"OrderStatus", 5.00, TIMESTAMP '2026-01-01 00:00:00')`,
          [order.id, branchId, order.status],
        );
        for (const entry of order.items) {
          await client.query(
            `INSERT INTO "order_items"
               ("id", "order_id", "dish_id", "quantity", "unit_price", "subtotal", "status")
             VALUES ($1, $2, $3, 1, 5.00, 5.00, $4::"OrderItemStatus")`,
            [entry.id, order.id, dishId, entry.before],
          );
        }
      }
    });

    afterAll(async () => {
      if (client) {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
      if (pool) await pool.end();
    });

    it('actualiza exactamente los platillos RECEIVED de comandas IN_PREPARATION', async () => {
      const ordersBefore = await orderSnapshot();

      await client.query(MIGRATION_SQL);

      const statuses = await itemStatuses();
      for (const order of orders) {
        for (const entry of order.items) {
          expect(
            { order: order.status, before: entry.before, after: statuses.get(entry.id) },
          ).toEqual({ order: order.status, before: entry.before, after: entry.expected });
        }
      }

      // Las comandas no cambian: ni estado ni updated_at.
      expect(await orderSnapshot()).toEqual(ordersBefore);
    });

    it('es idempotente: una segunda ejecución no actualiza filas', async () => {
      const before = await itemStatuses();

      const second = await client.query(MIGRATION_SQL);

      expect(second.rowCount).toBe(0);
      expect(await itemStatuses()).toEqual(before);
    });
  },
);
