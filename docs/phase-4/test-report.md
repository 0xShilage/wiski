# Phase 4 — test report

> Run: 2026-10-31, Claude's Linux workspace · Node 24.19.0 · Postgres 17.10 (embedded-postgres) · Redis 7.0.15 · nginx 1.24 · Chromium (Playwright 1.64.1, run with the workspace's build 1243 through `PW_CHROMIUM_EXECUTABLE`) · Turnstile and Mercado Pago faked at the network boundary
> Tree: the one delivered to `Documents\Wiskiflix` with this report (branch `phase-4-operations`). Build notes: [`README.md`](./README.md).

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint (`--max-warnings=0`) | `npm run lint` | ✅ 0 problems |
| Typecheck (strict) | `npm run typecheck` | ✅ |
| Formatting | `npm run format:check` | ✅ |
| Unit | `npm test` | ✅ **276 / 276** (unchanged; Phase 4 logic is database-bound and tested in integration) |
| Integration (Postgres 17 + Redis, app role `wf_app`, real migrations) | `npm run test:integration` | ✅ **837 / 837** (Phase 3: 557) |
| Brand (Chromium, 2×) | `npm run test:brand` | ✅ **151 / 151** |
| E2E (production build behind nginx/TLS, seeded, 360 px + 1280 px) | `npm run build && npm run test:e2e` | ✅ **258 / 258**, 0 flaky (+34 intentionally run on one project only) — every earlier page again, plus 13 new pages and `operations.spec.ts` |
| Dependencies | `npm audit --audit-level=high` | ✅ 0 high/critical. 18 moderate, all in the dev-only lint toolchain (`minimatch` via eslint plugins, `fast-uri`); nothing in the production bundle; no dependency changed in Phase 4 |
| Client bundle secret scan | `npm run check:bundle-secrets` | ✅ 34 files clean |
| Migrations vs schema | official schema engine (WASM): migrations applied vs Prisma's own empty→schema SQL | ✅ identical (332 columns, 70 foreign keys, 28 enums; the only extra object is R1's reviewed `ci_live_slot_unique`; Phase 4's partial unique `session_one_live` is in the schema) |
| Production build | `npm run build` | ✅ |

## New and extended suites

