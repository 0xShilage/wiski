#!/bin/sh
# Creates the least-privilege roles + database for local development (see prisma/sql/roles.sql).
set -eu
psql -v ON_ERROR_STOP=1 -U postgres \
  -v migrator_pw="'dev-migrator'" -v app_pw="'dev-app'" \
  -f /dev/stdin <<'SQL'
CREATE ROLE wf_migrator LOGIN PASSWORD :migrator_pw NOSUPERUSER NOCREATEROLE CREATEDB;
CREATE ROLE wf_app LOGIN PASSWORD :app_pw NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE wiskiflix OWNER wf_migrator;
-- Shadow database for `prisma migrate dev` / `npm run db:drift`.
CREATE DATABASE wiskiflix_shadow OWNER wf_migrator;
\connect wiskiflix
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO wf_migrator;
GRANT USAGE ON SCHEMA public TO wf_app;
SQL
