# 13 — Phase 2 plan: payments (hand-off)

> Status: **draft for approval** · 2026-10-19 · Read first: [11-redesign-spec.md](./11-redesign-spec.md) §2 (product rules), §7–§9 · [04-pricing-spec.md](./04-pricing-spec.md) · [05-threat-model.md](./05-threat-model.md) §6 (webhook spec) · [01-architecture.md](./01-architecture.md) §3.2–3.3 · [09-mercadopago-setup.md](./09-mercadopago-setup.md) · what exists: [`../r1/README.md`](../r1/README.md). Written so any Claude session attached to the Wiskiflix project can start cold.

## 0. Preconditions (check in this order)

1. Clone `github.com/0xShilage/wiski` (`main` ≥ `d95349c`, CI green), `npm ci`. Work on branch **`phase-2`**; it reaches `main` through a pull request with green CI.
2. `curl -sI https://registry.npmjs.org/zod` → 200. If npm is blocked, stop and tell the user.
3. Not reachable from Claude's workspace (checked 2026-10-19): `api.mercadopago.com`, `challenges.cloudflare.com`, `api.resend.com`, `binaries.prisma.sh`. Every external API is therefore **mocked in the test suites**, and real calls happen on the user's computer (`npm run dev` with test credentials). Prisma: `npm ci --ignore-scripts`, then `prisma generate` with `PRISMA_SCHEMA_ENGINE_BINARY` pointing at a stub script (generating the client doesn't need the engine), then `npm rebuild @embedded-postgres/linux-x64` for the integration suite; CI runs the real engine.
4. The schema already has `Order`, `Payment`, `WebhookEvent`, `Refund`, `PriceRuleSet`, `Voucher*`, `QueueJumpSlot`, `LegalDocument/Acceptance` and the reviewed constraints (`order_one_active_movie`, `camp_remaining`). Phase 2 adds services, endpoints, the worker and the UI on top.

## 1. Decisions (defaults — say if you disagree)

| # | Decision | Default and why |
|---|---|---|
| **D1** | Mercado Pago API | **Orders API** (`POST /v1/orders`, `GET /v1/orders/{id}`), not the older Payments API the Phase 0 docs describe. Mercado Pago still supports the Payments API but has stopped adding features to it and points new integrations to Orders. Same Pix, same signed webhooks; choosing it now avoids a migration right after launch. Consequences: the webhook event to tick in the panel (Phase 5) becomes **Order (Mercado Pago)** plus **chargebacks**; test tokens start with `APP_USR-`; sandbox requests use payer `test@testuser.com`; the Pix expiry is an ISO duration (30 min – 30 days); an unpaid Pix is **cancelled by us** when it expires, as Mercado Pago recommends (an Order's payment isn't treated as expired until 30 days after its due date). |
| **D2** | Scheduling | Stream sessions, `campaigns/[id]/schedule`, rescheduling, the public queue and "Próximos na live" move to **Phase 4** with the sessions admin, because they all need sessions to exist. Phase 2 ends at "paid": the movie is **Patrocinado**, the campaign **Meta atingida**. Queue-jump add-ons are charged and their daily/weekly caps reserved now; the queue position they buy is applied when sessions arrive. |
| **D3** | Price and voucher admin | Screens in Phase 4. Phase 2 seeds the active rule set (04 §3, rev 3) and adds an operator script to create vouchers (e.g. the R$ 5,00 go-live test voucher). |
| **D4** | Pix paid after it expired | Both kinds go to **NEEDS_ATTENTION**. The streamer resolves it in `/admin/pedidos`: accept it if the movie or campaign still has room, otherwise exception refund. |
| **D5** | Checkout screens | Built in the R1 visual language (no separate prototype round); screenshots in the pull request for review. |
| **D6** | Delivery | Pull request on GitHub, not zip batches. |

## 2. Scope

**In:**
- worker process (BullMQ)
- pricing engine with quote
- vouchers and queue-jump caps
- legal versions and acceptance
- Mercado Pago client
- movie checkout and campaign contributions (guest or logged in)
- order page with live Pix status
- signed webhook, sync, reconciliation and expiry
- campaign deadline pause and extension notices
- transactional e-mail (receipts with the order link)
- SSE for orders and campaigns
- "Minhas compras" in Perfil
- minimal `/admin/pedidos` with the exception refund

**Out:**
- sessions, scheduling, queue, overlays, pricing/voucher screens (Phase 4)
- reviews (Phase 3)
- real Turnstile keys, Resend domain, production credentials and deploy (Phase 5)

## 3. Work order

| # | Step | Key changes | Done when |
|---|---|---|---|
| 1 | Worker | `src/worker/*` + `npm run worker` (BullMQ on the existing Redis): queues `payment.sync`, `payment.reconcile`, `orders.expire`, `campaigns.deadline`, `email.send`, `media.process` (image processing moves here from the request, as R1 §5.6 planned); graceful shutdown; repeatable jobs; dev compose service | worker boots, runs a repeatable job, survives a Redis restart; media tests pass through the worker |
| 2 | Data model delta | `Payment`: `providerOrderId` (MP order) + `providerTransactionId` (payment inside it), raw `providerStatus`/`providerStatusDetail` next to our own `PaymentStatus` (mapping table in code); `EmailOutbox` (template + order/campaign id; the address is resolved at send time, never copied); seed `PriceRuleSet` v1 (04 §3) and dev placeholder `LegalDocument`s; reviewed SQL for any new CHECK | migration + drift check clean; constraint tests for new CHECKs |
| 3 | Pricing engine | pure `price(config, input, context)` per 04 §4: integer cents, `mulBps` half-up, perks read from the DB (never the request), BEST_SINGLE discount, queue jump on pre-discount subtotal, min R$ 5 / max R$ 2.000; `POST /api/v1/orders/quote` (movie) | 04 §11: table tests (E1–E10), band edges, rounding, perks, fast-check properties (Σ lines = total, integers, monotonic), tamper tests (`.strict()`, `expectedTotalCents` → 409) |
| 4 | Vouchers + queue-jump caps | reservation in the order transaction: voucher `redemptionCount` by conditional update; `QueueJumpSlot` with lowest free `(day, dayIndex)` / `(isoWeek, weekIndex)` in America/Sao_Paulo; release on expiry/cancel; brute-force cool-down on invalid codes; operator script `npm run voucher:create` | 50 parallel reservations never exceed shared/tier/buyer caps (real Postgres); day/week edges incl. ISO week 53; voucher limits race-free |
| 5 | Legal versions | `LegalDocument` = version + SHA-256 of the exact text shown; `GET /api/v1/legal/current`; checkout stores one `LegalAcceptance` per document; texts marked **provisório** until the lawyer's arrive, and **production refuses to boot** with provisional texts | acceptance rows pinned to the hash; boot test |
| 6 | Mercado Pago client | `src/server/payments/mercadopago.ts`: create Pix order (`processing_mode: automatic`, `external_reference` = our order id, `expiration_time` PT30M, amounts as exact decimal strings from cents, `X-Idempotency-Key` = `Payment.idempotencyKey`), get, cancel, refund; strict Zod on every response; timeouts + bounded retries; token only in the server, redacted in logs; a mock MP server for tests built from documented examples | contract tests against the mock; 5xx/timeout/409 idempotency paths; no float anywhere in amounts |
| 7 | Checkout | `POST /api/v1/orders` (movie: reserves the movie — one winner — `reservedUntil` 35 min) and `POST /api/v1/campaigns/[id]/contributions` (whole reais ≥ R$ 5, capped at what's left; `remainingCents` conditional decrement); both: Turnstile, `Idempotency-Key`, CSRF/Origin, rate limits, 1 pending order per buyer and 2 per IP, legal versions, sanitised display name/message (pending approval), order access token returned once + `__Host-wf_order` cookie. Order routes generalised to `orders/[code]`: read, `access`, `cancel` (unpaid only → cancels at MP), `claim`; `GET /api/v1/me/orders` | two buyers for one movie → exactly one Pix; 50 parallel contributions never overfund; guest and user paths; authz matrix extended (meta-test) |
| 8 | Webhook | `POST /api/webhooks/mercadopago` per 05 §6, adapted to Orders (topic/`data.id` = MP order id; exact query and header shape checked against MP's notification docs while building): signature + freshness + `SET NX` replay guard → `WebhookEvent` → enqueue `payment.sync` (`jobId` per MP order) → 200 fast; own nginx location (16 KB, rate limit, no CSRF) | every case in 05 §6 "Tests": bad/truncated signature, wrong secret, previous secret during rotation, stale/future `ts`, replay, 10× parallel duplicates, unknown topic → 200 IGNORED |
| 9 | Sync, reconcile, expiry | `payment.sync`: `GET /v1/orders/{id}`, verify `external_reference`, stored ids, amount, BRL, pix, `collector_id`, live/test mode → forward-only state machine (02 §3) with `version` + provider timestamp; in one transaction: order **PAID**, movie **SPONSORED** or campaign `reserved → raised` (goal reached → **FUNDED**), voucher/slot **CONSUMED**, audit; then publish events and queue the receipt. `payment.reconcile` every 2 min + nightly 48 h; `orders.expire` at 35 min → cancel at MP, **EXPIRED**, release movie/campaign/voucher/slot; late approval → NEEDS_ATTENTION (D4). `campaigns.deadline` → PAUSED when the deadline passes unfunded (pending Pix may still complete) | out-of-order (approved then pending), amount mismatch, foreign order, wrong collector, late approval, MP down → retries; a missed webhook is recovered by reconcile within 2 min |
| 10 | E-mail | `email.send` from the outbox: receipt with the order link after approval only, campaign extension notice, funded notice; provider interface with **Resend** (production) and a dev transport that writes to the log and `/dev/emails` (development only); pt-BR plain-text + simple HTML, no remote images | templates escape every value; no e-mail before approval; retries with backoff; LGPD export includes orders |
| 11 | Realtime | Redis pub/sub → SSE `GET /api/v1/orders/[code]/events` (owner/cookie) and `GET /api/v1/campaigns/[id]/events` (public); heartbeat 20 s (Cloudflare idles at 100 s); polling fallback 4 s; nginx `proxy_buffering off` for these locations | status reaches the page < 1 s after sync; reconnect works; payloads schema-checked; no e-mail or names in public events |
| 12 | UI | movie checkout sheet from **Patrocine agora** (breakdown, perks when logged in, voucher, Prioridade/Topo, e-mail for guests, optional name/message, legal checkboxes, Turnstile); contribution box (R$ 5/10/20/50 + any whole amount, capped); order page `/pedido/[code]` (QR + copia-e-cola with copy button, 30-min countdown, live status, "confira o nome do recebedor", success and expired states, "Vincular à minha conta"); live progress bars; "Minhas compras" in Perfil; CTAs switched on; mobile layouts | e2e (mocked MP, approval via signed webhook): movie → Patrocinado; contribution → bar moves; expiry → Reservado clears; CSP 0 violations incl. Turnstile; axe 0; no horizontal scroll at 360 px |
| 13 | Admin pedidos | `/admin/pedidos` (MODERATOR+ with passkey): list/filter, detail, approve display names/messages; NEEDS_ATTENTION resolve; **exception refund** (STREAMER + Google step-up + passkey, `Idempotency-Key`, reason enum, audit) through MP refund | authz matrix; refund idempotent under double-click; every action audited |
| 14 | Docs + report | `docs/phase-2/README.md` + `test-report.md`; 01/02/03/05 deltas (Orders API, worker, endpoints); 09 rewritten for Orders (panel events, test payer) | all suites green in CI |

## 4. Exit criteria

- Every R1 suite still green; new suites green: pricing table + properties, cap races, checkout races, webhook security cases, sync state machine, e-mail, SSE, checkout e2e.
- No path marks an order PAID without a verified `GET` from Mercado Pago (the webhook body is never trusted).
- CSP 0 violations on every page with the checkout open (Turnstile + QR); each security header exactly once; `npm audit` clean; gitleaks clean.
- Pull request `phase-2` → `main` with green CI and screenshots of the new screens.

## 5. Inputs from the user

| When | What |
|---|---|
| now | **S2** — confirm the production User ID (`1138239348`?) and Application ID (`2826739158388788`?) in Suas integrações › Produção (not secret) |
| now | **Q13** — the name payers see as the Pix recipient (not secret) |
| for your own local test | test values in `Wiskiflix/.env.local`: `MP_COLLECTOR_ID=3733347216`, `MP_APPLICATION_ID=5754049850745190`, `MP_ACCESS_TOKEN=<test token>` — typed by you, never sent in the chat |
| optional | allow `api.mercadopago.com` for Claude's workspace (claude.ai › Settings › Capabilities) if you want me to check the mock against real sandbox responses; the test token would then be read from your `.env.local`, test values only |
| Phase 5 | production Access Token, webhook secret (event **Order (Mercado Pago)** + chargebacks), Turnstile site/secret keys, Resend key + `mail.wiski.fun` DNS, the lawyer's final texts |

Sources: [Migrar de API Payments para API Orders](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/migrate-payments-to-orders.md) · [Pix na API Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix) · [API Payments — overview](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/overview)
