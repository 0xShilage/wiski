-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — SocialLink.position: deferred UNIQUE → deferred EXCLUDE (2026-11-02).
-- Hand-written; any change needs a second reviewer. Guarded by
-- tests/integration/db-constraints-phase6.test.ts.
--
-- Review decision: the rule is unchanged (one link per position, checked at COMMIT so a
-- reorder can permute rows in one transaction). A UNIQUE constraint is visible to Prisma, which
-- cannot express DEFERRABLE, so the CI drift check (`migrate diff --from-migrations
-- --to-schema`) reported it as an index missing from schema.prisma. An exclusion constraint on
-- `position WITH =` enforces the same thing and is invisible to Prisma, exactly like
-- ci_live_slot_unique (20261002230100_r1_constraints). Violations now raise SQLSTATE 23P01.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "SocialLink" DROP CONSTRAINT link_position_unique;
ALTER TABLE "SocialLink" ADD CONSTRAINT link_position_unique
  EXCLUDE USING btree (position WITH =)
  DEFERRABLE INITIALLY DEFERRED;
