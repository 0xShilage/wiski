-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('CHECKOUT', 'MANUAL');

-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "manualPriceCents" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'CHECKOUT';
