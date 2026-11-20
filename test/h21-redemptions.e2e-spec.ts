import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { LoyaltyRepository } from '../src/loyalty/loyalty.repository.js';

/**
 * PostgreSQL integration tests for the H21 database triggers.
 *
 * This file intentionally does not load dotenv and never reads DATABASE_URL.
 * H21_TEST_DATABASE_URL must point to a dedicated local test database.
 */

const EXPECTED_HOST = '127.0.0.1';
const EXPECTED_PORT = '55432';
const EXPECTED_DATABASE = 'be_h21_test';
const POINTS_RESERVED = 100;

interface Fixture {
  userId: string;
  branchId: string;
  orderId: string;
  loyaltyAccountId: string;
  redemptionId: string;
}

function validatedTestDatabaseUrl(): string {
  const connectionString = process.env.H21_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'H21_TEST_DATABASE_URL es obligatorio; no se admite fallback a DATABASE_URL ni a .env.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('H21_TEST_DATABASE_URL no es una URL PostgreSQL válida.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    parsed.hostname !== EXPECTED_HOST ||
    parsed.port !== EXPECTED_PORT ||
    database !== EXPECTED_DATABASE
  ) {
    throw new Error(
      `H21_TEST_DATABASE_URL debe apuntar exclusivamente a PostgreSQL en ${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}.`,
    );
  }

  return connectionString;
}

