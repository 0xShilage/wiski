-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — "Dias sem live" (docs/phase-6/README.md §43). Hand-written; any change needs a
-- second reviewer. Guarded by tests/integration/day-off.test.ts.
--
-- Review decisions:
--  1. A stretch is one to 31 calendar days (inclusive, plain DATEs: São Paulo days), between 2000
--     and 2100; the note matches the app's sanitiser limit (140).
--  2. Two stretches never overlap: an exclusion constraint on the inclusive date range (core GiST
--     range operators, no extension needed). The app maps the violation to a 409.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "LiveDayOff" ADD CONSTRAINT live_day_off_values CHECK (
  "endsOn" >= "startsOn" AND
  "endsOn" - "startsOn" <= 30 AND
  "startsOn" >= DATE '2000-01-01' AND "endsOn" <= DATE '2100-12-31' AND
  (note IS NULL OR char_length(note) BETWEEN 1 AND 140));

ALTER TABLE "LiveDayOff" ADD CONSTRAINT live_day_off_no_overlap
  EXCLUDE USING gist (daterange("startsOn", "endsOn", '[]') WITH &&);
