-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — the badge next to the username (docs/phase-6/README.md §51). Hand-written; any
-- change needs a second reviewer. Guarded by tests/integration/name-badge.test.ts.
--
-- Review decisions:
--  1. One badge at most: an event badge, a conquista or the staff role, never two at once.
--  2. An event badge only if this viewer claimed it (SQLSTATE WF412). Claims are only ever removed
--     by erasing the account's data; the badge goes with the claim.
--  3. The role badge only for staff; losing the role turns it off in the same row write.
--  4. A conquista is an id from src/lib/achievements.ts (shape checked here; whether it is still
--     earned is checked when chosen and again by the worker every night, since a refund can undo it).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "User" ADD CONSTRAINT user_name_badge_one
  CHECK (("nameBadgeEmblemId" IS NOT NULL)::int + ("nameBadgeAchievement" IS NOT NULL)::int
         + "nameBadgeRole"::int <= 1);

ALTER TABLE "User" ADD CONSTRAINT user_name_badge_achievement
  CHECK ("nameBadgeAchievement" IS NULL OR "nameBadgeAchievement" ~ '^[a-z0-9-]{1,40}$');

ALTER TABLE "User" ADD CONSTRAINT user_name_badge_role_staff
  CHECK (NOT "nameBadgeRole" OR role <> 'USER');

CREATE FUNCTION user_name_badge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'USER' THEN
    NEW."nameBadgeRole" := false;
  END IF;
  IF NEW."nameBadgeEmblemId" IS NOT NULL
     AND NEW."nameBadgeEmblemId" IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD."nameBadgeEmblemId" END)
     AND NOT EXISTS (
       SELECT 1 FROM "BadgeClaim" c
       WHERE c."badgeId" = NEW."nameBadgeEmblemId" AND c."userId" = NEW.id
     ) THEN
    RAISE EXCEPTION 'name_badge_not_claimed' USING ERRCODE = 'WF412';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER user_name_badge_guard BEFORE INSERT OR UPDATE OF "nameBadgeEmblemId", role ON "User"
  FOR EACH ROW EXECUTE FUNCTION user_name_badge_guard();

CREATE FUNCTION badge_claim_clear_name_badge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "User" SET "nameBadgeEmblemId" = NULL
    WHERE id = OLD."userId" AND "nameBadgeEmblemId" = OLD."badgeId";
  RETURN OLD;
END $$;

CREATE TRIGGER badge_claim_clear_name_badge AFTER DELETE ON "BadgeClaim"
  FOR EACH ROW EXECUTE FUNCTION badge_claim_clear_name_badge();
