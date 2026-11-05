-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — live segments: parts of a series/franchise and custom events on a live
-- (docs/phase-6/README.md §14, 2026-11-04). Hand-written; any change needs a second reviewer.
-- Guarded by tests/integration/live-segments.test.ts.
--
-- Review decisions:
--  1. A PART belongs to a campaign; an EVENT never does and carries no episode or film fields.
--  2. A series part names a season and an episode range (1 … 999, from ≤ to); a franchise part
--     names one film by position. Never both.
--  3. The label is 1 … 80 characters, the public note at most 140, the length 1 … 1440 minutes.
--  4. Done ⇔ doneAt set, never before the segment was created.
--  5. At most one segment is "Agora assistindo" per session: the partial unique index
--     live_segment_one_playing (schema.prisma).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "LiveSegment" ADD CONSTRAINT live_segment_kind CHECK (
  (kind = 'PART') = ("campaignId" IS NOT NULL) AND
  (kind = 'PART' OR ("seasonNumber" IS NULL AND "episodeFrom" IS NULL AND "episodeTo" IS NULL
                     AND "franchisePosition" IS NULL)));

ALTER TABLE "LiveSegment" ADD CONSTRAINT live_segment_part CHECK (
  ("seasonNumber" IS NULL AND "episodeFrom" IS NULL AND "episodeTo" IS NULL) OR
  ("seasonNumber" BETWEEN 1 AND 99 AND "episodeFrom" BETWEEN 1 AND 999 AND
   "episodeTo" BETWEEN "episodeFrom" AND 999 AND "franchisePosition" IS NULL));

ALTER TABLE "LiveSegment" ADD CONSTRAINT live_segment_film CHECK (
  "franchisePosition" IS NULL OR "franchisePosition" BETWEEN 0 AND 999);

ALTER TABLE "LiveSegment" ADD CONSTRAINT live_segment_values CHECK (
  char_length(label) BETWEEN 1 AND 80 AND
  (note IS NULL OR char_length(note) BETWEEN 1 AND 140) AND
  minutes BETWEEN 1 AND 1440 AND
  version >= 0);

ALTER TABLE "LiveSegment" ADD CONSTRAINT live_segment_done CHECK (
  (status = 'DONE') = ("doneAt" IS NOT NULL) AND
  ("doneAt" IS NULL OR "doneAt" >= "createdAt"));
