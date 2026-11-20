-- H29: los reportes los consulta el Gerente; se quita el rol Gerente general.
-- El usuario de prueba de ese rol se elimina (sus sesiones se borran en cascada).
DELETE FROM "users" WHERE "role" = 'GERENTE_GENERAL';

ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('GERENTE', 'MESERO', 'COCINA', 'CLIENTE');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole" USING ("role"::text::"UserRole");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CLIENTE';
DROP TYPE "UserRole_old";
