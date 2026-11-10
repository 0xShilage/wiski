-- AlterEnum
ALTER TYPE "ItemKind" ADD VALUE 'ANIME';

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('PLAYING', 'FINISHED', 'DROPPED');

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "platform" TEXT,
    "year" INTEGER,
    "status" "GameStatus" NOT NULL DEFAULT 'PLAYING',
    "note" TEXT,
    "vodUrl" TEXT,
    "coverId" UUID,
    "finishedOn" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Game_status_updatedAt_idx" ON "Game"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Game_coverId_idx" ON "Game"("coverId");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
