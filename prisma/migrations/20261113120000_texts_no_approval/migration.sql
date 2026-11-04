-- Sponsor names and messages go live with the order (2026-11-04): nothing waits for a moderator.
-- Texts still waiting when the rule changed are shown; anything a moderator had already hidden
-- (REJECTED) stays hidden. No schema change: the columns and their CHECKs are unchanged.
UPDATE "Order" SET "displayNameStatus" = 'APPROVED' WHERE "displayNameStatus" = 'PENDING';
UPDATE "Order" SET "messageStatus" = 'APPROVED' WHERE "messageStatus" = 'PENDING';
