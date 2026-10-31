# 08 — Hosting, domain and e-mail

> Status: **rev 5** · 2026-10-31 · Phase 5 built the stack described here: [../phase-5/deploy-guide.md](../phase-5/deploy-guide.md) (step by step), [../phase-5/security-checklist.md](../phase-5/security-checklist.md) · rev 4 · 2026-10-02 · domain **wiski.fun** on Cloudflare (done) · Hostinger dropped (no Brazil server offered to you) · candidate: **RedHosting** VPS, 2 vCPU · 2 GB RAM · 20 GB NVMe · 500 Mbps · expected traffic ≈ 1,000 visits/month.

## 1. Is 2 vCPU / 2 GB / 20 GB enough?

**Yes, for this traffic — with four conditions.** About 1,000 visits a month is a few dozen a day, with short peaks during lives. CPU and network are not the constraint; memory and disk are, so the stack runs with explicit limits.

### Memory budget (2 GB RAM + 2 GB swap file)

| Container | Limit | Typical | Tuning |
|---|---|---|---|
| OS + Docker | — | ~350 MB | journald capped at 200 MB |
| nginx | 64 MB | ~15 MB | |
| web (Next.js standalone) | 448 MB | 200–300 MB | `--max-old-space-size=320` |
| worker (same image) | 256 MB | 120–180 MB | `--max-old-space-size=192`, concurrency 2 |
| Postgres 17 | 384 MB | ~150–200 MB | `shared_buffers=128MB`, `max_connections=20`, `work_mem=4MB` |
| Redis | 128 MB | ~30 MB | `maxmemory 64mb`, `noeviction` (required for job queues); every cache key has a TTL |
| **Total** | **≈ 1.3 GB** | **≈ 0.9–1.1 GB** | 2 GB swap only as a safety net |

If memory is ever tight, the worker could run inside the web process (`WORKER_MODE=inline`), saving about 150 MB. Not built in Phase 5 (phase-5 D1): the limits above fit.

### Disk budget (20 GB)

Ubuntu ≈ 4 GB; Docker images (current + previous release) ≈ 2–3 GB; Postgres data well under 1 GB for years at this size; container logs capped at 10 MB × 3 per container; 7 days of local backup copies ≈ small; off-site copies to Cloudflare R2. Comfortable, provided old images are pruned after each deploy (scripted).

### The four conditions

1. **KVM virtualisation with full root access.** Docker needs a real kernel. OpenVZ, or LXC without nesting, won't run this stack. Ask RedHosting.
2. **Ubuntu 24.04 LTS** (plain, no cPanel). Their site advertises cPanel and Minecraft hosting; cPanel must **not** be on this server.
3. **Never build on the server.** `next build` needs more than 2 GB of RAM. Images are built in CI (GitHub Actions, private repository), pushed to a private registry, and the server only pulls and runs them. Needs a GitHub account — Q26.
4. **Know where the data center is.** São Paulo is ideal (pages can't be edge-cached with the strict CSP, so latency to the server is felt). Elsewhere in Brazil is fine; outside Brazil works but every page view is slower.

### Ask RedHosting before paying

- Virtualisation type (must be **KVM**) and whether Docker is allowed
- Data-center city
- Dedicated IPv4 (IPv6 is a bonus)
- Snapshots/backups included? (Off-site backups are planned anyway.)
- Provider firewall or security groups? If not, the server's own firewall (`ufw` / `nftables`) does the job.
- Is outgoing SMTP blocked? (Doesn't matter — e-mail goes out through Resend's HTTPS API.)
- Monthly billing, and reverse DNS (optional)

Since I couldn't find RedHosting's VPS specs publicly (their pages need JavaScript; they advertise Minecraft, VPS and cPanel hosting), these answers have to come from them.

**Upgrade path:** if traffic or features grow, 4 GB RAM is the next step. No code changes, just higher container limits.

## 2. Domain — `wiski.fun` (on Cloudflare ✓)

- Canonical origin `https://wiski.fun`; `www` → 301 to the apex.
- Registrar lock + 2FA on the registrar account.
- HSTS preload submission only after every subdomain you'll use serves HTTPS.
- `.fun` is a newer gTLD; strict SPF/DKIM/DMARC on a sending subdomain keeps receipts out of spam.

## 3. E-mail

| Need | Pick | Cost |
|---|---|---|
| Receiving (`contato@`, `privacidade@`, `seguranca@`) | Cloudflare Email Routing → your existing inbox | free |
| Sending (receipts with order link, notices, alerts) | Resend from `mail.wiski.fun` | free up to 3,000/month, 100/day |

DNS: SPF and DKIM for `mail.wiski.fun` (from Resend). DMARC on the apex starting at `p=none`, then `quarantine` and `reject` after 2–4 clean weeks. MX records for Email Routing.

## 4. Cloudflare settings (Phase 5)

- Proxied A/AAAA for `wiski.fun` and `www`.
- SSL **Full (strict)** with an Origin CA certificate, plus Authenticated Origin Pulls.
- Minimum TLS 1.2, TLS 1.3 on, Always Use HTTPS.
- Cloudflare HSTS **off** (nginx owns it). Managed Transforms security headers **off**. Rocket Loader and Email Obfuscation **off**.
- WAF skip only for `/api/webhooks/mercadopago`.
- Rate-limit rules on checkout, contact and auth.
- Server firewall: 443 from Cloudflare ranges only; SSH from your IP only.

## 5. Backups

Nightly encrypted Postgres dumps **and media** (age, to a public key whose private half stays off the server) to Cloudflare R2 (off-site), 7 local copies, and provider snapshots if RedHosting offers them. Restore drilled quarterly with `scripts/ops/restore.sh --drill` (phase-5 deploy guide §6).

Sources: [RedHosting](https://redhosting.com.br/) · [Hostinger server locations](https://www.hostinger.com/support/1583267-where-are-hostinger-servers-located/) · [Resend pricing guide](https://flexprice.io/blog/detailed-resend-pricing-guide) · [Cloudflare Email Routing](https://www.cloudflare.com/en-in/developer-platform/products/email-routing/)
