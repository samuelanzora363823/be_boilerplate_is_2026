-- H5: conserva pedidos de mesa existentes.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
ALTER TABLE "branches" ADD COLUMN "code" VARCHAR(12), ADD COLUMN "opening_time" VARCHAR(5) NOT NULL DEFAULT '07:00', ADD COLUMN "closing_time" VARCHAR(5) NOT NULL DEFAULT '22:00', ADD COLUMN "takeaway_counter" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");
ALTER TABLE "orders" ALTER COLUMN "account_id" DROP NOT NULL;
ALTER TABLE "orders" ADD COLUMN "customer_id" UUID, ADD COLUMN "order_number" VARCHAR(40);
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Códigos iniciales reproducibles; ajustar según códigos oficiales de sucursales.
UPDATE "branches" SET "code" = CASE WHEN lower("name") LIKE '%santa elena%' THEN 'SE' WHEN lower("name") LIKE '%escal%' THEN 'ES' ELSE 'S' || upper(substr(replace("id"::text, '-', ''), 1, 8)) END WHERE "code" IS NULL;
