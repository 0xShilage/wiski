-- Guia de Winden photos (docs/phase-6/README.md §37): a portrait per character version, uploaded
-- from the dashboard.
ALTER TYPE "MediaRole" ADD VALUE 'PORTRAIT';

-- CreateTable
CREATE TABLE "GuidePortrait" (
    "guide" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "assetId" UUID NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GuidePortrait_pkey" PRIMARY KEY ("guide","slot")
);

-- CreateIndex
CREATE INDEX "GuidePortrait_assetId_idx" ON "GuidePortrait"("assetId");

-- AddForeignKey
ALTER TABLE "GuidePortrait" ADD CONSTRAINT "GuidePortrait_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidePortrait" ADD CONSTRAINT "GuidePortrait_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
