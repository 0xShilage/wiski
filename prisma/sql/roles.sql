-- Least-privilege database roles for Wiskiflix. Run ONCE per cluster as a superuser, BEFORE the
-- first `prisma migrate deploy`, e.g.:
--   psql "postgresql://postgres@localhost:5432/postgres" \
--        -v migrator_pw="'...'" -v app_pw="'...'" -f prisma/sql/roles.sql
-- Then use:
--   MIGRATE_DATABASE_URL=postgresql://wf_migrator:<migrator_pw>@host:5432/wiskiflix   (prisma migrate)
--   DATABASE_URL=postgresql://wf_app:<app_pw>@host:5432/wiskiflix                     (web + worker)
-- Passwords come from the server's secret store, never from the repository.

CREATE ROLE wf_migrator LOGIN PASSWORD :migrator_pw NOSUPERUSER NOCREATEROLE;
CREATE ROLE wf_app      LOGIN PASSWORD :app_pw      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE wiskiflix OWNER wf_migrator;
-- Prisma's `migrate dev` needs to create a shadow database; production only runs `migrate deploy`.
-- ALTER ROLE wf_migrator CREATEDB;   -- development machines only
\connect wiskiflix
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO wf_migrator;
GRANT USAGE ON SCHEMA public TO wf_app;
