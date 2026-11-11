-- Off-stream watched titles and the "Já assistido" suggestion status (2026-11-10).
-- Plain schema changes (not reviewed constraints): a column add and an enum value.

-- Titles Iara watched by herself, logged by hand; kept out of the live progress counts.
ALTER TABLE "CatalogItem" ADD COLUMN "offStream" BOOLEAN NOT NULL DEFAULT false;

-- A moderator can mark a viewer suggestion as already watched.
ALTER TYPE "SuggestionStatus" ADD VALUE 'WATCHED';
