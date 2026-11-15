-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — blur-up placeholders (docs/phase-6/README.md §46). Hand-written; any change
-- needs a second reviewer. Guarded by tests/integration/media-lqip.test.ts.
--
-- Review decision: the placeholder is rendered into pages (as a CSS background set from script),
-- so the database only ever holds a small base64 WebP data URI — or '' for "can't be made".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "MediaAsset" ADD CONSTRAINT media_asset_lqip CHECK (
  lqip IS NULL OR lqip = '' OR (
    lqip ~ '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$' AND char_length(lqip) <= 3000));
