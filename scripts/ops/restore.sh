#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Restore a backup made by backup.sh (08 §5).
#
#   restore.sh --drill <backup dir> <age identity file>
#       Restores into a NEW database (wiskiflix_restore_<time>) next to the live one, checks it
#       (tables, migrations, audit rows against the manifest, the audit hash chain with the app's
#       own verifier, media archive) and drops it again. Nothing live is touched. Run quarterly.
#
#   restore.sh --replace <backup dir> <age identity file>
#       Disaster recovery: stops web + worker, replaces the live database and media with the
#       backup, starts them again. Asks for confirmation.
#
# The identity file is the age PRIVATE key. Keep it off the server (password manager); copy it
# in only for the restore and delete it afterwards. Settings as in backup.sh (WF_PG_MODE …), plus
#   WF_AUDIT_VERIFY   command that verifies the audit chain of $DATABASE_URL (default: the image)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

mode="${1:-}"; src="${2:-}"; identity="${3:-}"
[ "$mode" = --drill ] || [ "$mode" = --replace ] || { echo "usage: restore.sh --drill|--replace <backup dir> <identity>"; exit 2; }
[ -d "$src" ] && [ -s "$identity" ] || { echo "backup dir or identity file missing"; exit 2; }
MODE="${WF_PG_MODE:-compose}"
WF_ROOT="${WF_ROOT:-/opt/wiskiflix}"
WF_ETC="${WF_ETC:-/etc/wiskiflix}"
export WF_ETC
# WF_COMPOSE_EXTRA: more -f files (CI adds its own override)
# shellcheck disable=SC2206
COMPOSE=(docker compose -f "$WF_ROOT/docker/compose.prod.yml" ${WF_COMPOSE_EXTRA:-})

log() { printf '%s restore: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

log "checking SHA256SUMS"
( cd "$src" && sha256sum --quiet -c SHA256SUMS ) || die "checksums do not match — backup damaged"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
age -d -i "$identity" -o "$work/db.dump" "$src/db.dump.age" || die "cannot decrypt (wrong identity?)"
age -d -i "$identity" -o "$work/media.tar" "$src/media.tar.age" || die "cannot decrypt media"
pg_restore --list "$work/db.dump" > /dev/null || die "dump unreadable"
tar -tf "$work/media.tar" > /dev/null || die "media archive unreadable"

manifest() { sed -n "s/.*\"$1\":\"\{0,1\}\([0-9A-Z]*\).*/\1/p" "$src/manifest.json"; }

psql_db() { # <database> <sql>
  if [ "$MODE" = local ]; then
    psql -X -At -v ON_ERROR_STOP=1 -d "${WF_PG_URL%/*}/$1" -c "$2"
  else
    "${COMPOSE[@]}" exec -T postgres psql -X -At -v ON_ERROR_STOP=1 -U postgres -d "$1" -c "$2"
  fi
}
restore_into() { # <database>
  if [ "$MODE" = local ]; then
    pg_restore --exit-on-error --no-password -d "${WF_PG_URL%/*}/$1" "$work/db.dump"
  else
    "${COMPOSE[@]}" exec -T postgres pg_restore --exit-on-error -U postgres -d "$1" < "$work/db.dump"
  fi
}
audit_verify() { # <database>
  if [ -n "${WF_AUDIT_VERIFY:-}" ]; then
    DATABASE_URL="${WF_APP_URL_BASE:?}/$1" sh -c "$WF_AUDIT_VERIFY"
  else
    # the production image's own verifier, pointed at the restored database (the URL is rewritten
    # inside the container, so the password never appears on a command line here)
    "${COMPOSE[@]}" run --rm --no-deps -e WF_VERIFY_DB="$1" --entrypoint sh worker -c \
      'DATABASE_URL="${DATABASE_URL%/wiskiflix}/$WF_VERIFY_DB" exec node --conditions=react-server dist/worker.mjs --verify-audit'
  fi
}

check() { # <database>
  local tables migrations audit
  tables="$(psql_db "$1" "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
  migrations="$(psql_db "$1" 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
  audit="$(psql_db "$1" 'SELECT count(*) FROM "AuditLog"')"
  log "restored: $tables tables, $migrations migrations, $audit audit rows"
  [ "$migrations" = "$(manifest migrations)" ] || die "migrations: $migrations, backup had $(manifest migrations)"
  [ "$audit" -ge "$(manifest auditRows)" ] || die "audit rows: $audit < $(manifest auditRows)"
  # the app role must still be able to read (grants survived) but not touch the audit log
  psql_db "$1" "SET ROLE wf_app; SELECT count(*) FROM \"User\"" > /dev/null || die "wf_app cannot read"
  if psql_db "$1" "SET ROLE wf_app; DELETE FROM \"AuditLog\" WHERE false" > /dev/null 2>&1; then
    die "wf_app can DELETE from the audit log after restore"
  fi
  audit_verify "$1" || die "audit hash chain does not verify"
  log "audit hash chain verified"
}

if [ "$mode" = --drill ]; then
  db="wiskiflix_restore_$(date -u +%Y%m%d%H%M%S)"
  log "drill: restoring into $db"
  psql_db postgres "CREATE DATABASE $db OWNER wf_migrator"
  trap 'psql_db postgres "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
  restore_into "$db"
  check "$db"
  files="$(tar -tf "$work/media.tar" | grep -c -v '/$' || true)"
  [ "$files" = "$(manifest mediaFiles)" ] || die "media files: $files, backup had $(manifest mediaFiles)"
  log "media archive: $files files"
  log "DRILL PASSED ($(manifest created))"
  exit 0
fi

# ── --replace ──
[ "$MODE" = compose ] || die "--replace is for the server only"
read -r -p "Replace the LIVE database and media with $(manifest created)? Type RESTORE: " answer
[ "$answer" = RESTORE ] || die "cancelled"
log "stopping web, worker"
"${COMPOSE[@]}" stop web worker nginx
psql_db postgres "DROP DATABASE IF EXISTS wiskiflix_previous WITH (FORCE)"
psql_db postgres "ALTER DATABASE wiskiflix RENAME TO wiskiflix_previous"
psql_db postgres "CREATE DATABASE wiskiflix OWNER wf_migrator"
psql_db postgres "REVOKE CONNECT ON DATABASE wiskiflix FROM PUBLIC; GRANT CONNECT ON DATABASE wiskiflix TO wf_app"
restore_into wiskiflix
check wiskiflix
log "restoring media"
"${COMPOSE[@]}" run --rm --no-deps --user 10001 -v "$work:/restore:ro" --entrypoint sh web \
  -c 'find /var/lib/wiski/media -mindepth 1 -delete && tar -C /var/lib/wiski/media -xf /restore/media.tar'
"${COMPOSE[@]}" up -d --wait
log "done. The old database is kept as wiskiflix_previous until you drop it."
