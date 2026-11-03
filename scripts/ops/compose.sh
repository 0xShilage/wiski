#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# `docker compose` for the release that is running now (2026-11-02). The production compose file
# needs the image digests (WF_IMAGE, WF_MIGRATE_IMAGE) for every command, so this reads them from
# releases/current.env (written by deploy.sh) first:
#
#   sudo /opt/wiskiflix/scripts/ops/compose.sh ps
#   sudo /opt/wiskiflix/scripts/ops/compose.sh logs -f --since 10m web worker nginx
#   sudo /opt/wiskiflix/scripts/ops/compose.sh exec worker \
#     node --conditions=react-server dist/worker.mjs --publish-legal
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd /opt/wiskiflix
[ -s releases/current.env ] || { echo "no release deployed yet: run scripts/ops/deploy.sh first"; exit 1; }
# shellcheck disable=SC1090
source <(grep -E '^(WF_IMAGE|WF_MIGRATE_IMAGE|WF_COMMIT)=' releases/current.env)
export WF_IMAGE WF_MIGRATE_IMAGE
exec docker compose -f docker/compose.prod.yml "$@"
