# Phase 2 — test report

> Run: 2026-10-30, Claude's Linux workspace · Node 24.19.0 · Postgres 17.10 (embedded-postgres) · Redis 7.0.15 · nginx 1.24 · Chromium (Playwright 1.64.1) · Mercado Pago and Turnstile faked at the network boundary (`tests/support/mercadopago.ts`)
> Tree: the one delivered to `Documents\Wiskiflix` with this report. Build notes: [`README.md`](./README.md).

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint (`--max-warnings=0`) | `npm run lint` | ✅ 0 problems |
| Typecheck (strict) | `npm run typecheck` | ✅ |
| Formatting | `npm run format:check` | ✅ |
| Unit | `npm test` | ✅ **214 / 214** (R1: 125) |
| Integration (Postgres 17 + Redis, app role `wf_app`, real migrations) | `npm run test:integration` | ✅ **464 / 464** (R1: 324) |
| Brand (Chromium, 2×) | `npm run test:brand` | ✅ **151 / 151** |
| E2E (production build behind nginx/TLS, seeded, 360 px + 1280 px) | `npm run build && npm run test:e2e` | ✅ **179 / 179**, 0 flaky (+29 intentionally run on one project only) — all R1 pages again, now with the checkout notices on the detail pages |
| Dependencies | `npm audit --audit-level=high` | ✅ 0 high/critical (1 moderate, dev-only `fast-uri`, already on `main`; Dependabot) |
| Client bundle secret scan | `npm run check:bundle-secrets` | ✅ 27 files clean |
| Migrations vs schema | official schema engine (WASM): migrations applied vs Prisma's own empty→schema SQL — columns, indexes, enums, keys | ✅ identical (the only extra object is R1's reviewed `ci_live_slot_unique` exclusion constraint) |
| Production build | `npm run build` | ✅ standalone output; every page dynamic (ƒ) |

### New and extended suites

