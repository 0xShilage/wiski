-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — "Fila": a paid title leaves its tab and frees its slot (docs/phase-6/README.md
-- §20). Hand-written; any change needs a second reviewer. Guarded by
-- tests/integration/db-constraints-r1.test.ts and queue-tab.test.ts.
--
-- Review decisions:
--  1. Only an ACTIVE item (open for sponsorship) holds a slot and counts towards the 50/50/10
--     limit. SPONSORED, FUNDED, WATCHED and ARCHIVED items never have a slot; DRAFT may keep a
--     planned one. Existing SPONSORED/FUNDED/WATCHED rows give their slot up here.
--  2. The guard trigger clears the slot whenever an item leaves ACTIVE for one of those states,
--     so no code path can forget it.
--  3. An item coming back to ACTIVE without a slot (a refund, "Desfazer registro", "Desmarcar
--     assistido", a campaign falling under its goal) gets the lowest free slot, chosen under the
--     same per-kind advisory lock as the count. If the board is full it comes back as a DRAFT
--     instead (publishedAt kept): a refund must never fail because the board filled up.
--  4. Publishing a draft (DRAFT → ACTIVE) still has to fit: full → WF409, as before.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Slots only for ACTIVE items ════════════════════════════════════════════

ALTER TABLE "CatalogItem" DROP CONSTRAINT ci_live_slot_unique;
ALTER TABLE "CatalogItem" DROP CONSTRAINT ci_slot_state;

UPDATE "CatalogItem" SET slot = NULL WHERE status IN ('SPONSORED', 'FUNDED', 'WATCHED');

ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_slot_state CHECK (
  (status <> 'ACTIVE' OR slot IS NOT NULL) AND
  (status NOT IN ('SPONSORED', 'FUNDED', 'WATCHED', 'ARCHIVED') OR slot IS NULL));

-- One ACTIVE item per (kind, slot), checked at COMMIT (a slot reorder permutes in one go).
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_live_slot_unique
  EXCLUDE USING btree (kind WITH =, slot WITH =)
  WHERE (status = 'ACTIVE')
  DEFERRABLE INITIALLY DEFERRED;

-- ═══ 2–4. The guard trigger ════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION catalog_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  live_count integer;
  free_slot  integer;
  max_live   integer := CASE NEW.kind WHEN 'MOVIE' THEN 50 WHEN 'SERIES' THEN 50 ELSE 10 END;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'CatalogItem.kind is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('SPONSORED', 'FUNDED', 'WATCHED', 'ARCHIVED') THEN
    NEW.slot := NULL; -- paid, watched or archived: the slot is free again
    RETURN NEW;
  END IF;
  IF NEW.status <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' THEN
    RETURN NEW; -- already counted
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'CatalogItem publish requires READ COMMITTED isolation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('wiskiflix.catalog_live.' || NEW.kind::text));
  SELECT count(*) INTO live_count FROM "CatalogItem"
   WHERE kind = NEW.kind AND id <> NEW.id AND status = 'ACTIVE';
  IF NEW.slot IS NULL AND live_count < max_live THEN
    SELECT min(s) INTO free_slot FROM generate_series(1, max_live) AS s
     WHERE NOT EXISTS (
       SELECT 1 FROM "CatalogItem" c
        WHERE c.kind = NEW.kind AND c.status = 'ACTIVE' AND c.slot = s AND c.id <> NEW.id);
    NEW.slot := free_slot;
  END IF;
  IF live_count >= max_live OR NEW.slot IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.status IN ('SPONSORED', 'FUNDED', 'WATCHED') THEN
      NEW.status := 'DRAFT'; -- coming back with the board full: back to the drafts
      NEW.slot := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'catalog_live_limit: % live % items', live_count, NEW.kind
      USING ERRCODE = 'WF409';
  END IF;
  RETURN NEW;
END $$;
