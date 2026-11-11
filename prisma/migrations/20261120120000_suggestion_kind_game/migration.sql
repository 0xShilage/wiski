-- Viewers can suggest games too (2026-11-11). Suggestion.kind moves from ItemKind (the catalog
-- kinds) to its own SuggestionKind enum, which adds GAME. Jogos stay a separate model; this only
-- widens what a suggestion can be labelled.
CREATE TYPE "SuggestionKind" AS ENUM ('MOVIE', 'SERIES', 'FRANCHISE', 'ANIME', 'GAME');

ALTER TABLE "Suggestion"
  ALTER COLUMN "kind" TYPE "SuggestionKind" USING "kind"::text::"SuggestionKind";
