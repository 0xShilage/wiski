-- Ambient glow (docs/phase-6/README.md §33): the poster's accent colour, worked out once from the
-- re-encoded image. NULL = not worked out yet (assets uploaded before this column).
ALTER TABLE "MediaAsset" ADD COLUMN "accent" TEXT;
