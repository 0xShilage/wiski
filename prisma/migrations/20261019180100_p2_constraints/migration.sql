-- Phase 2 reviewed SQL (13 §3 step 2). Invariants the application must never be able to break,
-- whatever bug a service has. Each one is covered by tests/integration/db-constraints-p2.test.ts.
--
--  1. Buyer keys: "u:<user uuid>" or "e:<64 hex>" — never an e-mail in clear. A user's order
--     carries that user's key unless it was a guest order attached later (claimedAt).
--  2. NEEDS_ATTENTION always says why.
--  3. Outbox rows never keep the sealed order token once they are final, and SENT has a time.
--  4. Payment mirrors stay bounded (raw provider strings are short codes, not bodies).
--  5. Queue-jump per-tier index is never negative (its unique index does the capping).

-- ═══ 1. Buyer keys ═════════════════════════════════════════════════════════════

ALTER TABLE "Order" ADD CONSTRAINT ord_buyer_key CHECK (
  "buyerKey" ~ '^(u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|e:[0-9a-f]{64})$' AND
  ("userId" IS NULL OR "buyerKey" = 'u:' || "userId"::text OR "claimedAt" IS NOT NULL));

ALTER TABLE "VoucherRedemption" ADD CONSTRAINT vr_buyer_key CHECK (
  "buyerKey" ~ '^(u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|e:[0-9a-f]{64})$' AND
  ("userId" IS NULL OR "buyerKey" = 'u:' || "userId"::text) AND
  "discountCents" > 0);

-- ═══ 2. Orders that need the streamer ══════════════════════════════════════════

ALTER TABLE "Order" ADD CONSTRAINT ord_attention_reason CHECK (
  status <> 'NEEDS_ATTENTION' OR "attentionReason" IS NOT NULL);
ALTER TABLE "Order" ADD CONSTRAINT ord_paid_at CHECK (
  status NOT IN ('PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED') OR "paidAt" IS NOT NULL);
ALTER TABLE "Order" ADD CONSTRAINT ord_public_code CHECK ("publicCode" ~ '^WF-[0-9A-HJKMNP-TV-Z]{6}$');

-- ═══ 3. E-mail outbox ═══════════════════════════════════════════════════════════

ALTER TABLE "EmailOutbox" ADD CONSTRAINT eo_values CHECK (
  attempts >= 0 AND char_length("dedupeKey") BETWEEN 3 AND 200 AND
  ("lastError" IS NULL OR char_length("lastError") <= 64) AND
  ("providerMessageId" IS NULL OR char_length("providerMessageId") <= 128) AND
  ("sealedToken" IS NULL OR template = 'ORDER_RECEIPT'));
ALTER TABLE "EmailOutbox" ADD CONSTRAINT eo_final_states CHECK (
  (status IN ('HELD', 'PENDING') OR "sealedToken" IS NULL) AND
  (status <> 'SENT' OR "sentAt" IS NOT NULL));
ALTER TABLE "EmailOutbox" ADD CONSTRAINT eo_campaign CHECK (
  (template = 'ORDER_RECEIPT') = ("campaignId" IS NULL));

-- ═══ 4. Payments ════════════════════════════════════════════════════════════════

ALTER TABLE "Payment" ADD CONSTRAINT pay_provider_strings CHECK (
  ("providerOrderId" IS NULL OR "providerOrderId" ~ '^[A-Za-z0-9_-]{1,64}$') AND
  ("providerPaymentId" IS NULL OR "providerPaymentId" ~ '^[A-Za-z0-9_-]{1,64}$') AND
  ("providerStatus" IS NULL OR char_length("providerStatus") <= 40) AND
  ("statusDetail" IS NULL OR char_length("statusDetail") <= 60));

-- ═══ 5. Queue jump: per-tier daily index (unique (day, tierId, tierIndex)) ══════

ALTER TABLE "QueueJumpSlot" ADD CONSTRAINT qj_tier_index CHECK ("tierIndex" IS NULL OR "tierIndex" >= 0);

-- ═══ 6. Grants ══════════════════════════════════════════════════════════════════
-- EmailOutbox inherits wf_app DML through ALTER DEFAULT PRIVILEGES (20261002150100_constraints).
