-- CreateEnum
CREATE TYPE "LiveSegmentKind" AS ENUM ('PART', 'EVENT');

-- CreateEnum
CREATE TYPE "LiveSegmentStatus" AS ENUM ('SCHEDULED', 'PLAYING', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "LiveSegment" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "kind" "LiveSegmentKind" NOT NULL,
    "campaignId" UUID,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "seasonNumber" INTEGER,
    "episodeFrom" INTEGER,
    "episodeTo" INTEGER,
    "franchisePosition" INTEGER,
    "minutes" INTEGER NOT NULL,
    "atStart" BOOLEAN NOT NULL DEFAULT false,
    "status" "LiveSegmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMPTZ(3),

    CONSTRAINT "LiveSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "live_segment_one_playing" ON "LiveSegment"("sessionId") WHERE (status = 'PLAYING'::"LiveSegmentStatus");

-- CreateIndex
CREATE INDEX "LiveSegment_sessionId_status_idx" ON "LiveSegment"("sessionId", "status");

-- CreateIndex
CREATE INDEX "LiveSegment_campaignId_status_idx" ON "LiveSegment"("campaignId", "status");

-- AddForeignKey
ALTER TABLE "LiveSegment" ADD CONSTRAINT "LiveSegment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StreamSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSegment" ADD CONSTRAINT "LiveSegment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
