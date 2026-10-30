# Wiskiflix — Phase 2 (payments)

> Status: **built and tested** · 2026-10-30 · baseline: [`../phase-0/`](../phase-0/README.md) (01 §3.2–3.3, 03 §5.3, 04, 05 §5–§6, 09) and [`../phase-0/11-redesign-spec.md`](../phase-0/11-redesign-spec.md) §2, §7–§9 · results: [`test-report.md`](./test-report.md)

Phase 2 opens the money side: **"Patrocine agora"** (one sponsor pays the whole movie) and **"Contribuir"** (crowdfunded series and franchises), both with Pix via Mercado Pago, for guests and signed-in users. It adds the price engine and the active rule set, the checkout with every hold (movie, campaign amount, voucher, queue-jump slot), the signed webhook, a worker that syncs, reconciles and expires, the order page with live status, and "Meus pedidos" on Perfil.

## 1. What's in the box

| Area | Where | Notes |
|---|---|---|
| Data model | `prisma/schema.prisma`, migrations `20261030120000_phase2_checkout` (generated) + `20261030120100_phase2_constraints` (reviewed SQL) | `Order.buyerKey` + `ipKey`, guest voucher redemptions, the worker columns on `WebhookEvent`; CHECKs; **rule set rev 3 inserted as the ACTIVE PriceRuleSet** |
| Price engine | `src/server/pricing/{config,engine,ruleset}.ts` | PricingConfig v1 (Zod), pure `priceMovie()` / `checkContribution()`, canonical-JSON hash check on read (fail closed) |
| Checkout | `src/server/checkout/*` | quote, movie order, contribution, holds (reserve / confirm / release), queue-jump slots, order cookie, access/claim/cancel, order view, Pix cache |
| Mercado Pago | `src/server/payments/mercadopago/{client,signature}.ts` | Payments API (`POST/GET/PUT /v1/payments`), Zod-validated responses, `X-Idempotency-Key`, `x-signature` HMAC |
| Sync + jobs | `src/server/payments/{sync,jobs}.ts`, `src/worker/main.ts` | the only code that turns an MP payment into order state; webhook queue, reconciliation (2 min), expiry (1 min), nightly 48 h sweep, 90-day webhook purge, daily audit-chain check |
| Realtime | `src/server/realtime/events.ts` | Redis pub/sub → one subscriber per web process → SSE for the order page and the campaign bar |
| Pages | `/pedido/[code]`, checkout forms on `/filmes/[slug]`, `/series/[slug]`, `/franquias/[slug]`, "Meus pedidos" on `/perfil` | `src/components/checkout/*`, `src/styles/checkout.css` |
| Dev tools | `npm run worker`, `npm run dev:pay -- WF-XXXXXX` | the worker next to `npm run dev`; simulate an approval locally (development only, §2) |

### API endpoints added in Phase 2

| Method · path | Access | Purpose |
|---|---|---|
| `POST /api/v1/sponsorships/quote` | public (perk only when signed in) | live breakdown for a movie, queue-jump tier, voucher; nothing stored |
| `POST /api/v1/sponsorships` | public · Turnstile `sponsor` · `Idempotency-Key` | reserve the movie, create the Pix; returns the QR, `publicCode` and the order-link token **once**; sets `__Host-wf_order` |
| `POST /api/v1/campaigns/[id]/contributions` | public · Turnstile `contribute` · `Idempotency-Key` | reserve the amount, create the Pix |
| `GET /api/v1/campaigns/[id]/events` | public | SSE campaign progress |
| `GET /api/v1/orders/[code]` | owner, order cookie, or moderator (else 404) | status, breakdown, Pix while unpaid, `orderCsrf` for guests |
| `POST /api/v1/orders/[code]/access` | public (token in body) | order-link token → order cookie |
| `GET /api/v1/orders/[code]/events` | as GET above | SSE status |
| `POST /api/v1/orders/[code]/cancel` | owner or cookie (+ cookie-bound CSRF for guests) | cancel an unpaid order (MP first, then release) |
| `POST /api/v1/orders/[code]/claim` | signed in + order cookie | attach a guest order to the account |
| `GET /api/v1/me/orders` | signed in | my orders (newest 50) |
| `GET /api/v1/legal/current` | public | the legal versions checkout expects |
| `POST /api/webhooks/mercadopago` | HMAC (`x-signature`) | verify → store → wake the worker → 200 |

