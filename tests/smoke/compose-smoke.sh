#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The production stack end to end, in CI (Phase 5): the images CI just built, the production
# compose file (+ docker/compose.ci.yml: no Cloudflare in front), secrets as files, the REAL
# Prisma migrate image, the deploy order, then:
#   · scripts/ops/check-site.mjs — Observatory-equivalent A+, headers once, redirects, TLS policy
#   · containers run as their own users on read-only filesystems
#   · scripts/ops/backup.sh + restore.sh --drill in compose mode, on Postgres 17 — the restore
#     drill in the production topology
#
#   WF_IMAGE=wiski:ci WF_MIGRATE_IMAGE=wiski-migrate:ci tests/smoke/compose-smoke.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${WF_IMAGE:?}" "${WF_MIGRATE_IMAGE:?}"
WF_ETC="$(mktemp -d)"
export WF_ETC WF_IMAGE WF_MIGRATE_IMAGE WF_ROOT="$ROOT"
export WF_COMPOSE_EXTRA="-f $ROOT/docker/compose.ci.yml"
C=(docker compose -f "$ROOT/docker/compose.prod.yml" -f "$ROOT/docker/compose.ci.yml")
step() { printf '\n── %s\n' "$*"; }
cleanup() {
  local status=$?
  "${C[@]}" --profile ops logs --no-color > "$ROOT/test-results/compose-smoke.log" 2>&1 || true
  if [ "$status" -ne 0 ]; then
    # the artifact is not always reachable: put what failed in the job log too (throw-away values)
    echo "── smoke test failed: containers and their last log lines"
    "${C[@]}" ps -a || true
    "${C[@]}" logs --no-color --tail 60 nginx web worker || true
  fi
  "${C[@]}" --profile ops down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WF_ETC"
}
mkdir -p "$ROOT/test-results"
trap cleanup EXIT

step "server configuration in $WF_ETC (what server-setup.sh creates)"
mkdir -p "$WF_ETC/secrets" "$WF_ETC/tls" "$WF_ETC/nginx"
for s in pg_superuser pg_migrator pg_app redis; do openssl rand -hex 32 > "$WF_ETC/secrets/$s"; done
chmod 644 "$WF_ETC/secrets/"*   # CI: the runner user owns them; containers read them as their own uid
key() { openssl rand 32 | basenc --base64url | tr -d '='; }
cat > "$WF_ETC/app.env" <<ENV
APP_ORIGIN=https://localhost
DATABASE_URL=postgresql://wf_app:$(cat "$WF_ETC/secrets/pg_app")@postgres:5432/wiskiflix
REDIS_URL=redis://:$(cat "$WF_ETC/secrets/redis")@redis:6379
CSRF_SECRET=$(key)
COOKIE_SEAL_KEY=$(key)
IP_HASH_SECRET=$(key)
TOTP_ENCRYPTION_KEY=$(key)
CLIENT_IP_HEADER=x-real-ip
GOOGLE_CLIENT_ID=ci-smoke.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=ci-smoke-placeholder-secret
TURNSTILE_SITE_KEY=0x4AAAAAAAci-smoke-site
TURNSTILE_SECRET_KEY=0x4AAAAAAAci-smoke-secret
LOG_LEVEL=info
ENV
echo "MIGRATE_DATABASE_URL=postgresql://wf_migrator:$(cat "$WF_ETC/secrets/pg_migrator")@postgres:5432/wiskiflix" > "$WF_ETC/migrate.env"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 -subj /CN=localhost \
  -addext subjectAltName=DNS:localhost,DNS:www.localhost \
  -keyout "$WF_ETC/tls/origin.key" -out "$WF_ETC/tls/origin.pem" 2>/dev/null
chmod 644 "$WF_ETC/tls/origin.key"
cp "$ROOT/docker/nginx/snippets/cloudflare-real-ip.conf" "$WF_ETC/nginx/"

step "deploy order: database and cache → migrations (Prisma CLI image) → app"
"${C[@]}" up -d --wait postgres redis
"${C[@]}" --profile ops run --rm migrate
"${C[@]}" up -d --wait web worker nginx
"${C[@]}" ps

step "site check through nginx"
node "$ROOT/scripts/ops/check-site.mjs" https://localhost --insecure --http-port 80

step "containers: own users, read-only filesystems"
[ "$("${C[@]}" exec -T web id -u)" = 10001 ] || { echo "web is not uid 10001"; exit 1; }
[ "$("${C[@]}" exec -T worker id -u)" = 10001 ] || { echo "worker is not uid 10001"; exit 1; }
[ "$("${C[@]}" exec -T redis id -u)" = 999 ] || { echo "redis is not uid 999"; exit 1; }
if "${C[@]}" exec -T web sh -c 'echo x > /app/server.js' 2>/dev/null; then echo "web code is writable"; exit 1; fi
if "${C[@]}" exec -T web sh -c 'touch /etc/x' 2>/dev/null; then echo "web root fs is writable"; exit 1; fi
"${C[@]}" exec -T web sh -c 'touch /var/lib/wiski/media/.w && rm /var/lib/wiski/media/.w'
"${C[@]}" exec -T worker node --conditions=react-server dist/worker.mjs --verify-audit
echo "users and filesystems OK"

step "backup.sh + restore.sh --drill (compose mode, Postgres 17)"
age-keygen -o "$WF_ETC/identity.txt" 2>/dev/null
age-keygen -y "$WF_ETC/identity.txt" > "$WF_ETC/backup-recipient.txt"
export WF_BACKUP_DIR="$WF_ETC/backups" WF_RCLONE_REMOTE=none:
mkdir -p "$WF_BACKUP_DIR"
bash "$ROOT/scripts/ops/backup.sh"
B="$(find "$WF_BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*Z' | head -1)"
bash "$ROOT/scripts/ops/restore.sh" --drill "$B" "$WF_ETC/identity.txt"

printf '\nCOMPOSE SMOKE: ALL CHECKS PASSED\n'
