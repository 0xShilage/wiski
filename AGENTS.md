<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Wiskiflix — project rules for AI agents and humans

Design baseline: `docs/phase-0/` (architecture, data model, API, pricing, threat model, tokens).
Phase 1 status, how to run, decisions and deviations: `docs/phase-1/README.md`; results: `docs/phase-1/test-report.md`.
R1 (redesign foundation): `docs/r1/README.md`; results: `docs/r1/test-report.md`; rules: `docs/phase-0/11-redesign-spec.md`.
Phase 2 (payments): `docs/phase-2/README.md`; results: `docs/phase-2/test-report.md`.
Phase 3 (reviews and moderation): `docs/phase-3/README.md`; results: `docs/phase-3/test-report.md`.
Phase 4 (operations: live schedule, orders/people admin, overlays, media kit, contact, LGPD; §6: authenticator 2FA, Cronograma, username cooldown by role): `docs/phase-4/README.md`; results: `docs/phase-4/test-report.md`.
Phase 5 (production: image, compose stack, nginx, deploy, backups): `docs/phase-5/README.md`; deploy: `docs/phase-5/deploy-guide.md`; checklist: `docs/phase-5/security-checklist.md`; results: `docs/phase-5/test-report.md`.
Phase 6 (Links page, home progress block, viewer suggestions, 20 live series — current): `docs/phase-6/README.md`; results: `docs/phase-6/test-report.md`.

Non-negotiables (enforced by lint/tests — keep them green):

- **Every Route Handler is wrapped in `route()`** (`src/server/http/route.ts`): access level, CSRF, rate limit, Zod `.strict()` schemas, RFC 9457 errors. Add each new endpoint to the authz matrix (`tests/integration/authz.test.ts`) — a meta-test fails otherwise.
- **No inline styles, no `dangerouslySetInnerHTML`, no `<style>` in SVG**: the CSP has no `'unsafe-inline'`. Use classes; images through `@/components/Img`; brand SVGs only via `npm run brand` (lossless, pixel-diffed).
- **Identity is the Google `sub`**; sessions are server-side (hash in DB); cookies are `__Host-`, HttpOnly, Secure.
- **Money is integer cents; time is UTC in the DB** (connections pinned to `TimeZone=UTC`), business rules in America/Sao_Paulo.
- **Audit log is append-only**: write through `audit()` with an allow-listed metadata schema; never UPDATE/DELETE it.
- **Admin routes need the second factor** (authenticator app or passkey, `src/server/auth/mfa.ts`): `route()` enforces `Session.mfaAt` ≤ 96 h for `moderator`/`streamer` access by default — never pass `mfa: false` on an admin endpoint (only the second-factor endpoints themselves do). TOTP secrets are encrypted with `TOTP_ENCRYPTION_KEY`; recovery codes are stored as HMACs only. Money actions (moderators and the streamer) also need Google step-up (10 min); refunds and role changes need the `streamer` access level (STREAMER and SUPER_MODERATOR; only the STREAMER names or removes a Super Moderador, `src/lib/roles.ts`).
- **User images only through the media pipeline** (`src/server/media`): bytes decide the format, everything is re-encoded under content-hash names; nginx serves `/media/` in production (the app route is development-only).
- **Raw SQL only in reviewed migrations** (`prisma/migrations/*_constraints`) plus the documented tagged-template exceptions.
- **Order and payment state changes only in `src/server/payments/{sync,jobs,refunds}.ts`, `src/server/checkout/{orders,access,holds,admin}.ts`, `src/server/live/schedule.ts` and `catalog/service.ts` `markWatched`/`unmarkWatched`**: never trust a webhook body (re-fetch and verify every MP payment); every transition is a compare-and-set with its holds in the same transaction, and is audited.
- **Review counters are database triggers** (`likeCount`, `openReportCount`): never adjust them in code. Every moderator action goes through `src/server/reviews/moderation.ts` (compare-and-set on the status the moderator saw, reports resolved in the same transaction, audited).
- **Overlay payloads only through `src/server/overlay/events.ts`**: build them from sanitised text with the widget limits and validate against `overlayEventSchema` before publishing; the overlay page renders text nodes only.
- **Production runs only what CI built**: images by digest (`scripts/ops/deploy.sh`), the server's checkout clean at the release commit, configuration under `/etc/wiskiflix` created by `scripts/ops/server-setup.sh`. Keep `docker/compose.prod.yml` hardening (read-only, `cap_drop: ALL`, limits, internal data network) and the nginx template (tested by the browser suite) green: `tests/unit/{compose-prod,nginx-config}.test.ts`.
- **Secrets never in the repo, chat, logs or client bundle** (`npm run check:bundle-secrets`, gitleaks). Code/docs/identifiers in English, UI copy in pt-BR.
