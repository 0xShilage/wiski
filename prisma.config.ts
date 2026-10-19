import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env files by itself. Load the local, git-ignored env file if present
// (Node ≥ 22 built-in), without overriding variables that are already set (CI, Docker).
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations run as the DDL role (wf_migrator); the app uses DATABASE_URL (wf_app, DML only).
    url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    // Needed by `prisma migrate dev` / `migrate diff --from-migrations` (drift check in CI).
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
