-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('MOVIE', 'SERIES', 'FRANCHISE');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AgeRating" AS ENUM ('L', 'A10', 'A12', 'A14', 'A16', 'A18');

-- CreateEnum
CREATE TYPE "MediaRole" AS ENUM ('POSTER', 'BACKDROP', 'LOGO');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('OPEN', 'PAUSED', 'FUNDED', 'SCHEDULED', 'WATCHED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'NEEDS_ATTENTION', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('MOVIE', 'CONTRIBUTION');

-- DropForeignKey
ALTER TABLE "LegalAcceptance" DROP CONSTRAINT "LegalAcceptance_sponsorshipId_fkey";

-- DropForeignKey
ALTER TABLE "CatalogPackage" DROP CONSTRAINT "CatalogPackage_titleId_fkey";

-- DropForeignKey
ALTER TABLE "WatchEvent" DROP CONSTRAINT "WatchEvent_titleId_fkey";

-- DropForeignKey
ALTER TABLE "WatchEvent" DROP CONSTRAINT "WatchEvent_sponsorshipId_fkey";

-- DropForeignKey
ALTER TABLE "VoucherRedemption" DROP CONSTRAINT "VoucherRedemption_sponsorshipId_fkey";

-- DropForeignKey
ALTER TABLE "QueueJumpSlot" DROP CONSTRAINT "QueueJumpSlot_sponsorshipId_fkey";

-- DropForeignKey
ALTER TABLE "Sponsorship" DROP CONSTRAINT "Sponsorship_userId_fkey";

-- DropForeignKey
ALTER TABLE "Sponsorship" DROP CONSTRAINT "Sponsorship_titleId_fkey";

-- DropForeignKey
ALTER TABLE "Sponsorship" DROP CONSTRAINT "Sponsorship_packageId_fkey";

-- DropForeignKey
ALTER TABLE "Sponsorship" DROP CONSTRAINT "Sponsorship_ruleSetId_fkey";

-- DropForeignKey
ALTER TABLE "Sponsorship" DROP CONSTRAINT "Sponsorship_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_sponsorshipId_fkey";

-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_titleId_fkey";

-- DropIndex
DROP INDEX "LegalAcceptance_sponsorshipId_documentId_key";

-- DropIndex
DROP INDEX "WatchEvent_sponsorshipId_key";

-- DropIndex
DROP INDEX "WatchEvent_titleId_idx";

-- DropIndex
DROP INDEX "VoucherRedemption_sponsorshipId_key";

-- DropIndex
DROP INDEX "QueueJumpSlot_sponsorshipId_key";

-- DropIndex
DROP INDEX "Payment_sponsorshipId_key";

-- DropIndex
DROP INDEX "Review_titleId_status_createdAt_idx";

-- DropIndex
DROP INDEX "Review_userId_titleId_key";

-- AlterTable
ALTER TABLE "Passkey" ADD COLUMN     "aaguid" TEXT,
ADD COLUMN     "backedUp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LegalAcceptance" DROP COLUMN "sponsorshipId",
ADD COLUMN     "orderId" UUID;

-- AlterTable
ALTER TABLE "WatchEvent" DROP COLUMN "sponsorshipId",
DROP COLUMN "titleId",
ADD COLUMN     "itemId" UUID NOT NULL,
ADD COLUMN     "orderId" UUID;

-- AlterTable
ALTER TABLE "Voucher" DROP COLUMN "appliesToKinds";

-- AlterTable
ALTER TABLE "VoucherRedemption" DROP COLUMN "sponsorshipId",
ADD COLUMN     "orderId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "QueueJumpSlot" DROP COLUMN "sponsorshipId",
ADD COLUMN     "orderId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "sponsorshipId",
ADD COLUMN     "orderId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "Review" DROP COLUMN "titleId",
ADD COLUMN     "itemId" UUID NOT NULL;

-- DropTable
DROP TABLE "Title";

-- DropTable
DROP TABLE "CatalogRule";

-- DropTable
DROP TABLE "CatalogPackage";

-- DropTable
DROP TABLE "Sponsorship";

-- DropEnum
DROP TYPE "MediaKind";

-- DropEnum
DROP TYPE "MediaSource";

-- DropEnum
DROP TYPE "CatalogRuleType";

-- DropEnum
DROP TYPE "SponsorshipStatus";

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" UUID NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'DRAFT',
    "slot" INTEGER,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT,
    "year" INTEGER,
    "runtimeMinutes" INTEGER NOT NULL,
    "ageRating" "AgeRating",
    "genres" TEXT[],
    "synopsis" TEXT NOT NULL,
    "director" TEXT,
    "cast" TEXT[],
    "seasonsLabel" TEXT,
    "seasonCount" INTEGER,
    "episodeCount" INTEGER,
    "trailerYoutubeId" TEXT,
    "posterId" UUID,
    "backdropId" UUID,
    "logoId" UUID,
    "reservedUntil" TIMESTAMPTZ(3),
    "reservedOrderId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMPTZ(3),
    "watchedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FranchiseEntry" (
    "id" UUID NOT NULL,
    "franchiseId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "runtimeMinutes" INTEGER NOT NULL,

    CONSTRAINT "FranchiseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogRevision" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT NOT NULL,
    "editorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "sha256" BYTEA NOT NULL,
    "role" "MediaRole" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "variants" JSONB NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unusedSince" TIMESTAMPTZ(3),

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "goalCents" INTEGER NOT NULL,
    "raisedCents" INTEGER NOT NULL DEFAULT 0,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "remainingCents" INTEGER NOT NULL,
    "supporterCount" INTEGER NOT NULL DEFAULT 0,
    "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
    "extensions" INTEGER NOT NULL DEFAULT 0,
    "status" "CampaignStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "openedById" UUID NOT NULL,
    "fundedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "kind" "OrderKind" NOT NULL,
    "itemId" UUID NOT NULL,
    "userId" UUID,
    "contactEmail" TEXT NOT NULL,
    "accessTokenHash" BYTEA NOT NULL,
    "claimedAt" TIMESTAMPTZ(3),
    "runtimeMinutes" INTEGER,
    "ruleSetId" UUID,
    "sessionId" UUID,
    "queueJumpTierId" TEXT,
    "rescheduleCount" INTEGER,
    "campaignId" UUID,
    "breakdown" JSONB NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "queueJumpCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "sponsorMessage" TEXT,
    "messageStatus" "MessageStatus",
    "guestDisplayName" TEXT,
    "displayNameStatus" "MessageStatus",
    "showSponsorName" BOOLEAN NOT NULL DEFAULT true,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "clientRequestId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "scheduledAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_slug_key" ON "CatalogItem"("slug");

-- CreateIndex
CREATE INDEX "CatalogItem_kind_status_slot_idx" ON "CatalogItem"("kind", "status", "slot");

-- CreateIndex
CREATE INDEX "CatalogItem_status_watchedAt_idx" ON "CatalogItem"("status", "watchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FranchiseEntry_franchiseId_position_key" ON "FranchiseEntry"("franchiseId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogRevision_itemId_version_key" ON "CatalogRevision"("itemId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_sha256_key" ON "MediaAsset"("sha256");

-- CreateIndex
CREATE INDEX "MediaAsset_unusedSince_idx" ON "MediaAsset"("unusedSince");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_itemId_key" ON "Campaign"("itemId");

-- CreateIndex
CREATE INDEX "Campaign_status_deadlineAt_idx" ON "Campaign"("status", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicCode_key" ON "Order"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "Order_accessTokenHash_key" ON "Order"("accessTokenHash");

-- CreateIndex
CREATE INDEX "Order_kind_status_sessionId_idx" ON "Order"("kind", "status", "sessionId");

-- CreateIndex
CREATE INDEX "Order_itemId_status_idx" ON "Order"("itemId", "status");

-- CreateIndex
CREATE INDEX "Order_campaignId_status_idx" ON "Order"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_contactEmail_status_idx" ON "Order"("contactEmail", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_contactEmail_clientRequestId_key" ON "Order"("contactEmail", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "order_one_active_movie" ON "Order"("itemId") WHERE ((kind = 'MOVIE'::"OrderKind") AND (status = ANY (ARRAY['PENDING_PAYMENT'::"OrderStatus", 'PAID'::"OrderStatus", 'SCHEDULED'::"OrderStatus", 'WATCHING'::"OrderStatus", 'COMPLETED'::"OrderStatus"])));

-- CreateIndex
CREATE UNIQUE INDEX "LegalAcceptance_orderId_documentId_key" ON "LegalAcceptance"("orderId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchEvent_orderId_key" ON "WatchEvent"("orderId");

-- CreateIndex
CREATE INDEX "WatchEvent_itemId_idx" ON "WatchEvent"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherRedemption_orderId_key" ON "VoucherRedemption"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueJumpSlot_orderId_key" ON "QueueJumpSlot"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Review_itemId_status_createdAt_idx" ON "Review"("itemId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_userId_itemId_key" ON "Review"("userId", "itemId");

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_posterId_fkey" FOREIGN KEY ("posterId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_backdropId_fkey" FOREIGN KEY ("backdropId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_logoId_fkey" FOREIGN KEY ("logoId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FranchiseEntry" ADD CONSTRAINT "FranchiseEntry_franchiseId_fkey" FOREIGN KEY ("franchiseId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogRevision" ADD CONSTRAINT "CatalogRevision_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogRevision" ADD CONSTRAINT "CatalogRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchEvent" ADD CONSTRAINT "WatchEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchEvent" ADD CONSTRAINT "WatchEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueJumpSlot" ADD CONSTRAINT "QueueJumpSlot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "PriceRuleSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StreamSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
