# Wiskiflix — R1 (redesign foundation)

> Status: **built and tested** · 2026-10-02 · plan: [`../phase-0/12-r1-plan.md`](../phase-0/12-r1-plan.md) · rules: [`../phase-0/11-redesign-spec.md`](../phase-0/11-redesign-spec.md) · design: [`../design/README.md`](../design/README.md) · results: [`test-report.md`](./test-report.md)

R1 replaces the TMDB/packages model with a curated catalogue the moderation fills by hand: 35 movies, 10 series and 10 franchises on the air, a moderator dashboard with an image pipeline, passkeys for every admin, the new neon theme with the Filmes hero carousel, and campaign management for series and franchises. Payments (checkout, Pix, contributions) start in Phase 2.

Also in this release: the desktop layout is tuned for **1920×1080, 1366×768, 1536×864, 1280×720 and 3440×1440** (each full-screen and with browser toolbars + taskbar), see §3.

## 1. What's in the box

| Area | Where | Notes |
|---|---|---|
| Data model | `prisma/schema.prisma`, migrations `20261002230000_r1_catalog` (generated) + `20261002230100_r1_constraints` (reviewed SQL) | `CatalogItem`, `FranchiseEntry`, `CatalogRevision`, `MediaAsset`, `Campaign`, `Order` (movie or contribution); `Title`, `CatalogRule`, `CatalogPackage`, `Sponsorship`, `MediaSource`, YOUTUBE/ANIME removed; `Payment`, `LegalAcceptance`, `VoucherRedemption`, `QueueJumpSlot`, `WatchEvent`, `Review` repointed |
| Passkeys | `src/server/auth/passkeys.ts`, `src/app/api/v1/me/passkeys/**`, `/perfil/seguranca`, `src/components/admin/PasskeyGate.tsx` | `@simplewebauthn/server` + `/browser` 14; second factor for MODERATOR and STREAMER on `/admin/**` and every admin API |
| Media pipeline | `src/server/media/{sniff,pipeline}.ts`, `POST /api/v1/admin/media`, `docker/nginx/snippets/{media,upload}.conf` | `sharp` 0.35; JPEG/PNG/WebP/AVIF in, AVIF + WebP out under content-hash names in `MEDIA_DIR` |
| Catalogue services | `src/server/catalog/{input,snapshot,service,campaigns,read}.ts`, `src/lib/catalog/*` | CRUD, publish, slots, replace, revisions + revert, watched, campaigns; every write audited |
| Theme + layout | `src/styles/*.css`, `src/components/layout/*` | glow tokens, header (logo + 5 tabs), bottom tab bar ≤ 760 px, footer (legal, LGPD channel, media kit, contact); TMDB attribution gone |
| Public pages | `src/app/(site)/**`, `src/components/catalog/*` | `/` Filmes hero carousel, `/series`, `/franquias`, `/filmes/[slug]`, `/series/[slug]`, `/franquias/[slug]`, `/avaliacoes` (shell), `/perfil` (sign-in + account), `/perfil/sessoes`, `/perfil/seguranca` |
| Redirects | `next.config.ts` | `/entrar` → `/perfil`, `/conta` → `/perfil`, `/conta/sessoes` → `/perfil/sessoes` (301); `/admin` → `/admin/catalogo` |
| Dashboard | `/admin/catalogo`, `src/components/admin/{Dashboard,SlotBoard,ItemEditor,MediaDrop}.tsx` | sidebar with counts, slot board (drag **or** Alt + arrows), editor with live price, YouTube check, drop zones, "Ver como visitante", draft/publish, history + revert, conflict handling |
| Trailer | `src/components/catalog/TrailerButton.tsx`, `src/lib/catalog/youtube.ts` | native `<dialog>`; the `youtube-nocookie.com` iframe exists only while the modal is open |
| Dev seed | `scripts/seed-dev.ts`, `scripts/seed-art.ts`, `npm run db:seed` | fictional titles with brand placeholder art, through the real services and pipeline |

### API endpoints added in R1

