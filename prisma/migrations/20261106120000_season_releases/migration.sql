-- CreateTable
CREATE TABLE "SeasonRelease" (
    "id" UUID NOT NULL,
    "itemId" UUID,
    "title" TEXT NOT NULL,
    "seasonLabel" TEXT NOT NULL,
    "releaseDate" DATE NOT NULL,
    "note" TEXT,
    "editedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SeasonRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeasonRelease_releaseDate_idx" ON "SeasonRelease"("releaseDate");

-- AddForeignKey
ALTER TABLE "SeasonRelease" ADD CONSTRAINT "SeasonRelease_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonRelease" ADD CONSTRAINT "SeasonRelease_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
