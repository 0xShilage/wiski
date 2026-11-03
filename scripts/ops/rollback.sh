#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Roll the app back to the previous release (Phase 5). Code only: migrations are forward-only and
# written expand/contract (a release never needs a schema the previous release can't run on), so
# the database stays as it is. To undo DATA, restore a backup (restore.sh --replace).
#
#   sudo /opt/wiskiflix/scripts/ops/rollback.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd /opt/wiskiflix
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
[ -s releases/previous.env ] || { echo "no previous release recorded"; exit 1; }

# shellcheck disable=SC1090
source <(grep -E '^(WF_IMAGE|WF_MIGRATE_IMAGE|WF_COMMIT)=' releases/previous.env)
export WF_IMAGE WF_MIGRATE_IMAGE
echo "rolling back to ${WF_IMAGE##*@} (${WF_COMMIT:-?})"
git checkout --quiet "$WF_COMMIT"
docker compose -f docker/compose.prod.yml up -d --wait --remove-orphans web worker nginx
cp releases/current.env "releases/rolled-back-$(date -u +%Y%m%dT%H%M%SZ).env"
cp releases/previous.env releases/current.env
echo "done — run the site check (scripts/ops/check-site.mjs) and look at the logs"
