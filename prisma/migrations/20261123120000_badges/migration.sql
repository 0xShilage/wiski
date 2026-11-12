-- Emblemas (docs/phase-6/README.md §38): time-limited badges and their claims.
ALTER TYPE "MediaRole" ADD VALUE 'BADGE';

CREATE TABLE "Badge" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "assetId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "codeHash" BYTEA,
    "maxClaims" INTEGER,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Badge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BadgeClaim" (
    "badgeId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "claimedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeClaim_pkey" PRIMARY KEY ("badgeId","userId")
);

CREATE UNIQUE INDEX "Badge_slug_key" ON "Badge"("slug");
CREATE INDEX "Badge_endsAt_idx" ON "Badge"("endsAt");
CREATE INDEX "Badge_startsAt_idx" ON "Badge"("startsAt");
CREATE INDEX "BadgeClaim_userId_claimedAt_idx" ON "BadgeClaim"("userId", "claimedAt");

ALTER TABLE "Badge" ADD CONSTRAINT "Badge_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BadgeClaim" ADD CONSTRAINT "BadgeClaim_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BadgeClaim" ADD CONSTRAINT "BadgeClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