Every route is wrapped in `route()` and listed in the authz matrix.

## 2. Running it

Everything from R1 §2 still applies. What's new:

1. **Pull and install** (new dev dependency `fast-check`; your `package.json` keeps its `allowScripts` block):

   ```bash
   npm ci
   npm run db:migrate          # the two Phase 2 migrations (as wf_migrator)
   npm run db:drift            # expect no output
   npm run db:seed -- --reset  # optional; also registers PROVISIONAL legal texts for local checkout
   ```

2. **Mercado Pago test credentials** in `.env.local` (never in the chat): your `.env.local` already has the test access token; add the **test** collector id next to it — the app checks that the token ends with `-<MP_COLLECTOR_ID>`:

   ```
   MP_COLLECTOR_ID=3733347216
   ```

   Without both values checkout shows "Os pagamentos com Pix ainda não estão ativos neste ambiente." and nothing calls Mercado Pago.

3. **Two processes**, each in its own terminal:

   ```bash
   npm run dev       # http://localhost:3000
   npm run worker    # webhook queue, reconciliation, expiry
   ```

   Without the worker, unpaid orders never expire (the movie stays "Reservado") and approvals are never applied — keep it running.

4. **Seeing a payment go through locally.** A Pix created with test credentials can't be paid from a bank app (09 §D). To watch the paid flow, open the order page, then in a third terminal:

   ```bash
   npm run dev:pay -- WF-XXXXXX    # the code shown on the order page
   ```

   It runs the real sync code with a synthetic "approved" payment; the page turns to "Pago" by itself, the movie shows "Patrocinado", the campaign bar moves. It refuses `NODE_ENV=production`.

5. **Webhooks in development** need a public URL Mercado Pago can reach (a tunnel). You don't need one: the worker's reconciliation re-reads pending payments every 2 minutes. If you set one up, put the test webhook's *assinatura secreta* into `MP_WEBHOOK_SECRET`.

6. **Turnstile**: development uses Cloudflare's public test keys (always passes; the widget loads from `challenges.cloudflare.com`, so the browser needs internet). Production needs real keys (P1-c).

## 3. How it works

### Movie: "Patrocine agora"

1. The detail page asks the server for a **quote** (`priceMovie` with the ACTIVE rule set; the moderator/VIP perk is read from the session, never from the body).
2. Submit → `POST /api/v1/sponsorships` with the selection, `expectedTotalCents`, the contact e-mail (guests), optional public name, "anônimo", optional message, the legal versions, Turnstile token and an `Idempotency-Key`.
3. **One transaction**: per-IP pending cap (≤ 2, advisory lock) → queue-jump lock + re-count → voucher read → price again (409 `PRICE_CHANGED` if it differs from what the buyer saw) → `Order` + `Payment` + 3 `LegalAcceptance` → the movie is reserved with a conditional update (`ACTIVE` and not reserved) → voucher redemption (conditional count) → queue slot → audit.
4. **Pix** (outside the transaction): `POST /v1/payments` with `X-Idempotency-Key`, `external_reference` = order id, `date_of_expiration` = +31 min. The response is verified like a webhook (amount, collector, live mode…) and the QR payload validated (strict base64 PNG ≤ 64 KB, EMV copia-e-cola). Any failure → a compensating transaction releases every hold and the buyer sees "Nada foi cobrado".
5. The browser goes to `/pedido/WF-XXXXXX#t=<token>`: the QR, a countdown and live status (SSE).
6. Mercado Pago notifies → the webhook verifies the HMAC and stores the delivery → the worker re-fetches the payment, verifies it, and in one transaction: payment `APPROVED`, order `PAID`, movie `SPONSORED`, voucher `CONSUMED`, queue slot confirmed, audit. The order page updates by itself.

### Contribution: "Contribuir"

