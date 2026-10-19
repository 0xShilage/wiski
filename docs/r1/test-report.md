# R1 — test report

> Run: 2026-10-02/03, Claude's Linux workspace · Node 22.22.0, then **every suite again on Node 24.19.0** after the move to Node 24 LTS (same results) · Postgres 17.10 (embedded-postgres) · Redis 7.0.15 · nginx 1.24 · Chromium (Playwright 1.63)
> Tree: the one delivered to `Documents\Wiskiflix` with this report. Build notes: [`README.md`](./README.md).

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint (`--max-warnings=0`) | `npm run lint` | ✅ 0 problems |
| Typecheck (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | `npm run typecheck` | ✅ |
| Formatting | `npm run format:check` | ✅ |
| Unit | `npm test` | ✅ **122 / 122** (Phase 1: 89) |
| Integration (Postgres 17 + Redis, app role `wf_app`, real migrations) | `npm run test:integration` | ✅ **324 / 324** (Phase 1: 165) |
| Brand (Chromium, 2×) | `npm run test:brand` | ✅ **151 / 151** |
| E2E (production build behind nginx/TLS, seeded, 360 px + 1280 px) | `npm run build && npm run test:e2e` | ✅ **179 / 179**, 0 flaky (+29 intentionally run on one project only) |
| Dependencies | `npm audit --audit-level=high` | ✅ 0 vulnerabilities (see F6) |
| Client bundle secret scan | `npm run check:bundle-secrets` | ✅ 25 files clean |
| Migrations vs schema | official schema engine (WASM), `diff-migrations` | ✅ empty migration (no drift) |
| Production build | `npm run build` | ✅ standalone output; every page dynamic (ƒ) |

### New and extended suites

| File | Tests | Covers |
|---|---|---|
| `tests/integration/db-constraints-r1.test.ts` | 16 | every new CHECK, the deferred slot exclusion (swap in one transaction), 35/10/10 trigger under concurrency (`WF409`), campaign `remaining`, `Order` kind columns, one active movie order |
| `tests/integration/media.test.ts` | 20 | fuzz corpus (below) + the development-only `/media/[file]` route (headers, bad names, 404 in production) |
| `tests/integration/passkeys.test.ts` | 8 | no passkey → 401 with the enrol URL; enrolling needs a fresh Google login; enrol → verify → admin open, after 10 min `PASSKEY_REQUIRED`; replayed assertion (single-use challenge), wrong origin, wrong RP ID, missing user verification and a non-increasing counter rejected; foreign passkeys/ids → 404; viewers can't use the endpoints |
| `tests/integration/catalog.test.ts` | 15 | drafts (sanitised text, trailer link parsed), 422s, stale `expectedVersion` → 409, exact revert, incomplete → 422, publish into the first free slot, beyond 35 → 409, atomic reorder, Substituir, watched, draft-only delete; campaigns: moderators can't open, stale Google login → step-up, extend, goal never below raised + reserved |
| `tests/integration/authz.test.ts` | 157 | **39 routes × 4 roles** + completeness meta-test (now walks all of `src/app`) |
| `tests/unit/catalog-lib.test.ts` | 33 | prices and goals, YouTube id parsing (hostile URLs), slugs, sanitiser, byte sniffing, `srcset` builder |
| `tests/e2e/carousel.spec.ts` | 5 per viewport | arrows, counter, `aria-live`, no auto-rotation, keyboard + focus, sponsored/reserved states, touch swipe (phone), trailer modal |
| `tests/e2e/dashboard.spec.ts` | 5 | passkey via WebAuthn virtual authenticator → create → upload → publish → in the carousel; edit + revert; two moderators → conflict; Alt + → slot swap |
| `tests/e2e/viewports.spec.ts` | 13 | the five requested desktop resolutions, full screen and with browser chrome |
| `tests/e2e/design-match.spec.ts` | 7 | the eight design PNGs at 390 / 1440 / 1920 (side-by-side images + Figma metrics) |
| `tests/e2e/headers.spec.ts` | 20 per run | Phase 1 checks + Permissions-Policy for the player, `/media/` headers, 9 refused media names, upload location (GET → 403, 12 MB announced → 413) |
| `tests/e2e/csp.spec.ts`, `a11y-layout.spec.ts` | 24 + 22 per viewport | all R1 pages (incl. dashboard, passkey screens, detail pages) |

## R1 exit criteria (12 §3)

| Criterion | Evidence | Status |
|---|---|---|
| All Phase 1 suites still green | every Phase 1 test is still in the suites above and passes (pages renamed: `/entrar`, `/conta` → `/perfil`) | ✅ |
| New suites green: constraints, media fuzz, passkeys, catalog authz matrix, carousel and dashboard e2e | table above | ✅ |
| CSP 0 violations on every page, with the trailer open | `csp.spec.ts`: 22 pages × 2 viewports, 0 enforced violations, nonce on every `<script>`/`<style>`, no `style=` in SSR HTML; `carousel.spec.ts`: 0 violations with the YouTube player open on `/` and on a detail page, nothing requested from YouTube before the click, iframe destroyed on close | ✅ |
| Each security header exactly once | `headers.spec.ts`: page, 404, API, brand asset, favicon, hashed JS **and a `/media/` image**; Permissions-Policy delegates `autoplay`/`encrypted-media`/`fullscreen`/`picture-in-picture` to `youtube-nocookie.com` only | ✅ |
| `npm audit` clean | 0 vulnerabilities (F6) | ✅ |
| Pages match the design PNGs at 390 / 1440 / 1920 | `design-match.spec.ts` writes design-vs-build images to `test-results/design/` (reviewed: Filmes 1920, 1440, 1440 sponsored, 390 + rail, trailer modal, Séries, dashboard) and asserts side margins (160 px @1920, 120 px @1440), active poster centred (< 2 px), header order, 16:9 player centred, phone tab bar and CTA order | ✅ (art differs on purpose: seed placeholders) |
| Delivered like Phase 1 | batches of ≤ 50 files to `Documents\Wiskiflix`, no `node_modules`, `.next`, `.env*` or media; zip in the chat | ✅ |

## Per-step "done when" checks (12 §2)

| # | Step | Check | Result |
|---|---|---|---|
| 1 | Baseline | Phase 1 suites reproduced before any change | ✅ |
| 2 | Data model | both R1 migrations apply on Postgres 17.10 (integration + e2e setup); `db-constraints-r1.test.ts` (16) covers every new CHECK/unique/exclusion/trigger; schema valid; no drift | ✅ |
| 3 | Env + headers | `env.test.ts` (TMDB vars and licence rule gone, `MEDIA_DIR` required in production); CSP unit test (`frame-src` adds only `youtube-nocookie.com`); header e2e exactly-once incl. `/media/` and upload location | ✅ |
| 4 | Passkeys | `passkeys.test.ts` (8) + dashboard e2e with a virtual authenticator; every admin route × role in the authz matrix | ✅ |
| 5 | Media pipeline | `media.test.ts`: SVG, HTML renamed `.jpg`, GIF, HEIC, PDF, empty → 415; JPEG/HTML polyglots neutralised (trailing payload and COM segment gone); PNG bomb (2.5 GP header) refused without decoding; 11 MB → 413 (header and lying `Content-Length` while streaming); EXIF GPS stripped (no metadata in any output); path-traversal names never used (unknown query keys → 422, `Content-Disposition` ignored); wrong role, too small, logo without alpha, truncated, animated → 422; viewers → 404 before the body is read; temp dir empty afterwards | ✅ |
| 6 | Catalogue services + admin API | `catalog.test.ts` (15): revert restores the exact snapshot; publish beyond 35 → 409; stale version → 409; authz matrix 39 × 4 | ✅ |
| 7 | Theme + layout | axe 0 violations on 22 pages × 2 viewports; header/tab bar/footer per design; 301s for `/entrar`, `/conta`, `/conta/sessoes`; no TMDB attribution | ✅ |
| 8 | Public pages | carousel e2e (buttons, keyboard, counter, states); CSP 0 incl. trailer; `<picture>` with AVIF/WebP `srcset` from `MediaAsset` | ✅ |
| 9 | Dashboard UI | dashboard e2e: create → upload → publish → visible in the carousel (hero image served from `/media/…webp`); revert; second moderator → "Outra pessoa salvou…", reload shows the other save; keyboard slot swap | ✅ |
| 10 | Seed + docs | the e2e stack seeds through `scripts/seed-dev.ts` (real services + pipeline); `docs/r1/README.md`, this report, R1 delta sections in 02/03/05 | ✅ |

## Desktop resolutions (user request)

`tests/e2e/viewports.spec.ts` — title, CTAs, price line and arrows inside the first screen, nothing overlapping the poster rail, the active poster fully visible, no horizontal scroll. Screenshots: `test-results/viewports/`.

| Size | Full screen | With browser chrome + taskbar |
|---|---|---|
| 1920 × 1080 | ✅ | 1920 × 947 ✅ |
| 1536 × 864 | ✅ | 1536 × 730 ✅ |
| 1366 × 768 | ✅ | 1366 × 625 ✅ |
| 1280 × 720 | ✅ | 1280 × 593 ✅ |
| 3440 × 1440 | ✅ (text column at x > 400, centred 2400 px stage) | 3440 × 1305 ✅ |

Séries, a detail page and the dashboard at 1366 × 768, 1280 × 720 and 3440 × 1440: ✅ (no horizontal scroll; sponsor panel in the first screen; dashboard page itself never scrolls — each column does).

## Findings fixed during R1

| # | Finding | Fix | Guarded by |
|---|---|---|---|
| F1 | A CHECK written as `x BETWEEN a AND b` lets `NULL` through (NULL is not false) — a MOVIE order without `runtimeMinutes`/`rescheduleCount` passed | explicit `IS NOT NULL` in the kind-specific `Order` CHECKs | `db-constraints-r1` |
| F2 | The partial unique index on active movie orders drifted (Prisma's predicate text ≠ Postgres's normalised form) | predicate written exactly as Postgres normalises it (`raw(…)`) | drift check empty |
| F3 | Tailwind's preflight zeroes `margin` on `<dialog>`, so the trailer modal stuck to the top of the screen | `margin: auto` on the modal and the preview dialog | `design-match` (player centred ± 4 px) |
| F4 | `/perfil/seguranca` scrolled sideways by 33 px on 360 px phones (passkey name field) | flexible field (`min-w-0`, `w-full`) | `a11y-layout` (no horizontal scroll) |
| F5 | The meta row could end a line with a dangling `│` separator when genres wrapped | separators belong to the next item and are clipped at the start of a line | visual check (design-match) |
| F6 | `npm audit`: new advisory GHSA-vfj7-8cjw-p6xm (`braces` ≤ 3.0.3, **no fixed release**) via the lint-only chain `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch` | `overrides` gives that plugin `tinyglobby` (same API, already in the tree); not exploitable here anyway — the plugin only globs `settings.next.rootDir` | `npm audit` = 0 |
| F7 | UI: two-line seed logos clipped; desktop rail started empty on the left; dashboard columns caused a phantom page scroll | logo layout; ring rail on desktop; positioned columns | design-match, viewports |

## Trusted Types trial (report-only)

Unchanged from Phase 1: pages with client components report one sink, `HTMLScriptElement src`, from Next.js's chunk loader (now also `/admin/catalogo`, `/perfil`, `/perfil/sessoes`). Enforcement needs a Trusted Types policy for `/_next/static` — Phase 5 item.

## Not verifiable in this workspace

- `prisma migrate deploy` with the native engine (download host blocked) — run `npm run db:migrate` + `npm run db:drift` locally or in CI.
- Real Google login and therefore the dashboard with your own account (needs the OAuth client, Q27). The flows are covered against a mocked issuer and with a WebAuthn virtual authenticator; a hardware security key or a phone passkey wasn't available here.
- The real YouTube player: the e2e tests stub `youtube-nocookie.com` (hermetic, and they prove nothing is requested before the click).
- Firefox and Safari (only Chromium is installed here); GitHub Actions (no repository yet, Q26).
