# Wiskiflix — Phase 5 (production: image, stack, deploy, backups, security)

> Status: **built and tested; deployment pending** · 2026-10-31 · baseline [`../phase-0/`](../phase-0/README.md) (01 §2, 05 §7 + §10, 08) · results [`test-report.md`](./test-report.md).
> **Do this:** [`deploy-guide.md`](./deploy-guide.md) · **check this:** [`security-checklist.md`](./security-checklist.md).

Phase 5 turns the repository into something a 2 GB VPS can run safely:

- **One image** built in CI, with two targets: the app (web and worker) and a Prisma migrator.
- **A hardened Compose stack**: nginx, web, worker, Postgres 17 and Redis.
- **nginx in front, reachable only by Cloudflare**: a firewall on Cloudflare's ranges plus Authenticated Origin Pulls.
- **Scripts** for server setup, deploys, rollbacks, encrypted off-site backups and restores (including a restore drill).
- **A site check** that scores the headers the way Mozilla Observatory does.
- **Tests and CI jobs** that keep all of the above true.

## 1. What's in the box

| Area | Where | Notes |
|---|---|---|
| Image | `Dockerfile`, `.dockerignore` | `runtime`: Next.js standalone server + `dist/worker.mjs` on `node:24-bookworm-slim`, uid 10001, code owned by root, npm/npx removed. `migrate`: Prisma CLI + migrations only, uid 10002. Built in CI, never on the server (08 §1 condition 3). |
| Worker bundle | `scripts/build-worker.mjs` → `dist/worker.mjs` | esbuild; everything bundled except the packages Next.js keeps external (`pino`, `ioredis`, `pg`) and the Prisma runtime, which the standalone output ships; `--check` proves they are there. New `--verify-audit` mode (one audit-chain check, exit 0/1) for restore drills. |
| Stack | `docker/compose.prod.yml` | memory limits from 08 §1 (64 + 448 + 256 + 384 + 128 MB); read-only filesystems, `cap_drop: ALL`, `no-new-privileges`, PID limits, 3 × 10 MB logs; only nginx publishes ports; Postgres + Redis on an `internal` network; Postgres, Redis and app passwords as Docker secrets (files); Redis with a password, `noeviction`, `FLUSHALL`/`CONFIG` disabled; Postgres with data checksums and SCRAM; `migrate` as a one-off profile |
| nginx | `docker/nginx/nginx.conf`, `templates/wiskiflix.conf.template`, `snippets/{tls,origin-pull,cloudflare-real-ip,security-headers,media,upload}.conf` | http → https, www → apex, unknown names get no certificate (`ssl_reject_handshake`), TLS 1.2/1.3 AEAD only, Authenticated Origin Pulls, real IP from `CF-Connecting-IP` only from Cloudflare, SSE locations unbuffered, coarse per-IP request/connection limits, gzip only for static assets (BREACH), JSON access log without query strings or IPs. **The browser tests now run this exact template** (`tests/e2e/support/stack.ts`). |
| Postgres init | `docker/postgres/init-roles.sh` | the least-privilege roles of `prisma/sql/roles.sql`, passwords from the secret files |
| Ops scripts | `scripts/ops/` | `server-setup.sh` (one-time Ubuntu 24.04 preparation), `firewall.sh` (ufw + DOCKER-USER), `cloudflare-ips.sh`, `deploy.sh`, `rollback.sh`, `backup.sh`, `restore.sh` (`--drill` / `--replace`), `check-site.mjs` |
| systemd | `docker/systemd/` | nightly backup (04:40 São Paulo), weekly Cloudflare ranges, firewall after every Docker start |
| CI | `.github/workflows/ci.yml`, `.github/dependabot.yml` | new jobs: `restore-drill`, `image` (build both targets → production-stack smoke test → on `main`: push to GHCR + `release.env` artifact); shellcheck; `npm audit --omit=dev` must be clean; Dependabot also for base and infrastructure images |
| Tests | `tests/unit/{nginx-config,compose-prod}.test.ts`, `tests/smoke/{worker-smoke.ts,restore-drill.sh,compose-smoke.sh,migrate.ts}`, `tests/e2e/headers.spec.ts` | see the test report |
| Docs | `docs/phase-5/{deploy-guide,security-checklist,test-report}.md` | |

## 2. How a request reaches the app

```
visitor ──TLS 1.2/1.3──▶ Cloudflare (WAF, rate rules, edge TLS, cache for /_next/static + /media)
           ──TLS + Cloudflare client certificate (Authenticated Origin Pulls)──▶ server :443
             firewall: 80/443 from Cloudflare ranges only (DOCKER-USER), 22 from the admin IP only
             nginx: real IP = CF-Connecting-IP (trusted from Cloudflare only), security headers,
                    /media from disk, /api/ready hidden, SSE unbuffered
               ──▶ web (Next.js, uid 10001, read-only)  ──▶ Postgres 17 / Redis   (internal network)
                   worker (same image)                  ──▶ Mercado Pago API (outbound)
```

## 3. Decisions and deviations

| # | Plan said | Built | Why |
|---|---|---|---|
| D1 | `WORKER_MODE=inline` as an option (08 §1) | not built | the stack fits the memory budget with a separate worker (≈ 1.3 GB of limits for 2 GB + swap); one process per job keeps restarts and limits simple. Revisit only if memory runs short. |
| D2 | `scripts/check-headers.sh` (05 §7) | `scripts/ops/check-site.mjs` | Node instead of curl: it can count each header exactly once, score like Observatory and probe TLS versions/ciphers without extra tools |
| D3 | Cloudflare Origin CA certificate | + Authenticated Origin Pulls | the firewall already limits 443 to Cloudflare; AOP also stops other Cloudflare customers' traffic aimed at the origin IP |
| D4 | Origin HTTP/2 | HTTP/1.1 at the origin | Cloudflare speaks HTTP/2 and HTTP/3 to visitors and HTTP/1.1 to origins by default; one less moving part (and works with the nginx the tests use) |
| D5 | Image vulnerability scanner in CI | not added | Dependabot keeps base images current, the runtime image has no npm and no dev dependencies, and `npm audit --omit=dev` gates every build. A scanner action can be added once one is chosen and pinned. |
| D6 | Observatory / SSL Labs A+ (exit criteria) | measured with `check-site.mjs` on the browser-test stack and the CI production stack | the real scanners need the public site; they are the first post-deploy step on the checklist (L11, L12) |
| D7 | Restore drill | run locally (Postgres 16, the workspace's tools) **and** in CI against the production stack (Postgres 17, the real compose file) | this workspace cannot pull Docker Hub images; CI can. The first drill on the server is on the go-live checklist (L14). |

## 4. Open items

| # | Item | Owner |
|---|---|---|
| Q21b | RedHosting: KVM? Docker allowed? data-center city? dedicated IPv4? | you |
| Q26 | GitHub repository with Actions (the `image` job publishes to GHCR) — the repo exists; make sure Actions and Packages are enabled | you |
| P5-a | Cloudflare R2 bucket + token, backup key pair (deploy guide §0, §3) | you |
| P5-b | First deploy, real Observatory and SSL Labs scans, first restore drill on the server | you (with the guide) |
| Q13, E1 | legal texts + Pix recipient name; e-mail provider | you / lawyer |
