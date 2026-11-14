-- Anúncios automáticos (2026-11-13): when the chat bot announced a badge opened.
ALTER TABLE "Badge" ADD COLUMN "announcedAt" TIMESTAMPTZ(3);
