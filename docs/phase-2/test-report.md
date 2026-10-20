# Phase 2 — test report

> Run: 2026-10-19, Claude's Linux workspace · Node 22.22.0 (CI: Node 24) · Postgres 17 (embedded-postgres) · Redis 7 · nginx · Chromium (Playwright 1.64)
> Branch `phase-2`. Build notes: [`README.md`](./README.md). Mercado Pago, Turnstile and Resend are not reachable from the workspace (13 §0): every suite talks to a local stand-in built from their documented requests and responses (`tests/support/mock-externals.ts`).

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint (`--max-warnings=0`) | `npm run lint` | ✅ 0 problems |
| Typecheck (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | `npm run typecheck` | ✅ |
| Formatting | `npm run format:check` | ✅ |
| Unit | `npm test` | ✅ **221 / 221** (R1: 122) |
| Integration (Postgres 17 + Redis, app role `wf_app`, real migrations) | `npm run test:integration` | ✅ **486 / 486** (R1: 324) |
| E2E (production build behind nginx/TLS, worker + mocks, 360 px + 1280 px) | `npm run build && npm run test:e2e` | ✅ **187 / 187** (+29 intentionally run on one project only; R1: 179) |
| Dependencies | `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Client bundle secret scan (now incl. the Resend key) | `npm run check:bundle-secrets` | ✅ |
| Production build | `npm run build` | ✅ `/pedido/[code]`, `/admin/pedidos` and 17 new API routes, all dynamic |
| Migrations vs schema | CI (`db:drift` with the real engine) | runs on the pull request |

### New and extended suites

| File | Tests | Covers |
|---|---|---|
| `tests/unit/pricing.test.ts` | 52 | 04 §11 table (E1–E10), band edges, half-up rounding, perks, BEST_SINGLE, queue jump on the pre-discount subtotal, min/max; **fast-check properties**: Σ lines = total, integers only, monotonic in runtime |
| `tests/unit/payments-lib.test.ts` | 36 | cents ⇄ decimal strings (no floats), Orders status mapping, forward-only moves, signature parsing + manifest + rotation + staleness, public codes, UUID v7, buyer-key hashing, São Paulo business day + ISO week 53, e-mail escaping and header-safe subjects, **pinned legal hashes** |
| `tests/unit/qr.test.ts` | 2 | deterministic QR path, quiet zone, finder patterns |
| `tests/unit/env.test.ts` | 25 | production refuses test/mismatched Mercado Pago tokens, missing webhook secret / Resend key / recipient name, endpoint overrides off localhost |
| `tests/integration/checkout.test.ts` | 23 | guest checkout in one transaction; signed-in perk; tampering (`.strict()`, stale `expectedTotalCents` → 409 with the new breakdown); legal versions; Turnstile + Idempotency-Key; replay; **two buyers racing for one movie → one Pix**; 1 unpaid per buyer, 2 per IP (paid orders free the place; **8 parallel from one IP → 2**); MP down → 503 and every hold released, late create cancelled; vouchers race-free + cool-down; **queue-jump caps under concurrency**; access/cancel/claim; contributions (whole reais, never leaving < R$ 5, **30 parallel → exactly the goal**, paused/funded closed, sanitised moderated texts) |
| `tests/integration/webhook.test.ts` | 20 | every 05 §6 case: wrong secret, id signed for another order, missing/truncated/duplicated parts, tampered request id, upper/lower-case id, previous secret in rotation, stale and future `ts`, seconds vs ms, replay → DUPLICATE, **10 parallel duplicates → one event, one job**, other topics IGNORED, 405/413/415, no Origin needed |
| `tests/integration/payments-sync.test.ts` | 24 | approval side effects in one transaction, no e-mail before approval, voucher/slot final, campaign funded + notices, foreign orders ignored, out-of-order and backwards moves refused, **10 concurrent syncs → paid once**, MP down → retry, expiry sweep, late approval → NEEDS_ATTENTION, provider-side cancel, panel refund / chargeback → NEEDS_ATTENTION, reconcile, extension notices; **a sync racing the expiry sweep (row lock held) never credits a released reservation**; money after a buyer's cancel → late approval; no cancel while the Pix is being created; unprocessed notifications re-queued; nightly re-read of approved payments |
| `tests/integration/admin-orders.test.ts` | 13 | list/search never shows a full e-mail; moderation once + audited; **accept a late Pix** (PAID, SPONSORED, receipt re-armed, audited) or 409 when the movie is gone; moderators can't accept/refund; step-up required; **double-click refund → one Mercado Pago call**; MP down → 502 and a retry re-sends the same key; refunded contribution re-opens a funded campaign; late approval refundable; **refusal by Mercado Pago → REJECTED and the order back to PAID**; a pending refund is offered for retry; a late contribution that would leave < R$ 5 is not accepted |
| `tests/integration/realtime.test.ts` | 5 | order stream: first frame = current status, approval reaches the open stream in < 1 s, stream-friendly headers, 404 without access; campaign stream: no names or e-mails, bar moves on approval; 6 streams per IP; payloads schema-checked before Redis |
| `tests/integration/db-constraints-p2.test.ts` | 7 | buyer-key format (never an e-mail), user key unless claimed, one unpaid order per buyer, NEEDS_ATTENTION needs a reason, paid needs `paidAt`, Crockford codes, provider strings, outbox token erased on final states, per-tier queue-jump index |
| `tests/integration/worker.test.ts` | 2 | real BullMQ: signed notification → queue → worker → PAID + SPONSORED + receipt sent; schedulers upsert idempotently |
| `tests/integration/authz.test.ts` | 225 | **56 handlers × 4 roles** + completeness meta-test (17 new Phase 2 handlers) |
| `tests/integration/db-constraints.test.ts` | 12 | the "exactly one ACTIVE rule set / current legal text" tests now run in a rolled-back transaction (they used to leave rows behind) |
| `tests/e2e/payments.spec.ts` | 4 per viewport | movie (guest) → Pix page (QR, copia e cola, recipient name, link token out of the address bar) → "Reservado" for others → signed notification through nginx → worker → "Pagamento confirmado!" live → receipt e-mail → "Patrocinado"; contribution (signed in) with **a second tab's bar moving live** → Minhas compras; expiry clears "Reservado"; `/admin/pedidos` |

Every e2e step asserts **0 enforced CSP violations** (Turnstile stand-in loaded through the Trusted Types policy, QR drawn as SVG), **axe clean** (checkout sheet, order page pending and paid, Perfil, admin) and **no horizontal scroll** at 360 px.

## Phase 2 exit criteria (13 §4)

| Criterion | Result |
|---|---|
| Every R1 suite still green; new suites green (pricing + properties, cap races, checkout races, webhook security cases, sync state machine, e-mail, SSE, checkout e2e) | ✅ all of the above |
| No path marks an order PAID without a verified `GET` from Mercado Pago | ✅ an order becomes PAID in exactly two places: `markPaidInTx`, reached only from `syncMpOrder` after `getMpOrder` + `verifyMpOrder`, and the STREAMER's accept of a late approval, which requires a payment that such a sync already verified as APPROVED |
| CSP 0 violations with the checkout open (Turnstile + QR); each security header once | ✅ payments e2e + the existing CSP/headers specs |
| `npm audit` clean; gitleaks clean | ✅ audit; gitleaks runs in CI |
| Pull request `phase-2` → `main` with green CI and screenshots | screenshots in [`README.md`](./README.md#7-screens) and the pull request |

## Findings fixed during Phase 2

| # | Finding | Fix |
|---|---|---|
| F1 | nginx replaced Mercado Pago's `x-request-id` with its own `$request_id` → every real notification would have failed the signature | webhook location passes the header through (`docker/nginx/snippets/mercadopago-webhook.conf`); e2e sends signed notifications through nginx |
| F2 | The per-IP limit counted every checkout in the last 35 min, paid or not → people on one carrier NAT blocked each other | counts unpaid orders only (test: a paid order frees the place) |
| F3 | A contribution could leave R$ 1–4 to go, which nobody can pay (minimum R$ 5) | contributions and goal changes keep the remainder at 0 or ≥ R$ 5 (server + UI) |
| F4 | A legal-text setup inside the order transaction waited on a second pool connection (deadlock under load) | acceptance versions are checked before the transaction |
| F5 | Expiring an old reservation inline was blocked by the one-unpaid-per-buyer index | reservation taken before the order row exists, with a UUID v7 id |
| F6 | BullMQ job ids can't contain `:` | ids use `-` |
| F7 | The R1 "exactly one" constraint tests left an ACTIVE rule set / current legal text behind | they run in a rolled-back transaction |

## Independent review (before merge)

A separate agent that had not seen the work reviewed the payment paths (read-only). It found **no path to PAID, credit, sponsorship or refund without a verified Mercado Pago `GET`, no free goods and no double refund**. It confirmed the signature check, link token, cookie, CSRF, step-up and integer money arithmetic. It also reported seven defects. All of them are fixed, and each fix has a test:

| # | Finding | Fix |
|---|---|---|
| F8 (medium) | A sync could overwrite a concurrent expiry. The paid order showed "Pago" while the released reservation was never credited (a campaign could collect over its goal), and a failed credit was ignored. | Every sync order transition is conditional on status + version; a conflict rolls back and re-reads (late approval). A failed credit goes to NEEDS_ATTENTION. |
| F9 (medium) | Late events could be lost for good: a queueing failure was swallowed, sync gave up after about 1 min, the replay key was set before the row was stored, and nothing re-read old approved payments (chargebacks). | Stored-but-unprocessed notifications are re-queued every 2 min. Sync retries 10 times over about 40 min. The replay key is dropped if the row can't be stored. A nightly re-read covers approved payments for 120 days. |
| F10 (medium) | A refund that Mercado Pago refused left the order stuck in REFUND_PENDING with no retry. | A refusal is settled as REJECTED and the order goes back to its previous status (audited). A refund with no answer is offered for retry with the same key, and reconcile re-reads it every 2 min. |
| F11 (low) | The per-IP check-then-add could be raced (10 parallel → 10 reservations). | One atomic Redis script. |
| F12 (low) | Cancelling while the Pix was still being created, then paying it, went unnoticed. | No cancel in that window. Approval after a cancel or rejection surfaces as a late approval. |
| F13 (low) | Staff could read the buyer page (incl. the Pix) without the passkey. | Buyer pages admit only the owner or the cookie holder. |
| F14 (low) | Accepting a late contribution could leave R$ 1–4 to go or ignore the deadline. | The same remainder rule and an open-campaign/deadline check apply. |

The review also noted that the docs claimed a currency check that the Orders API can't have (no currency field). The docs are corrected.

## Not verifiable in this workspace

- Real Mercado Pago sandbox calls (`api.mercadopago.com` blocked here): the mock follows the documented Orders API shapes; first real check is `npm run dev` + `npm run worker` with test credentials on your computer, then one real low-value Pix before launch (09 §D).
- Real Turnstile and Resend (blocked here): server-side verification and the Resend call are tested against the mock; real keys arrive in Phase 5.
- Migration drift with the real schema engine (`binaries.prisma.sh` blocked): checked in CI.
