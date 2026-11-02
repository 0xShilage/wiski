-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — authenticator app (TOTP) second factor: docs/phase-4/README.md §6.
-- Hand-written; any change needs a second reviewer. Guarded by
-- tests/integration/db-constraints-mfa.test.ts.
--
-- Review decisions:
--  1. A secret exists exactly when the authenticator is enabled; the pending secret during set-up
--     lives in Redis for 10 minutes, never in this table.
--  2. The encrypted secret is iv (12) + ciphertext (20) + tag (16) = 48 bytes.
--  3. Recovery codes are stored as a 32-byte HMAC; a user has at most 6 unused codes (the app
--     replaces the whole set in one transaction; the trigger is the backstop).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "User" ADD CONSTRAINT user_totp CHECK (
  ("totpSecretEnc" IS NULL) = ("totpEnabledAt" IS NULL) AND
  ("totpSecretEnc" IS NULL OR octet_length("totpSecretEnc") = 48) AND
  ("totpLastStep" IS NULL OR "totpLastStep" >= 0) AND
  "mfaEpoch" >= 0);

ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT mrc_values CHECK (
  octet_length("codeHash") = 32 AND ("usedAt" IS NULL OR "usedAt" >= "createdAt"));

CREATE FUNCTION mfa_recovery_cap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM "MfaRecoveryCode" WHERE "userId" = NEW."userId" AND "usedAt" IS NULL) > 6 THEN
    RAISE EXCEPTION 'at most 6 unused recovery codes per user' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER mfa_recovery_cap AFTER INSERT ON "MfaRecoveryCode"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mfa_recovery_cap();

-- A used code stays used; the user it belongs to never changes.
CREATE FUNCTION mfa_recovery_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."userId" <> OLD."userId" OR NEW."codeHash" <> OLD."codeHash" OR
     (OLD."usedAt" IS NOT NULL AND NEW."usedAt" IS DISTINCT FROM OLD."usedAt") THEN
    RAISE EXCEPTION 'recovery codes are single-use and immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER mfa_recovery_immutable BEFORE UPDATE ON "MfaRecoveryCode"
  FOR EACH ROW EXECUTE FUNCTION mfa_recovery_immutable();
