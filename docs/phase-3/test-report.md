# Phase 3 — test report

> Run: 2026-10-30, Claude's Linux workspace · Node 24.19.0 · Postgres 17.10 (embedded-postgres) · Redis 7.0.15 · nginx 1.24 · Chromium (Playwright 1.64.1) · Turnstile and Mercado Pago faked at the network boundary
> Tree: the one delivered to `Documents\Wiskiflix` with this report (branch `phase-3-reviews`). Build notes: [`README.md`](./README.md).

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint (`--max-warnings=0`) | `npm run lint` | ✅ 0 problems |
| Typecheck (strict) | `npm run typecheck` | ✅ |
| Formatting | `npm run format:check` | ✅ |
| Unit | `npm test` | ✅ **276 / 276** (Phase 2: 214) |
| Integration (Postgres 17 + Redis, app role `wf_app`, real migrations) | `npm run test:integration` | ✅ **557 / 557** (Phase 2: 464) |
| Brand (Chromium, 2×) | `npm run test:brand` | ✅ **151 / 151** |
| E2E (production build behind nginx/TLS, seeded, 360 px + 1280 px) | `npm run build && npm run test:e2e` | ✅ **203 / 203**, 0 flaky (+31 intentionally run on one project only) — every earlier page again, plus 4 new pages and `reviews.spec.ts` |
| Dependencies | `npm audit --audit-level=high` | ✅ 0 high/critical (the same 1 moderate, dev-only `fast-uri`) |
| Client bundle secret scan | `npm run check:bundle-secrets` | ✅ 28 files clean |
| Migrations vs schema | official schema engine (WASM): migrations applied vs Prisma's own empty→schema SQL | ✅ identical (the only extra object is R1's reviewed `ci_live_slot_unique`) |
| Production build | `npm run build` | ✅ |

## New and extended suites

| File | Tests | Covers |
|---|---|---|
| `tests/unit/reviews.test.ts` | 62 | sanitiser over the **XSS corpus** (36 payloads: script/img/svg/iframe/object/base/meta/form/event handlers, mutation-XSS, entity and URL encodings, template injection, bidi override, zero-width, controls, line separators, BOM, tag characters) — no forbidden code point survives, idempotent, never longer; legitimate text (accents, emoji, RTL, `<`/`>`, ZWJ families) unchanged; **fast-check** property (2 000 random binary strings); link counting incl. disguised schemes and a linear-time check; cursor round-trip and tampering |
| `tests/integration/reviews.test.ts` | 28 | happy path (sanitised, listed, summary, no e-mail); watched-only (archived and in-slot); login/username/suspension; one per person incl. 4 parallel posts → 1; strict body, whole stars, length after sanitising (2000 emoji OK, 2001 chars 422); Turnstile; > 2 links held; **the XSS corpus stored and served back byte-for-byte as sanitised text**; report notes sanitised; edit ("editado", no-op edit, foreign 404, locked when held); delete (cascade, REMOVED stays and blocks a new review); recent/top keyset paging over 23 reviews, tampered cursor, duplicate query params; hidden and erased authors excluded; latest list and profiles (exact public fields, case-insensitive, erased → 404); likes (idempotent, own 422, hidden 404, suspended 403, **25 parallel likes → 25**, parallel like/unlike by one person stays consistent); reports (account age, own, idempotent, note length, **3 from ≥ 7-day accounts → auto-hide + audit**, young accounts never auto-hide, **6 parallel reports → hidden once, one audit row**); **rate limits**: create 5/h per person and 10/h per IP, like 120/h, report 10/h per person and 20/h per IP |
| `tests/integration/moderation.test.ts` | 10 | passkey ≤ 10 min required; HIDE (reports ACTIONED, audit without text/notes); RESTORE an auto-hidden review (reports DISMISSED, can be reported afresh); DISMISS and "nothing to dismiss"; REMOVE streamer-only and final; stale view 409, invalid transition 409, unknown 404, strict body; **two moderators at once → one wins, one audit row**; queue order and contents (no e-mail); hidden list; like-burst and report-burst signals |
| `tests/integration/db-constraints-p3.test.ts` | 7 | `review_hold`, rating/body/counters/times CHECKs, one review per person per item; self-like/self-report triggers; `likeCount` through inserts, deletes and cascades; `openReportCount` through inserts, resolutions and deletes; report note length, resolution pairs, immutable `reviewId` |
| `tests/integration/authz.test.ts` | 253 | **63 route × method rows × 4 roles** + completeness meta-test (12 new Phase 3 routes) |
| `tests/e2e/reviews.spec.ts` | 5 (8 runs) | **XSS corpus rendered under the real CSP**: raw payloads stored straight in the DB (worse than the API allows), every page loaded — literal text visible, no `script`/`img`/`svg`/`iframe`/… inside review bodies, no inline event-handler attributes anywhere, no dialog, 0 enforced CSP violations; spoilers folded; anonymous view; like (persists after reload) and report through the dialog; moderator dismisses and hides from `/admin/moderacao`, and the hidden review is gone from the public page |
| `tests/e2e/{csp,a11y-layout}.spec.ts` | +4 pages | watched title (anonymous and signed in), a public profile with reviews, the moderation page: 0 CSP violations, axe clean, no horizontal scroll at 360 px |

## Phase 3 exit criteria (00 README, phase plan)

| Criterion | Evidence | Status |
|---|---|---|
| Sanitizer tests | `tests/unit/reviews.test.ts` (corpus, keep-list, property test) + `catalog-lib.test.ts` | ✅ |
| XSS payload corpus | `tests/support/xss-corpus.ts` through the sanitiser (unit), the API (integration) and the rendered page under the CSP (e2e) | ✅ |
| Rate-limit tests | `reviews.test.ts` › rate limits (create per person and per IP, like, report per person and per IP) | ✅ |

## Visual check

Screenshots at 1280 px and 360 px of a watched title (anonymous and signed in, with the form), Avaliações, a public profile and the moderation queue. One fix: on desktop the display font's tilde in "AVALIAÇÕES" touched the section's top edge — the section got 16 px of top padding. Turnstile can't load here (no internet), which showed the form's "não foi possível carregar a verificação" message.

## Findings and notes

| # | Finding | Action |
|---|---|---|
| F1 | The self-like/self-report trigger used one `CASE` over both tables; PL/pgSQL resolves `NEW.<column>` at run time, so it failed on whichever table lacked the column | separate `IF` branches; covered by `db-constraints-p3` and every like/report test |
| F2 | The shared sanitiser stripped the zero-width joiner everywhere, splitting emoji like 👨‍👩‍👧 | ZWJ kept only between emoji; stray ZWJ still removed (unit tests both ways) |
| F3 | Watched titles 404'd after their slot was replaced (ARCHIVED), which would have orphaned their reviews | detail pages serve ARCHIVED titles that were watched, as "Assistido na live" |
| F4 | On narrow dashboards the whole "Operação" sidebar section was hidden, so Moderação was unreachable below 1200 px | only the "em breve" entries are hidden there now |
| F5 | The anonymous like link's accessible name didn't start with its visible text (axe `label-content-name-mismatch`) | visible count first, then screen-reader text |
