-- CreateEnum
CREATE TYPE "RoletaPrize" AS ENUM ('NADA', 'FILME', 'DOIS_FILMES', 'VIP_TWITCH', 'CUPOM_30');

-- CreateEnum
CREATE TYPE "RoletaPrizeStatus" AS ENUM ('PENDING', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RoletaSpin" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "period" DATE NOT NULL,
    "n" INTEGER NOT NULL,
    "prize" "RoletaPrize" NOT NULL,
    "slot" INTEGER NOT NULL,
    "status" "RoletaPrizeStatus",
    "voucherId" UUID,
    "twitchLogin" TEXT,
    "deliveredAt" TIMESTAMPTZ(3),
    "deliveredById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoletaSpin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoletaSpin_voucherId_key" ON "RoletaSpin"("voucherId");

-- CreateIndex
CREATE INDEX "RoletaSpin_status_createdAt_idx" ON "RoletaSpin"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RoletaSpin_prize_createdAt_idx" ON "RoletaSpin"("prize", "createdAt");

-- CreateIndex
CREATE INDEX "RoletaSpin_deliveredById_idx" ON "RoletaSpin"("deliveredById");

-- CreateIndex
CREATE UNIQUE INDEX "RoletaSpin_userId_period_n_key" ON "RoletaSpin"("userId", "period", "n");

-- AddForeignKey
ALTER TABLE "RoletaSpin" ADD CONSTRAINT "RoletaSpin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoletaSpin" ADD CONSTRAINT "RoletaSpin_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoletaSpin" ADD CONSTRAINT "RoletaSpin_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
