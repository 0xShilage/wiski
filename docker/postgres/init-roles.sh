#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Production: runs ONCE, on the first start with an empty data volume (postgres image
# docker-entrypoint-initdb.d). Same roles as prisma/sql/roles.sql; the passwords come from Docker
# secrets (files under /run/secrets, created by scripts/ops/server-setup.sh), never from
# environment variables or this repository. psql's :'var' quoting keeps them out of the SQL text.
# ─────────────────────────────────────────────────────────────────────────────
set -eu
migrator_pw="$(cat /run/secrets/pg_migrator)"
app_pw="$(cat /run/secrets/pg_app)"
psql -v ON_ERROR_STOP=1 -U postgres \
  -v migrator_pw="$migrator_pw" -v app_pw="$app_pw" -f - <<'SQL'
CREATE ROLE wf_migrator LOGIN PASSWORD :'migrator_pw' NOSUPERUSER NOCREATEROLE NOCREATEDB;
CREATE ROLE wf_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 16;
CREATE DATABASE wiskiflix OWNER wf_migrator;
REVOKE CONNECT ON DATABASE wiskiflix FROM PUBLIC;
GRANT CONNECT ON DATABASE wiskiflix TO wf_app;
\connect wiskiflix
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO wf_migrator;
GRANT USAGE ON SCHEMA public TO wf_app;
SQL
