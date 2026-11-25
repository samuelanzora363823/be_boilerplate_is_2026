import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Verificación estática de la migración de datos de E1 (H8).
 * No se conecta a ninguna base: comprueba que el SQL tenga exactamente el
 * alcance acordado. El comportamiento contra PostgreSQL se prueba en
 * test/h8-e1-data-repair.e2e-spec.ts.
 */

const MIGRATION_NAME = '20261126090000_h8_reparar_platillos_en_preparacion';
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url),
);

function sqlStatements(): string[] {
  const raw = readFileSync(
    `${MIGRATIONS_DIR}${MIGRATION_NAME}/migration.sql`,
    'utf8',
  );
  const withoutComments = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  return withoutComments
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

describe('Migración H8 de reparación de datos E1 (estática)', () => {
  it('se aplica después de las migraciones de las que depende', () => {
    const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const position = (name: string) => migrations.indexOf(name);

    expect(position(MIGRATION_NAME)).toBeGreaterThan(-1);
    // Tablas orders/order_items y sus enums de estado (H4), PENDING_PAYMENT
    // (H5), H30 y las migraciones de H22, que ya estaban en develop al
    // integrar esta corrección: la reparación debe aplicarse después de ellas.
    for (const dependency of [
      '20261106150000_h4_mesas_cuentas_pedidos',
      '20261106220000_h5_pedidos_para_llevar',
      '20261120040000_h30_resenas',
      '20261122120000_h22_configuracion_lealtad',
      '20261125120000_h22_beneficio_actualizado_por',
    ]) {
      expect(position(dependency)).toBeGreaterThan(-1);
      expect(position(MIGRATION_NAME)).toBeGreaterThan(position(dependency));
    }
  });

  it('contiene una única sentencia UPDATE sobre order_items', () => {
    const statements = sqlStatements();

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^UPDATE "order_items" AS i /);
  });

  it('solo asigna IN_PREPARATION al estado del platillo', () => {
    const [statement] = sqlStatements();
    const setClause = statement.slice(
      statement.indexOf(' SET '),
      statement.indexOf(' FROM '),
    );

    expect(setClause.trim()).toBe(`SET "status" = 'IN_PREPARATION'`);
  });

  it('limita la actualización a platillos RECEIVED de comandas IN_PREPARATION', () => {
    const [statement] = sqlStatements();
    const whereClause = statement.slice(statement.indexOf(' WHERE '));

    expect(statement).toContain('FROM "orders" AS o');
    expect(whereClause).toContain(`i."order_id" = o."id"`);
    expect(whereClause).toContain(`o."status" = 'IN_PREPARATION'`);
    expect(whereClause).toContain(`i."status" = 'RECEIVED'`);
    // Sin OR: ninguna condición puede ampliar el alcance.
    expect(whereClause).not.toMatch(/\bOR\b/i);
  });

  it('no modifica el esquema, no borra datos ni actualiza comandas', () => {
    const [statement] = sqlStatements();

    expect(statement).not.toMatch(
      /\b(DELETE|DROP|ALTER|INSERT|TRUNCATE|CREATE)\b/i,
    );
    expect(statement).not.toMatch(/UPDATE\s+"orders"/i);
  });
});