Same path, with `checkContribution` (whole reais ≥ R$ 5, never above what's left; no perks, vouchers or queue jump). The hold is a conditional decrement of `Campaign.remainingCents` into `reservedCents`; approval moves it to `raisedCents`, and the approval that makes `raised = goal` marks the campaign and the item **FUNDED**. Expiry gives the amount back.

### Holds and their lifetime

| Hold | Taken | Released | Confirmed |
|---|---|---|---|
| Movie (`reservedOrderId`, until expiry + 4 min) | checkout | expired, cancelled, rejected, Pix failure | approved in time → `SPONSORED` |
| Campaign amount (`reservedCents`) | checkout | same | approved → `raisedCents` (+ supporter) |
| Voucher redemption (`redemptionCount`) | checkout, only when the voucher gave the discount | same → `RELEASED`, count −1 | `CONSUMED` |
| Queue-jump slot | checkout | deleted | `confirmed = true` |

The database backs every one of them: one active order per movie (partial unique), one unpaid order per buyer (partial unique), `remaining = goal − raised − reserved ≥ 0` (CHECK), queue slot uniqueness per day and ISO week.

### State machine (05 §6.9, as built)

| Mercado Pago says | Order was `PENDING_PAYMENT` | Order was `PAID` | Order was `EXPIRED`/`CANCELLED` |
|---|---|---|---|
| approved, paid ≤ expiry + 4 min | **PAID** (holds confirmed) | — | — |
| approved, paid later | NEEDS_ATTENTION (holds released) | — | NEEDS_ATTENTION |
| rejected / cancelled | CANCELLED (released) | unchanged | unchanged |
| refunded / charged back / in mediation | NEEDS_ATTENTION (released) | NEEDS_ATTENTION | unchanged |
| anything that fails verification, or an unknown status | NEEDS_ATTENTION | NEEDS_ATTENTION | NEEDS_ATTENTION |

Updates older than the last one we applied (`date_last_updated`) are ignored; provider statuses never move backwards; every change is a compare-and-set on both rows and is audited (`payment.status`, actor = system). "Paid later" is judged by MP's `date_approved`, not by when the notification arrived.

## 4. Security decisions made while building (all covered by tests)

1. **The webhook body is never parsed.** `route()` got an `ignoreBody` option used only by provider callbacks: the body is size- and type-checked, then dropped. The HMAC covers the query-string id, `x-request-id` and `ts` (MP's manifest, absent parts omitted, alphanumeric ids lower-cased), compared in constant time against the current **and** previous secret, ±10 min. The unique `x-request-id` in `WebhookEvent` is the replay guard (a duplicate answers 200 so MP stops). No secret configured → every delivery is 401.
2. **Re-fetch and verify everything**: id, `external_reference`, amount (cents, round-trip), currency, `pix`, `collector_id`, `live_mode` (true only in production). The **created** payment is verified the same way before its QR is ever shown.
3. **Guest access** (05 §5): 256-bit order-link token, only its SHA-256 stored, constant-time compare, exchanged from the URL fragment for the sealed `__Host-wf_order` cookie (AES-256-GCM, HttpOnly, Secure, SameSite=Strict, ≤ 10 orders, 30 days); wrong token and unknown code give the same 404; 10 tries/min. Guest cancel needs a CSRF token bound to that cookie's random id. Claim needs login **and** the cookie; claimed orders can't be re-claimed.
4. **Limits**: 1 unpaid order per buyer (user id, or SHA-256 of the lower-cased e-mail — the key holds no e-mail) by partial unique index; 2 per IP under an advisory lock, with the IP stored only as the keyed HMAC and **only while the order is unpaid** (CHECK); 10 creates/h per IP, 5/h per user and per buyer; voucher brute force: the 5th invalid code within 10 min starts a 15-min cool-down per IP and per buyer.
5. **Idempotency**: `Idempotency-Key` (UUID) required; the same key from the same buyer replays the first response for 24 h (sealed in Redis); the DB unique `(contactEmail, clientRequestId)` blocks a duplicate even without Redis; MP gets its own per-payment `X-Idempotency-Key`.
6. **Prices fail closed**: the ACTIVE rule set must parse as PricingConfig v1 *and* hash to its `configHash`, else checkout says "temporariamente indisponível". Checkout also stays closed without MP credentials, without current legal texts, or when `AppSetting orders.open = false`.
7. **Pix payload hygiene**: QR images only from our API as validated PNG `data:` URLs (`img-src 'self' data:` already allowed), copia-e-cola as text; the page tells the buyer to check the recipient name; payloads live only in Redis with TTL = expiry and are never logged.
8. **No personal data in events or audit**: SSE payloads are `{type, code, status, at}` / campaign totals; audit metadata is amounts, statuses and flags only.
9. **Webhook flooding** can't cost us money or MP quota: the signature check comes before any work, and bursts for one payment coalesce into one fetch per worker run.

## 5. Deviations from the plan, and why

1. **No BullMQ.** The verified `WebhookEvent` rows are the durable queue (claimed with a 60 s lease, retried with exponential backoff up to 8 attempts, then reconciliation takes over); reconciliation and expiry scan Postgres directly. One dependency and one Redis-durability requirement fewer on a 2 GB server, and BullMQ had just shipped a new major (6.x) with a different API. Redis is still used for pub/sub, rate limits, the Pix cache and idempotency replays — none of which must survive a restart.
2. **Order page at `/pedido/[code]`** (03 named `/patrocinar/pedido/[code]`; the redesign removed `/patrocinar`). The API is generalised to `orders/[code]` as 11 §8 says; creation stays at `/sponsorships` and `/campaigns/[id]/contributions`.
3. **PricingConfig v1 keeps only the MOVIE kind** (series/anime packages and YouTube left with 11 §10) and adds a `contributions` block (min R$ 5, step R$ 1, max R$ 2.000). E5/E6/E11 of 04 §9 are replaced by equivalent tests on the general engine paths.
4. **Vouchers work for guests**, as 04 §4 says; `VoucherRedemption.userId` became optional and limits count per `buyerKey`.
5. **No e-mail yet.** Receipts and the "prazo prorrogado" notice need an e-mail provider (open item E1). Until then the order page shows **"Copiar link do pedido"** and the order is in the browser's cookie; signed-in buyers see it in Perfil.
6. **Late approvals don't auto-sell.** An approval after the reservation window goes to NEEDS_ATTENTION (05 §6.10), even if the movie happens to be free — another buyer may have been turned away meanwhile. The admin screens for NEEDS_ATTENTION and the exception refund tool are Phase 4 ("remaining admin").
7. **Raw SQL**: two new tagged-template exceptions, both `pg_advisory_xact_lock` inside the checkout transaction (queue-jump allocation; per-IP pending cap). No other raw SQL.
8. **Legal texts**: checkout requires a current `LegalDocument` of each type. The dev seed registers **provisional** ones locally; production stays closed until your lawyer's texts are published (Q13).
9. **Migration back-fill**: the generated migration adds the two `buyerKey` columns nullable, back-fills existing rows (your seeded orders), then sets NOT NULL; the end state is exactly the generated one (`db:drift` empty).
10. **Images and the worker**: image processing still runs inline in the upload request (R1 deviation 6); moving it to the worker isn't needed at this volume.

## 6. Open items / needed from you

| # | Item | Needed by |
|---|---|---|
| — | `.env.local`: add `MP_COLLECTOR_ID=3733347216` (test) next to the test token (§2.2) | to try checkout locally |
| — | After copying: `npm ci`, `npm run db:migrate`, `npm run db:drift`, optionally `npm run db:seed -- --reset` | now |
| **E1** | **E-mail provider** for receipts and campaign notices (e.g. Amazon SES, Brevo, Resend — sending domain `wiski.fun`, SPF/DKIM/DMARC) | before launch |
| **Q13** | Lawyer's terms / privacy / no-refund texts (including the crowdfunding wording) → published as the current legal versions; until then production checkout stays closed | before launch |
| **S2** | Confirm the **production** `collector_id` and Application ID | Phase 5 |
| P1-c | Turnstile widget keys for `wiski.fun` | Phase 5 |
| — | Production webhook URL `https://wiski.fun/api/webhooks/mercadopago` + its *assinatura secreta* (09 §C.5) | Phase 5 |
| — | One real low-value Pix end to end (09 §D) | before launch |
