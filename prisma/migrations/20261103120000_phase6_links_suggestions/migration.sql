-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('NEW', 'ACCEPTED', 'DISMISSED');

-- CreateTable
CREATE TABLE "SocialLink" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SocialLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "title" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "year" INTEGER,
    "note" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'NEW',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Suggestion_status_createdAt_idx" ON "Suggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Suggestion_titleKey_idx" ON "Suggestion"("titleKey");

-- CreateIndex
CREATE INDEX "Suggestion_userId_createdAt_idx" ON "Suggestion"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "suggestion_one_open_per_title" ON "Suggestion"("userId", "titleKey") WHERE (status = 'NEW'::"SuggestionStatus");

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
