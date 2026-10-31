#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Restore drill on a workstation / CI (Phase 5 exit criterion): the REAL scripts/ops/backup.sh and
# restore.sh in "local" mode against a throw-away Postgres cluster that holds every migration and
# the development seed (catalogue, orders, reviews, sessions, audit log, media files).
#
#   1. backup.sh            → encrypted dump + media archive, manifest, SHA256SUMS
#   2. restore.sh --drill   → new database, checks, audit hash chain verified by the app's worker
#   3. a damaged backup     → refused at the checksum step
#   4. the wrong age key    → refused at decryption
#
# Needs: Postgres server + client binaries (PG_BIN), redis-server, age, a built worker bundle
# (npm run build:worker). Usage: tests/smoke/restore-drill.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT=55433
REDIS_PORT=63811
T="$(mktemp -d)"
chmod 755 "$T"
export PATH="$PG_BIN:$PATH"
as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

cleanup() {
  as_pg pg_ctl -D "$T/pg" -m fast stop >/dev/null 2>&1 || true
  [ -n "${REDIS_PID:-}" ] && kill "$REDIS_PID" 2>/dev/null || true
  rm -rf "$T"
}
trap cleanup EXIT

step() { printf '\n── %s\n' "$*"; }

step "cluster ($(postgres --version))"
mkdir "$T/pg" && { [ "$(id -u)" != 0 ] || chown postgres "$T/pg"; }
as_pg initdb -D "$T/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
as_pg pg_ctl -D "$T/pg" -o "-p $PORT -k $T/pg -c timezone=UTC" -l "$T/pg/server.log" -w start >/dev/null
SU="postgresql://postgres@127.0.0.1:$PORT"
psql -X -q -v ON_ERROR_STOP=1 -d "$SU/postgres" \
  -v migrator_pw="'migrator'" -v app_pw="'app'" -f "$ROOT/prisma/sql/roles.sql"
redis-server --port "$REDIS_PORT" --save '' --appendonly no --daemonize no >/dev/null &
REDIS_PID=$!

key() { node -e "process.stdout.write(Buffer.alloc(32, $1).toString('base64url'))"; }
export NODE_ENV=development
export APP_ORIGIN=http://localhost:3000
export DATABASE_URL="postgresql://wf_app:app@127.0.0.1:$PORT/wiskiflix"
export MIGRATE_DATABASE_URL="postgresql://wf_migrator:migrator@127.0.0.1:$PORT/wiskiflix"
export REDIS_URL="redis://127.0.0.1:$REDIS_PORT"
CSRF_SECRET="$(key 1)"; COOKIE_SEAL_KEY="$(key 2)"; IP_HASH_SECRET="$(key 3)"; TOTP_ENCRYPTION_KEY="$(key 4)"
export CSRF_SECRET COOKIE_SEAL_KEY IP_HASH_SECRET TOTP_ENCRYPTION_KEY
export MEDIA_DIR="$T/media" LOG_LEVEL=warn
mkdir "$MEDIA_DIR"

step "migrations + development seed"
(cd "$ROOT" && npx tsx tests/smoke/migrate.ts)
(cd "$ROOT" && npx tsx --conditions=react-server scripts/seed-dev.ts) | tail -1

step "backup.sh (local mode)"
age-keygen -o "$T/identity.txt" 2>/dev/null
age-keygen -y "$T/identity.txt" > "$T/recipient.txt"
export WF_PG_MODE=local WF_PG_URL="$SU/wiskiflix" WF_MEDIA_DIR="$MEDIA_DIR"
export WF_BACKUP_DIR="$T/backups" WF_BACKUP_RECIPIENT="$T/recipient.txt" WF_RCLONE_REMOTE=none:
mkdir "$WF_BACKUP_DIR"
bash "$ROOT/scripts/ops/backup.sh"
B="$(find "$WF_BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*Z' | head -1)"
cat "$B/manifest.json"; echo
if grep -aq 'INSERT INTO\|CREATE TABLE' "$B/db.dump.age"; then echo "backup is not encrypted"; exit 1; fi

step "restore.sh --drill (local mode)"
export WF_APP_URL_BASE="postgresql://wf_app:app@127.0.0.1:$PORT"
export WF_AUDIT_VERIFY="cd '$ROOT' && node --conditions=react-server dist/worker.mjs --verify-audit"
bash "$ROOT/scripts/ops/restore.sh" --drill "$B" "$T/identity.txt"

step "a damaged backup is refused"
cp -r "$B" "$T/damaged"
printf 'x' | dd of="$T/damaged/db.dump.age" bs=1 seek=200 conv=notrunc status=none
if bash "$ROOT/scripts/ops/restore.sh" --drill "$T/damaged" "$T/identity.txt"; then
  echo "damaged backup was accepted"; exit 1
fi

step "the wrong key is refused"
age-keygen -o "$T/other.txt" 2>/dev/null
if bash "$ROOT/scripts/ops/restore.sh" --drill "$B" "$T/other.txt"; then
  echo "wrong key was accepted"; exit 1
fi

printf '\nRESTORE DRILL: ALL CHECKS PASSED\n'
