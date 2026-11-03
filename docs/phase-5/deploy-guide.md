# Wiskiflix — deploy guide (Phase 5)

> From an empty VPS to `https://wiski.fun` behind Cloudflare. Written to be followed in order, once. Day-to-day releases are §5; backups and restores §6; what to do when something breaks §7.
> Builds on [`../phase-0/08-hosting.md`](../phase-0/08-hosting.md) (sizing, Cloudflare, e-mail) and [`security-checklist.md`](./security-checklist.md).

## 0. What you need before starting

| Item | Where | Notes |
|---|---|---|
| A **KVM** VPS with **Ubuntu 24.04 LTS**, 2 vCPU / 2 GB / 20 GB, a dedicated IPv4 | RedHosting (Q21b: confirm KVM, Docker allowed, data-center city) | no cPanel on it |
| Your SSH public key on the server | the provider's panel or `ssh-copy-id` | password login is switched off by the setup |
| The domain on Cloudflare | done (`wiski.fun`) | |
| The GitHub repository with Actions on | Q26 | the `image` job builds and publishes the images |
| A Cloudflare R2 bucket `wiskiflix-backups` + an API token limited to it | Cloudflare › R2 | off-site backups; set a 30-day lifecycle rule |
| `age` on **your** computer | `winget install FiloSottile.age` (Windows) | makes the backup key pair; the private half never goes to the server |
| Production credentials | Google OAuth client, Turnstile site, Mercado Pago production | the same ones as `.env.local`, production values |

## 1. Cloudflare (dashboard, before the server takes traffic)

