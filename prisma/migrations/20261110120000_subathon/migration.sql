-- CreateEnum
CREATE TYPE "SubathonStatus" AS ENUM ('READY', 'RUNNING', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "SubathonEntryKind" AS ENUM ('ORDER', 'REFUND', 'TIP', 'BITS', 'SUB', 'RESUB', 'PRIME', 'GIFT', 'MANUAL');

-- CreateTable
CREATE TABLE "Subathon" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "SubathonStatus" NOT NULL DEFAULT 'READY',
    "openSlot" INTEGER DEFAULT 1,
    "initialSeconds" INTEGER NOT NULL,
    "remainingSeconds" INTEGER NOT NULL,
    "endsAt" TIMESTAMPTZ(3),
    "capSeconds" INTEGER,
    "secondsPerReal" INTEGER NOT NULL DEFAULT 60,
    "rates" JSONB NOT NULL,
    "addedSeconds" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subathon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubathonEntry" (
    "id" UUID NOT NULL,
    "subathonId" UUID NOT NULL,
    "kind" "SubathonEntryKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "valueCents" INTEGER,
    "seconds" INTEGER NOT NULL,
    "appliedSeconds" INTEGER NOT NULL,
    "label" TEXT,
    "orderId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubathonEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subathon_openSlot_key" ON "Subathon"("openSlot");

-- CreateIndex
CREATE INDEX "SubathonEntry_subathonId_createdAt_idx" ON "SubathonEntry"("subathonId", "createdAt");

-- CreateIndex
CREATE INDEX "SubathonEntry_orderId_idx" ON "SubathonEntry"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SubathonEntry_subathonId_externalId_key" ON "SubathonEntry"("subathonId", "externalId");

-- AddForeignKey
ALTER TABLE "SubathonEntry" ADD CONSTRAINT "SubathonEntry_subathonId_fkey" FOREIGN KEY ("subathonId") REFERENCES "Subathon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
