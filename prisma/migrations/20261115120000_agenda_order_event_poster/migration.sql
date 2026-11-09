-- AlterTable
ALTER TABLE "LiveSegment" ADD COLUMN     "posterId" UUID;

-- AlterTable
ALTER TABLE "StreamSession" ADD COLUMN     "entryOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hiddenAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "LiveSegment_posterId_idx" ON "LiveSegment"("posterId");

-- AddForeignKey
ALTER TABLE "LiveSegment" ADD CONSTRAINT "LiveSegment_posterId_fkey" FOREIGN KEY ("posterId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