| File | Tests | Covers |
|---|---|---|
| `tests/unit/pricing.test.ts` | 64 | rule set rev 3 = public price constants; canonical JSON/hash; malformed configs refused; 04 §9 worked examples; band edges and multi-band configs; `mulBps` rounding at .4999/.5/.5001 and bps 0/1/9999/10000/16000; perks (guest, USER, VIP, MODERATOR), perk-vs-voucher tie; every voucher error; queue-jump errors; add-ons; contribution amounts; **fast-check properties** (2 000 runs: total = Σ lines, integers only, within min/max, discount ≤ subtotal, surcharge independent of discount; monotonic in runtime) |
| `tests/unit/mercadopago.test.ts` | 25 | signature manifest (absent parts, lower-casing), header parsing (order, duplicates, hex), seconds/ms, every rejection reason, secret rotation; cents ↔ reais round trip; −03:00 dates; status mapping; Pix payload validation (SVG, bad base64, url-safe alphabet, non-EMV copia-e-cola, control chars, > 64 KB); BRT calendar day and ISO weeks (week 53, year edges, Monday 00:00 BRT); buyer keys; public-code alphabet |
| `tests/integration/checkout.test.ts` | 25 | guest happy path end to end (quote → hold → MP request shape: amount, `external_reference`, `-03:00` expiry, idempotency key, no `notification_url` → order page with Pix → approval → SPONSORED); signed-in buyer + moderator perk; strict body (no client prices/discounts); PRICE_CHANGED with nothing held; Turnstile, Idempotency-Key, guest e-mail, LEGAL_CHANGED; closed without MP credentials / when switched off / with a tampered rule set; **20 buyers racing for one movie → one order, one Pix**; 1 unpaid order per buyer, 2 per IP; idempotent replay; MP 5xx/timeout/tampered amount/invalid QR → 503 and every hold released; vouchers for guests, 5-invalid cool-down, **10 buyers vs a 3-use voucher → 3**; **"Topo da fila" under 10 parallel buyers → 1**, shared daily cap 5; contributions: amount rules, **30 parallel R$ 10 into R$ 100 → exactly 10**, approvals fund the campaign, paused campaign, no perk fields |
| `tests/integration/webhook.test.ts` | 43 | 05 §6 list: valid delivery → worker → PAID; wrong secret, no/garbage/truncated/duplicated header, missing `x-request-id`, signed for another id, stale/future ts → 401 and nothing stored; seconds-ts; lower-cased ids; previous secret; no secret → 401; replayed `x-request-id` → DUPLICATE; 10 parallel copies → 1 row; bursts coalesce to 1 MP fetch; other topics/malformed ids ignored; foreign payment ignored; out-of-order older update ignored; amount/collector/live-mode/method/currency/reference mismatch and unknown status → NEEDS_ATTENTION; rejected → released; late approval vs grace window; approval after EXPIRED; refunded/charged-back/in-mediation after a sale; **6 parallel syncs apply once**; MP 5xx → backoff → applied; gives up after 8 attempts; reconciliation finds a missed approval; 90-day purge; expiry releases movie + voucher + queue slot and cancels at MP; approval just before expiry wins; expiry while MP is down; expired contribution returned to the campaign |
| `tests/integration/orders-access.test.ts` | 13 | public code alone / foreign / forged cookie → 404; staff can read, not cancel; token exchange keeps other orders; wrong token = unknown code (same 404, no cookie); 10/min limit; only the token hash stored; claim needs login **and** cookie, once only, audited; guest cancel needs the cookie-bound CSRF token (another browser's token fails), releases the movie and cancels at MP; cross-site refused; already-paid Pix → 409 ORDER_ALREADY_PAID; SSE streams status first, only to readers, no personal data |
| `tests/integration/db-constraints-p2.test.ts` | 11 | ACTIVE rule set == `RULESET_REV3` and its hash; buyer-key format and user match; IP key only while unpaid; one unpaid order per buyer; public-code alphabet; text lengths + moderation pairs; paid states need `paidAt`; provider id digits; APPROVED needs `approvedAt`; webhook row values; voucher redemption values |
| `tests/integration/authz.test.ts` | 205 | **51 route × method rows × 4 roles** + completeness meta-test (12 new Phase 2 routes) |

## Phase 2 exit criteria (00 README, phase plan)

| Criterion | Evidence | Status |
|---|---|---|
| Price engine table / property tests | `tests/unit/pricing.test.ts` (64, incl. fast-check) | ✅ |
| Webhook suite: bad signature, replay, duplicates, out-of-order | `tests/integration/webhook.test.ts` (43) | ✅ |
| Concurrency: one sponsor per movie, no overfunding | `checkout.test.ts` — 20-way movie race, 30-way contribution race; also queue-jump and voucher races | ✅ |
| Guest-token tests | `orders-access.test.ts` (13) | ✅ |
| Real `prisma migrate deploy` + drift check | CI `migrations` job on push (the native engine download is blocked in Claude's workspace; the WASM comparison above passed) | ✅ here · CI on push |

## Visual check (development server, seeded)

Checked by hand in Chromium at 1440 × 900 and 390 × 844: movie detail with the checkout form (tiers, voucher, breakdown, buyer fields), series detail with the contribution form, the order page while unpaid (QR, copia-e-cola, countdown, cancel, "Copiar link do pedido") and after `npm run dev:pay` (status "Pago"), unknown order. **0 CSP violations, no horizontal scroll.** One layout bug found and fixed (the breakdown inherited the detail page's 2-column `dl` grid). Turnstile can't load in this workspace (no internet), which exercised the form's "não foi possível carregar a verificação" message.

## Findings and notes

| # | Finding | Action |
|---|---|---|
| F1 | A parallel sync could lose its compare-and-set and the webhook event was still marked processed | sync re-reads and retries (3×); a remaining conflict keeps the event for retry — test "6 parallel syncs apply once" |
| F2 | Voucher cool-down started at the 6th invalid code | now the 5th (04 §6) |
| F3 | `db-constraints.test.ts` assumed no current legal text and no ACTIVE rule set | made independent of file order (the Phase 2 migration publishes rev 3) |
| F4 | Playwright 1.64.1 expects Chromium build 1248; the workspace has 1243 | ran with `PW_CHROMIUM_EXECUTABLE` (the config already supports it); CI installs the matching build |
| F5 | `npm audit`: 1 moderate (`fast-uri`, dev-only, present on `main` before this phase) | below the CI threshold (high); Dependabot will propose the bump |
