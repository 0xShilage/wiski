-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — 50 live series, agenda order and clearing, event posters
-- (docs/phase-6/README.md §18). Hand-written; any change needs a second reviewer. Guarded by
-- tests/integration/db-constraints-phase6.test.ts and agenda-batch.test.ts.
--
-- Review decisions:
--  1. Live limits become 50 movies / 50 series / 10 franchises (2026-11-09). The slot range CHECK
--     and the live-count trigger change together; the trigger keeps its advisory lock and
--     READ COMMITTED requirement unchanged.
--  2. Only a session that is over (DONE) or CANCELLED can be hidden from the agenda.
--  3. A session's manual entry order is a short list of "KIND:<uuid>" keys (the app checks they
--     belong to the session; stale keys are ignored when sorting).
--  4. A poster belongs to a custom EVENT only (a part shows its title's poster).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. 50 live series ═════════════════════════════════════════════════════════

ALTER TABLE "CatalogItem" DROP CONSTRAINT ci_slot_range;
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_slot_range CHECK (
  slot IS NULL OR
  (kind = 'MOVIE' AND slot BETWEEN 1 AND 50) OR
  (kind = 'SERIES' AND slot BETWEEN 1 AND 50) OR
  (kind = 'FRANCHISE' AND slot BETWEEN 1 AND 10));

CREATE OR REPLACE FUNCTION catalog_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  live_count integer;
  max_live   integer := CASE NEW.kind WHEN 'MOVIE' THEN 50 WHEN 'SERIES' THEN 50 ELSE 10 END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'CatalogItem.kind is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED') THEN
    RETURN NEW; -- already counted
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'CatalogItem publish requires READ COMMITTED isolation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('wiskiflix.catalog_live.' || NEW.kind::text));
  SELECT count(*) INTO live_count FROM "CatalogItem"
   WHERE kind = NEW.kind AND id <> NEW.id
     AND status IN ('ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED');
  IF live_count >= max_live THEN
    RAISE EXCEPTION 'catalog_live_limit: % live % items', live_count, NEW.kind
      USING ERRCODE = 'WF409';
  END IF;
  RETURN NEW;
END $$;

-- ═══ 2. Clearing the agenda ════════════════════════════════════════════════════

ALTER TABLE "StreamSession" ADD CONSTRAINT ss_hidden CHECK (
  "hiddenAt" IS NULL OR status IN ('DONE', 'CANCELLED'));

-- ═══ 3. Manual entry order ═════════════════════════════════════════════════════

ALTER TABLE "StreamSession" ADD CONSTRAINT ss_entry_order CHECK (
  cardinality("entryOrder") <= 300 AND
  array_to_string("entryOrder", ',') ~ '^((ORDER|CAMPAIGN|SEGMENT):[0-9a-f-]{36}(,|$))*$');

-- ═══ 4. Event posters ══════════════════════════════════════════════════════════

ALTER TABLE "LiveSegment" ADD CONSTRAINT seg_poster CHECK ("posterId" IS NULL OR kind = 'EVENT');
