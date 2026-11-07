-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_account_id_fkey";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "image_url" VARCHAR(500);

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
