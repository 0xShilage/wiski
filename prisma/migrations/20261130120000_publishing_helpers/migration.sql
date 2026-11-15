-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "publishAt" TIMESTAMPTZ(3),
ADD COLUMN     "publishError" TEXT,
ADD COLUMN     "wikidataId" TEXT;

-- AlterTable
ALTER TABLE "Suggestion" ADD COLUMN     "itemId" UUID;

-- CreateIndex
CREATE INDEX "CatalogItem_publishAt_idx" ON "CatalogItem"("publishAt");

-- CreateIndex
CREATE INDEX "CatalogItem_wikidataId_idx" ON "CatalogItem"("wikidataId");

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
