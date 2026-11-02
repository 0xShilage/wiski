-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — release posters, year-only releases and the "Meta total" overlay widget
-- (docs/phase-6/README.md §8). Hand-written; any change needs a second reviewer. Guarded by
-- tests/integration/db-constraints-phase6.test.ts.
--
-- Review decisions:
--  1. A year-only release is stored on 31 December of that year, so it sorts after the releases
--     with a known day in the same year and stays on the Cronograma until the year is over.
--  2. A release's own poster must be a POSTER asset: checked by a trigger (another table), like
--     the series-only link. Removing the asset (ON DELETE SET NULL) is always allowed.
--  3. Overlay keys may open the new "meta-total" widget; five widgets at most.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "SeasonRelease" ADD CONSTRAINT release_year_only CHECK (
  NOT "yearOnly" OR (EXTRACT(MONTH FROM "releaseDate") = 12 AND EXTRACT(DAY FROM "releaseDate") = 31));

CREATE FUNCTION season_release_poster_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."posterId" IS NOT NULL AND
     (SELECT role FROM "MediaAsset" WHERE id = NEW."posterId") IS DISTINCT FROM 'POSTER' THEN
    RAISE EXCEPTION 'SeasonRelease.posterId must reference a POSTER asset' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER season_release_poster_role BEFORE INSERT OR UPDATE OF "posterId" ON "SeasonRelease"
  FOR EACH ROW EXECUTE FUNCTION season_release_poster_role();

ALTER TABLE "OverlayKey" DROP CONSTRAINT ok_values;
ALTER TABLE "OverlayKey" ADD CONSTRAINT ok_values CHECK (
  char_length(label) BETWEEN 1 AND 40 AND "keyPrefix" ~ '^[A-Za-z0-9_-]{6}$' AND
  cardinality(widgets) BETWEEN 1 AND 5 AND
  widgets <@ ARRAY['agora', 'fila', 'meta', 'meta-total', 'patrocinio']::text[] AND
  octet_length("keyHash") = 32);
