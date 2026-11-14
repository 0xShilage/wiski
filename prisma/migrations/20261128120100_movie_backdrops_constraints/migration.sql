-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — more backgrounds for a movie (docs/phase-6/README.md §45). Hand-written; any
-- change needs a second reviewer. Guarded by tests/integration/movie-backdrops.test.ts.
--
-- Review decisions:
--  1. Up to four extra backgrounds (positions 1–4) after the main one: five in all.
--  2. Movies only, and only BACKDROP assets: a trigger checks both on insert/update (a CHECK
--     can't look at other tables). The service says it first, in Portuguese; this is the floor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "CatalogItemBackdrop" ADD CONSTRAINT catalog_item_backdrop_position
  CHECK ("position" BETWEEN 1 AND 4);

CREATE OR REPLACE FUNCTION catalog_item_backdrop_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT kind FROM "CatalogItem" WHERE id = NEW."itemId") IS DISTINCT FROM 'MOVIE' THEN
    RAISE EXCEPTION 'extra backgrounds are for movies only' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT role FROM "MediaAsset" WHERE id = NEW."assetId") IS DISTINCT FROM 'BACKDROP' THEN
    RAISE EXCEPTION 'extra backgrounds must be BACKDROP assets' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER catalog_item_backdrop_check
  BEFORE INSERT OR UPDATE ON "CatalogItemBackdrop"
  FOR EACH ROW EXECUTE FUNCTION catalog_item_backdrop_check();
