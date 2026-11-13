-- Poster palette and marathon trail (2026-11-13)
ALTER TABLE "MediaAsset" ADD COLUMN "palette" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CatalogItem" ADD COLUMN "partsWatched" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "partsWatchedAt" TIMESTAMPTZ(3);
