import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { LoyaltyDiscountType } from '../src/generated/prisma/enums.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { LoyaltyRepository } from '../src/loyalty/loyalty.repository.js';
import { LoyaltyAdminService } from '../src/loyalty/loyalty-admin.service.js';
import { LoyaltyService } from '../src/loyalty/loyalty.service.js';

/**
 * H22: integración con PostgreSQL de la regla de puntos y los beneficios,
 * incluido su efecto sobre H20 (acumulación) y H21 (canjes).
 *
 * Como en H21, no lee dotenv ni DATABASE_URL: H22_TEST_DATABASE_URL debe
 * apuntar a una base desechable dedicada y recién migrada.
 */

const EXPECTED_HOST = '127.0.0.1';
const EXPECTED_PORT = '55433';
const EXPECTED_DATABASE = 'be_h22_test';

function validatedTestDatabaseUrl(): string {
  const connectionString = process.env.H22_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'H22_TEST_DATABASE_URL es obligatorio; no se admite fallback a DATABASE_URL ni a .env.',
    );
  }
  const parsed = new URL(connectionString);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    parsed.hostname !== EXPECTED_HOST ||
    parsed.port !== EXPECTED_PORT ||
    database !== EXPECTED_DATABASE
  ) {
    throw new Error(
      `H22_TEST_DATABASE_URL debe apuntar exclusivamente a ${EXPECTED_HOST}:${EXPECTED_PORT}/${EXPECTED_DATABASE}.`,
    );
  }
  return connectionString;
}

