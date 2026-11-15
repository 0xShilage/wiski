-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — publishing helpers (docs/phase-6/README.md §50). Hand-written; any change needs
-- a second reviewer. Guarded by tests/integration/publishing-helpers.test.ts.
--
-- Review decisions:
--  1. wikidataId is only ever a Wikidata item id ("Q" + digits), never a URL or free text.
--  2. A scheduled publish (publishAt) and its failure note (publishError, ≤ 300 chars) belong to
--     movie drafts only: series, animes and franchises go live through a campaign.
--  3. Leaving DRAFT (published, watched off stream, by the worker or by hand) clears both in the
--     same row write, so no code path can leave a stale schedule behind; the CHECK is the floor.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "CatalogItem" ADD CONSTRAINT catalog_item_wikidata_id
  CHECK ("wikidataId" IS NULL OR "wikidataId" ~ '^Q[1-9][0-9]{0,11}$');

ALTER TABLE "CatalogItem" ADD CONSTRAINT catalog_item_publish_at_draft
  CHECK (("publishAt" IS NULL AND "publishError" IS NULL) OR (kind = 'MOVIE' AND status = 'DRAFT'));

ALTER TABLE "CatalogItem" ADD CONSTRAINT catalog_item_publish_error_len
  CHECK ("publishError" IS NULL OR char_length("publishError") BETWEEN 1 AND 300);

CREATE OR REPLACE FUNCTION catalog_item_clear_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'DRAFT' THEN
    NEW."publishAt" := NULL;
    NEW."publishError" := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER catalog_item_clear_schedule
  BEFORE INSERT OR UPDATE OF status ON "CatalogItem"
  FOR EACH ROW EXECUTE FUNCTION catalog_item_clear_schedule();
