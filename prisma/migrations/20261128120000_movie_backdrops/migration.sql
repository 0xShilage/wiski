-- CreateTable
CREATE TABLE "CatalogItemBackdrop" (
    "itemId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "assetId" UUID NOT NULL,

    CONSTRAINT "CatalogItemBackdrop_pkey" PRIMARY KEY ("itemId","position")
);

-- CreateIndex
CREATE INDEX "CatalogItemBackdrop_assetId_idx" ON "CatalogItemBackdrop"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemBackdrop_itemId_assetId_key" ON "CatalogItemBackdrop"("itemId", "assetId");

-- AddForeignKey
ALTER TABLE "CatalogItemBackdrop" ADD CONSTRAINT "CatalogItemBackdrop_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemBackdrop" ADD CONSTRAINT "CatalogItemBackdrop_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
