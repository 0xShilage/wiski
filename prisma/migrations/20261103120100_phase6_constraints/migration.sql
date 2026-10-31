-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Phase 6: 20 live series, the Links page, viewer suggestions (docs/phase-6/README.md).
-- Hand-written; any change needs a second reviewer. Guarded by
-- tests/integration/db-constraints-phase6.test.ts and db-constraints-r1.test.ts.
--
-- Review decisions:
--  1. Live limits become 35 movies / 20 series / 10 franchises (2026-10-31). The slot range CHECK
--     and the live-count trigger change together; the trigger keeps its advisory lock and
--     READ COMMITTED requirement unchanged.
--  2. SocialLink.url is https only, without user-info, spaces or control characters; the app
--     parses it with the WHATWG URL parser first, this CHECK is the backstop.
--  3. SocialLink.position is unique and DEFERRABLE INITIALLY DEFERRED (a reorder permutes rows in
--     one transaction); 1…30 caps the page at 30 links.
--  4. Suggestion: reviewer and time are set exactly when the status leaves NEW; the titleKey is
--     derived by the app (lower-case letters and digits without accents, single spaces).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. 20 live series ═════════════════════════════════════════════════════════

ALTER TABLE "CatalogItem" DROP CONSTRAINT ci_slot_range;
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_slot_range CHECK (
  slot IS NULL OR
  (kind = 'MOVIE' AND slot BETWEEN 1 AND 35) OR
  (kind = 'SERIES' AND slot BETWEEN 1 AND 20) OR
  (kind = 'FRANCHISE' AND slot BETWEEN 1 AND 10));

CREATE OR REPLACE FUNCTION catalog_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  live_count integer;
  max_live   integer := CASE NEW.kind WHEN 'MOVIE' THEN 35 WHEN 'SERIES' THEN 20 ELSE 10 END;
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

-- ═══ 2. Links page ═════════════════════════════════════════════════════════════

ALTER TABLE "SocialLink" ADD CONSTRAINT link_values CHECK (
  char_length(label) BETWEEN 1 AND 40 AND
  (note IS NULL OR char_length(note) BETWEEN 1 AND 80) AND
  char_length(url) BETWEEN 12 AND 300 AND
  url ~ '^https://[^/?#@[:space:][:cntrl:]]+\.[^/?#@[:space:][:cntrl:]]+([/?#][^[:space:][:cntrl:]]*)?$' AND
  position BETWEEN 1 AND 30);

ALTER TABLE "SocialLink" ADD CONSTRAINT link_position_unique UNIQUE (position)
  DEFERRABLE INITIALLY DEFERRED;

-- ═══ 3. Suggestions ════════════════════════════════════════════════════════════

ALTER TABLE "Suggestion" ADD CONSTRAINT suggestion_values CHECK (
  char_length(title) BETWEEN 1 AND 120 AND
  "titleKey" = lower("titleKey") AND char_length("titleKey") BETWEEN 1 AND 120 AND
  "titleKey" !~ '(^ | $|  )' AND
  (year IS NULL OR year BETWEEN 1888 AND 2100) AND
  (note IS NULL OR char_length(note) BETWEEN 1 AND 280));

ALTER TABLE "Suggestion" ADD CONSTRAINT suggestion_review CHECK (
  (status = 'NEW') = ("reviewedAt" IS NULL) AND
  (status <> 'NEW' OR "reviewedById" IS NULL) AND
  ("reviewedAt" IS NULL OR "reviewedAt" >= "createdAt"));