async function transaction<T>(
  client: PoolClient,
  callback: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await callback();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

describe('H21 PostgreSQL lifecycle triggers (integration)', () => {
  let pool: Pool | undefined;
  let prisma: PrismaClient | undefined;
  let loyaltyRepository: LoyaltyRepository | undefined;

  function testPool(): Pool {
    if (!pool) throw new Error('El pool PostgreSQL H21 no está inicializado.');
    return pool;
  }

  function testRepository(): LoyaltyRepository {
    if (!loyaltyRepository) {
      throw new Error('El repositorio Prisma H21 no está inicializado.');
    }
    return loyaltyRepository;
  }

  beforeAll(async () => {
    const connectionString = validatedTestDatabaseUrl();
    pool = new Pool({ connectionString, max: 5 });
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });
    loyaltyRepository = new LoyaltyRepository(prisma as never);

    const schema = await testPool().query(`
      SELECT current_database() AS database,
             to_regclass('public.loyalty_redemptions')::text AS redemptions,
             to_regclass('public.loyalty_redemption_movements')::text AS movements,
             to_regclass('public.loyalty_accounts')::text AS accounts,
             to_regclass('public.orders')::text AS orders,
             to_regclass('public.payments')::text AS payments
    `);
    const installed = schema.rows[0] as {
      database: string;
      redemptions: string | null;
      movements: string | null;
      accounts: string | null;
      orders: string | null;
      payments: string | null;
    };
    if (
      installed.database !== EXPECTED_DATABASE ||
      !installed.redemptions ||
      !installed.movements ||
      !installed.accounts ||
      !installed.orders ||
      !installed.payments
    ) {
      throw new Error(
        'La base exclusiva no tiene las tablas H18/H20/H21 requeridas. Prepara el esquema de pruebas por separado antes de ejecutar esta suite.',
      );
    }

    const triggers = await testPool().query(`
      SELECT COUNT(*)::text AS count
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'loyalty_redemption_integrity_trigger',
          'loyalty_redemption_movement_integrity_trigger',
          'loyalty_redemption_lifecycle_constraint',
          'loyalty_redemption_movement_lifecycle_constraint',
          'loyalty_account_reserved_points_constraint',
          'payment_redemption_lifecycle_constraint'
        )
    `);
    if (Number((triggers.rows[0] as { count: string }).count) !== 6) {
      throw new Error(
        'No están instalados todos los triggers H21 requeridos en la base exclusiva.',
      );
    }
  });

  afterAll(async () => {
    if (prisma) {
      const currentPrisma = prisma;
      prisma = undefined;
      await currentPrisma.$disconnect();
    }
    if (pool) {
      const currentPool = pool;
      pool = undefined;
      await currentPool.end();
    }
  });

  async function createFixture(): Promise<Fixture> {
    const fixture: Fixture = {
      userId: randomUUID(),
      branchId: randomUUID(),
      orderId: randomUUID(),
      loyaltyAccountId: randomUUID(),
      redemptionId: randomUUID(),
    };
    const client = await testPool().connect();
    try {
      await transaction(client, async () => {
        await client.query(
          `INSERT INTO "users" ("id", "email", "password_hash", "role", "updated_at")
           VALUES ($1, $2, 'integration-test-hash', 'CLIENTE', CURRENT_TIMESTAMP)`,
          [fixture.userId, `h21-${fixture.userId}@integration.test`],
        );
        await client.query(
          `INSERT INTO "branches" ("id", "name", "code")
           VALUES ($1, $2, $3)`,
          [fixture.branchId, `H21 test ${fixture.branchId}`, `H21-${fixture.branchId.slice(0, 6)}`],
        );
        await client.query(
          `INSERT INTO "orders"
             ("id", "customer_id", "order_number", "branch_id", "status", "total", "updated_at")
           VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', 10.00, CURRENT_TIMESTAMP)`,
          [
            fixture.orderId,
            fixture.userId,
            `H21-${fixture.orderId}`,
            fixture.branchId,
          ],
        );
        await client.query(
          `INSERT INTO "loyalty_accounts" ("id", "user_id", "balance", "reserved_points", "updated_at")
           VALUES ($1, $2, 1000, 0, CURRENT_TIMESTAMP)`,
          [fixture.loyaltyAccountId, fixture.userId],
        );
      });
    } finally {
      client.release();
    }
    return fixture;
  }

  async function cleanupFixture(fixture: Fixture): Promise<void> {
    const client = await testPool().connect();
    try {
      await transaction(client, async () => {
        // This database is reserved exclusively for this sequential suite.
        // TRUNCATE does not fire the movement table's row-level immutability
        // trigger; no application or development data can be present here.
        await client.query('TRUNCATE TABLE "loyalty_redemption_movements"');
        await client.query(
          'DELETE FROM "loyalty_redemptions" WHERE "id" = $1',
          [fixture.redemptionId],
        );
        await client.query('DELETE FROM "payments" WHERE "order_id" = $1', [
          fixture.orderId,
        ]);
        await client.query('DELETE FROM "loyalty_accounts" WHERE "id" = $1', [
          fixture.loyaltyAccountId,
        ]);
        await client.query('DELETE FROM "orders" WHERE "id" = $1', [
          fixture.orderId,
        ]);
        await client.query('DELETE FROM "branches" WHERE "id" = $1', [
          fixture.branchId,
        ]);
        await client.query('DELETE FROM "users" WHERE "id" = $1', [
          fixture.userId,
        ]);
      });
    } finally {
      client.release();
    }
  }

  async function withFixture(
    run: (fixture: Fixture) => Promise<void>,
  ): Promise<void> {
    const fixture = await createFixture();
    let testFailed = false;
    let testError: unknown;
    try {
      await run(fixture);
    } catch (error) {
      testFailed = true;
      testError = error;
    }

    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      await cleanupFixture(fixture);
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    }

    if (testFailed) {
      if (cleanupFailed) {
        console.error('La limpieza del fixture H21 también falló:', cleanupError);
      }
      throw testError;
    }
    if (cleanupFailed) throw cleanupError;
  }

  async function reserveFixture(
    fixture: Fixture,
    expired = false,
  ): Promise<void> {
    const client = await testPool().connect();
    try {
      await transaction(client, async () => {
        await client.query(
          `UPDATE "loyalty_accounts"
           SET "reserved_points" = "reserved_points" + $2,
               "updated_at" = CURRENT_TIMESTAMP
           WHERE "id" = $1`,
          [fixture.loyaltyAccountId, POINTS_RESERVED],
        );
        await client.query(
          `INSERT INTO "loyalty_redemptions"
             ("id", "loyalty_account_id", "benefit_id", "order_id",
              "points_reserved", "subtotal_amount", "discount_amount",
              "status", "created_at", "expires_at", "updated_at")
           VALUES ($1, $2, $3, $4, $5, 10.00, 2.00, 'RESERVED',
                   ${expired ? "CURRENT_TIMESTAMP - INTERVAL '16 minutes'" : 'CURRENT_TIMESTAMP'},
                   ${expired ? "CURRENT_TIMESTAMP - INTERVAL '1 minute'" : "CURRENT_TIMESTAMP + INTERVAL '15 minutes'"},
                   CURRENT_TIMESTAMP)`,
          [
            fixture.redemptionId,
            fixture.loyaltyAccountId,
            randomUUID(), // H21 has no benefit FK until H22.
            fixture.orderId,
            POINTS_RESERVED,
          ],
        );
        await client.query(
          `INSERT INTO "loyalty_redemption_movements"
             ("id", "redemption_id", "loyalty_account_id", "type", "points", "idempotency_key")
           VALUES ($1, $2, $3, 'RESERVED', $4, $5)`,
          [
            randomUUID(),
            fixture.redemptionId,
            fixture.loyaltyAccountId,
            POINTS_RESERVED,
            `${fixture.redemptionId}:RESERVED`,
          ],
        );
      });
    } finally {
      client.release();
    }
  }

  async function createPayment(
    client: PoolClient,
    fixture: Fixture,
    status: 'APPROVED' | 'REJECTED' = 'APPROVED',
  ): Promise<string> {
    const paymentId = randomUUID();
    await client.query(
      `INSERT INTO "payments"
         ("id", "branch_id", "order_id", "user_id", "method", "status", "amount")
       VALUES ($1, $2, $3, $4, 'CARD', $5, 10.00)`,
      [paymentId, fixture.branchId, fixture.orderId, fixture.userId, status],
    );
    return paymentId;
  }

  async function readState(fixture: Fixture) {
    const result = await testPool().query(
      `SELECT la."balance", la."reserved_points", r."status",
              COALESCE(json_agg(json_build_object('type', m."type", 'points', m."points"))
                FILTER (WHERE m."id" IS NOT NULL), '[]'::json) AS movements
       FROM "loyalty_accounts" la
       JOIN "loyalty_redemptions" r ON r."loyalty_account_id" = la."id"
       LEFT JOIN "loyalty_redemption_movements" m ON m."redemption_id" = r."id"
       WHERE la."id" = $1 AND r."id" = $2
       GROUP BY la."id", r."id"`,
      [fixture.loyaltyAccountId, fixture.redemptionId],
    );
    return result.rows[0] as {
      balance: number;
      reserved_points: number;
      status: string;
      movements: Array<{ type: string; points: number }>;
    };
  }

  it('reserva puntos y exige un movimiento RESERVED consistente', async () => {
    await withFixture(async (fixture) => {
    await reserveFixture(fixture);

    const state = await readState(fixture);
    expect(state.balance).toBe(1000);
    expect(state.reserved_points).toBe(POINTS_RESERVED);
    expect(state.status).toBe('RESERVED');
    expect(state.movements).toContainEqual({
      type: 'RESERVED',
      points: POINTS_RESERVED,
    });
    });
  });

  it('completa y descuenta exactamente los puntos, con un SPENT correspondiente', async () => {
    await withFixture(async (fixture) => {
    await reserveFixture(fixture);
    const client = await testPool().connect();
    try {
      await transaction(client, async () => {
        const paymentId = await createPayment(client, fixture);
        await client.query(
          `UPDATE "loyalty_redemptions"
           SET "payment_id" = $2, "status" = 'COMPLETED', "completed_at" = CURRENT_TIMESTAMP
           WHERE "id" = $1 AND "status" = 'RESERVED'`,
          [fixture.redemptionId, paymentId],
        );
        await client.query(
          `INSERT INTO "loyalty_redemption_movements"
             ("id", "redemption_id", "loyalty_account_id", "type", "points", "idempotency_key")
           VALUES ($1, $2, $3, 'SPENT', $4, $5)`,
          [
            randomUUID(),
            fixture.redemptionId,
            fixture.loyaltyAccountId,
            POINTS_RESERVED,
            `${fixture.redemptionId}:SPENT`,
          ],
        );
      });
    } finally {
      client.release();
    }

    const state = await readState(fixture);
    expect(state.balance).toBe(1000 - POINTS_RESERVED);
    expect(state.reserved_points).toBe(0);
    expect(state.status).toBe('COMPLETED');
    expect(state.movements.filter((movement) => movement.type === 'SPENT')).toEqual([
      { type: 'SPENT', points: POINTS_RESERVED },
    ]);
    });
  });

  it('libera puntos sin reducir balance y registra RELEASED exacto', async () => {
    await withFixture(async (fixture) => {
    await reserveFixture(fixture);
    const client = await testPool().connect();
    try {
      await transaction(client, async () => {
        await client.query(
          `UPDATE "loyalty_redemptions"
           SET "status" = 'RELEASED', "release_reason" = 'EXPIRED',
               "released_at" = CURRENT_TIMESTAMP
           WHERE "id" = $1 AND "status" = 'RESERVED'`,
          [fixture.redemptionId],
        );
        await client.query(
          `INSERT INTO "loyalty_redemption_movements"
             ("id", "redemption_id", "loyalty_account_id", "type", "points", "idempotency_key")
           VALUES ($1, $2, $3, 'RELEASED', $4, $5)`,
          [
            randomUUID(),
            fixture.redemptionId,
            fixture.loyaltyAccountId,
            POINTS_RESERVED,
            `${fixture.redemptionId}:RELEASED`,
          ],
        );
      });
    } finally {
      client.release();
    }

    const state = await readState(fixture);
    expect(state.balance).toBe(1000);
    expect(state.reserved_points).toBe(0);
    expect(state.status).toBe('RELEASED');
    expect(state.movements.filter((movement) => movement.type === 'RELEASED')).toEqual([
      { type: 'RELEASED', points: POINTS_RESERVED },
    ]);
    });
  });

  it('falla al commit si completa sin SPENT y revierte Payment, estado y saldos', async () => {
    await withFixture(async (fixture) => {
    await reserveFixture(fixture);
    const client = await testPool().connect();
    try {
      await expect(
        transaction(client, async () => {
          const paymentId = await createPayment(client, fixture);
          await client.query(
            `UPDATE "loyalty_redemptions"
             SET "payment_id" = $2, "status" = 'COMPLETED', "completed_at" = CURRENT_TIMESTAMP
             WHERE "id" = $1`,
            [fixture.redemptionId, paymentId],
          );
        }),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      client.release();
    }

    const state = await readState(fixture);
    const payments = await testPool().query(
      'SELECT COUNT(*)::int AS count FROM "payments" WHERE "order_id" = $1',
      [fixture.orderId],
    );
    expect(state.balance).toBe(1000);
    expect(state.reserved_points).toBe(POINTS_RESERVED);
    expect(state.status).toBe('RESERVED');
    expect(state.movements).toHaveLength(1);
    expect(payments.rows[0].count).toBe(0);
    });
  });

  it('rechaza un SPENT con puntos distintos y revierte el débito', async () => {
    await withFixture(async (fixture) => {
    await reserveFixture(fixture);
    const client = await testPool().connect();
    try {
      await expect(
        transaction(client, async () => {
          const paymentId = await createPayment(client, fixture);
          await client.query(
            `UPDATE "loyalty_redemptions"
             SET "payment_id" = $2, "status" = 'COMPLETED', "completed_at" = CURRENT_TIMESTAMP
             WHERE "id" = $1`,
            [fixture.redemptionId, paymentId],
          );
          await client.query(
            `INSERT INTO "loyalty_redemption_movements"
               ("id", "redemption_id", "loyalty_account_id", "type", "points", "idempotency_key")
             VALUES ($1, $2, $3, 'SPENT', $4, $5)`,
            [
              randomUUID(),
              fixture.redemptionId,
              fixture.loyaltyAccountId,
              POINTS_RESERVED - 1,
              `${fixture.redemptionId}:SPENT`,
            ],
          );
        }),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      client.release();
    }

    const state = await readState(fixture);
    expect(state.balance).toBe(1000);
    expect(state.reserved_points).toBe(POINTS_RESERVED);
    expect(state.status).toBe('RESERVED');
    expect(state.movements).toHaveLength(1);
    });
  });

  it('una segunda actualización COMPLETED no provoca otro descuento ni otro SPENT', async () => {
    await withFixture(async (fixture) => {
    await reserveFixture(fixture);
    const client = await testPool().connect();
    try {
      await transaction(client, async () => {
        const paymentId = await createPayment(client, fixture);
        await client.query(
          `UPDATE "loyalty_redemptions"
           SET "payment_id" = $2, "status" = 'COMPLETED', "completed_at" = CURRENT_TIMESTAMP
           WHERE "id" = $1 AND "status" = 'RESERVED'`,
          [fixture.redemptionId, paymentId],
        );
        await client.query(
          `INSERT INTO "loyalty_redemption_movements"
             ("id", "redemption_id", "loyalty_account_id", "type", "points", "idempotency_key")
           VALUES ($1, $2, $3, 'SPENT', $4, $5)`,
          [
            randomUUID(),
            fixture.redemptionId,
            fixture.loyaltyAccountId,
            POINTS_RESERVED,
            `${fixture.redemptionId}:SPENT`,
          ],
        );
        await client.query(
          `UPDATE "loyalty_redemptions" SET "status" = 'COMPLETED'
           WHERE "id" = $1 AND "status" = 'COMPLETED'`,
          [fixture.redemptionId],
        );
      });
    } finally {
      client.release();
    }

    const state = await readState(fixture);
    expect(state.balance).toBe(1000 - POINTS_RESERVED);
    expect(state.reserved_points).toBe(0);
    expect(state.movements.filter((movement) => movement.type === 'SPENT')).toEqual([
      { type: 'SPENT', points: POINTS_RESERVED },
    ]);
    });
  });

  it('revierte el estado y saldo si ocurre un error después del UPDATE del canje', async () => {
    await withFixture(async (fixture) => {
    await reserveFixture(fixture);
    const client = await testPool().connect();
    try {
      await expect(
        transaction(client, async () => {
          const paymentId = await createPayment(client, fixture);
          await client.query(
            `UPDATE "loyalty_redemptions"
             SET "payment_id" = $2, "status" = 'COMPLETED', "completed_at" = CURRENT_TIMESTAMP
             WHERE "id" = $1`,
            [fixture.redemptionId, paymentId],
          );
          throw new Error('forced failure after redemption update');
        }),
      ).rejects.toThrow('forced failure after redemption update');
    } finally {
      client.release();
    }

    const state = await readState(fixture);
    const payments = await testPool().query(
      'SELECT COUNT(*)::int AS count FROM "payments" WHERE "order_id" = $1',
      [fixture.orderId],
    );
    expect(state.balance).toBe(1000);
    expect(state.reserved_points).toBe(POINTS_RESERVED);
    expect(state.status).toBe('RESERVED');
    expect(state.movements).toHaveLength(1);
    expect(payments.rows[0].count).toBe(0);
    });
  });

  it('el proceso programado libera una reserva vencida sin descontar balance', async () => {
    const fixture = await createFixture();
    await reserveFixture(fixture, true);

    const repository = testRepository();
    const candidates = await repository.findExpiredRedemptionCandidates(new Date());
    expect(candidates.map((candidate) => candidate.id)).toContain(fixture.redemptionId);
    await expect(
      repository.releaseExpiredRedemptionById(fixture.redemptionId),
    ).resolves.toBe(true);

    const state = await readState(fixture);
    expect(state.balance).toBe(1000);
    expect(state.reserved_points).toBe(0);
    expect(state.status).toBe('RELEASED');
    expect(state.movements.filter((movement) => movement.type === 'RELEASED')).toEqual([
      { type: 'RELEASED', points: POINTS_RESERVED },
    ]);
  });

  it('libera bajo demanda bajo bloqueos LoyaltyAccount, Order y Redemption', async () => {
    const fixture = await createFixture();
    await reserveFixture(fixture, true);

    const repository = testRepository();
    await repository.transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "loyalty_accounts" WHERE "id" = ${fixture.loyaltyAccountId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${fixture.orderId}::uuid FOR UPDATE`;
      await expect(
        repository.releaseExpiredRedemptionInTransaction(
          tx,
          fixture.redemptionId,
          new Date(),
        ),
      ).resolves.toBe(true);
    });

    const state = await readState(fixture);
    expect(state.balance).toBe(1000);
    expect(state.reserved_points).toBe(0);
    expect(state.status).toBe('RELEASED');
    expect(state.movements.filter((movement) => movement.type === 'RELEASED')).toHaveLength(1);
  });

  it('dos procesos concurrentes liberan una reserva una sola vez', async () => {
    const fixture = await createFixture();
    await reserveFixture(fixture, true);
    const repository = testRepository();

    const results = await Promise.all([
      repository.releaseExpiredRedemptionById(fixture.redemptionId),
      repository.releaseExpiredRedemptionById(fixture.redemptionId),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const state = await readState(fixture);
    expect(state.balance).toBe(1000);
    expect(state.reserved_points).toBe(0);
    expect(state.status).toBe('RELEASED');
    expect(state.movements.filter((movement) => movement.type === 'RELEASED')).toEqual([
      { type: 'RELEASED', points: POINTS_RESERVED },
    ]);
  });

  it('serializa expiración y comienzo de pago sin completar ni liberar dos veces', async () => {
    const fixture = await createFixture();
    await reserveFixture(fixture, true);
    const repository = testRepository();
    const initial = await testPool().query(
      'SELECT "id" FROM "loyalty_redemptions" WHERE "id" = $1 AND "status" = \'RESERVED\'',
      [fixture.redemptionId],
    );
    expect(initial.rows[0].id).toBe(fixture.redemptionId);

    const paymentAttempt = repository.transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "loyalty_accounts" WHERE "id" = ${fixture.loyaltyAccountId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${fixture.orderId}::uuid FOR UPDATE`;
      const current = await tx.loyaltyRedemption.findUnique({
        where: { id: fixture.redemptionId },
        select: { id: true, status: true, expiresAt: true },
      });
      if (!current || current.status !== 'RESERVED') return 'changed';
      if (current.expiresAt <= new Date()) {
        await repository.releaseExpiredRedemptionInTransaction(
          tx,
          fixture.redemptionId,
          new Date(),
        );
        return 'expired';
      }
      return 'payable';
    });
    const [scheduledRelease, paymentOutcome] = await Promise.all([
      repository.releaseExpiredRedemptionById(fixture.redemptionId),
      paymentAttempt,
    ]);

    expect(['expired', 'changed']).toContain(paymentOutcome);
    expect(scheduledRelease).toBeTypeOf('boolean');
    const state = await readState(fixture);
    expect(state.balance).toBe(1000);
    expect(state.reserved_points).toBe(0);
    expect(state.status).toBe('RELEASED');
    expect(state.movements.filter((movement) => movement.type === 'RELEASED')).toHaveLength(1);
    const payments = await testPool().query(
      'SELECT COUNT(*)::int AS count FROM "payments" WHERE "order_id" = $1',
      [fixture.orderId],
    );
    expect(payments.rows[0].count).toBe(0);
  });
});