1. **DNS**: `A wiski.fun → <server IPv4>` and `CNAME www → wiski.fun`, both **Proxied** (orange cloud). AAAA too if the VPS has IPv6.
2. **SSL/TLS › Overview**: **Full (strict)**.
3. **SSL/TLS › Origin Server › Create certificate**: RSA 2048 or ECC, hostnames `wiski.fun, *.wiski.fun`, 15 years. Keep the window open: the certificate and the key go to the server in §3.
4. **SSL/TLS › Origin Server › Authenticated Origin Pulls**: **On** (zone level). nginx refuses any TLS client without Cloudflare's certificate from then on, so do this before the first deploy.
5. **SSL/TLS › Edge Certificates**: Minimum TLS **1.2**, TLS 1.3 **on**, Always Use HTTPS **on**, Automatic HTTPS Rewrites **on**. **HSTS: off here** — nginx sends it (one owner per header).
6. **Rules › Settings › Managed Transforms**: "Add security headers" **off**. **Speed › Optimization**: Rocket Loader **off**, Email Obfuscation **off** (both rewrite pages and break the CSP).
7. **Security › WAF**: managed rules on; one skip rule for `/api/webhooks/mercadopago` (Mercado Pago's servers must reach it; the app checks the HMAC). Rate-limit rules (free plan allows one): `/api/v1/sponsorships*`, `/api/v1/campaigns/*`, `/api/v1/contact`, `/api/auth/*`, 20 requests / 10 s per IP → block 1 min.
8. **Caching › Configuration**: browser cache TTL "Respect existing headers". Pages are `private, no-store` and are never cached; `/_next/static/` and `/media/` are immutable and cache well.

## 2. Server preparation (once)

```bash
ssh root@<server IP>        # or your sudo user
curl -fsSLO https://raw.githubusercontent.com/0xShilage/wiski/<commit>/scripts/ops/server-setup.sh
less server-setup.sh         # read it
sudo WF_ADMIN_IP=<your public IP> WF_REPO=git@github.com:0xShilage/wiski.git bash server-setup.sh
```

`WF_REPO` needs read access: add a **deploy key** (read-only) to the repository and put its private half in `/root/.ssh/` first, or use an HTTPS URL with a fine-grained read-only token.

The script installs Docker, swap, log limits, unattended upgrades, SSH keys only, and the firewall:

- SSH is reachable from `WF_ADMIN_IP` only.
- Ports 80 and 443 are reachable from Cloudflare only.

It generates every internal secret into `/etc/wiskiflix` (0600, never printed) and clones the repository to `/opt/wiskiflix`. It also installs two timers: the nightly backup and the weekly refresh of Cloudflare's IP ranges.

If your home IP changes, edit `/etc/wiskiflix/admin-ips.txt` from the provider's web console and run `sudo /opt/wiskiflix/scripts/ops/firewall.sh`.

## 3. Secrets on the server (by hand, once)

| File | Content |
|---|---|
| `/etc/wiskiflix/tls/origin.pem` | the Cloudflare **Origin certificate** (§1.3) |
| `/etc/wiskiflix/tls/origin.key` | its **private key** (`chmod 600`) |
| `/etc/wiskiflix/app.env` | replace every `CHANGE_ME`: Google client id + secret, Turnstile site + secret, Mercado Pago production ids, token and webhook secret. Leave out the four `MP_*` lines until checkout opens (the site then shows checkout as closed). |
| `/etc/wiskiflix/backup-recipient.txt` | your age **public** key: on your computer run `age-keygen -o wiskiflix-backup-key.txt`, keep that file in your password manager, and paste the `age1…` line it prints here |
| rclone remote | `sudo rclone config` → new remote **`wiskiflix-r2`**, type `s3`, provider `Cloudflare`, the R2 token and account endpoint |
| GHCR login | `echo <read-only token> \| sudo docker login ghcr.io -u <github user> --password-stdin` (a classic token with `read:packages` only) |

Everything else (`DATABASE_URL`, `REDIS_URL`, `CSRF_SECRET`, `COOKIE_SEAL_KEY`, `IP_HASH_SECRET`, `TOTP_ENCRYPTION_KEY`, the database and Redis passwords) was generated by the setup script. **Never copy `.env.local` from your computer to the server**: development and production keys must differ.

## 4. First deploy

1. Push to `main`. When CI is green, the `image` job has:
   - published both images to GHCR;
   - attached a **`release`** artifact (`release.env`, with both image digests and the commit).
2. Copy `release.env` to the server and deploy that commit:
   ```bash
   cd /opt/wiskiflix && sudo git fetch && sudo git checkout <WF_COMMIT from release.env>
   sudo scripts/ops/deploy.sh /root/release.env
   ```
   The script:
   - checks that the images are pinned by digest and that the checkout is clean at that commit;
   - pulls the images and takes a backup (from the second deploy on);
   - starts Postgres and Redis, runs the migrations with the `migrate` image, then starts web, worker and nginx and waits until they are healthy;
   - records the release.
3. Check from your computer:
   ```bash
   node scripts/ops/check-site.mjs https://wiski.fun --origin-ip <server IP>
   ```
   Every line must read PASS. `--origin-ip` also proves that the server ignores anyone who is not Cloudflare.
4. Run the real scans (exit criteria):
   - <https://developer.mozilla.org/en-US/observatory> → **A+**;
   - <https://www.ssllabs.com/ssltest/> on `wiski.fun` → **A+** (this grades Cloudflare's edge; HSTS comes from nginx).
5. Make yourself the streamer: log in once with Google, then `sudo scripts/ops/compose.sh exec postgres psql -U postgres -d wiskiflix`, then `UPDATE "User" SET role = 'STREAMER' WHERE email = '…';`. After that, set up the authenticator in **Perfil › Segurança**. (`compose.sh` = `docker compose` with the running release's image digests, which the production compose file needs for every command.)
6. **Open checkout** (Q13): register the legal text as the current version — `sudo scripts/ops/compose.sh exec worker node --conditions=react-server dist/worker.mjs --publish-legal`. Idempotent; a changed text needs a new `LEGAL_UPDATED` in `src/content/legal/privacy.ts` and a release first.
7. **First restore drill on the server** (§6). Do it now, before launch, not when you need it.

## 5. Releases

```bash
cd /opt/wiskiflix && sudo git fetch && sudo git checkout <commit>
sudo scripts/ops/deploy.sh /root/release.env        # the new release.env from CI
node scripts/ops/check-site.mjs https://wiski.fun   # from your computer
```

- **Rollback** (code only): `sudo scripts/ops/rollback.sh` puts the previous release back.
- **Migrations are forward-only and expand/contract.** A release adds columns/tables first and stops using old ones; it removes them only in a later release. So the previous release always runs on the current schema.
- **Logs**: `sudo scripts/ops/compose.sh logs -f --since 10m web worker nginx`.
- **Disk**: images older than 10 days are pruned by each deploy.

## 6. Backups and restores

- **Every night at 04:40** (São Paulo) the backup timer runs `scripts/ops/backup.sh`:
  - a custom-format Postgres dump, checked with `pg_restore --list`;
  - a tar of the processed media;
  - both encrypted with age to your public key, with a manifest and SHA-256 sums;
  - copied to R2 and verified there; 7 copies are kept on the server.
  - Check it with `sudo systemctl status wiskiflix-backup` and `ls /var/backups/wiskiflix`.
- **Restore drill (quarterly)** — touches nothing live:
  ```bash
  scp wiskiflix-backup-key.txt root@<server>:/root/       # the PRIVATE key, only for the drill
  sudo /opt/wiskiflix/scripts/ops/restore.sh --drill /var/backups/wiskiflix/<newest> /root/wiskiflix-backup-key.txt
  sudo shred -u /root/wiskiflix-backup-key.txt
  ```
  It:
  - checks the sums and decrypts the backup;
  - restores it into a new database next to the live one;
  - checks the migrations, the audit-log row count and the permissions (the app role can read but can't touch the audit log);
  - verifies the audit hash chain with the app's own verifier, checks the media archive, then drops the drill database.
  - It ends with `DRILL PASSED`. Write the date in the security checklist.
- **Disaster recovery**: `restore.sh --replace <backup> <key>`.
  - It stops the app, keeps the current database as `wiskiflix_previous`, restores the backup and the media, and starts everything again.
  - From R2: `rclone copy wiskiflix-r2:wiskiflix-backups/<stamp> /var/backups/wiskiflix/<stamp>` first.
- **New server from scratch**: §2 → §3 → §4 steps 1–2 → `restore.sh --replace` with the newest R2 backup.

## 7. When something breaks

| Symptom | Look at |
|---|---|
| Cloudflare 52x | `docker compose ps`. Check that nginx is up and that the origin certificate files exist. Cloudflare 526 means the origin certificate is wrong or SSL mode isn't Full (strict). |
| Every request answers 400 "No required SSL certificate" | Authenticated Origin Pulls is off in Cloudflare (§1.4) while nginx requires it |
| Web container restarting | `docker compose logs web`. "Invalid environment" lists exactly which variable is wrong in `app.env`. |
| Payments not confirming | `docker compose logs worker`, then the Mercado Pago webhook panel (`docs/phase-0/09-mercadopago-setup.md`) |
| Disk full | `docker system df`, `journalctl --disk-usage`, `/var/backups/wiskiflix` |
| Locked out of SSH | provider's web console → fix `/etc/wiskiflix/admin-ips.txt` → `scripts/ops/firewall.sh` |
