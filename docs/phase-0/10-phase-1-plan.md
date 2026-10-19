# 10 — Phase 1 plan (hand-off)

> Status: **ready to start** · 2026-10-02 · Written so any Claude session attached to the Wiskiflix project can pick Phase 1 up cold. Read 01–09 first; this file lists only the order of work, the checks and the deliverables.

## 0. Preconditions (check first, in this order)

1. `curl -sI https://registry.npmjs.org/zod` → **200**. If it is `403` with `x-deny-reason: host_not_allowed`, package downloads are still blocked for the session. Stop and tell the user; don't route around the policy.
2. The user's `Documents\Wiskiflix` folder is connected (`ASSETS/`, `docs/phase-0/`).
3. Node 22 LTS available. `redis-server` is present in the workspace image; Postgres for tests comes from the `embedded-postgres` npm package (Docker Hub is not reachable).

## 1. Scope of Phase 1

Scaffold · theme from assets (logo, favicon set, SVG pipeline, fonts) · Google auth + server-side sessions · security middleware (CSP nonce, headers, CSRF, rate limiting, Turnstile hook, guard pipeline) · Prisma schema + reviewed SQL migrations · audit log · base pages. **Not** in Phase 1: catalog, pricing, payments (Phase 2), reviews (3), admin, overlays, media kit (4), Docker/nginx (5).

## 2. Work order