| File | Tests | Covers |
|---|---|---|
| `tests/integration/live.test.ts` | 14 | sessions: plan, edit, start, one live at a time (**two simultaneous starts → one wins**), capacity never below what is booked, cancel (streamer) returns everything; queue order (Topo da fila → Prioridade → payment time, campaigns included); **10 movies of 120 min racing for a 300-min session → exactly 2 fit**; stale version / finished session / wrong state → 409; remove frees the minutes; now playing → completed (order COMPLETED, item WATCHED, watch event with order + session, reviews open); ending needs nothing on the air and returns the rest; the catalogue's "Marcar como assistido" also completes the order; owner rescheduling (owner only, ≥ 24 h, PLANNED target ≤ 60 days with room, at most twice; closed within 24 h); public schedule with approved names only, never e-mails |
| `tests/integration/orders-admin.test.ts` | 12 | list/detail (e-mail and MP id for the streamer only); sponsor message and guest name private until approved, audited, second decision 409, stale version 409; accepting a NEEDS_ATTENTION order (streamer + step-up; movie still free → PAID/SPONSORED; taken → 409, nothing changes; a payment that failed verification is never accepted); exception refunds (movie back in the catalogue and session freed, webhook → REFUNDED; step-up + Idempotency-Key; MP down → 503, nothing changes, retry works; completed/expired not refundable; a contribution leaves a funded campaign, which opens again; the schedule never shows a refunded movie) |
| `tests/integration/users-admin.test.ts` | 11 | suspensions (moderator ≤ 7 days, the person still reads but can't write; streamer longer/indefinite with step-up; never yourself, the streamer, or a moderator; a timed suspension lifts itself); roles (USER → MODERATOR ends their sessions, no STREAMER through the API) and VIP; user list (prefix search, filters, e-mail for the streamer only); **LGPD**: export has only your own data and no secrets; erase needs a fresh login and the username typed, removes reviews/likes/reports, anonymises, ends sessions; the streamer account can't be erased |
| `tests/integration/overlay.test.ts` | 9 | keys shown once, stored as SHA-256 only, streamer + step-up; key → cookie (HttpOnly, Secure, Strict, 12 h), wrong or revoked key → 401; snapshots follow the schedule and show names only once approved; revenue goals as a percentage only; a paid order is announced on "Novo patrocínio" (published on Redis, sanitised); **payload sanitisation (exit criterion)**: the XSS corpus as title, sponsor and message → inert, capped, schema-valid; long strings cut with an ellipsis at the widget limits; the schema refuses unsanitised strings, extra keys, HTML-ish types and too many items; the queue never exceeds 5 items |
| `tests/integration/operations.test.ts` | 10 | contact form (sanitised, 12-month purge date, e-mail lower-cased; honeypot → "received", nothing stored; too fast / forged / expired token → 422; Turnstile; strict body; 5/h per IP); inbox (list, mark, delete — audited without content; purge after the date); goals (count / revenue / minutes inside their window; edits audited, bad windows refused, moderators 404); media kit numbers set and cleared; checkout switch and vouchers (streamer + step-up); audit viewer (filter, paging, **CSV cells can never become formulas**) |
| `tests/integration/db-constraints-p4.test.ts` | 9 | session values and lifecycle timestamps, now playing only while live, **at most one LIVE session**; orders and campaigns carry a session only in the right states; overlay keys, goals, stats, contact messages; account status dates |
| `tests/integration/authz.test.ts` | 509 | **127 route × method rows × 4 roles** + completeness meta-test (37 new Phase 4 route files, 64 new rows): **every admin route × role** (exit criterion) |
| `tests/e2e/operations.spec.ts` | 3 (desktop) | the home page strip shows the seeded live with its movie; an overlay opened with a real key: the fragment is exchanged, removed from the address, the cookie is HttpOnly, a second allowed widget opens on the same cookie, a widget the key doesn't allow shows "sem acesso"; **a moderator starts the live and presses "Agora assistindo" in the agenda, and an overlay open in another browser updates over SSE** |
| `tests/e2e/{csp,a11y-layout}.spec.ts` | +13 pages | agenda, pedidos, pessoas (moderator), the agenda and seven streamer pages (streamer), a streamer page as a moderator (404), and the overlay page without a key: 0 CSP violations, axe clean, no horizontal scroll at 360 px |

## Phase 4 exit criteria (00 README, phase plan)

| Criterion | Evidence | Status |
|---|---|---|
| Every admin route × role tested | `authz.test.ts`: 127 rows × anonymous / user / moderator / streamer + the meta-test that fails on any route missing from the matrix | ✅ |
| Overlay payload sanitisation tests | `overlay.test.ts` › payload sanitisation (corpus, limits, schema refusals, item cap) + the overlay page in the CSP spec (0 violations) and `operations.spec.ts` (text rendered from live events) | ✅ |

## Visual check

Screenshots at 1280 px and 360 px of every new page:

- the agenda, orders and people boards;
- the seven streamer pages;
- the home strip, the media kit and the contact form;
- the overlay page.

Fixes from the review are listed as F2 and F3 below.

Turnstile can't load here (no internet), so the contact form shows its "não foi possível carregar a verificação" message, as the review form did in Phase 3.

## Findings and notes

| # | Finding | Action |
|---|---|---|
| F1 | The dev seed now schedules a movie, which publishes overlay updates on Redis; the open Redis connection kept the seed process alive, so `npm run db:seed` (and the e2e stack) never exited | the seed closes Redis at the end |
| F2 | On the home page the display face's acute accent in "PRÓXIMOS" was hidden under the hero's fade-out | the strip sits above it, with 24 px of top room |
| F3 | On the agenda form the date input pushed into the capacity column | form fields may shrink (`min-width: 0`) |
| F4 | The audit table scrolls sideways on phones but couldn't be reached by keyboard (axe `scrollable-region-focusable`) | the wrapper is a focusable, labelled region |
| F5 | The overlay's "sem acesso" text sat on a transparent page (axe contrast; also unreadable over a bright scene in OBS) | shown in the same dark box as the widgets |
| F6 | An overlay with a bad key retried its stream forever | stops after the first refused connection and says so |
| F7 | The transparent overlay background lost to the body's `bg-bg` utility (layer order) | an unlayered rule for overlay pages only |
