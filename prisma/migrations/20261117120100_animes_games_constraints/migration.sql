-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Animes and Jogos (docs/phase-6/README.md §21). Hand-written; any change needs a
-- second reviewer. Guarded by tests/integration/animes-games.test.ts.
--
-- Review decisions:
--  1. ANIME works like SERIES (seasons, episodes, a crowdfunded campaign, episode parts on the
--     live) on its own tab, with its own limit: 20 live animes (slots 1 … 20). The slot range
--     CHECK and the guard trigger change together; the trigger is otherwise unchanged from
--     20261116120100 (slots only for ACTIVE, freed on leaving it, assigned on coming back).
--  2. The season fields (seasonsLabel, seasonCount, episodeCount) are allowed on SERIES and ANIME.
--  3. "Próximas temporadas" may link an ANIME as well as a SERIES.
--  4. Game: text lengths match the app's limits; a VOD link is an https Twitch or YouTube URL
--     (the app parses it with the WHATWG URL parser first, this is the backstop); "Zerado em" /
--     "Dropado em" only for a finished or dropped game.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. ANIME on the board ═════════════════════════════════════════════════════

ALTER TABLE "CatalogItem" DROP CONSTRAINT ci_slot_range;
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_slot_range CHECK (
  slot IS NULL OR
  (kind = 'MOVIE' AND slot BETWEEN 1 AND 50) OR
  (kind = 'SERIES' AND slot BETWEEN 1 AND 50) OR
  (kind = 'ANIME' AND slot BETWEEN 1 AND 20) OR
  (kind = 'FRANCHISE' AND slot BETWEEN 1 AND 10));

CREATE OR REPLACE FUNCTION catalog_item_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  live_count integer;
  free_slot  integer;
  max_live   integer := CASE NEW.kind
    WHEN 'MOVIE' THEN 50 WHEN 'SERIES' THEN 50 WHEN 'ANIME' THEN 20 ELSE 10 END;
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

-- ═══ 2. Season fields ══════════════════════════════════════════════════════════

ALTER TABLE "CatalogItem" DROP CONSTRAINT ci_series_fields;
ALTER TABLE "CatalogItem" ADD CONSTRAINT ci_series_fields CHECK (
  (kind IN ('SERIES', 'ANIME') OR
   ("seasonsLabel" IS NULL AND "seasonCount" IS NULL AND "episodeCount" IS NULL)) AND
  ("seasonsLabel" IS NULL OR char_length("seasonsLabel") BETWEEN 1 AND 60) AND
  ("seasonCount" IS NULL OR "seasonCount" BETWEEN 1 AND 100) AND
  ("episodeCount" IS NULL OR "episodeCount" BETWEEN 1 AND 10000));

-- ═══ 3. "Próximas temporadas" for animes ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION season_release_series_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."itemId" IS NOT NULL AND
     (SELECT kind FROM "CatalogItem" WHERE id = NEW."itemId") NOT IN ('SERIES', 'ANIME') THEN
    RAISE EXCEPTION 'SeasonRelease.itemId must reference a SERIES or an ANIME'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ═══ 4. Games ══════════════════════════════════════════════════════════════════

ALTER TABLE "Game" ADD CONSTRAINT game_values CHECK (
  char_length(title) BETWEEN 1 AND 120 AND
  (platform IS NULL OR char_length(platform) BETWEEN 1 AND 40) AND
  (note IS NULL OR char_length(note) BETWEEN 1 AND 140) AND
  (year IS NULL OR year BETWEEN 1950 AND 2100) AND
  version >= 0);
ALTER TABLE "Game" ADD CONSTRAINT game_vod CHECK (
  "vodUrl" IS NULL OR (
    char_length("vodUrl") <= 300 AND
    "vodUrl" ~ '^https://(www\.|m\.)?(twitch\.tv|youtube\.com|youtu\.be)/[A-Za-z0-9/_?=&.%-]+$'));
ALTER TABLE "Game" ADD CONSTRAINT game_finished CHECK (
  "finishedOn" IS NULL OR status IN ('FINISHED', 'DROPPED'));
