#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy one release on the server (Phase 5). The images were built and scanned by CI; this only
# pulls them by digest, backs up, migrates and swaps the containers.
#
#   sudo /opt/wiskiflix/scripts/ops/deploy.sh <release.env>
#
# release.env is the CI artifact ("release" job): WF_IMAGE=ghcr.io/…/wiski@sha256:…,
# WF_MIGRATE_IMAGE=…@sha256:…, WF_COMMIT=<git sha>. The repository at /opt/wiskiflix must be at
# that commit (the compose file and nginx config come from it): the script checks.
#
# Order: pull → backup → migrate (forward-only, expand/contract — 08 §6) → up --wait → record the
# release → prune images older than 10 days. Any failure stops before the old containers go.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd /opt/wiskiflix
release="${1:?usage: deploy.sh <release.env>}"
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }

log() { printf '%s deploy: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# shellcheck disable=SC1090
source <(grep -E '^(WF_IMAGE|WF_MIGRATE_IMAGE|WF_COMMIT)=' "$release")
[[ "${WF_IMAGE:-}" =~ @sha256:[0-9a-f]{64}$ ]] || die "WF_IMAGE must be pinned by digest"
[[ "${WF_MIGRATE_IMAGE:-}" =~ @sha256:[0-9a-f]{64}$ ]] || die "WF_MIGRATE_IMAGE must be pinned by digest"
head="$(git rev-parse HEAD)"
[ "$head" = "${WF_COMMIT:-}" ] || die "repository is at $head, release is ${WF_COMMIT:-?} (git checkout $WF_COMMIT)"
git diff --quiet || die "local changes in /opt/wiskiflix — the server runs the repository as-is"
export WF_IMAGE WF_MIGRATE_IMAGE
COMPOSE=(docker compose -f docker/compose.prod.yml)

log "pulling $WF_IMAGE"
"${COMPOSE[@]}" pull --quiet web worker nginx postgres redis
docker pull --quiet "$WF_MIGRATE_IMAGE" >/dev/null

if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx postgres; then
  log "backup before migrating"
  scripts/ops/backup.sh
fi

log "database and cache"
"${COMPOSE[@]}" up -d --wait postgres redis
log "migrations"
"${COMPOSE[@]}" --profile ops run --rm migrate

log "starting the release"
"${COMPOSE[@]}" up -d --wait --remove-orphans web worker nginx

mkdir -p releases
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
cp "$release" "releases/$stamp.env"
[ -e releases/current.env ] && cp releases/current.env releases/previous.env
cp "$release" releases/current.env

log "pruning images older than 10 days"
docker image prune -af --filter "until=240h" >/dev/null

log "done: ${WF_IMAGE##*@} ($WF_COMMIT)"
log "next: node scripts/ops/check-site.mjs https://\${WF_SERVER_NAME:-wiski.fun} --origin-ip <this server's IP>"
