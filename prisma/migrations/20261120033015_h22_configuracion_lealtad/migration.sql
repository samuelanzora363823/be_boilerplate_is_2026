-- CreateEnum
CREATE TYPE "LoyaltyDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateTable
CREATE TABLE "loyalty_rules" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'global',
    "points_per_dollar" DECIMAL(10,2) NOT NULL DEFAULT 1.0,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_benefits" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "points_required" INTEGER NOT NULL,
    "discount_type" "LoyaltyDiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_benefits_name_key" ON "loyalty_benefits"("name");

-- AddForeignKey
ALTER TABLE "loyalty_rules" ADD CONSTRAINT "loyalty_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_benefits" ADD CONSTRAINT "loyalty_benefits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_benefits" ADD CONSTRAINT "loyalty_benefits_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
