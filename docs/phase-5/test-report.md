# Phase 5 — test report

> Run: 2026-10-31, Claude's Linux workspace · Node 24.19.0 · Postgres 17.10 (embedded) and 16.15 (Ubuntu, restore drill) · Redis 7.0.15 · nginx 1.24 · Docker CLI/Compose 5.6 (daemon without registry access) · Chromium (Playwright 1.64.1, build 1243)
> Tree: branch `phase-5-production`, delivered to `Documents\Wiskiflix` with this report. Build notes: [`README.md`](./README.md).

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint / typecheck / formatting | `npm run lint` · `npm run typecheck` · `npm run format:check` | ✅ |
| Shell scripts | `shellcheck -S warning scripts/ops/*.sh tests/smoke/*.sh docker/**/*.sh` | ✅ 0 warnings |
| Unit | `npm test` | ✅ **293 / 293** (+8: production nginx config, compose hardening) |
| Integration | `npm run test:integration` | ✅ **877 / 877** |
| E2E (production build behind the **production nginx template**, 360 + 1280 px) | `npm run build && npm run test:e2e` | ✅ **267 passed**, 0 failed, 0 flaky (35 skipped by design: tests that run on one viewport only (touch on mobile, admin tools and once-only checks on desktop)) |
| Worker bundle | `npm run build:worker && npm run smoke:worker` | ✅ started from the standalone directory exactly as the image runs it, ran its jobs against Postgres 17 + Redis, exited 0 on SIGTERM |
| **Restore drill** (exit criterion) | `tests/smoke/restore-drill.sh` | ✅ `RESTORE DRILL: ALL CHECKS PASSED` — see below |
| Site check (Observatory scoring) | `node scripts/ops/check-site.mjs https://localhost:8443 --insecure --http-port 8081` | ✅ **A+ (110)**, 20 / 20 checks |
| Dependencies (exit criterion) | `npm audit --omit=dev` | ✅ **0 vulnerabilities** in what ships. Full tree: 17 moderate, all `minimatch` < 11 in the ESLint toolchain (dev only; accepted, checklist L13). `fast-uri` (via Prisma's dev tooling) fixed to 3.1.9. |
| Bundle secret scan / build | `npm run check:bundle-secrets` · `npm run build` | ✅ |

## New suites

| File | Covers |
|---|---|
| `tests/unit/nginx-config.test.ts` (3) | the production `nginx.conf` + site template rendered with production values + every real snippet pass `nginx -t`. **Runs nginx for real**: a client without the (test) origin-pull CA's certificate → 400 "No required SSL certificate"; with one → proxied; `CF-Connecting-IP`, `X-Forwarded-For` and `X-Real-IP` sent from outside Cloudflare's ranges are ignored (the app sees the real peer, no forwarded chain); `/api/ready` → 404. Guard rails: AOP + TLS policy on every TLS server, TLS 1.2/1.3 only, no CBC/RC4/3DES, real IP never trusted from 0.0.0.0/0, gzip only for static assets. |
| `tests/unit/compose-prod.test.ts` (5) | the compose file as Docker Compose resolves it: exactly nginx/web/worker/postgres/redis/migrate; every service read-only, `cap_drop: ALL`, `no-new-privileges`, capped json logs; the app gets no capability, nginx exactly four; only nginx publishes 80/443; Postgres and Redis only on the internal network; memory limits 64/448/256/384/128 MB (≤ 1.3 GB, 08 §1), PID limits, restart policy; passwords only as secret files; images by digest |
| `tests/e2e/headers.spec.ts` (+2, the stack now runs the production template) | `www` → apex and plain HTTP → HTTPS keep path and query; unknown server names get no certificate; TLS 1.1 refused; `/api/ready` 404 |
| `tests/smoke/worker-smoke.ts` | the bundled worker (above) |
| `tests/smoke/restore-drill.sh` | see below |
| `tests/smoke/compose-smoke.sh` (CI `image` job) | the CI-built images in the production compose file (+ `compose.ci.yml`: no Cloudflare in front): deploy order with the **real Prisma migrate image**, `check-site.mjs` A+ through nginx, web/worker uid 10001 and Redis uid 999, code and root filesystem not writable, media writable, audit chain verified by the worker, then `backup.sh` + `restore.sh --drill` in compose mode on Postgres 17 |

## Restore drill

`tests/smoke/restore-drill.sh` runs the real `scripts/ops/backup.sh` and `restore.sh` against a throw-away cluster. The cluster holds every migration and the development seed: 32 tables with data, 88 media files, 115 audit rows.

1. **Backup.**
   - Custom-format dump, checked with `pg_restore --list`, and the media tar.
   - Both encrypted with age to a public key; the encrypted dump contains no plain SQL.
   - Manifest and SHA-256 sums.
2. **`restore.sh --drill`.**
   - Checksums verified, then decrypted with the private key.
   - Restored into a new database: 32 tables, 12 migrations, 115 audit rows, all matching the manifest.
   - The app role can still read, and still cannot delete from the audit log.
   - The **audit hash chain verified by the worker's own `--verify-audit`**.
   - The media archive has 88 files, matching the manifest. The drill database is dropped.
3. **One flipped byte in the encrypted dump** → refused at the checksum step.
4. **The wrong age key** → refused at decryption.

The same scripts run in CI on the production stack (Postgres 17, `compose-smoke.sh`); that run is the first one on GitHub. The drill on the server itself is checklist item L14.

## Exit criteria (00 README, phase plan)

| Criterion | Evidence | Status |
|---|---|---|
| Observatory A+ | `check-site.mjs` scores with Observatory's modifiers: **110** (CSP without unsafe sources, +5 Referrer-Policy, +5 frame-ancestors). It checks the browser-test stack here and the production stack in CI. | ✅ measured; real scan after the first deploy (L11) |
| SSL Labs A+ | Origin, checked here: TLS 1.3 and 1.2 offered; AEAD and forward secrecy only; TLS 1.0/1.1 and CBC suites refused by the server. HSTS is 2 years with preload. The edge is Cloudflare with min TLS 1.2 (guide §1). | ✅ origin; real scan of the edge after the first deploy (L12) |
| `npm audit` clean | `npm audit --omit=dev`: 0. CI gates it. | ✅ |
| Restore drill done | above | ✅ local + CI; server drill on the checklist (L14) |

## What could not run here

This workspace's network blocks Docker Hub, so the image itself was **not built here**. Its parts were checked separately:

- the standalone server, under the browser tests;
- the worker bundle, by the smoke test;
- the compose file, resolved by Docker Compose;
- the nginx config, run for real.

The CI `image` job builds the image, starts the full stack from it and runs the smoke test above. Watch its first run on GitHub.

## Findings

| # | Finding | Action |
|---|---|---|
| F1 | A per-IP flood guard of 20 r/s on every location answered nginx's HTML 429 to static chunks during a fast page load (the browser tests caught it as a "MIME type text/html" script refusal). It would also have hit viewers sharing a carrier-grade-NAT address during a live. | Limits now cover dynamic requests only, at 30 r/s with a 150 burst and 100 concurrent per IP. Static files and media are not limited; Cloudflare caches them. |
| F2 | The worker can't run from the standalone output with every package external: Next.js bundles `zod` and `@prisma/adapter-pg` into its server chunks, so they are not in `node_modules`. | Everything is bundled except `pino`/`ioredis`/`pg`/Prisma runtime, and `build-worker.mjs --check` proves those are present. |
| F3 | The restore script first read the database password from the app's environment file and passed it on a `docker run -e` command line, where it shows up in the process list. | The URL is rewritten inside the container. |
| F4 | Redis's image only drops root for a bare `redis-server` command, and the password-from-secret wrapper (`sh -c`) would have kept it running as root. | `user: 999:1000`, no capabilities. |
| F5 | Docker publishes ports past ufw. | Web ports are filtered in `DOCKER-USER`, re-applied after every Docker start. |
| F6 | The live Cloudflare IP list would have dirtied the server's checkout, which `deploy.sh` refuses. | It lives in `/etc/wiskiflix/nginx` and is mounted over the committed baseline. |