| Method · path | Access | Purpose |
|---|---|---|
| `GET /api/v1/catalog/[kind]` · `GET /api/v1/catalog/[kind]/[slug]` | public | live items in slot order (`movies`, `series`, `franchises`) · one live item |
| `GET /api/v1/campaigns/[id]` | public | campaign progress (`Cache-Control: public, max-age=5`) |
| `GET`/`POST /api/v1/admin/catalog/items` | moderator + passkey | list (dashboard) · create draft |
| `GET`/`PATCH`/`DELETE /api/v1/admin/catalog/items/[id]` | moderator + passkey | read · edit (needs `expectedVersion`) · delete a draft |
| `POST …/items/[id]/publish` · `…/replace` · `…/watched` · `…/revert` · `GET …/revisions` | moderator + passkey | put on the air (limits 35/10/10) · archive and free the slot · watched on stream · restore a revision · history |
| `PUT /api/v1/admin/catalog/slots` | moderator + passkey | reorder / swap slots of one kind in one transaction |
| `POST /api/v1/admin/media?role=POSTER\|BACKDROP\|LOGO` | moderator + passkey | one image as the raw request body |
| `POST /api/v1/admin/campaigns/[id]/open` · `…/extend` · `…/goal` | streamer + passkey + Google step-up | open a prepared series/franchise · extend the deadline · change the goal |
| `GET /api/v1/me/passkeys` · `DELETE …/[id]` · `POST …/registration/options` · `POST …/registration` · `POST …/authentication/options` · `POST …/authentication` | moderator+ | list · remove · enrol · verify (stamps the session) |
| `GET /media/[file]` | public, **development only** | serves `MEDIA_DIR` in `next dev`; 404 in production, where nginx serves `/media/` |

Every route is wrapped in `route()` and listed in the authz matrix (`tests/integration/authz.test.ts`); the matrix meta-test now walks all of `src/app`, not only `src/app/api`.

## 2. Running it

**Prerequisites:** Node **24 LTS** (`.nvmrc`; R1 moved from 22 to 24 — the whole suite was re-run on 24.19), Docker Desktop (running), Git. Any editor works; VS Code is fine (Terminal → New Terminal opens PowerShell in the project folder). Work in **one** folder — `Documents\Wiskiflix`, the one Claude delivers to.

### First run, in this order (Windows PowerShell, macOS or Linux)

```bash
npm ci                                            # pinned tools; also runs `prisma generate`
npm run setup:dev                                 # creates .env.local with fresh random secrets (git-ignored)
#   → open .env.local in the editor and fill GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (§7), save
docker compose -f docker/compose.dev.yml up -d    # dev Postgres 17 + Redis (Docker Desktop must be running)
npm run db:migrate                                # all migrations incl. the two R1 ones (as wf_migrator)
npm run db:drift                                  # expect no output (migrations == schema.prisma)
npm run db:seed                                   # optional: the fictional demo catalogue
npm run dev                                       # http://localhost:3000
```

Every `db:*` script and the app read `.env.local`; without it they fail with *"Connection url is empty"*, *"You must set `datasource.shadowDatabaseUrl`"* or *"Invalid environment: APP_ORIGIN…"* — run `npm run setup:dev` in the project folder. `db:seed` refuses a non-empty catalogue; `npm run db:seed -- --reset` empties it first (development only).

- **`MEDIA_DIR`** — where processed images live. Optional in development (default `.media/` in the project, git-ignored); required in production (e.g. `/var/lib/wiski/media`, a volume nginx reads and the app writes).
- **Using the dashboard yourself** needs a Google login (Q27 — set it up as in §7), a role set by the operator (§7), and a passkey enrolled at `/perfil/seguranca`. Passkeys work on `http://localhost` and on https origins. The STREAMER's money actions also ask for a fresh Google login.
- Integration and browser tests need Linux tools (`redis-server`, `nginx`, `openssl`): they run in CI on every push (§7) or in WSL2. Lint, typecheck, unit tests and `npm run dev` run anywhere.

## 3. Desktop resolutions

The Filmes hero is sized by viewport **width** (margins and type, Figma metrics) and **height** (vertical rhythm and poster rail), so title, meta, synopsis, both buttons, the price line, the ◀ ▶ arrows with the counter and the whole active poster sit in one screen:

| Resolution | Full screen | With browser chrome + taskbar |
|---|---|---|
| 1920×1080 | ✅ | 1920×947 ✅ |
| 1536×864 | ✅ | 1536×730 ✅ |
| 1366×768 | ✅ | 1366×625 ✅ |
| 1280×720 | ✅ | 1280×593 ✅ |
| 3440×1440 | ✅ (content on a centred 2400 px stage) | 3440×1305 ✅ |

Below 900 px of height the arrows move next to the buttons; below 700 px the synopsis shows two lines. Séries, the detail pages and the dashboard were checked at 1366×768, 1280×720 and 3440×1440 (no horizontal scroll; the dashboard columns scroll on their own). Guarded by `tests/e2e/viewports.spec.ts` (screenshots in `test-results/viewports/`).

## 4. Security decisions made while building (all covered by tests)

