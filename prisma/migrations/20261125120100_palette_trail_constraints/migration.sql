-- Poster palette (2026-11-13): at most five lower-case #rrggbb colours, posters only.
ALTER TABLE "MediaAsset" ADD CONSTRAINT media_palette CHECK (
  cardinality("palette") <= 5
  AND array_to_string("palette", ',') ~ '^(#[0-9a-f]{6}(,#[0-9a-f]{6}){0,4})?$'
  AND (cardinality("palette") = 0 OR role = 'POSTER')
);

-- Marathon trail (2026-11-13): seasons or films watched so far; never on a movie; the date goes
-- with a non-zero count.
ALTER TABLE "CatalogItem" ADD CONSTRAINT item_parts_watched CHECK (
  "partsWatched" BETWEEN 0 AND 100
  AND (kind <> 'MOVIE' OR "partsWatched" = 0)
  AND (("partsWatched" = 0) = ("partsWatchedAt" IS NULL))
);
