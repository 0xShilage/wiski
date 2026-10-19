-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — R1 redesign invariants (docs/phase-0/11-redesign-spec.md §7, §9).
-- Hand-written; any change needs a second reviewer. Guarded by tests/integration/db-constraints-r1.test.ts.
--
-- Review decisions vs the spec text:
--  1. "partial unique (kind, slot) for live items" is a DEFERRABLE INITIALLY DEFERRED exclusion
--     constraint (same semantics, checked at COMMIT), so a slot reorder can permute positions in
--     one transaction without parking rows on temporary values. Live = ACTIVE | SPONSORED |
--     FUNDED | WATCHED (a watched item keeps its slot until a moderator replaces it).
--  2. "at most 35/10/10 live items per kind, counted under a per-kind advisory lock" is enforced
--     by a BEFORE trigger (not only in the publish transaction), so no code path can exceed it.
--     Raises SQLSTATE WF409 (mapped to HTTP 409 CATALOG_FULL). The count runs after the lock in
--     READ COMMITTED (fresh snapshot per statement); other isolation levels are refused.
--  3. CatalogItem.kind is immutable (same trigger).
--  4. One active MOVIE order per item is a partial unique index declared in schema.prisma
--     (previewFeature partialIndexes), like Phase 1's one_active_ruleset.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. CatalogItem ═══════════════════════════════════════════════════════════

ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_slug_format CHECK (
  slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80);
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_text_len CHECK (
  char_length(title) BETWEEN 1 AND 120
  AND ("originalTitle" IS NULL OR char_length("originalTitle") BETWEEN 1 AND 120)
  AND (director IS NULL OR char_length(director) BETWEEN 1 AND 160)
  AND char_length(synopsis) <= 600
  AND cardinality(genres) <= 6
  AND cardinality("cast") <= 12);
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_year CHECK (year IS NULL OR year BETWEEN 1888 AND 2100);
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_runtime CHECK (
  (kind = 'MOVIE' AND "runtimeMinutes" BETWEEN 1 AND 360) OR
  (kind <> 'MOVIE' AND "runtimeMinutes" BETWEEN 1 AND 20000));
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_slot_range CHECK (
  slot IS NULL OR
  (kind = 'MOVIE' AND slot BETWEEN 1 AND 35) OR
  (kind <> 'MOVIE' AND slot BETWEEN 1 AND 10));
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_slot_state CHECK (
  (status NOT IN ('ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED') OR slot IS NOT NULL) AND
  (status <> 'ARCHIVED' OR slot IS NULL));
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_status_kind CHECK (
  (status <> 'SPONSORED' OR kind = 'MOVIE') AND (status <> 'FUNDED' OR kind <> 'MOVIE'));
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_series_fields CHECK (
  (kind = 'SERIES' OR ("seasonsLabel" IS NULL AND "seasonCount" IS NULL AND "episodeCount" IS NULL)) AND
  ("seasonsLabel" IS NULL OR char_length("seasonsLabel") BETWEEN 1 AND 60) AND
  ("seasonCount" IS NULL OR "seasonCount" BETWEEN 1 AND 100) AND
  ("episodeCount" IS NULL OR "episodeCount" BETWEEN 1 AND 10000));
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_trailer_id CHECK (
  "trailerYoutubeId" IS NULL OR "trailerYoutubeId" ~ '^[A-Za-z0-9_-]{11}$');
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_reservation CHECK (
  ("reservedUntil" IS NULL) = ("reservedOrderId" IS NULL) AND
  ("reservedUntil" IS NULL OR (kind = 'MOVIE' AND status = 'ACTIVE')));
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_lifecycle_times CHECK (
  (status = 'DRAFT' OR "publishedAt" IS NOT NULL) AND
  (status <> 'WATCHED' OR "watchedAt" IS NOT NULL) AND
  (status <> 'ARCHIVED' OR "archivedAt" IS NOT NULL));
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_version CHECK (version >= 0);

-- One live item per (kind, slot), checked at COMMIT (decision 1).
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_live_slot_unique
  EXCLUDE USING btree (kind WITH =, slot WITH =)
  WHERE (status IN ('ACTIVE', 'SPONSORED', 'FUNDED', 'WATCHED'))
  DEFERRABLE INITIALLY DEFERRED;

-- Live limit per kind + immutable kind (decisions 2, 3).
CREATE FUNCTION catalog_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  live_count integer;
  max_live   integer := CASE NEW.kind WHEN 'MOVIE' THEN 35 ELSE 10 END;
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

