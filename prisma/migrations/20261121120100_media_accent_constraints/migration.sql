-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Ambient glow (docs/phase-6/README.md §33). Hand-written; any change needs a
-- second reviewer. Guarded by tests/integration/ambient.test.ts.
--
-- Review decisions:
--  1. The accent is rendered into an SVG attribute on the title page, so the database only
--     accepts a lowercase #rrggbb colour: nothing else can ever reach that attribute.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "MediaAsset" ADD CONSTRAINT media_accent_hex
  CHECK (accent IS NULL OR accent ~ '^#[0-9a-f]{6}$');
