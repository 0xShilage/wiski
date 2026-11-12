-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Emblemas (docs/phase-6/README.md §38). Hand-written; any change needs a second
-- reviewer. Guarded by tests/integration/badges.test.ts.
--
-- Review decisions:
--  1. The text a badge shows publicly has the shapes the app builds (slug, lengths, no control
--     characters); the window is a real interval; a limit, when set, is positive; the claim word
--     is stored only as a 32-byte SHA-256.
--  2. Claims are checked HERE, not only in the app: a claim outside the badge's window, or past
--     its limit, is refused by a trigger that row-locks the badge first, so two viewers claiming
--     the last place at the same moment can't both get it (SQLSTATE WF410 closed, WF411 full).
--  3. A claim is never updated (it is a fact: who, which badge, when).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Badge" ADD CONSTRAINT badge_values CHECK (
  slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) <= 60 AND
  char_length(name) BETWEEN 1 AND 40 AND name !~ '[[:cntrl:]]' AND
  char_length(description) <= 200 AND description !~ '[[:cntrl:]]' AND
  "endsAt" > "startsAt" AND
  ("maxClaims" IS NULL OR "maxClaims" BETWEEN 1 AND 1000000) AND
  ("codeHash" IS NULL OR octet_length("codeHash") = 32));

CREATE FUNCTION badge_claim_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  b       "Badge"%ROWTYPE;
  claimed integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'BadgeClaim rows are never updated' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO b FROM "Badge" WHERE id = NEW."badgeId" FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key reports it
  END IF;
  NEW."claimedAt" := now(); -- the database's clock decides, never the caller's
  IF NEW."claimedAt" < b."startsAt" OR NEW."claimedAt" >= b."endsAt" THEN
    RAISE EXCEPTION 'badge_closed' USING ERRCODE = 'WF410';
  END IF;
  IF b."maxClaims" IS NOT NULL THEN
    SELECT count(*) INTO claimed FROM "BadgeClaim" WHERE "badgeId" = b.id;
    IF claimed >= b."maxClaims" THEN
      RAISE EXCEPTION 'badge_full' USING ERRCODE = 'WF411';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER badge_claim_guard BEFORE INSERT OR UPDATE ON "BadgeClaim"
  FOR EACH ROW EXECUTE FUNCTION badge_claim_guard();