CREATE TRIGGER catalog_item_guard BEFORE INSERT OR UPDATE OF status, kind ON "CatalogItem"
  FOR EACH ROW EXECUTE FUNCTION catalog_item_guard();

-- ═══ 2. Franchise entries, revisions, media ════════════════════════════════════

ALTER TABLE "FranchiseEntry" ADD CONSTRAINT fe_values CHECK (
  position BETWEEN 1 AND 30 AND char_length(title) BETWEEN 1 AND 120 AND
  "runtimeMinutes" BETWEEN 1 AND 360 AND (year IS NULL OR year BETWEEN 1888 AND 2100));
ALTER TABLE "CatalogRevision" ADD CONSTRAINT rev_values CHECK (
  version >= 1 AND char_length(note) BETWEEN 1 AND 40 AND jsonb_typeof(snapshot) = 'object');
ALTER TABLE "MediaAsset" ADD CONSTRAINT media_values CHECK (
  width > 0 AND height > 0 AND octet_length(sha256) = 32 AND jsonb_typeof(variants) = 'array');

-- ═══ 3. Campaigns (no overfunding) ═════════════════════════════════════════════

ALTER TABLE "Campaign" ADD CONSTRAINT camp_money CHECK (
  "goalCents" BETWEEN 500 AND 100000000 AND "raisedCents" >= 0 AND "reservedCents" >= 0 AND
  "supporterCount" >= 0 AND extensions >= 0 AND version >= 0);
ALTER TABLE "Campaign" ADD CONSTRAINT camp_remaining CHECK (
  "remainingCents" = "goalCents" - "raisedCents" - "reservedCents" AND "remainingCents" >= 0);
ALTER TABLE "Campaign" ADD CONSTRAINT camp_funded CHECK (
  (status IN ('OPEN', 'PAUSED')) OR ("raisedCents" = "goalCents" AND "fundedAt" IS NOT NULL));
ALTER TABLE "Campaign" ADD CONSTRAINT camp_deadline CHECK ("deadlineAt" > "openedAt");

-- ═══ 4. Orders (replaces the Sponsorship checks of 20261002150100_constraints) ══

ALTER TABLE "Order" ADD CONSTRAINT ord_money_nonneg CHECK (
  "subtotalCents" >= 0 AND "discountCents" >= 0 AND "queueJumpCents" >= 0 AND "totalCents" > 0);
ALTER TABLE "Order" ADD CONSTRAINT ord_total_consistent CHECK (
  "totalCents" = "subtotalCents" - "discountCents" + "queueJumpCents");
ALTER TABLE "Order" ADD CONSTRAINT ord_contact_email CHECK (
  "contactEmail" = lower("contactEmail") AND char_length("contactEmail") BETWEEN 6 AND 254);
ALTER TABLE "Order" ADD CONSTRAINT ord_version CHECK (version >= 0);
ALTER TABLE "Order" ADD CONSTRAINT ord_movie_fields CHECK (
  kind <> 'MOVIE' OR (
    "campaignId" IS NULL AND "ruleSetId" IS NOT NULL AND
    -- explicit IS NOT NULL: a NULL comparison would make the CHECK pass
    "runtimeMinutes" IS NOT NULL AND "runtimeMinutes" BETWEEN 1 AND 360 AND
    "rescheduleCount" IS NOT NULL AND "rescheduleCount" >= 0));
ALTER TABLE "Order" ADD CONSTRAINT ord_contribution_fields CHECK (
  kind <> 'CONTRIBUTION' OR (
    "campaignId" IS NOT NULL AND "ruleSetId" IS NULL AND "runtimeMinutes" IS NULL AND
    "sessionId" IS NULL AND "queueJumpTierId" IS NULL AND "rescheduleCount" IS NULL AND
    "discountCents" = 0 AND "queueJumpCents" = 0 AND
    "totalCents" >= 500 AND "totalCents" % 100 = 0));

-- LegalAcceptance.la_subject was dropped with the sponsorshipId column: re-create it.
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT la_subject CHECK ("userId" IS NOT NULL OR "orderId" IS NOT NULL);

-- ═══ 5. Grants ═════════════════════════════════════════════════════════════════
-- New tables inherit wf_app DML through ALTER DEFAULT PRIVILEGES (20261002150100_constraints).
-- Nothing here is append-only, so no extra REVOKEs.