1. **Passkeys:** enrolling one needs a fresh Google login; user verification required; RP ID and origin pinned to `APP_ORIGIN`; challenges random, bound to the session, single-use (Redis `GETDEL`) and valid 5 min; a sign counter that doesn't increase is rejected and the stored counter is updated with compare-and-set; a successful assertion stamps `Session.mfaAt`, accepted for 10 min. Without a passkey every admin API answers 401 with `PASSKEY_ENROLL_REQUIRED` / `PASSKEY_REQUIRED` (the dashboard shows the matching screen).
2. **Uploads are checked before a byte is read:** session, role, CSRF, passkey and `Content-Length` first; then the body is streamed to a private temp file. The **bytes** decide the format (client type and file name are ignored); SVG/HTML/GIF/HEIC/PDF → 415; `sharp` with a 40 MP limit, auto-rotate, metadata stripped, minimum size per role, logos must have transparency; outputs are named `<128-bit hash>-<width>.<avif|webp>`; the temp file never survives.
3. **`/media/` is static only:** nginx serves it from `MEDIA_DIR` with a name allow-list (anything else → 404 without touching the disk), GET/HEAD only, `nosniff`, immutable cache and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox`. The upload location is the only one with `client_max_body_size 11m` and has its own `limit_req` (2 r/min per IP, burst 2).
4. **Trailers:** only the validated 11-character id is stored; the iframe points at `www.youtube-nocookie.com/embed/<id>`, is created on click and destroyed on close; `frame-src` and Permissions-Policy (`autoplay`, `encrypted-media`, `fullscreen`, `picture-in-picture`) allow exactly that origin.
5. **Invariants in the database** (reviewed SQL): the 35/10/10 live limits in a trigger under an advisory lock (SQLSTATE `WF409` → HTTP 409), one live item per `(kind, slot)` as a **deferred** exclusion constraint (swaps commit atomically), campaign `remaining = goal − raised − reserved ≥ 0`, kind-specific `Order` columns, one active order per movie (partial unique).
6. **Optimistic concurrency:** every content change needs `expectedVersion`; a stale save gets 409 and the editor offers "Recarregar" — never a silent overwrite. Each change stores the full snapshot (`CatalogRevision`); revert restores it exactly and is itself a new revision.
7. **Admin text is plain text:** bidi overrides, zero-width and control characters are removed, whitespace normalised, lengths counted in code points; React renders it as text nodes.
8. **Every admin write is audited** with allow-listed metadata (new actions for catalogue, slots, media, campaigns and passkeys). Rate limits: `adminWrite`, `mediaUpload` (20 per 10 min per user and IP), `passkey`, `catalogRead`.
9. **The pages stay CSP-strict** (no `style=` anywhere): progress bars are `<progress>`, carousel positions and art come from classes, images from `<picture>`/`srcset` built only from well-formed same-origin `/media/` paths.

## 5. Deviations from the plan, and why

1. **Raw-body upload instead of multipart.** One image per request as `application/octet-stream` (or the image type) with `?role=`. No multipart parser means no file names, no boundary parsing and no extra fields to attack; the server still streams to a temp file and checks size while reading.
2. **Live-slot uniqueness is a deferred exclusion constraint**, not the partial unique index the plan names: a partial unique index can't be deferred, so swapping two slots in one transaction would fail midway.
3. **Live limits by trigger**, not by application code alone: the count and the insert/update happen under one advisory lock in the database, so two moderators can't both publish the 36th movie.
4. **Edits to a live item are published immediately** (one "Salvar alterações" button, with the revision kept for revert). Drafts keep the save/publish split.
5. **Campaign endpoints take the catalogue item id** (`/admin/campaigns/[itemId]/open` creates the campaign when it opens it).
6. **Not in R1:** `GET /api/v1/campaigns/[id]/events` (SSE) and `…/schedule` move to Phase 2 with payments; image processing runs inline with concurrency 1 and a timeout (move to the BullMQ worker in Phase 2, as the plan allows); a disk-quota alert for `MEDIA_DIR` is a Phase 5 (deploy) item.
7. **Migrations in this workspace** were produced and drift-checked with Prisma's official schema engine in its WASM build (the native engine download host is blocked here), as in Phase 1. Run `npm run db:drift` once locally.
8. **Trusted Types** stays report-only (same Next.js chunk-loader report as Phase 1, now also on `/perfil`, `/perfil/sessoes`, `/admin/catalogo`).
9. **npm audit — `braces` (GHSA-vfj7-8cjw-p6xm, high, no fixed release).** It reached the tree only through the lint chain `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` (dev-only; the plugin globs nothing but `settings.next.rootDir`, which we don't set). An `overrides` entry gives that one plugin `tinyglobby` instead of `fast-glob` — same `globSync(pattern, { onlyDirectories })` API, already in the tree through Vite and typescript-eslint — so `npm audit` reports 0 vulnerabilities. Drop the override when Next.js ships a plugin without `fast-glob` (Dependabot will show it).
10. **Node 24 LTS instead of 22.** Your computer runs Node 24.19, and Node 22 leaves long-term support in April 2027 — around launch — while 24 is supported until April 2028. `engines`, `.nvmrc` (so CI) and `@types/node` moved to 24; the whole suite was re-run on Node 24.19 ([`test-report.md`](./test-report.md)). The Phase 5 Docker image uses the same major.

## 6. Open items / needed from you

| # | Item | Needed by |
|---|---|---|
| Q27 | ✅ client id received — put the **client secret** into `.env.local` yourself (§7) | now (dashboard) |
| Q26 | ✅ `github.com/0xShilage/wiski` — extract the `.github` folder, then first push and settings in §7 | now |
| — | After copying: `npm ci`, `npm run db:migrate`, `npm run db:drift`, optionally `npm run db:seed` | now |
| — | Delete the obsolete Phase 1 pages from the project folder: `src/app/(site)/entrar/` and `src/app/(site)/conta/` (replaced by `/perfil`; the file bridge can't delete) | before the next build |
| S2 | Production Mercado Pago ids (unchanged from Phase 1) | Phase 2 |

## 7. Google sign-in (Q27) and the first push to GitHub (Q26)

### Google sign-in

Client id `333411243821-f80tvc0hpoj3mh3sp9ocmcj17dhet5tc.apps.googleusercontent.com` (public by design — it appears in every login URL). The **client secret** never goes into a chat, a file in the repository or a ticket.

1. Google Cloud Console → APIs & Services → Credentials → this client: **Authorized redirect URIs** exactly `http://localhost:3000/api/auth/google/callback` and `https://wiski.fun/api/auth/google/callback` (no trailing slash; "Authorized JavaScript origins" aren't needed — the login is a server-side code flow). OAuth consent screen: app name "Wiski", scopes `openid email profile` only; while the app is in *Testing*, add your Google account as a test user.
2. `npm run setup:dev` has created `.env.local` (git-ignored) with both lines empty. Open it in the editor, fill them and save — the server refuses to start with only one of them:

   ```
   GOOGLE_CLIENT_ID=333411243821-f80tvc0hpoj3mh3sp9ocmcj17dhet5tc.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=<copy it from the console>
   ```

