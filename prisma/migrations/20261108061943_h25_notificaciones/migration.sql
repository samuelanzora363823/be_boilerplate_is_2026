-- CreateEnum
CREATE TYPE "NotificationSource" AS ENUM ('COCINA', 'RESERVAS', 'INVENTARIO');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('NO_LEIDA', 'LEIDA');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient_id" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "source_module" "NotificationSource" NOT NULL,
    "reference_type" VARCHAR(50),
    "reference_id" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'NO_LEIDA',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_status_created_at_idx" ON "notifications"("recipient_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
