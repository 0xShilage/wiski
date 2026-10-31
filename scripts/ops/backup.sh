#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nightly backup (08 §5): Postgres (custom-format dump) + processed media, each checked, then
# encrypted with age to a PUBLIC key — the private key never lives on the server — and copied
# off-site to Cloudflare R2 when rclone has a "wiskiflix-r2" remote. 7 local copies are kept.
#
#   sudo /opt/wiskiflix/scripts/ops/backup.sh                    (systemd timer: wiskiflix-backup)
#
# Settings (environment, defaults for the server layout):
#   WF_BACKUP_DIR        /var/backups/wiskiflix
#   WF_BACKUP_RECIPIENT  /etc/wiskiflix/backup-recipient.txt   (age public key, "age1…")
#   WF_BACKUP_KEEP       7
#   WF_RCLONE_REMOTE     wiskiflix-r2:wiskiflix-backups         (skipped if rclone has no such remote)
#   WF_PG_MODE           compose | local        local: pg_dump/psql on this host, for the drill
#   WF_PG_URL            (local mode) superuser URL of the cluster
#   WF_MEDIA_DIR         (local mode) media directory
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

WF_ROOT="${WF_ROOT:-/opt/wiskiflix}"
WF_ETC="${WF_ETC:-/etc/wiskiflix}"
export WF_ETC
BACKUP_DIR="${WF_BACKUP_DIR:-/var/backups/wiskiflix}"
RECIPIENT_FILE="${WF_BACKUP_RECIPIENT:-$WF_ETC/backup-recipient.txt}"
KEEP="${WF_BACKUP_KEEP:-7}"
REMOTE="${WF_RCLONE_REMOTE:-wiskiflix-r2:wiskiflix-backups}"
MODE="${WF_PG_MODE:-compose}"
# WF_COMPOSE_EXTRA: more -f files (CI adds its own override)
# shellcheck disable=SC2206
COMPOSE=(docker compose -f "$WF_ROOT/docker/compose.prod.yml" ${WF_COMPOSE_EXTRA:-})

log() { printf '%s backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

command -v age >/dev/null || die "age is not installed (apt install age)"
[ -s "$RECIPIENT_FILE" ] || die "no age recipient in $RECIPIENT_FILE"
grep -q '^age1' "$RECIPIENT_FILE" || die "$RECIPIENT_FILE must hold an age public key (age1…)"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/$stamp"
work="$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

pg_dump_cmd() {
  if [ "$MODE" = local ]; then
    pg_dump --format=custom --compress=6 --no-password -d "${WF_PG_URL:?}"
  else
    "${COMPOSE[@]}" exec -T postgres pg_dump -U postgres -d wiskiflix --format=custom --compress=6
  fi
}
psql_cmd() {
  if [ "$MODE" = local ]; then
    psql -X -At -v ON_ERROR_STOP=1 -d "${WF_PG_URL:?}" -c "$1"
  else
    "${COMPOSE[@]}" exec -T postgres psql -X -At -v ON_ERROR_STOP=1 -U postgres -d wiskiflix -c "$1"
  fi
}
media_tar() {
  if [ "$MODE" = local ]; then
    tar -C "${WF_MEDIA_DIR:?}" -cf - .
  else
    "${COMPOSE[@]}" exec -T web tar -C /var/lib/wiski/media -cf - .
  fi
}

log "dumping database"
pg_dump_cmd > "$work/db.dump"
# the dump must be readable by pg_restore before it is trusted
pg_restore --list "$work/db.dump" > "$work/db.toc" || die "pg_restore cannot read the dump"
tables="$(grep -c ' TABLE DATA ' "$work/db.toc" || true)"
[ "$tables" -gt 10 ] || die "dump has only $tables tables of data"

log "archiving media"
media_tar > "$work/media.tar"
tar -tf "$work/media.tar" > /dev/null || die "media archive is unreadable"
files="$(tar -tf "$work/media.tar" | grep -c -v '/$' || true)"

migrations="$(psql_cmd 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
audit_rows="$(psql_cmd 'SELECT count(*) FROM "AuditLog"')"

log "encrypting"
age -R "$RECIPIENT_FILE" -o "$out/db.dump.age" "$work/db.dump"
age -R "$RECIPIENT_FILE" -o "$out/media.tar.age" "$work/media.tar"
cat > "$out/manifest.json" <<JSON
{"created":"$stamp","tables":$tables,"mediaFiles":$files,"migrations":$migrations,"auditRows":$audit_rows,"dbBytes":$(stat -c %s "$work/db.dump"),"mediaBytes":$(stat -c %s "$work/media.tar")}
JSON
( cd "$out" && sha256sum db.dump.age media.tar.age manifest.json > SHA256SUMS )

if command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -qx "${REMOTE%%:*}:"; then
  log "copying off-site to $REMOTE/$stamp"
  rclone copy --immutable --no-traverse "$out" "$REMOTE/$stamp"
  rclone check --one-way "$out" "$REMOTE/$stamp" || die "off-site copy does not match"
else
  log "WARNING: no rclone remote ${REMOTE%%:*} — this backup is only on this server"
fi

# keep the newest $KEEP local copies
mapfile -t old < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*Z' | sort -r | tail -n +"$((KEEP + 1))")
for d in "${old[@]}"; do rm -rf -- "$d"; done

log "done: $out ($tables tables, $files media files, $migrations migrations, $audit_rows audit rows)"