3. `npm run dev` → `/perfil` → **Entrar com Google** → choose a username.
4. Give yourself the streamer role (local database, as the operator):

   ```
   docker compose -f docker/compose.dev.yml exec postgres psql -U postgres -d wiskiflix
   UPDATE "User" SET role = 'STREAMER' WHERE email = 'you@gmail.com';
   \q
   ```

5. Within 10 minutes of signing in: `/perfil/seguranca` → **Adicionar passkey** (Windows Hello, phone or security key) → `/admin/catalogo` → **Verificar com passkey**.

### First push (PowerShell, inside the `Wiskiflix` folder)

Before the first commit, delete `src/app/(site)/entrar` and `src/app/(site)/conta` (§6), and put the CI folder in place: extract `Claude outputs/wiskiflix-github-folder.zip` into the `Wiskiflix` folder so that `Wiskiflix\.github\workflows\ci.yml` exists (the file bridge isn't allowed to write `.github`). `.env.local`, `node_modules`, `.next`, `.media`, `Claude outputs` and zip files are git-ignored.

```powershell
git --version       # no git? install Git for Windows: winget install --id Git.Git -e  (then reopen VS Code)
git init -b main
git config user.name "0xShilage"
git config user.email "145050809+0xShilage@users.noreply.github.com"   # GitHub's private address
git add .
git diff --cached --name-only | Select-String 'env[.]local|node_modules/|Claude outputs|^[.]next/'   # must print NOTHING
git commit -m "Wiski: Phase 1 + R1"
git remote add origin https://github.com/0xShilage/wiski.git
git push -u origin main   # the first push opens a GitHub sign-in window
```

If the repository was created with a README or licence, run `git pull origin main --allow-unrelated-histories` before the push. After the push, the repository's **Actions** tab shows the first CI run.

### What runs on GitHub, and repository settings

- **`ci`** on every push and pull request: lint · typecheck · unit; integration (Postgres 17 + Redis); migrations (`prisma migrate deploy` with the native engine + drift check — the check this workspace couldn't run); build · brand pixels · e2e behind nginx · bundle secret scan; `npm audit` · gitleaks. About 20 minutes of runner time per push, counted against the account's Actions allowance for private repositories.
- **`codeql`** is skipped on a private repository: code scanning there needs GitHub Team/Enterprise with Code Security. It starts by itself if the repository is ever public.
- **Dependabot** (npm + Actions, weekly, grouped) — free on private repositories. In Settings → Code security, turn on Dependabot alerts and security updates.
- If the repository is owned by an **organisation**, gitleaks-action needs a free `GITLEAKS_LICENSE` secret (personal accounts don't).
- Branch protection for `main` (require the `ci` checks, block force pushes) needs GitHub Pro or higher on a private repository; worth it once someone else commits.