| # | Step | Key files | Done when |
|---|---|---|---|
| 1 | Scaffold Next.js 16 (App Router, `src/`), TS strict (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint (`react/no-danger` error, no `style` prop in server components, `regexp` plugin), Prettier, Vitest, Playwright, exact-pinned versions, `.nvmrc`, `poweredByHeader: false`, `output: 'standalone'` | `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs` | `npm run lint && npm run typecheck && npm test` green on an empty app |
| 2 | Env validation at boot (Zod) + `.env.example` (no real secrets; `MP_COLLECTOR_ID`/`MP_APPLICATION_ID` placeholders; `TMDB_LICENSED=false`) | `src/server/env.ts`, `.env.example` | app refuses to boot with a missing/invalid var (unit test) |
| 3 | Brand pipeline: copy `ASSETS` → `public/brand` with ASCII slugs (06 §1 map); SVGO **lossless only** (`inlineStyles`, `convertStyleToAttrs`, `prefixIds`; path/number/colour plugins off); SVGR components | `scripts/brand-assets.ts`, `svgo.config.mjs`, `src/components/brand/*` | Playwright pixel-diff: every original vs processed SVG at 2× → **0 differing pixels** |
| 4 | Logo "Wiski": outline SVGs generated from `BlackRockie.ttf` glyphs with the font's kerning (`opentype.js`) in ink / lilac / lavender | `scripts/logo.ts`, `public/brand/logo-wiski-*.svg` | snapshot test; renders identically to live text in the font |
| 5 | Favicon set from `PNG - ICONS/favicon.png` placed unchanged on an ink rounded tile (`sharp`): `favicon.ico` 16/32/48, `icon.png`, `apple-icon.png` 180, `icon-192/512.png`, manifest | `scripts/icons.ts`, `src/app/*` icons | visual check vs `favicon-preview.png` panel B |
| 6 | Fonts: woff2 subsets (Latin + Latin-1 + punctuation) for Poppins 400/500/600/700, Escargoth, Black Rockie (`subset-font`); `next/font/local`; theme from `theme.proposal.css` | `src/app/fonts.ts`, `src/app/globals.css` | no layout shift on the header; pt-BR glyph test page |
| 7 | Prisma 7: schema from `schema.draft.prisma`, `prisma.config.ts`, `@prisma/adapter-pg`, first migration + **reviewed SQL** from 02 §4 (CHECKs, partial uniques, audit triggers, grants) | `prisma/schema.prisma`, `prisma/migrations/*` | `prisma validate`; migrate against embedded Postgres; constraint tests (bad rating, double ACTIVE rule set, UPDATE on AuditLog → error) |
| 8 | Guard pipeline: requestId, method allow-list, body/content-type limits, rate limit (Redis sliding window, IP + user), session load, CSRF (Sec-Fetch-Site + Origin + HMAC token), Turnstile verifier (Cloudflare test keys in dev), RBAC/ownership helpers, Zod `.strict()`, RFC 9457 errors, audit hook | `src/server/http/route.ts`, `src/server/security/*`, `src/server/ratelimit/*` | unit tests per guard; integration test of the full chain |
| 9 | `proxy.ts`: per-request nonce, CSP exactly as 05 §7, `Reporting-Endpoints`, report-only Trusted Types trial; `/api/csp-report` endpoint; `next/image` wrapper without inline styles | `src/proxy.ts`, `src/server/security/csp.ts`, `src/app/api/csp-report/route.ts`, `src/components/Img.tsx` | Playwright: nonce differs per request, **0 CSP violations** on every page, no `style=` attributes in SSR HTML |
| 10 | Auth: `openid-client` v6 Google (PKCE S256, state, nonce, `email_verified`), sealed `__Host-wf_oauth` cookie (AES-256-GCM), sessions (hashed token, idle/absolute expiry, rotation), logout, `/conta/sessoes` revoke, step-up primitive (`max_age`), username rules + reserved list + 30-day holds, avatar presets (20 keys) | `src/server/auth/*`, `src/app/api/auth/*`, `src/app/(site)/entrar`, `bem-vindo`, `conta` | integration tests with a mocked Google issuer/JWKS: bad state, bad nonce, replayed code, unverified e-mail, open-redirect attempts, session fixation |
| 11 | Audit log service + nightly hash-chain verifier (job stub, worker comes in Phase 2) | `src/server/audit/*` | tamper test detects an altered row |
| 12 | Base pages (pt-BR, mobile-first): layout with logo header + footer (TMDB attribution block, legal links), home placeholder, `/u/[username]`, legal placeholders, 404/500 | `src/app/(site)/*` | Playwright at 360 px and 1280 px; axe accessibility check clean |
| 13 | CI skeleton: lint, typecheck, unit, integration, e2e, `npm audit --audit-level=high`, gitleaks, client-bundle secret scan; Dependabot config | `.github/workflows/ci.yml`, `.github/dependabot.yml` | runs once the repo is on GitHub (Q26) |

## 3. Phase 1 exit criteria

`prisma validate` + migrations apply · CSP e2e with 0 violations · each security header present **exactly once** (nginx part is simulated in Phase 1, real in Phase 5) · cookies `__Host-`, HttpOnly, Secure, SameSite as specified · authz matrix scaffold green · 0-pixel-diff asset test · `npm audit` clean · test report in `docs/phase-1/test-report.md`.

## 4. Delivery

Code is built and tested in Claude's workspace, then written into the user's `Documents\Wiskiflix` folder: `package.json` at the folder root, next to `ASSETS/` and `docs/`; `node_modules`, `.next` and secrets never copied. The file-commit tool takes ≤ 50 files per call, so delivery runs in batches. A zip of the same tree is also sent in the chat.

## 5. Inputs from the user (none block the start)

| Needed by | Item |
|---|---|
| End of Phase 1 (real login test) | Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web application). Authorized redirect URIs: `http://localhost:3000/api/auth/google/callback` and `https://wiski.fun/api/auth/google/callback`. OAuth consent screen: app name "Wiski", support e-mail, scopes `openid email profile` only. Share the **Client ID**; put the **Client secret** in `Wiskiflix/.env.local` yourself. |
| End of Phase 1 | Cloudflare Turnstile widget for `wiski.fun` + `localhost` (dev uses Cloudflare's public test keys until then). |
| Phase 2 | Mercado Pago **test** Access Token in `Wiskiflix/.env.local` (test values only). |
