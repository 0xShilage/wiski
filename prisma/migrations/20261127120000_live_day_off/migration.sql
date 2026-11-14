-- CreateEnum
CREATE TYPE "LiveDayOffReason" AS ENUM ('FOLGA', 'VIAGEM', 'OUTRO');

-- CreateTable
CREATE TABLE "LiveDayOff" (
    "id" UUID NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "reason" "LiveDayOffReason" NOT NULL,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveDayOff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveDayOff_endsOn_idx" ON "LiveDayOff"("endsOn");

-- CreateIndex
CREATE INDEX "LiveDayOff_createdById_idx" ON "LiveDayOff"("createdById");

-- AddForeignKey
ALTER TABLE "LiveDayOff" ADD CONSTRAINT "LiveDayOff_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
