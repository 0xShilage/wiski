-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "scheduledAt" TIMESTAMPTZ(3),
ADD COLUMN     "sessionId" UUID;

-- AlterTable
ALTER TABLE "StreamSession" ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3),
ADD COLUMN     "nowItemId" UUID,
ADD COLUMN     "startedAt" TIMESTAMPTZ(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Campaign_sessionId_idx" ON "Campaign"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "session_one_live" ON "StreamSession"("status") WHERE (status = 'LIVE'::"StreamSessionStatus");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StreamSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StreamSession" ADD CONSTRAINT "StreamSession_nowItemId_fkey" FOREIGN KEY ("nowItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
