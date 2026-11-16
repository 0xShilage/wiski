-- AlterTable
ALTER TABLE "User" ADD COLUMN     "nameBadgeAchievement" TEXT,
ADD COLUMN     "nameBadgeEmblemId" UUID,
ADD COLUMN     "nameBadgeRole" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_nameBadgeEmblemId_fkey" FOREIGN KEY ("nameBadgeEmblemId") REFERENCES "Badge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
