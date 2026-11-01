-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — "Próximas temporadas" (docs/phase-6/README.md §6). Hand-written; any change
-- needs a second reviewer. Guarded by tests/integration/db-constraints-phase6.test.ts.
--
-- Review decisions:
--  1. Text lengths match the app's sanitiser limits; the release day is a plain DATE (a calendar
--     day, no time zone), between 2000 and 2100.
--  2. A linked catalog item must be a SERIES: checked by a trigger, because a CHECK cannot look
--     at another table. Unlinking (ON DELETE SET NULL) is always allowed.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "SeasonRelease" ADD CONSTRAINT release_values CHECK (
  char_length(title) BETWEEN 1 AND 120 AND
  char_length("seasonLabel") BETWEEN 1 AND 40 AND
  (note IS NULL OR char_length(note) BETWEEN 1 AND 80) AND
  "releaseDate" BETWEEN DATE '2000-01-01' AND DATE '2100-12-31');

CREATE FUNCTION season_release_series_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."itemId" IS NOT NULL AND
     (SELECT kind FROM "CatalogItem" WHERE id = NEW."itemId") IS DISTINCT FROM 'SERIES' THEN
    RAISE EXCEPTION 'SeasonRelease.itemId must reference a SERIES' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER season_release_series_only BEFORE INSERT OR UPDATE OF "itemId" ON "SeasonRelease"
  FOR EACH ROW EXECUTE FUNCTION season_release_series_only();
