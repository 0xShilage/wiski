-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Guia de Winden photos (docs/phase-6/README.md §37). Hand-written; any change
-- needs a second reviewer. Guarded by tests/integration/guide-portraits.test.ts.
--
-- Review decisions:
--  1. `guide` and `slot` end up in an alt text and a CSS-free attribute on a public page, so the
--     database only takes the shapes the code builds: a guide id and "<person>:<era>".
--  2. That the asset is a PORTRAIT is checked by the app (an enum cast in a CHECK would need the
--     new enum value committed first, which this migration runs alongside).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "GuidePortrait" ADD CONSTRAINT guide_portrait_guide
  CHECK (guide ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(guide) <= 40);

ALTER TABLE "GuidePortrait" ADD CONSTRAINT guide_portrait_slot
  CHECK (slot ~ '^[a-z0-9]+(?:-[a-z0-9]+)*:(?:19[0-9]{2}|20[0-9]{2})$' AND char_length(slot) <= 60);
