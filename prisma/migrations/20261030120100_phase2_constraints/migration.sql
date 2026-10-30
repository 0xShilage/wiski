-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Phase 2 (payments) invariants: docs/phase-2/README.md §4, 04 §2–§5, 05 §5–§6.
-- Hand-written; any change needs a second reviewer. Guarded by tests/integration/db-constraints-p2.test.ts.
--
-- Review decisions:
--  1. "max 1 pending order per buyer" is the partial unique index order_one_pending_per_buyer
--     (declared in schema.prisma). "max 2 per IP" is counted by the checkout under a per-IP
--     advisory lock; the IP key exists only while an order is unpaid (CHECK below), so paid
--     orders never keep it (LGPD, 05 §13).
--  2. The ACTIVE price rule set (rev 3, 04 §3) is inserted here, not by a seed, so every
--     environment — production included — starts from the same reviewed prices. Its config is
--     the canonical JSON of RULESET_REV3 (src/server/pricing/config.ts) and configHash its
--     SHA-256; tests/integration/pricing-ruleset.test.ts keeps the three in sync.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Orders ═════════════════════════════════════════════════════════════════

ALTER TABLE "Order" ADD CONSTRAINT ord_buyer_key CHECK (
  "buyerKey" ~ '^(u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|e:[0-9a-f]{64})$');
ALTER TABLE "Order" ADD CONSTRAINT ord_buyer_matches_user CHECK (
  "userId" IS NULL OR "claimedAt" IS NOT NULL OR "buyerKey" = 'u:' || "userId"::text);
ALTER TABLE "Order" ADD CONSTRAINT ord_ip_key CHECK (
  "ipKey" IS NULL OR (status = 'PENDING_PAYMENT' AND "ipKey" ~ '^[A-Za-z0-9_-]{16}$'));
ALTER TABLE "Order" ADD CONSTRAINT ord_public_code CHECK ("publicCode" ~ '^WF-[0-9A-HJKMNP-TV-Z]{6}$');
ALTER TABLE "Order" ADD CONSTRAINT ord_texts CHECK (
  ("sponsorMessage" IS NULL OR char_length("sponsorMessage") BETWEEN 1 AND 140) AND
  ("guestDisplayName" IS NULL OR char_length("guestDisplayName") BETWEEN 2 AND 24) AND
  (("sponsorMessage" IS NULL) = ("messageStatus" IS NULL)) AND
  (("guestDisplayName" IS NULL) = ("displayNameStatus" IS NULL)));
ALTER TABLE "Order" ADD CONSTRAINT ord_paid_at CHECK (
  status NOT IN ('PAID', 'SCHEDULED', 'WATCHING', 'COMPLETED') OR "paidAt" IS NOT NULL);

-- ═══ 2. Payments, webhooks, vouchers ══════════════════════════════════════════

ALTER TABLE "Payment" ADD CONSTRAINT pay_provider_id CHECK (
  "providerPaymentId" IS NULL OR "providerPaymentId" ~ '^[0-9]{1,20}$');
ALTER TABLE "Payment" ADD CONSTRAINT pay_approved_at CHECK (status <> 'APPROVED' OR "approvedAt" IS NOT NULL);
ALTER TABLE "WebhookEvent" ADD CONSTRAINT wh_values CHECK (
  attempts >= 0 AND char_length("requestId") BETWEEN 1 AND 128 AND
  "resourceId" ~ '^[0-9]{1,20}$' AND char_length(topic) BETWEEN 1 AND 40);
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT vr_values CHECK (
  "discountCents" > 0 AND
  "buyerKey" ~ '^(u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|e:[0-9a-f]{64})$');

-- ═══ 3. Active price rule set (rev 3) ═════════════════════════════════════════

-- Archive whatever was active (nothing in a fresh database), then publish rev 3 as the next version.
UPDATE "PriceRuleSet" SET status = 'ARCHIVED' WHERE status = 'ACTIVE';
INSERT INTO "PriceRuleSet" (id, version, status, config, "configHash", "createdAt", "publishedAt")
SELECT '019a3a00-0000-7000-8000-000000000003'::uuid,
       COALESCE(MAX(version), 0) + 1,
       'ACTIVE',
       '{"addOns":[],"contributions":{"maxCents":200000,"minCents":500,"stepCents":100},"currency":"BRL","discounts":{"discountsApplyToQueueJump":false,"moderatorBps":1000,"stacking":"BEST_SINGLE","vipBps":1000},"kinds":{"MOVIE":{"enabled":true,"maxRuntimeMinutes":360,"minRuntimeMinutes":1,"pricing":{"bands":[{"baseCents":2000,"upToMinutes":130}],"mode":"RUNTIME_BANDS","perMinuteOverCents":100}}},"maxTotalCents":200000,"minTotalCents":500,"queueJump":{"dailyCap":5,"enabled":true,"perBuyerDailyCap":1,"reservationTtlMinutes":35,"tiers":[{"bps":8000,"id":"prioridade","label":"Prioridade","placement":"AHEAD_OF_REGULAR"},{"bps":16000,"dailyCap":1,"id":"topo","label":"Topo da fila","placement":"TOP"}],"weeklyCap":20},"schemaVersion":1}'::jsonb,
       sha256(convert_to('{"addOns":[],"contributions":{"maxCents":200000,"minCents":500,"stepCents":100},"currency":"BRL","discounts":{"discountsApplyToQueueJump":false,"moderatorBps":1000,"stacking":"BEST_SINGLE","vipBps":1000},"kinds":{"MOVIE":{"enabled":true,"maxRuntimeMinutes":360,"minRuntimeMinutes":1,"pricing":{"bands":[{"baseCents":2000,"upToMinutes":130}],"mode":"RUNTIME_BANDS","perMinuteOverCents":100}}},"maxTotalCents":200000,"minTotalCents":500,"queueJump":{"dailyCap":5,"enabled":true,"perBuyerDailyCap":1,"reservationTtlMinutes":35,"tiers":[{"bps":8000,"id":"prioridade","label":"Prioridade","placement":"AHEAD_OF_REGULAR"},{"bps":16000,"dailyCap":1,"id":"topo","label":"Topo da fila","placement":"TOP"}],"weeklyCap":20},"schemaVersion":1}', 'UTF8')),
       now(), now()
  FROM "PriceRuleSet";
