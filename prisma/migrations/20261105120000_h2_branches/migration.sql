CREATE TABLE "branches" (
 "id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL, "is_active" BOOLEAN NOT NULL DEFAULT true,
 CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branches_name_key" ON "branches"("name");
CREATE TABLE "branch_dishes" (
 "branch_id" UUID NOT NULL, "dish_id" UUID NOT NULL,
 "stock_status" "DishStatus" NOT NULL DEFAULT 'ACTIVE',
 CONSTRAINT "branch_dishes_pkey" PRIMARY KEY ("branch_id", "dish_id")
);
ALTER TABLE "branch_dishes" ADD CONSTRAINT "branch_dishes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_dishes" ADD CONSTRAINT "branch_dishes_dish_id_fkey" FOREIGN KEY ("dish_id") REFERENCES "dishes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Sucursales de demostración; reemplazar por el catálogo oficial cuando exista.
INSERT INTO "branches" ("id", "name") VALUES
 ('10000000-0000-4000-8000-000000000001', 'Santa Elena'),
 ('10000000-0000-4000-8000-000000000002', 'Escalón');
-- Los platillos existentes se habilitan inicialmente en ambas sucursales.
INSERT INTO "branch_dishes" ("branch_id", "dish_id", "stock_status")
SELECT b.id, d.id, d.status FROM "branches" b CROSS JOIN "dishes" d;
