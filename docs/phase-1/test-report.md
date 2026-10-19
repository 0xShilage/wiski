# Phase 1 — test report

> Run: 2026-10-02, Claude's Linux workspace · Node 22.22.0 · Postgres 17.10 (embedded-postgres) · Redis 7.0.15 · nginx 1.24 · Chromium (Playwright 1.63)
> Commit state: the tree delivered to `Documents\Wiskiflix` on the same day.

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint (ESLint 9 + next + typescript-eslint + regexp, `--max-warnings=0`) | `npm run lint` | ✅ 0 problems |
| Typecheck (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | `npm run typecheck` | ✅ |
| Formatting | `npm run format:check` | ✅ |
| Unit | `npm test` | ✅ **89 / 89** |
| Integration (Postgres 17 + Redis, app role `wf_app`) | `npm run test:integration` | ✅ **165 / 165** |
| Brand (Chromium, 2×) | `npm run test:brand` | ✅ **151 / 151** |
| E2E (production build behind nginx/TLS, 360 px + 1280 px) | `npm run test:e2e` | ✅ **77 / 77** (+1 intentionally run on one viewport only) |
| Dependencies | `npm audit --audit-level=high` | ✅ 0 vulnerabilities |
| Client bundle secret scan | `npm run check:bundle-secrets` | ✅ 19 files clean |
| Prisma schema | `prisma validate` | ✅ valid (bundled WASM; see README §4.1) |
| Production build | `npm run build` | ✅ every page dynamic (ƒ), standalone output |

## Phase 1 exit criteria (10 §3)

| Criterion | Evidence | Status |
|---|---|---|
| `prisma validate` + migrations apply | schema valid; both migrations apply in order on Postgres 17.10 as `wf_migrator` (integration + e2e setup). Real `prisma migrate deploy` + drift check: CI `migrations` job | ✅ (CLI deploy pending first CI/local run) |
| CSP e2e with 0 violations | `csp.spec.ts`: 11 pages × 2 viewports, 0 enforced violations, 0 console CSP errors; every `<script>`/`<style>` carries the request nonce; no `style=` attribute in SSR HTML | ✅ |
| Nonce differs per request | 5 consecutive requests → 5 distinct 128-bit nonces, HTML nonces = header nonce; client-sent `x-nonce`/CSP headers ignored | ✅ |
| Each security header exactly once | `headers.spec.ts`: page, 404, API, brand asset, favicon, hashed JS → HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP once each; CSP / CSP-Report-Only / Reporting-Endpoints once on pages; API CSP `default-src 'none'`; no `X-Powered-By`, `Server: nginx` without version | ✅ (nginx part with the real Phase 5 snippet) |
| Cookies `__Host-`, HttpOnly, Secure, SameSite | `auth-flow.test.ts` + `accounts.test.ts` parse Set-Cookie: session = Lax, oauth = Lax 600 s, no Domain, Path=/; e2e: session invisible to `document.cookie` | ✅ |
| Authz matrix scaffold green | `authz.test.ts`: 14 routes × 4 roles (56) + completeness meta-test | ✅ |
| 0-pixel-diff asset test | 55 originals vs processed (as image, 2×) + 55 inline + 40 SVGR components vs processed: **0 differing pixels each** | ✅ |
| `npm audit` clean | 0 vulnerabilities | ✅ |
| Test report | this file | ✅ |

## Per-step "done when" checks (10 §2)

| # | Step | Check | Result |
|---|---|---|---|
| 1 | Scaffold | lint + typecheck + test green on the empty app, then on the full app | ✅ |
| 2 | Env validation | `env.test.ts` (19): missing/invalid/placeholder vars rejected, values never echoed, production rules (https, Google creds, no Turnstile test keys, TMDB licence flag, MP id/token match); e2e `boot.spec.ts`: standalone server **exits 1** without `CSRF_SECRET` | ✅ |
| 3 | Brand pipeline | Playwright pixel diff 0 for all 55 SVGs; processed SVGs contain no `<style>`, scripts, handlers or external refs; colour of every file verified against the 06 §1 map | ✅ |
| 4 | Logo | committed SVG = regenerated geometry (unit); outlines vs live text in Black Rockie at 240 px: 453 edge pixels differ (1.2 % of ink, browser text hinting), 16 beyond 1 px (0.04 %) — threshold < 0.1 % | ✅ |
| 5 | Favicon set | ICO = 16/32/48 PNG; 512 tile: transparent rounded corners, ink background; maskable full-bleed; visually checked against favicon-preview panel B | ✅ |
| 6 | Fonts | all pt-BR letters present in Poppins, Escargoth, Black Rockie (served subsets); `º ª …` absent from the original display fonts → Poppins fallback; header bounding box identical before/after `document.fonts.ready`, no header layout shift, total CLS < 0.05 | ✅ |
| 7 | Prisma + reviewed SQL | `db-constraints.test.ts` (12): bad rating, body length, username format, money consistency, voucher kinds, capacity, double ACTIVE rule set, double current legal doc, AuditLog UPDATE/DELETE/TRUNCATE → error (as `wf_app` and as superuser), REPEATABLE READ insert refused, no backdating, UTC session | ✅ |
| 8 | Guard pipeline | `guard-pipeline.test.ts` (27): 405, 413, 415, 400, 422 (no input echo, unknown keys, repeated params), generic 500, 401/404 RBAC, CSRF (Fetch Metadata, 5 bad Origins, token binding), 429 + Retry-After, sliding window math, Redis down → 503, step-up 401 with URL, Turnstile siteverify params / failures | ✅ |
| 9 | proxy.ts / CSP | see exit criteria; `/api/csp-report` accepts Reporting API + legacy formats | ✅ |
| 10 | Auth | `auth-flow.test.ts` (34) against a mocked Google issuer/JWKS: happy path, `sub` not e-mail, bad state, missing/tampered cookie, bad/missing nonce, replayed code, unverified e-mail (`false` and `"true"`), wrong issuer/audience, expired, future `iat`, foreign signing key, PKCE mismatch, user cancel, 8 open-redirect payloads, session fixation, step-up `max_age` (fresh/stale `auth_time`), privileged-login audit, deleted account, login unavailable; `session.test.ts` (9); `accounts.test.ts` (20): onboarding once, reserved names, race on the same name (200/409), 30-day hold & cooldown, avatar presets only, IDOR on sessions → 404, logout CSRF | ✅ |
| 11 | Audit + verifier | `audit-chain.test.ts` (6): allow-listed metadata, 25 concurrent writers → valid chain, **tamper test** (edited row → `hash`; re-hashed row → `link` on the next), deleted middle row → `link`, head anchor reported | ✅ |
| 12 | Base pages | e2e at 360 px and 1280 px: axe (WCAG 2.0/2.1/2.2 A+AA + best practice) **0 violations** on 11 pages, no horizontal scroll, `lang="pt-BR"`; onboarding → conta → public profile flow; logout invalidates the token | ✅ |
| 13 | CI skeleton | `ci.yml` (quality, integration, migrations + drift check, e2e + brand + bundle scan, npm audit + gitleaks), `codeql.yml`, `dependabot.yml`; actions pinned by SHA | ✅ written · runs once the repo is on GitHub (Q26) |

## Findings fixed during the phase

| # | Finding | Fix | Guarded by |
|---|---|---|---|
| F1 | openid-client skips the JWS check on token-endpoint ID tokens by default | `enableNonRepudiationChecks()` | auth-flow "signed with an unknown key" |
| F2 | openid-client accepted an ID token with `iat` 1 h in the future | explicit `iat` window (−10 min / +5 min) | auth-flow "issued in the future" |
| F3 | `@prisma/adapter-pg` drops `timestamptz` offsets → hours of drift on a non-UTC server | `TimeZone=UTC` on every app connection | db-constraints "timestamps" |
| F4 | Phase 0 audit hash depended on session TimeZone/DateStyle and could fork under concurrency | canonical jsonb input; id/at assigned under the lock; isolation guard | audit-chain tests |
| F5 | Redis client without offline queue failed the first requests after start | queue during (re)connect + 2 s command timeout; fail-closed for mutations | guard-pipeline |
| F6 | Encoded slashes in `returnTo` survived as same-origin paths | rejected (`%2F`, `%5C`) | unit + auth-flow open-redirect |
| F7 | Plain-text production credentials in the project folder (`DATA.txt`) | git-ignored; gitleaks rule for MP tokens; rotation recommended | `.gitignore`, `.gitleaks.toml` |
| F8 | Phase 0 recorded the *test* Mercado Pago ids as production ids | boot check token ↔ collector id; docs corrected | env unit test |

## Trusted Types trial (report-only)

No reports on server-only pages. Pages with client components (`/conta`, `/conta/sessoes`, `/bem-vindo`) report one sink: `HTMLScriptElement src` from Next.js's chunk loader. Enforcement needs a Trusted Types policy for `/_next/static` scripts — Phase 5 item. Full list: `test-results/trusted-types-report-only.json`.

## Not verifiable in this workspace

- `prisma migrate deploy` / `migrate status` with the native schema engine (download host blocked) — CI `migrations` job, or locally (`docs/phase-1/README.md` §2).
- Real Google login (needs the OAuth client, Q27) — the flow is covered end-to-end against a mocked issuer.
- GitHub Actions themselves (no repository yet, Q26).
