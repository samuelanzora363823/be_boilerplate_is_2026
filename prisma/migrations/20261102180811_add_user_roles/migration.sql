-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('GERENTE', 'MESERO', 'COCINA', 'CLIENTE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'CLIENTE';
