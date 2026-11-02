-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Phase 3 (reviews, likes, reports, moderation) invariants:
-- docs/phase-3/README.md §3, 02 §2, 05 §8 and Q15. Hand-written; any change needs a second
-- reviewer. Guarded by tests/integration/db-constraints-p3.test.ts.
--
-- Review decisions:
--  1. Counters are kept by triggers, not by application code: "likeCount" (ReviewLike rows) and
--     "openReportCount" (ReviewReport rows with status OPEN). Every write path — the API, the
--     seed, a cascade — keeps them exact, and the UPDATE inside the trigger row-locks the review,
--     so concurrent reports on one review are serialised: the auto-hide count that runs after the
--     report INSERT always sees every earlier committed report (READ COMMITTED).
--  2. Nobody can like or report their own review — checked by the API (422) and again here
--     (check_violation) so a bug in one path can't inflate a review.
--  3. AUTO_HIDDEN always carries its reason (too many links, or the report threshold).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Value checks ═══════════════════════════════════════════════════════════

ALTER TABLE "Review" ADD CONSTRAINT review_hold CHECK ((status = 'AUTO_HIDDEN') = ("heldReason" IS NOT NULL));
ALTER TABLE "Review" ADD CONSTRAINT review_open_reports CHECK ("openReportCount" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT review_times CHECK (
  ("editedAt" IS NULL OR "editedAt" >= "createdAt") AND
  ("moderatedAt" IS NULL OR "moderatedAt" >= "createdAt"));

ALTER TABLE "ReviewReport" ADD CONSTRAINT rr_note CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500);
ALTER TABLE "ReviewReport" ADD CONSTRAINT rr_resolution CHECK (
  (status = 'OPEN') = ("resolvedAt" IS NULL) AND (status <> 'OPEN' OR "resolvedById" IS NULL));

-- ═══ 2. No self-likes, no self-reports ═════════════════════════════════════════

CREATE FUNCTION review_self_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor uuid;
BEGIN
  -- separate branches: PL/pgSQL resolves NEW.<column> at run time, per table
  IF TG_TABLE_NAME = 'ReviewLike' THEN
    actor := NEW."userId";
  ELSE
    actor := NEW."reporterId";
  END IF;
  IF EXISTS (SELECT 1 FROM "Review" r WHERE r.id = NEW."reviewId" AND r."userId" = actor) THEN
    RAISE EXCEPTION '%: own review', TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER review_like_self_guard BEFORE INSERT ON "ReviewLike"
  FOR EACH ROW EXECUTE FUNCTION review_self_guard();
CREATE TRIGGER review_report_self_guard BEFORE INSERT ON "ReviewReport"
  FOR EACH ROW EXECUTE FUNCTION review_self_guard();

-- ═══ 3. Counters ═══════════════════════════════════════════════════════════════

CREATE FUNCTION review_like_count() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Review" SET "likeCount" = "likeCount" + 1 WHERE id = NEW."reviewId";
  ELSE
    -- a cascade from a deleted review updates nothing (the review row is already gone)
    UPDATE "Review" SET "likeCount" = "likeCount" - 1 WHERE id = OLD."reviewId";
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER review_like_count AFTER INSERT OR DELETE ON "ReviewLike"
  FOR EACH ROW EXECUTE FUNCTION review_like_count();

CREATE FUNCTION review_open_report_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  delta int := 0;
  rid uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    rid := NEW."reviewId";
    IF NEW.status = 'OPEN' THEN delta := 1; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    rid := OLD."reviewId";
    IF OLD.status = 'OPEN' THEN delta := -1; END IF;
  ELSE
    IF NEW."reviewId" <> OLD."reviewId" THEN
      RAISE EXCEPTION 'ReviewReport.reviewId is immutable' USING ERRCODE = 'check_violation';
    END IF;
    rid := NEW."reviewId";
    delta := (NEW.status = 'OPEN')::int - (OLD.status = 'OPEN')::int;
  END IF;
  IF delta <> 0 THEN
    UPDATE "Review" SET "openReportCount" = "openReportCount" + delta WHERE id = rid;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER review_open_report_count AFTER INSERT OR UPDATE OF status, "reviewId" OR DELETE ON "ReviewReport"
  FOR EACH ROW EXECUTE FUNCTION review_open_report_count();

-- Back-fill (rows written before Phase 3 — normally none).
UPDATE "Review" r SET
  "likeCount" = (SELECT count(*) FROM "ReviewLike" l WHERE l."reviewId" = r.id),
  "openReportCount" = (SELECT count(*) FROM "ReviewReport" p WHERE p."reviewId" = r.id AND p.status = 'OPEN');