describe('H22 configuración de lealtad (integración PostgreSQL)', () => {
  let pool: Pool;
  let prisma: PrismaClient;
  let admin: LoyaltyAdminService;
  let loyalty: LoyaltyService;

  const managerId: string = randomUUID();
  const otherManagerId: string = randomUUID();
  const clientId = randomUUID();
  const branchId = randomUUID();
  const categoryId = randomUUID();
  const dishId = randomUUID();
  const run = randomUUID().slice(0, 8);

  async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
    return (await pool.query(text, params)).rows as T[];
  }

  async function takeawayOrder(subtotal: string) {
    const orderId = randomUUID();
    await sql(
      `INSERT INTO "orders" ("id", "customer_id", "order_number", "branch_id", "status", "total", "updated_at")
       VALUES ($1, $2, $3, $4, 'PENDING_PAYMENT', $5, CURRENT_TIMESTAMP)`,
      [orderId, clientId, `H22-${orderId}`, branchId, subtotal],
    );
    await sql(
      `INSERT INTO "order_items" ("id", "order_id", "dish_id", "quantity", "unit_price", "subtotal")
       VALUES ($1, $2, $3, 1, $4, $4)`,
      [randomUUID(), orderId, dishId, subtotal],
    );
    return orderId;
  }

  const benefit = (name: string, overrides: Record<string, unknown> = {}) => ({
    name,
    pointsRequired: 100,
    discountType: LoyaltyDiscountType.PERCENTAGE,
    discountValue: 10,
    ...overrides,
  });

  beforeAll(async () => {
    const connectionString = validatedTestDatabaseUrl();
    pool = new Pool({ connectionString, max: 10 });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const repository = new LoyaltyRepository(prisma as never);
    admin = new LoyaltyAdminService(repository);
    loyalty = new LoyaltyService(repository);

    const [installed] = await sql<{ database: string; column: string | null; rules: number }>(`
      SELECT current_database() AS database,
             (SELECT column_name FROM information_schema.columns
               WHERE table_name = 'loyalty_benefits' AND column_name = 'updated_by_id') AS column,
             (SELECT count(*)::int FROM "loyalty_rules") AS rules
    `);
    if (installed.database !== EXPECTED_DATABASE || !installed.column) {
      throw new Error('La base de prueba H22 no tiene aplicadas las migraciones de H22.');
    }
    if (installed.rules !== 0) {
      throw new Error('La base de prueba H22 debe empezar sin reglas de lealtad.');
    }

    for (const [id, role] of [
      [managerId, 'GERENTE'],
      [otherManagerId, 'GERENTE'],
      [clientId, 'CLIENTE'],
    ]) {
      await sql(
        `INSERT INTO "users" ("id", "email", "password_hash", "role", "updated_at")
         VALUES ($1, $2, 'integration-test-hash', $3, CURRENT_TIMESTAMP)`,
        [id, `h22-${id}@integration.test`, role],
      );
    }
    await sql(`INSERT INTO "branches" ("id", "name", "code") VALUES ($1, $2, $3)`, [
      branchId,
      `H22 test ${run}`,
      `H22-${run.slice(0, 6)}`,
    ]);
    await sql(`INSERT INTO "categories" ("id", "name") VALUES ($1, $2)`, [
      categoryId,
      `H22 ${run}`,
    ]);
    await sql(
      `INSERT INTO "dishes" ("id", "name", "price", "category_id", "updated_at")
       VALUES ($1, 'Platillo H22', 20.00, $2, CURRENT_TIMESTAMP)`,
      [dishId, categoryId],
    );
    await sql(
      `INSERT INTO "loyalty_accounts" ("id", "user_id", "balance", "reserved_points", "updated_at")
       VALUES ($1, $2, 1000, 0, CURRENT_TIMESTAMP)`,
      [randomUUID(), clientId],
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  describe('regla de puntos por dólar', () => {
    it('sin regla responde 1 por defecto y no crea registros', async () => {
      await expect(admin.getRuleConfig()).resolves.toEqual({
        pointsPerDollar: 1,
        updatedAt: null,
      });
      expect(await sql(`SELECT 1 FROM "loyalty_rules"`)).toHaveLength(0);
    });

    it('el primer guardado crea una sola regla e historial 1 → 1.5', async () => {
      const saved = await admin.updateRuleConfig({ pointsPerDollar: 1.5 }, managerId);
      expect(saved.pointsPerDollar).toBe(1.5);

      const rules = await sql(`SELECT "points_per_dollar"::text AS rate FROM "loyalty_rules"`);
      expect(rules).toEqual([{ rate: '1.50' }]);
      const history = await sql(
        `SELECT "previous_points"::text AS prev, "new_points"::text AS next, "changed_by_id" AS by
         FROM "loyalty_rule_history"`,
      );
      expect(history).toEqual([{ prev: '1.00', next: '1.50', by: managerId }]);
      await expect(admin.getRuleConfig()).resolves.toMatchObject({ pointsPerDollar: 1.5 });
    });

    it('guardados concurrentes no duplican la regla y el historial es consistente', async () => {
      const rates = [2, 2.25, 3, 3.5, 4];
      await Promise.all(
        rates.map((pointsPerDollar, index) =>
          admin.updateRuleConfig(
            { pointsPerDollar },
            index % 2 === 0 ? managerId : otherManagerId,
          ),
        ),
      );

      const rules = await sql<{ rate: string }>(
        `SELECT "points_per_dollar"::text AS rate FROM "loyalty_rules"`,
      );
      expect(rules).toHaveLength(1);
      const history = await sql<{ prev: string; next: string }>(
        `SELECT "previous_points"::text AS prev, "new_points"::text AS next
         FROM "loyalty_rule_history"`,
      );
      expect(history).toHaveLength(6);
      // Cada valor anterior es el inicial o un valor guardado antes, y el
      // último guardado es el vigente: anteriores + vigente = inicial + nuevos.
      const previous = [...history.map((h) => h.prev), rules[0].rate].sort();
      const next = ['1.00', ...history.map((h) => h.next)].sort();
      expect(previous).toEqual(next);

      const { items } = await admin.getRuleHistory();
      expect(items).toHaveLength(6);
      expect(items.every((item) => [managerId, otherManagerId].includes(item.changedBy.id))).toBe(true);
    });
  });

  describe('beneficios', () => {
    let benefitId: string;

    it('crea un beneficio registrando creador y último responsable', async () => {
      const created = await admin.createBenefit(benefit(`Postre ${run}`), managerId);
      benefitId = created.id;

      expect(created).toMatchObject({ active: true, discountValue: 10, updatedBy: { id: managerId } });
      const [row] = await sql(
        `SELECT "created_by_id" AS created, "updated_by_id" AS updated FROM "loyalty_benefits" WHERE "id" = $1`,
        [benefitId],
      );
      expect(row).toEqual({ created: managerId, updated: managerId });
    });

    it('rechaza nombres repetidos sin distinguir mayúsculas ni espacios', async () => {
      await expect(
        admin.createBenefit(benefit(`  POSTRE ${run.toUpperCase()}  `), managerId),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('dos altas simultáneas con el mismo nombre crean solo un beneficio', async () => {
      const results = await Promise.allSettled([
        admin.createBenefit(benefit(`Café ${run}`), managerId),
        admin.createBenefit(benefit(`café ${run}`), otherManagerId),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(ConflictException);
    });

    it('rechaza un porcentaje mayor que 100 y acepta un fijo mayor que 100', async () => {
      await expect(
        admin.createBenefit(benefit(`Pct ${run}`, { discountValue: 101 }), managerId),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        admin.createBenefit(
          benefit(`Fijo ${run}`, { discountType: LoyaltyDiscountType.FIXED, discountValue: 150 }),
          managerId,
        ),
      ).resolves.toMatchObject({ discountType: 'FIXED', discountValue: 150 });
    });

    it('edita un beneficio, actualiza el responsable y detecta choques de nombre', async () => {
      const edited = await admin.updateBenefit(
        benefitId,
        benefit(`Postre ${run}`, { pointsRequired: 150, discountValue: 15.5 }),
        otherManagerId,
      );
      expect(edited).toMatchObject({ pointsRequired: 150, discountValue: 15.5, updatedBy: { id: otherManagerId } });

      await expect(
        admin.updateBenefit(benefitId, benefit(`CAFÉ ${run}`), managerId),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        admin.updateBenefit(randomUUID(), benefit(`Nuevo ${run}`), managerId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lista todos los beneficios, incluidos los inactivos', async () => {
      const inactive = await admin.createBenefit(benefit(`Inactivo ${run}`), managerId);
      await admin.setBenefitActive(inactive.id, false, managerId);

      const { items } = await admin.listAllBenefits();
      expect(items.find((item) => item.id === inactive.id)).toMatchObject({ active: false });
      const clientView = await loyalty.getBenefits();
      expect(clientView.items.some((item) => item.id === inactive.id)).toBe(false);
    });

    it('cambiar el estado de un beneficio inexistente responde 404', async () => {
      await expect(
        admin.setBenefitActive(randomUUID(), false, managerId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('efecto sobre H21: canjes', () => {
    it('editar o desactivar no altera canjes existentes y bloquea canjes nuevos', async () => {
      const created = await admin.createBenefit(benefit(`Canje ${run}`), managerId);
      const firstOrder = await takeawayOrder('20.00');

      const reserved = await loyalty.requestRedemption(clientId, {
        benefitId: created.id,
        orderId: firstOrder,
      });
      expect(reserved).toMatchObject({ pointsRedeemed: 100, discountApplied: 2 });

      await admin.updateBenefit(
        created.id,
        benefit(`Canje ${run}`, { pointsRequired: 300, discountValue: 50 }),
        managerId,
      );
      const deactivated = await admin.setBenefitActive(created.id, false, otherManagerId);
      expect(deactivated).toMatchObject({ active: false, updatedBy: { id: otherManagerId } });

      const [redemption] = await sql(
        `SELECT "points_reserved" AS points, "discount_amount"::text AS discount, "status"::text AS status
         FROM "loyalty_redemptions" WHERE "id" = $1`,
        [reserved.id],
      );
      expect(redemption).toEqual({ points: 100, discount: '2.00', status: 'RESERVED' });
      expect(await sql(`SELECT 1 FROM "loyalty_benefits" WHERE "id" = $1`, [created.id])).toHaveLength(1);

      const secondOrder = await takeawayOrder('20.00');
      await expect(
        loyalty.requestRedemption(clientId, { benefitId: created.id, orderId: secondOrder }),
      ).rejects.toThrow('El beneficio no está activo.');

      await admin.setBenefitActive(created.id, true, managerId);
      await expect(
        loyalty.requestRedemption(clientId, { benefitId: created.id, orderId: secondOrder }),
      ).resolves.toMatchObject({ pointsRedeemed: 300, discountApplied: 10 });
    });
  });

  describe('efecto sobre H20: acumulación', () => {
    it('usa la regla vigente y no recalcula puntos ya acreditados', async () => {
      await admin.updateRuleConfig({ pointsPerDollar: 1.15 }, managerId);
      const firstPayment = `h22-pay-${randomUUID()}`;
      await loyalty.processApprovedPayment(clientId, firstPayment, 100);

      await admin.updateRuleConfig({ pointsPerDollar: 3 }, managerId);
      const secondPayment = `h22-pay-${randomUUID()}`;
      await loyalty.processApprovedPayment(clientId, secondPayment, 10);

      const movements = await sql<{ ref: string; points: number }>(
        `SELECT "payment_reference" AS ref, "points" FROM "loyalty_movements"
         WHERE "payment_reference" = ANY($1) ORDER BY "created_at"`,
        [[firstPayment, secondPayment]],
      );
      expect(movements).toEqual([
        { ref: firstPayment, points: 115 },
        { ref: secondPayment, points: 30 },
      ]);
    });
  });
});
