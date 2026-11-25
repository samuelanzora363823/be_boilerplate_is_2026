-- CreateEnum
CREATE TYPE "LoyaltyDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateTable
CREATE TABLE "loyalty_rules" (
    "id" UUID NOT NULL,
    "points_per_dollar" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_rule_history" (
    "id" UUID NOT NULL,
    "loyalty_rule_id" UUID NOT NULL,
    "previous_points" DECIMAL(10,2) NOT NULL,
    "new_points" DECIMAL(10,2) NOT NULL,
    "changed_by_id" UUID NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_rule_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_benefits" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "points_required" INTEGER NOT NULL,
    "discount_type" "LoyaltyDiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_rule_history_loyalty_rule_id_changed_at_idx" ON "loyalty_rule_history"("loyalty_rule_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_benefits_name_key" ON "loyalty_benefits"("name");

-- CreateIndex
CREATE INDEX "loyalty_benefits_active_points_required_idx" ON "loyalty_benefits"("active", "points_required");

-- AddForeignKey
ALTER TABLE "loyalty_rule_history" ADD CONSTRAINT "loyalty_rule_history_loyalty_rule_id_fkey" FOREIGN KEY ("loyalty_rule_id") REFERENCES "loyalty_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_rule_history" ADD CONSTRAINT "loyalty_rule_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_benefits" ADD CONSTRAINT "loyalty_benefits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_benefit_id_fkey" FOREIGN KEY ("benefit_id") REFERENCES "loyalty_benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

