-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — database-enforced invariants that Prisma's schema language cannot express.
-- Source of truth: docs/phase-0/02-data-model.md §4 (with the Phase 1 review fixes below).
-- This is the only hand-written SQL in the project. Any change needs a second reviewer.
--
-- Phase 1 review fixes vs the Phase 0 draft:
--  1. Audit hash input is a canonical jsonb array (unambiguous field boundaries, NULL-safe) and
--     the timestamp is rendered in UTC with a fixed format, so the hash no longer depends on the
--     session's TimeZone/DateStyle (the draft used concat_ws(at::text, …)).
--  2. id and at are assigned by the trigger *under the advisory lock*, so chain order == id
--     order even with concurrent writers, and the application cannot backdate an entry.
--  3. TRUNCATE is blocked too (row triggers don't fire on TRUNCATE).
--  4. Built-in sha256() instead of the pgcrypto extension (no extension privileges needed).
--  5. Grants are applied only when the wf_app role exists (local dev databases may not have it).
--  6. The two partial unique indexes moved into schema.prisma (Prisma 7 "partialIndexes"), so
--     `prisma migrate dev` tracks them instead of reporting drift.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Value checks ═════════════════════════════════════════════════════════

ALTER TABLE "Review"          ADD CONSTRAINT review_rating_range  CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "Review"          ADD CONSTRAINT review_body_len      CHECK (char_length(body) BETWEEN 1 AND 2000);
ALTER TABLE "Review"          ADD CONSTRAINT review_like_count    CHECK ("likeCount" >= 0);
ALTER TABLE "User"            ADD CONSTRAINT user_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$');
ALTER TABLE "UsernameHold"    ADD CONSTRAINT hold_username_format CHECK (username ~ '^[a-z0-9_]{3,20}$' AND "holdUntil" > "releasedAt");
ALTER TABLE "Session"         ADD CONSTRAINT session_expiry_order CHECK ("idleExpiresAt" <= "expiresAt" AND "createdAt" < "expiresAt");
ALTER TABLE "Sponsorship"     ADD CONSTRAINT sp_money_nonneg      CHECK ("subtotalCents" >= 0 AND "discountCents" >= 0 AND "queueJumpCents" >= 0 AND "totalCents" > 0);
ALTER TABLE "Sponsorship"     ADD CONSTRAINT sp_total_consistent  CHECK ("totalCents" = "subtotalCents" - "discountCents" + "queueJumpCents");
ALTER TABLE "Sponsorship"     ADD CONSTRAINT sp_contact_email     CHECK ("contactEmail" = lower("contactEmail") AND char_length("contactEmail") BETWEEN 6 AND 254);
ALTER TABLE "Sponsorship"     ADD CONSTRAINT sp_reschedule_count  CHECK ("rescheduleCount" >= 0 AND version >= 0);
ALTER TABLE "Payment"         ADD CONSTRAINT pay_amount_pos       CHECK ("amountCents" > 0);
ALTER TABLE "Payment"         ADD CONSTRAINT pay_currency_brl     CHECK (currency = 'BRL');
ALTER TABLE "Refund"          ADD CONSTRAINT refund_amount_pos    CHECK ("amountCents" > 0);
ALTER TABLE "QueueJumpSlot"   ADD CONSTRAINT qj_multiplier_bounds CHECK ("multiplierBps" BETWEEN 8000 AND 16000);
ALTER TABLE "QueueJumpSlot"   ADD CONSTRAINT qj_index_nonneg      CHECK ("dayIndex" >= 0 AND "weekIndex" >= 0);
ALTER TABLE "QueueJumpSlot"   ADD CONSTRAINT qj_iso_week_format   CHECK ("isoWeek" ~ '^[0-9]{4}-W[0-9]{2}$');
ALTER TABLE "StreamSession"   ADD CONSTRAINT ss_capacity          CHECK ("bookedMinutes" >= 0 AND "bookedMinutes" <= "capacityMinutes");
ALTER TABLE "Voucher"         ADD CONSTRAINT voucher_kind_values  CHECK (
  (kind = 'PERCENT' AND "percentBps" BETWEEN 1 AND 10000 AND "amountCents" IS NULL) OR
  (kind = 'FIXED'   AND "amountCents" > 0 AND "percentBps" IS NULL));
ALTER TABLE "Voucher"         ADD CONSTRAINT voucher_count        CHECK ("redemptionCount" >= 0 AND ("maxRedemptions" IS NULL OR "redemptionCount" <= "maxRedemptions"));
ALTER TABLE "Voucher"         ADD CONSTRAINT voucher_code_format  CHECK (code ~ '^[A-Z0-9-]{8,32}$');
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT la_subject           CHECK ("userId" IS NOT NULL OR "sponsorshipId" IS NOT NULL);
ALTER TABLE "CatalogPackage"  ADD CONSTRAINT pkg_values           CHECK ("seasonNumber" >= 0 AND "episodeCount" >= 1 AND "runtimeMinutes" > 0);
ALTER TABLE "CatalogPackage"  ADD CONSTRAINT pkg_price_override   CHECK (
  ("priceOverrideCents" IS NULL AND "priceOverrideReason" IS NULL) OR
  ("priceOverrideCents" > 0 AND char_length("priceOverrideReason") >= 3));

-- ═══ 2. "Exactly one" rules ═══════════════════════════════════════════════════
-- one_active_ruleset / one_current_legaldoc are partial unique indexes declared in schema.prisma
-- (previewFeature "partialIndexes"), so Prisma creates and tracks them in the init migration.

-- ═══ 3. Append-only, hash-chained audit log ════════════════════════════════════

-- Canonical row hash. Single source of truth: used by the insert trigger AND by the verifier
-- (src/server/audit/verify-chain.ts), so both always agree on the hash input.
CREATE FUNCTION audit_log_row_hash(
  prev bytea, at timestamptz, actor_id uuid, actor_role "Role", action text,
  target_type text, target_id text, metadata jsonb, request_id text
) RETURNS bytea
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT sha256(prev || convert_to(jsonb_build_array(
    to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    actor_id, actor_role, action, target_type, target_id, metadata, request_id
  )::text, 'UTF8'))
$$;

CREATE FUNCTION audit_log_expected_hash(a "AuditLog") RETURNS bytea
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT audit_log_row_hash(a."prevHash", a.at, a."actorId", a."actorRole", a.action,
                            a."targetType", a."targetId", a.metadata, a."requestId")
$$;

CREATE FUNCTION audit_log_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_hash bytea;
BEGIN
  -- Under REPEATABLE READ/SERIALIZABLE the snapshot predates the lock and could miss the newest
  -- row, forking the chain. Refuse instead of silently forking.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'AuditLog inserts require READ COMMITTED isolation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('wiskiflix.audit_log_chain'));
  SELECT hash INTO last_hash FROM "AuditLog" ORDER BY id DESC LIMIT 1;
  NEW.id         := nextval(pg_get_serial_sequence('"AuditLog"', 'id'));
  NEW.at         := date_trunc('milliseconds', clock_timestamp());
  NEW."prevHash" := COALESCE(last_hash, '\x00'::bytea);
  NEW.hash       := audit_log_row_hash(NEW."prevHash", NEW.at, NEW."actorId", NEW."actorRole",
                                       NEW.action, NEW."targetType", NEW."targetId", NEW.metadata,
                                       NEW."requestId");
  RETURN NEW;
END $$;

CREATE TRIGGER audit_log_chain BEFORE INSERT ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

CREATE FUNCTION audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- ═══ 4. Least-privilege grants ═════════════════════════════════════════════════
-- Roles (created outside migrations, see prisma/sql/roles.sql):
--   wf_migrator — owns the schema, runs migrations (DDL)
--   wf_app      — used by web/worker: DML only; AuditLog is SELECT + INSERT only
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wf_app') THEN
    GRANT USAGE ON SCHEMA public TO wf_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wf_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wf_app;
    REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "AuditLog" FROM wf_app;
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON "_prisma_migrations" FROM wf_app;
    END IF;
    -- Tables created by later migrations (run as the same migrator role) get DML for wf_app.
    -- AuditLog-style restrictions must be repeated explicitly in those migrations.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wf_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO wf_app;
  ELSE
    RAISE NOTICE 'role wf_app not found: grants skipped (see prisma/sql/roles.sql)';
  END IF;
END $$;
