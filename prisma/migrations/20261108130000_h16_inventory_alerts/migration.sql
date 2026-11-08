CREATE TYPE "InventoryAlertStatus" AS ENUM ('ACTIVA', 'ATENDIDA');
CREATE TABLE "inventory_alerts" (
 "id" TEXT NOT NULL,
 "branch_id" UUID NOT NULL,
 "supply_id" TEXT NOT NULL,
 "quantity_at_alert" DECIMAL(10,3) NOT NULL,
 "status" "InventoryAlertStatus" NOT NULL DEFAULT 'ACTIVA',
 "cycle_open" BOOLEAN NOT NULL DEFAULT true,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "inventory_alerts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "inventory_alerts_branch_id_status_created_at_idx" ON "inventory_alerts"("branch_id", "status", "created_at");
CREATE UNIQUE INDEX "inventory_alerts_one_open_cycle_idx" ON "inventory_alerts"("branch_id", "supply_id") WHERE "cycle_open" = true;
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
