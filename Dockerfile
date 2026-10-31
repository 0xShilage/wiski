# ─────────────────────────────────────────────────────────────────────────────
# Wiskiflix image (Phase 5). Built in CI only (`next build` needs more RAM than the 2 GB server —
# 08 §1 condition 3), pushed to GHCR, pulled by the server.
#
#   target runtime  web (node server.js) and worker (node … dist/worker.mjs) — the same image
#   target migrate  one-off `prisma migrate deploy` with the DDL role (wf_migrator)
#
# Base images are pinned by version here and by digest in CI (Dependabot "docker" updates them).
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_IMAGE=node:24.19.0-bookworm-slim

# ── dependencies (dev included: the build needs them) ──
FROM ${NODE_IMAGE} AS deps
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1 CI=true
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ── build: Prisma client, Next.js standalone server, worker bundle ──
FROM deps AS build
COPY . .
RUN npx prisma generate \
 && npm run build \
 && npm run build:worker \
 && node scripts/build-worker.mjs --check .next/standalone \
 && npm run check:bundle-secrets

# ── runtime: only the standalone output; no npm, no source, no dev dependencies ──
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    MEDIA_DIR=/var/lib/wiski/media
# npm/npx/corepack are not needed at runtime: less attack surface, fewer CVEs to track
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && groupadd --system --gid 10001 wiski \
 && useradd --system --uid 10001 --gid wiski --no-create-home --shell /usr/sbin/nologin wiski \
 && mkdir -p /var/lib/wiski/media /app \
 && chown wiski:wiski /var/lib/wiski/media
WORKDIR /app
COPY --from=build --chown=root:root /src/.next/standalone ./
COPY --from=build --chown=root:root /src/.next/static ./.next/static
COPY --from=build --chown=root:root /src/public ./public
COPY --from=build --chown=root:root /src/dist/worker.mjs ./dist/worker.mjs
# the code is owned by root and read-only for the app user
USER wiski
EXPOSE 3000
# Liveness for `docker run`; compose adds the readiness check (/api/ready).
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--max-old-space-size=320", "server.js"]

# ── migrate: Prisma CLI + migrations, nothing else of the app ──
FROM ${NODE_IMAGE} AS migrate
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /migrate
COPY --from=deps /src/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts package.json ./
RUN groupadd --system --gid 10002 migrate \
 && useradd --system --uid 10002 --gid migrate --no-create-home --shell /usr/sbin/nologin migrate
USER migrate
# MIGRATE_DATABASE_URL comes from the environment (wf_migrator)
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]
