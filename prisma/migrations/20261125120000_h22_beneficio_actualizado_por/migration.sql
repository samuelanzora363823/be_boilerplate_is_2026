-- H22: registra el último gerente que creó, editó o cambió el estado de un
-- beneficio. La columna es opcional para no alterar beneficios existentes.

-- AlterTable
ALTER TABLE "loyalty_benefits" ADD COLUMN     "updated_by_id" UUID;

-- AddForeignKey
ALTER TABLE "loyalty_benefits" ADD CONSTRAINT "loyalty_benefits_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
