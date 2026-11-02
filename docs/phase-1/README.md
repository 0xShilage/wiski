# Wiskiflix — Phase 1 (foundation & security core)

> Status: **built and tested** · 2026-10-02 · plan: [`../phase-0/10-phase-1-plan.md`](../phase-0/10-phase-1-plan.md) · results: [`test-report.md`](./test-report.md)

Phase 1 delivers the scaffold, the brand pipeline, Google sign-in with server-side sessions, the security middleware, the database with its reviewed constraints and audit log, and the base pages. Catalog, pricing and payments start in Phase 2.

## 1. What's in the box

| Area | Where | Notes |
|---|---|---|
| App | Next.js 16.3.8 (App Router, `src/`), React 19.3, TypeScript 5.9 strict (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Tailwind 4.3 | exact-pinned versions, `.nvmrc` = 22, `output: 'standalone'`, `poweredByHeader: false` |
| Env validation | `src/server/env.ts`, `src/instrumentation*.ts`, `.env.example` | Zod schema; the server **refuses to boot** on a missing/invalid value and never prints values |
| Brand pipeline | `scripts/brand-*.ts`, `svgo.config.mjs`, `public/brand/`, `src/components/brand/` | `npm run brand` regenerates everything from `ASSETS/` (originals never touched) |
| Logo | `scripts/logo.ts` → `public/brand/logo-wiski-{ink,lilac,lavender}.svg` | Black Rockie glyph outlines + kerning via opentype.js |
| Favicons | `scripts/icons.ts` → `src/app/favicon.ico`, `icon.png`, `apple-icon.png`, `public/brand/icon-*.png`, `opengraph-image.png` | `favicon.png` unchanged on an ink rounded tile (panel B) |
| Fonts | `scripts/fonts.ts` → `src/app/fonts/*.woff2`, `src/app/fonts.ts` | Latin + Latin-1 + punctuation subsets, 8–20 KB each |
| Database | `prisma/schema.prisma`, `prisma/migrations/`, `prisma.config.ts`, `prisma/sql/roles.sql` | Prisma 7.10 + `@prisma/adapter-pg`; reviewed SQL in `*_constraints` |
| Guard pipeline | `src/server/http/route.ts` + `src/server/security/*`, `ratelimit/*`, `rbac/*` | requestId → method → size/type → RL(IP) → session → RL(user) → RBAC → CSRF → step-up → Turnstile → Zod → handler → problem+json |
| CSP | `src/proxy.ts`, `src/server/security/csp.ts`, `src/app/api/csp-report/route.ts`, `src/components/Img.tsx` | per-request nonce, exactly the 05 §7 policy |
| Auth | `src/server/auth/*`, `src/app/api/auth/*`, `src/app/api/v1/me/*` | openid-client 6 (PKCE S256, state, nonce, `email_verified`), sealed `__Host-wf_oauth`, hashed sessions, step-up primitive |
| Audit | `src/server/audit/*`, `src/worker/jobs/audit-verify.ts` | allow-listed metadata, DB hash chain, verifier + nightly job stub |
| Pages (pt-BR) | `src/app/(site)/*`, `src/app/not-found.tsx`, `error.tsx` | home, `/entrar`, `/bem-vindo`, `/conta`, `/conta/sessoes`, `/u/[username]`, legal placeholders, 404/500 |
| nginx headers | `docker/nginx/snippets/security-headers.conf` | the real Phase 5 snippet, already exercised by the e2e header test |
| CI | `.github/workflows/ci.yml`, `codeql.yml`, `.github/dependabot.yml`, `.gitleaks.toml` | actions pinned by commit SHA |

### API endpoints in Phase 1

| Method · path | Access | Purpose |
|---|---|---|
| `GET /api/health` · `GET /api/ready` | public · internal | liveness · DB+Redis readiness (nginx denies `/api/ready` from outside) |
| `POST /api/csp-report` | public | CSP / Reporting API sink (8 KB, rate-limited, sampled logs) |
| `GET /api/auth/google/start` · `GET /api/auth/google/callback` | public | OIDC login (also step-up with `?stepUp=1`) |
| `POST /api/auth/logout` | user | revoke current session |
| `GET /api/v1/me` | user | profile, role, onboarding state, CSRF token |
| `POST /api/v1/me/onboarding` · `PATCH /api/v1/me/profile` | user | username + avatar once · avatar; username once per 30 days (moderators and streamer: 5 days, since Phase 4) |
| `GET`/`DELETE /api/v1/me/sessions` · `DELETE /api/v1/me/sessions/[id]` | user | list · sign out all other devices · revoke one (foreign id → 404) |
| `GET /api/v1/usernames/availability?u=` | user | `{available}` only |
| `GET /api/v1/admin/session` | moderator+ | admin-shell probe: role + step-up freshness (seed for Phase 4) |

`DELETE /api/v1/me/sessions`, `GET /api/v1/admin/session` and `GET /api/ready` are additions to 03 §5.

## 2. Running it

### Prerequisites

Node 22 LTS, Docker Desktop (for the dev Postgres + Redis), Git. On Windows, integration/e2e tests need `redis-server`, `nginx` and `openssl` on the PATH — easiest in WSL2 or CI; unit tests, lint and typecheck run anywhere.

### First run (Windows PowerShell, macOS or Linux — from the `Wiskiflix` folder)

```bash
npm ci                                             # installs the PINNED tools (Prisma 7.10, Next 16…) + prisma generate
npm run setup:dev                                  # creates .env.local with fresh random secrets (stays on your machine)
docker compose -f docker/compose.dev.yml up -d     # dev Postgres 17 + Redis (Docker Desktop)
npm run db:migrate                                 # prisma migrate deploy, as wf_migrator
npm run db:status                                  # expect: "Database schema is up to date!"
npm run db:drift                                   # expect: no output, exit code 0 (migrations == schema.prisma)
npm run dev                                        # http://localhost:3000
```

> **Always use the `npm run …` scripts (or `npx` *after* `npm ci`).** Without `node_modules`, `npx prisma …` downloads whatever npm currently tags as latest — at the moment a Prisma **8 release candidate** with a different config format, which fails with `CLI.CONFIG_SECTION_INVALID … 'orm' section is missing`. The project is pinned to Prisma 7.10.0.

Without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` the site runs and `/entrar` says login is unavailable. To test real login, create the OAuth client (10 §5 / Q27) and fill both values in `.env.local` yourself.

### Commands

| Command | What |
|---|---|
| `npm run setup:dev` | create `.env.local` for development (refuses to overwrite) |
| `npm run db:migrate` · `db:status` · `db:drift` | apply migrations · show status · fail if migrations ≠ schema |
| `npm run lint` · `typecheck` · `format:check` | static checks |
| `npm test` | unit tests (no services) |
| `npm run test:integration` | embedded Postgres 17 + local Redis; real migrations; app runs as `wf_app` |
| `npm run test:brand` | SVG pixel diffs, component and logo checks (Chromium) |
| `npm run build && npm run test:e2e` | production build behind nginx (TLS, real header snippet) at 360 px and 1280 px |
| `npm run check:bundle-secrets` | fails if a secret or token pattern reaches `.next/static` |
| `npm run brand` | regenerate brand assets, logo, icons, fonts from `ASSETS/` |

## 3. Security decisions made while building (all covered by tests)

1. **ID-token signatures are verified.** openid-client v6, following OIDC Core §3.1.3.7, skips the JWS check for ID tokens received from the token endpoint by default (it trusts TLS). 05 §5 requires the JWKS check, so `enableNonRepudiationChecks()` is on. A token signed with a foreign key is rejected (test).
2. **ID-token `iat` window.** Tokens issued > 5 min in the future or > 10 min in the past are rejected (openid-client accepted a future `iat`).
3. **Database sessions run in UTC.** `@prisma/adapter-pg` reads `timestamptz` by discarding the offset, so a Postgres server in another zone would shift every expiry and `authTime` by hours. Connections set `TimeZone=UTC`; a test runs against a server whose default zone is America/Sao_Paulo.
4. **Audit chain hardening** (reviewed SQL vs the Phase 0 draft): canonical `jsonb` hash input with a fixed UTC timestamp format; `id` and `at` assigned by the trigger under the advisory lock (chain order = id order, no backdating); TRUNCATE blocked; inserts refused outside READ COMMITTED; built-in `sha256()` (no pgcrypto). Note: ids advance by 2 per row (gaps are harmless).
5. **Partial unique indexes in `schema.prisma`** (`one_active_ruleset`, `one_current_legaldoc`) via Prisma 7's `partialIndexes` preview, so `prisma migrate dev` tracks them instead of proposing to drop them.
6. **Mercado Pago id/token mismatch check.** Boot fails if `MP_ACCESS_TOKEN` doesn't belong to `MP_COLLECTOR_ID` (the Phase 0 doc had recorded the *test* ids — see §5).
7. **Fail-closed rate limiting** for mutations when Redis is unreachable (503); reads fail open. Commands queue during (re)connect but time out after 2 s.
8. **Open-redirect defence** also rejects encoded slashes (`%2F`, `%5C`) and `/api/*` targets.
9. **Usernames:** besides the reserved list, names containing `wiski`, `admin`, `moderad…`, `suporte/support`, `oficial/official`, `staff` are refused (anti-impersonation).
10. **Session lifetimes:** viewers idle 14 days / absolute 60 days; moderators and streamer 8 h / 24 h (05 §5). A promoted user's older session is capped by the stricter limit.

## 4. Deviations from the plan, and why

1. **Migrations in this workspace.** `binaries.prisma.sh` is blocked by the workspace's egress policy, so the Prisma CLI can't download its schema engine here. The init migration was produced by **Prisma's official schema engine** in its WASM build from npm (`@prisma/schema-engine-wasm@7.10.0-4.0edf323…`, the exact engine commit of prisma 7.10.0); `prisma validate`/`generate` ran with the bundled WASM. Migrations were applied to Postgres 17.10 and tested. CI's `migrations` job runs the real `prisma migrate deploy` plus `prisma migrate diff --exit-code` (drift check).
2. **`/brand/*` cache:** 7 days + stale-while-revalidate instead of `immutable`, because brand file names aren't content-hashed. `/_next/static` stays immutable.
3. **Development CSP** follows Next.js's documented dev policy (`'unsafe-eval'`, inline dev styles, HMR websocket). Production is exactly 05 §7. `upgrade-insecure-requests` is emitted only for an https origin.
4. **Trusted Types stays report-only.** Next.js's chunk loader sets `script.src` on pages with client components (reports on `/conta`, `/conta/sessoes`, `/bem-vindo`). Enforcing needs a TT policy for `/_next/static` — revisit in Phase 5.
5. **TMDB attribution** is shown as text (EN + pt-BR). The official TMDB logo file is added with the TMDB integration in Phase 2.
6. **Display fonts** lack `º ª …` in the original files (checked with opentype.js), not only `º ª`; these fall back to Poppins.
7. **ESLint 9.39** (v10 is current, but `eslint-plugin-react` doesn't declare v10 support yet) and **TypeScript 5.9** (typescript-eslint supports < 6.1). Dependabot will propose upgrades.
8. **npm audit:** the Prisma CLI pulls vulnerable `deepmerge-ts`/`mysql2` (dev-only); `overrides` pin fixed versions → 0 vulnerabilities.
9. **Header test** runs through a real nginx (1.24) with the real snippet over TLS instead of a simulation.

## 5. Open items / needed from you

| # | Item | Needed by |
|---|---|---|
| S1 | ✅ Production Access Token renewed and `DATA.txt` moved out (optional: renew the unused Client Secret too) | done |
| **S2** | Production `MP_COLLECTOR_ID`/`MP_APPLICATION_ID` are the ids of the **production** app/account, not `3733347216`/`5754049850745190` (those are the test credentials) | Phase 2 |
| Q27 | Google OAuth client (Web application) — redirect URIs in 10 §5 | real-login test |
| — | Cloudflare Turnstile widget for `wiski.fun` + `localhost` | Phase 2 forms |
| Q26 | GitHub account/private repo → CI runs, Dependabot, CodeQL | Phase 5 (useful now) |
| — | Run `npm ci`, then `npm run db:migrate`, `npm run db:status` and `npm run db:drift` once locally (§2) | now |
| — | Copy the `.github/` folder from `wiskiflix-phase1.zip` into the project (the file bridge may not write into `.github`) | before the first push |
