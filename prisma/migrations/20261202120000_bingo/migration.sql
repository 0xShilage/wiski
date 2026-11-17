-- Bingo (docs/phase-6/README.md §53): the items, the day's lock, cards, calls and wins.
CREATE TABLE "BingoItem" (
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BingoItem_pkey" PRIMARY KEY ("position")
);

CREATE TABLE "BingoRound" (
    "day" DATE NOT NULL,
    "winners" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BingoRound_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "BingoCard" (
    "id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "userId" UUID NOT NULL,
    "cells" INTEGER[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BingoCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BingoCall" (
    "day" DATE NOT NULL,
    "position" INTEGER NOT NULL,
    "calledById" UUID,
    "calledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BingoCall_pkey" PRIMARY KEY ("day","position")
);

CREATE TABLE "BingoWin" (
    "day" DATE NOT NULL,
    "userId" UUID NOT NULL,
    "place" INTEGER NOT NULL,
    "line" INTEGER[],
    "wonAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BingoWin_pkey" PRIMARY KEY ("day","userId")
);

CREATE INDEX "BingoCard_userId_idx" ON "BingoCard"("userId");
CREATE UNIQUE INDEX "BingoCard_day_userId_key" ON "BingoCard"("day", "userId");
CREATE INDEX "BingoCall_calledById_idx" ON "BingoCall"("calledById");
CREATE INDEX "BingoWin_wonAt_idx" ON "BingoWin"("wonAt");
CREATE INDEX "BingoWin_userId_wonAt_idx" ON "BingoWin"("userId", "wonAt");
CREATE UNIQUE INDEX "BingoWin_day_place_key" ON "BingoWin"("day", "place");

ALTER TABLE "BingoItem" ADD CONSTRAINT "BingoItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BingoCard" ADD CONSTRAINT "BingoCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BingoCall" ADD CONSTRAINT "BingoCall_calledById_fkey" FOREIGN KEY ("calledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BingoWin" ADD CONSTRAINT "BingoWin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
