-- CreateEnum
CREATE TYPE "LoyaltyMovementType" AS ENUM ('EARNED');

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_movements" (
    "id" UUID NOT NULL,
    "loyalty_account_id" UUID NOT NULL,
    "type" "LoyaltyMovementType" NOT NULL,
    "points" INTEGER NOT NULL,
    "payment_reference" TEXT NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_user_id_key" ON "loyalty_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_movements_payment_reference_key" ON "loyalty_movements"("payment_reference");

-- CreateIndex
CREATE INDEX "loyalty_movements_loyalty_account_id_created_at_idx" ON "loyalty_movements"("loyalty_account_id", "created_at");

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_movements" ADD CONSTRAINT "loyalty_movements_loyalty_account_id_fkey" FOREIGN KEY ("loyalty_account_id") REFERENCES "loyalty_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
