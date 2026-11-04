-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — subathon timer (docs/phase-6/README.md §10, 2026-11-03).
-- Hand-written; any change needs a second reviewer. Guarded by
-- tests/integration/subathon.test.ts.
--
-- Review decisions:
--  1. At most one open subathon: openSlot is 1 while open (unique), NULL exactly when ENDED.
--  2. The clock is in exactly one place: endsAt while RUNNING, remainingSeconds otherwise.
--     Starting time and time left stay within 0 … 90 days; an optional cap is 1 min … 90 days.
--  3. secondsPerReal is 1 … 3600 (the base rule is 60: R$ 1 = 60 s).
--  4. Ledger: the seconds an entry asked for and what it applied have the same sign; a REFUND
--     never adds time, an ORDER/TIP/stream event never removes it (0 is allowed: a tiny value
--     can round to 0 s and must still be recorded once); values in cents are ≥ 0.
--  5. Overlay keys may include the "subathon" widget (ok_values replaced, same rules otherwise).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Subathon" ADD CONSTRAINT subathon_open_slot CHECK (
  ("openSlot" IS NULL) = (status = 'ENDED') AND ("openSlot" IS NULL OR "openSlot" = 1));

ALTER TABLE "Subathon" ADD CONSTRAINT subathon_clock CHECK (
  (status = 'RUNNING') = ("endsAt" IS NOT NULL) AND
  (status <> 'RUNNING' OR "startedAt" IS NOT NULL) AND
  (status = 'ENDED') = ("endedAt" IS NOT NULL));

ALTER TABLE "Subathon" ADD CONSTRAINT subathon_ranges CHECK (
  "initialSeconds" BETWEEN 0 AND 7776000 AND
  "remainingSeconds" BETWEEN 0 AND 7776000 AND
  ("capSeconds" IS NULL OR "capSeconds" BETWEEN 60 AND 7776000) AND
  "secondsPerReal" BETWEEN 1 AND 3600 AND
  char_length(title) BETWEEN 1 AND 60);

ALTER TABLE "SubathonEntry" ADD CONSTRAINT subathon_entry_sign CHECK (
  ("valueCents" IS NULL OR "valueCents" >= 0) AND
  (kind = 'MANUAL' OR (kind = 'REFUND' AND seconds <= 0) OR (kind <> 'REFUND' AND seconds >= 0)) AND
  (seconds = 0 OR sign("appliedSeconds") IN (0, sign(seconds))) AND
  abs("appliedSeconds") <= abs(seconds) AND
  char_length("externalId") BETWEEN 1 AND 120 AND
  ("label" IS NULL OR char_length("label") <= 80));

-- 5. Overlay keys may carry the new "subathon" widget (the allow-list of widget names, and up to
--    6 widgets per key).
ALTER TABLE "OverlayKey" DROP CONSTRAINT ok_values;
ALTER TABLE "OverlayKey" ADD CONSTRAINT ok_values CHECK (
  char_length(label) BETWEEN 1 AND 40 AND "keyPrefix" ~ '^[A-Za-z0-9_-]{6}$' AND
  cardinality(widgets) BETWEEN 1 AND 6 AND
  widgets <@ ARRAY['agora', 'fila', 'meta', 'meta-total', 'patrocinio', 'subathon']::text[] AND
  octet_length("keyHash") = 32);
