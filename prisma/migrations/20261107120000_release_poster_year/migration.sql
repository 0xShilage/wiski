-- AlterTable
ALTER TABLE "SeasonRelease" ADD COLUMN     "posterId" UUID,
ADD COLUMN     "yearOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "SeasonRelease_posterId_idx" ON "SeasonRelease"("posterId");

-- AddForeignKey
ALTER TABLE "SeasonRelease" ADD CONSTRAINT "SeasonRelease_posterId_fkey" FOREIGN KEY ("posterId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
