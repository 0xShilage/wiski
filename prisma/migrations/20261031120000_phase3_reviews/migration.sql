-- CreateEnum
CREATE TYPE "ReviewHoldReason" AS ENUM ('LINKS', 'REPORTS');

-- DropIndex
DROP INDEX "ReviewLike_reviewId_idx";

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "heldReason" "ReviewHoldReason",
ADD COLUMN     "moderatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "openReportCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Review_itemId_status_likeCount_idx" ON "Review"("itemId", "status", "likeCount");

-- CreateIndex
CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Review_openReportCount_idx" ON "Review"("openReportCount");

-- CreateIndex
CREATE INDEX "ReviewLike_reviewId_createdAt_idx" ON "ReviewLike"("reviewId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewReport_reviewId_status_idx" ON "ReviewReport"("reviewId", "status");

-- CreateIndex
CREATE INDEX "ReviewReport_reporterId_createdAt_idx" ON "ReviewReport"("reporterId", "createdAt");
