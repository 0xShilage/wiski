-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — 50 live movies, manual movie prices, "Já pago" orders (docs/phase-6/README.md §9).
-- Hand-written; any change needs a second reviewer. Guarded by
-- tests/integration/db-constraints-phase6.test.ts and db-constraints-r1.test.ts.
--
-- Review decisions:
--  1. Live limits become 50 movies / 20 series / 10 franchises (2026-11-02). The slot range CHECK
--     and the live-count trigger change together; the trigger keeps its advisory lock and
--     READ COMMITTED requirement unchanged.
--  2. manualPriceCents is for movies only, R$ 5,00 to R$ 2.000,00.
--  3. A MANUAL order (registered by the streamer as paid outside the site) is never pending and
--     never carries an IP key; it is born PAID. A manual contribution may be any positive amount
--     (it can close a campaign whose remainder is under R$ 5 or not whole reais); checkout
--     contributions keep the R$ 5 minimum in whole reais.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. 50 live movies ═════════════════════════════════════════════════════════

ALTER TABLE "CatalogItem" DROP CONSTRAINT ci_slot_range;
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_slot_range CHECK (
  slot IS NULL OR
  (kind = 'MOVIE' AND slot BETWEEN 1 AND 50) OR
  (kind = 'SERIES' AND slot BETWEEN 1 AND 20) OR
  (kind = 'FRANCHISE' AND slot BETWEEN 1 AND 10));

CREATE OR REPLACE FUNCTION catalog_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  live_count integer;
  max_live   integer := CASE NEW.kind WHEN 'MOVIE' THEN 50 WHEN 'SERIES' THEN 20 ELSE 10 END;
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

-- ═══ 2. Manual movie price ═════════════════════════════════════════════════════

ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_manual_price CHECK (
  "manualPriceCents" IS NULL OR (kind = 'MOVIE' AND "manualPriceCents" BETWEEN 500 AND 200000));

-- ═══ 3. "Já pago" orders ═══════════════════════════════════════════════════════

ALTER TABLE "Order" ADD CONSTRAINT ord_manual CHECK (
  source <> 'MANUAL' OR (status <> 'PENDING_PAYMENT' AND "ipKey" IS NULL AND "paidAt" IS NOT NULL));

ALTER TABLE "Order" DROP CONSTRAINT ord_contribution_fields;
ALTER TABLE "Order" ADD CONSTRAINT ord_contribution_fields CHECK (
  kind <> 'CONTRIBUTION' OR (
    "campaignId" IS NOT NULL AND "ruleSetId" IS NULL AND "runtimeMinutes" IS NULL AND
    "sessionId" IS NULL AND "queueJumpTierId" IS NULL AND "rescheduleCount" IS NULL AND
    "discountCents" = 0 AND "queueJumpCents" = 0 AND
    (source = 'MANUAL' OR ("totalCents" >= 500 AND "totalCents" % 100 = 0))));
