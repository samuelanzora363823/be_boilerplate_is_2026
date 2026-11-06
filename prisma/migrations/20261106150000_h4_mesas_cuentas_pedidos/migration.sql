-- H4: estructuras nuevas; no modifica ni elimina tablas anteriores.
CREATE TYPE "TableStatus" AS ENUM ('FREE', 'OCCUPIED', 'RESERVED');
CREATE TYPE "AccountStatus" AS ENUM ('OPEN', 'PAID', 'VOID');
CREATE TYPE "OrderStatus" AS ENUM ('RECEIVED', 'IN_PREPARATION', 'READY', 'DELIVERED', 'CANCELLED');
CREATE TYPE "OrderItemStatus" AS ENUM ('RECEIVED', 'IN_PREPARATION', 'READY', 'CANCELLED');

CREATE TABLE "staff_branches" (
  "user_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  CONSTRAINT "staff_branches_pkey" PRIMARY KEY ("user_id", "branch_id")
);
CREATE TABLE "restaurant_tables" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "capacity" INTEGER NOT NULL,
  "status" "TableStatus" NOT NULL DEFAULT 'FREE',
  CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "accounts" (
  "id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "table_id" UUID NOT NULL,
  "customer_id" UUID,
  "waiter_id" UUID NOT NULL,
  "status" "AccountStatus" NOT NULL DEFAULT 'OPEN',
  "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "orders" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'RECEIVED',
  "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "order_items" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "dish_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "notes" VARCHAR(100),
  "unit_price" DECIMAL(10,2) NOT NULL,
  "subtotal" DECIMAL(10,2) NOT NULL,
  "status" "OrderItemStatus" NOT NULL DEFAULT 'RECEIVED',
  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "restaurant_tables_branch_id_number_key" ON "restaurant_tables"("branch_id", "number");
CREATE INDEX "accounts_table_id_status_idx" ON "accounts"("table_id", "status");
CREATE INDEX "orders_branch_id_status_created_at_idx" ON "orders"("branch_id", "status", "created_at");
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");
-- Una mesa solo puede tener una cuenta abierta (protección frente a concurrencia).
CREATE UNIQUE INDEX "accounts_one_open_per_table" ON "accounts"("table_id") WHERE "status" = 'OPEN';
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_branches" ADD CONSTRAINT "staff_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "restaurant_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_waiter_id_fkey" FOREIGN KEY ("waiter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

