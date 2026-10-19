# 11 — Redesign spec ("Wiski" catalog site)

> Status: **APPROVED** (all defaults O2–O10 accepted) · rev 6 · 2026-10-02. Visual target: [../design/README.md](../design/README.md). Build plan: [12-r1-plan.md](./12-r1-plan.md). Supersedes the catalog, search, TMDB, series-package and YouTube parts of 01–06 and 10. Payments, security architecture, auth, sessions and the guard pipeline built in Phase 1 stay. Visual details wait for the Figma file (§12, O1).

## 1. What changes

| Topic | Before (rev 1–5 / Phase 1) | Now |
|---|---|---|
| Catalog source | TMDB search + YouTube links | **Handpicked only.** Every title, text and image is entered by moderators in a dashboard. No TMDB, no search, no viewer-chosen titles. |
| Movies | any TMDB movie | **35 handpicked movies**, browsed with arrow buttons; one sponsor pays the **full price** |
| Series | per-season packages, single buyer | **10 handpicked series**, **crowdfunded** |
| Franchises | — | **separate handpicked entries** (e.g. "Saga Alien — 4 filmes"), **crowdfunded** |
| Approval | moderator approval before payment was considered | **no approval** — titles are already handpicked |
| Navigation | — | **Filmes · Séries · Franquias · Avaliações · Perfil** (no search button) |
| CTAs | — | "**Patrocine agora**" (movies), "**Assistir trailer**" |
| Look | dark purple brand theme | same brand, **neon glows built only from the brand purples**, layout following the Figma concept |
| Name / logo | Wiski / "Wiski" in Black Rockie | unchanged |
| Payments | Pix via Mercado Pago, webhook, no refunds | unchanged (now also used for campaign contributions) |

## 2. Product rules

### 2.1 Movies (single payment)

- At most **35 movies** are live at a time, in a fixed carousel order (positions 1–35) set in the dashboard.
- Price = existing rule: **R$ 20 up to 130 min, + R$ 1 per extra minute** (04 §3). Moderator/VIP 10 % perk, vouchers and the queue-jump add-ons (**Prioridade +80 %**, **Topo da fila +160 %**) still apply to movies only.
- **One sponsor per movie.** Lifecycle:

```
DRAFT ──publish──▶ ACTIVE ──checkout──▶ (reserved 35 min while the Pix is pending)
ACTIVE ◀──Pix expired/cancelled──┘            │ approved
                                              ▼
                                SPONSORED ("Patrocinado" badge, can't be bought)
                                              │ watched on stream
                                              ▼
                     WATCHED ──moderator replaces──▶ ARCHIVED (slot freed for a new pick)
```

- While a Pix is pending, the movie shows **"Reservado"** and can't be bought by someone else (35 min max).

### 2.2 Crowdfunding (series and franchises)

| Rule | Value |
|---|---|
| Goal | Series: **R$ 100 × seasons included** (e.g. "Temporadas 1–3" → R$ 300). Franchise: **sum of each film's movie price** (R$ 20 ≤ 130 min + R$ 1/min). The streamer can set a different goal before opening. |
| Contribution | **any whole-real amount ≥ R$ 5**, quick buttons R$ 5 / 10 / 20 / 50; the last contribution is capped at what's left |
| No overfunding | an amount is **reserved** while its Pix is pending (35 min); the bar shows confirmed money, and "remaining" excludes reservations |
| Perks | no moderator/VIP discount, vouchers or queue jump on contributions |
| Who | guests and logged-in users (same checkout as movies: contact e-mail, order link, Turnstile) |
| Deadline | set when the campaign opens (default **30 days**). If the goal isn't reached, contributions **pause** and the streamer **extends the deadline** (any number of times). Each extension is shown publicly ("Prazo prorrogado até …") and contributors with an e-mail get a notice. |
| Goal reached | campaign → **Meta atingida**, contributions close, streamer schedules it on stream session(s); then **Assistido** |
| Refunds | none (same no-refund policy). Because money can wait indefinitely for an extension, the terms must say so plainly — your lawyer should review this crowdfunding wording specifically. |
| Lowering a goal | STREAMER only, never below what's already been raised + reserved; lowering it to exactly the amount raised completes the campaign |
| Limits | at most **10 series** and **10 franchises** (O4) live at a time |

### 2.3 Reviews ("Avaliações")

Reviews stay as specified (1–5 stars, text, likes, reports, moderation) and attach to a **movie, series or franchise** once it has been watched on stream. The Avaliações tab lists the latest reviews and the watched titles.

### 2.4 Perfil

Logged out: Google sign-in. Logged in: profile (username, avatar), my sponsorships and contributions, sessions, LGPD data tools — the Phase 1 pages, restyled.

## 3. Site structure (final layout follows the Figma file)

| Route | Content |
|---|---|
| `/` = **Filmes** | full-width hero with the current movie: backdrop, title logo or title, year · runtime · age rating · genres, synopsis, **Patrocine agora**, **Assistir trailer**, price; **◀ ▶ arrow buttons** cycle through the 35 movies (keyboard and swipe; position counter "12 / 35"); a row of poster cards below; a "Próximos na live" strip |
| `/series` | the series campaigns: hero + cards with progress bar (raised / goal), deadline, **Contribuir** |
| `/franquias` | franchise campaigns, same pattern, with the list of films included |
| `/filmes/[slug]`, `/series/[slug]`, `/franquias/[slug]` | detail pages (shareable links, Open Graph image from the backdrop) |
| `/avaliacoes` | latest reviews, watched titles |
| `/perfil` | sign-in or profile/account (replaces `/entrar` and `/conta` as the entry point) |
| `/admin/catalogo` | moderator dashboard (§4) |
| footer | legal pages, media kit, contact, LGPD channel |

- **Mobile:** the five tabs become a **bottom tab bar**; the hero becomes a swipeable card with the two CTAs stacked.
- **Neon:** glows, borders and text-shadows built from lavender `#A99DE0` and violet `#736BB2` on ink `#1B1225`, e.g. neon outline on the active nav tab and on "Patrocine agora", a soft pulsing glow on hover. Pure CSS, no images. Animations turn off under `prefers-reduced-motion`. Text contrast rules from 06 §2 still apply: glow is decoration, never what makes text readable.
- **Trailer:** "Assistir trailer" opens a modal that loads the YouTube player only after the click (§6).
- **Accessibility:** the carousel is a labelled region with real buttons, `aria-live` announcing the current title, and no auto-rotation.

## 4. Moderator dashboard (`/admin/catalogo`)

| Feature | Detail |
|---|---|
| Movie editor | title, original title, year, runtime (min), age rating (L, 10, 12, 14, 16, 18), genres, synopsis (≤ 600 chars), director, main cast, **poster** (2:3), **backdrop** (16:9), optional **title logo** (transparent PNG), **YouTube trailer link**, carousel position. Price is computed from the runtime and shown read-only. |
| Series editor | same fields plus seasons included (label + count), episode count, total runtime (for scheduling); goal shown from the formula |
| Franchise editor | same fields plus the list of films (title, year, runtime) → goal from the formula |
| Slots | a 35-slot board for movies (drag to reorder, "Substituir" puts a new pick into a freed slot); 10-slot boards for series and franchises |
| Preview | "Ver como visitante" renders the hero exactly as the public page |
| Publish | moderators publish movies directly. Campaigns: a moderator prepares them; the **streamer opens** them (sets goal and deadline, step-up re-auth) |
| History | every save keeps the previous version; one-click revert; all actions in the audit log |
| Watched | mark as watched → reviews unlock → movie goes to ARCHIVED and its slot frees up |

Roles: MODERATOR and STREAMER use the editor. Money-related actions are STREAMER-only with step-up: campaign goal, deadline, extensions, goal changes, prices, VIP, exception refunds.

## 5. Image uploads (new attack surface — Phase 1 had none)

| Control | Rule |
|---|---|
| Who | MODERATOR+ only; rate-limited; audited |
| Accepted | JPEG, PNG, WebP, AVIF, detected from the **file bytes** (magic numbers), not from the name or `Content-Type`. **SVG, GIF, HEIC and anything else rejected.** |
| Size | ≤ 10 MB per file; ≤ 40 megapixels (decompression-bomb guard in `sharp`); minimums: poster 600 × 900, backdrop 1920 × 1080 |
| Processing | the worker **re-encodes** every image with `sharp` (strips EXIF/GPS/ICC metadata and any trailing payload), auto-rotates, and writes fixed widths (poster 240/480/960, backdrop 960/1440/1920/2560, logo 480/960) as **AVIF + WebP**. The original upload is deleted after processing. |
| Storage | outside the app code: `/var/lib/wiski/media` (Docker volume, included in backups); file names = content hash + width + format — never user-supplied |
| Serving | nginx `location /media/` → static files only, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, CSP `default-src 'none'`; same origin, so page CSP `img-src 'self'` doesn't change |
| Pages | `<picture>` with `srcset` built by our `Img` component (no runtime image optimisation on the 2 GB server) |
| Clean-up | images no longer referenced by any version are deleted after 30 days |
| Upload path | the only endpoint allowed bodies > 16 KB: nginx `client_max_body_size 11m` on that one location; streamed to a temp file, not buffered in memory |
| Rights | posters and backdrops of real films are usually copyrighted; use images you are allowed to use (worth a line in your lawyer's review) |

## 6. Trailer embeds

- The moderator pastes a YouTube link; the server extracts the 11-character id with a strict regex and stores only the id.
- The player is `https://www.youtube-nocookie.com/embed/{id}?autoplay=1&rel=0` inside a modal, created only after "Assistir trailer" is clicked (privacy: nothing loads from Google before that).
- Changes:
  - CSP: `frame-src` gains `https://www.youtube-nocookie.com`.
  - Permissions-Policy (nginx): `autoplay`, `encrypted-media`, `fullscreen` and `picture-in-picture` allowed for `self` and that origin only.
  - The iframe gets a matching `allow` attribute and `referrerpolicy="strict-origin-when-cross-origin"`, because YouTube's embedded player needs to receive the site's origin.
- No YouTube API key needed.

## 7. Data model delta (Prisma)

Removed: `Title.source/externalId/metadataSyncedAt`, `MediaSource`, `CatalogRule`, `CatalogRuleType`, `CatalogPackage`, the `YOUTUBE` and `ANIME` kinds (anime is just a series). Nothing that used them has been built, so no data migrates.

```prisma
enum ItemKind { MOVIE SERIES FRANCHISE }
enum ItemStatus { DRAFT ACTIVE SPONSORED FUNDED WATCHED ARCHIVED }
enum AgeRating { L A10 A12 A14 A16 A18 }

model CatalogItem {                       // replaces Title
  id                String     @id @default(uuid(7)) @db.Uuid
  kind              ItemKind
  slug              String     @unique
  status            ItemStatus @default(DRAFT)
  slot              Int?       // carousel position; unique per kind while ACTIVE/SPONSORED/FUNDED (partial unique)
  title             String
  originalTitle     String?
  year              Int?
  runtimeMinutes    Int        // movie runtime, or total runtime of a series/franchise (scheduling)
  ageRating         AgeRating?
  genres            String[]
  synopsis          String     // ≤ 600 chars, sanitised plain text
  director          String?
  cast              String[]
  seasonsLabel      String?    // SERIES: "Temporadas 1–3"
  seasonCount       Int?       // SERIES: goal = 100,00 × seasonCount by default
  episodeCount      Int?
  trailerYoutubeId  String?    // [A-Za-z0-9_-]{11}
  posterId          String?    @db.Uuid
  backdropId        String?    @db.Uuid
  logoId            String?    @db.Uuid
  reservedUntil     DateTime?  @db.Timestamptz(3) // MOVIE: pending Pix holds the movie
  reservedOrderId   String?    @db.Uuid
  version           Int        @default(0)
  publishedAt       DateTime?  @db.Timestamptz(3)
  watchedAt         DateTime?  @db.Timestamptz(3)
  createdAt         DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime   @updatedAt @db.Timestamptz(3)
  // relations: poster/backdrop/logo → MediaAsset; franchiseEntries; campaign; revisions; sponsorships; reviews; watchEvents
}

model FranchiseEntry {                    // films inside a franchise (informational + goal formula)
  id             String @id @default(uuid(7)) @db.Uuid
  franchiseId    String @db.Uuid
  position       Int
  title          String
  year           Int?
  runtimeMinutes Int
  @@unique([franchiseId, position])
}

model CatalogRevision {                   // every dashboard save; enables revert
  id        String   @id @default(uuid(7)) @db.Uuid
  itemId    String   @db.Uuid
  version   Int
  snapshot  Json     // full editable fields, validated by Zod
  editorId  String   @db.Uuid
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  @@unique([itemId, version])
}

enum MediaRole { POSTER BACKDROP LOGO }
model MediaAsset {
  id           String    @id @default(uuid(7)) @db.Uuid
  sha256       Bytes     @unique  // of the re-encoded master
  role         MediaRole
  width        Int
  height       Int
  variants     Json      // [{w, format, path, bytes}]
  uploadedById String    @db.Uuid
  createdAt    DateTime  @default(now()) @db.Timestamptz(3)
  unusedSince  DateTime? @db.Timestamptz(3) // GC after 30 days
}

enum CampaignStatus { OPEN PAUSED FUNDED SCHEDULED WATCHED }
model Campaign {                          // one per SERIES / FRANCHISE item
  id             String         @id @default(uuid(7)) @db.Uuid
  itemId         String         @unique @db.Uuid
  goalCents      Int
  raisedCents    Int            @default(0)   // confirmed payments
  reservedCents  Int            @default(0)   // pending Pix
  remainingCents Int            // = goal − raised − reserved; conditional decrement prevents overfunding
  deadlineAt     DateTime       @db.Timestamptz(3)
  extensions     Int            @default(0)
  status         CampaignStatus @default(OPEN)
  openedAt       DateTime       @db.Timestamptz(3)
  fundedAt       DateTime?      @db.Timestamptz(3)
  version        Int            @default(0)
  // CHECK remainingCents = goalCents - raisedCents - reservedCents AND remainingCents >= 0
}

enum OrderKind { MOVIE CONTRIBUTION }
model Order {                             // replaces Sponsorship as the common checkout record
  // = the old Sponsorship buyer/amount/status/guest/legal fields (publicCode, userId?, contactEmail,
  //   accessTokenHash, display name + moderation, message + moderation, ruleSetId, breakdown,
  //   subtotal/discount/queueJump/total, status, clientRequestId, version, timestamps)
  kind         OrderKind
  itemId       String  @db.Uuid
  // MOVIE only: sessionId, queueJumpTierId, rescheduleCount (CHECK: null for CONTRIBUTION)
  // CONTRIBUTION only: campaignId (CHECK: null for MOVIE)
}
```

`Payment`, `LegalAcceptance`, `VoucherRedemption`, `QueueJumpSlot`, `WatchEvent` and `Review` point to `Order` / `CatalogItem` instead of `Sponsorship` / `Title`. New reviewed SQL: the CHECKs above, partial unique `(kind, slot)` for live items, at most 35/10/10 live items per kind (enforced in the publish transaction by counting under a per-kind advisory lock).

**Concurrency:**
- Movie reservation: `updateMany where status = ACTIVE and (reservedUntil is null or < now)`, so only one checkout wins.
- Contribution: `updateMany where status = OPEN and remainingCents ≥ amount` → decrement `remainingCents`, increment `reservedCents`. Pix approved → move to `raisedCents`; expired → give it back.

## 8. API delta

| Change | Endpoints |
|---|---|
| **Removed** | catalog search, TMDB movie/tv lookups, `catalog/packages`, YouTube resolve, admin `catalog/tv/*`, `packages/*`, `catalog-rules` |
| Public reads | `GET /api/v1/catalog/{movies,series,franchises}` (live items in slot order) · `GET /api/v1/catalog/{kind}/[slug]` · `GET /api/v1/campaigns/[id]` (progress, cached 5 s) · `GET /api/v1/campaigns/[id]/events` (SSE progress) |
| Checkout | `POST /api/v1/sponsorships/quote` + `POST /api/v1/sponsorships` now take `movieId` (reserves the movie) · **new** `POST /api/v1/campaigns/[id]/contributions` (guest or user, Turnstile, `Idempotency-Key`, `{amountCents, contactEmail?, displayName?, message?, legal versions}`) → Pix · order pages/events/access/claim/cancel generalised from `sponsorships/[code]` to `orders/[code]` |
| Admin (MODERATOR+) | `admin/catalog/items` CRUD, `…/[id]/publish`, `…/[id]/replace`, `…/[id]/revisions` + revert, `…/[id]/watched`, `admin/catalog/slots` reorder, `POST admin/media` (multipart upload) |
| Admin (STREAMER + step-up) | `admin/campaigns/[id]/open` (goal, deadline), `…/extend`, `…/goal`, `…/schedule` |

## 9. Security delta (adds to 05)

| Threat | Control |
|---|---|
| Malicious upload (HTML/SVG/polyglot XSS, decompression bomb, EXIF location leak, path traversal, disk filling) | byte sniffing + allow-list, SVG rejected, re-encode with metadata stripped, pixel limit, size limit, hash names, `/media` served as static with `nosniff` and a deny-all CSP, per-user upload rate limit + disk quota alert, worker-side processing with timeout |
| Compromised moderator defacing the homepage | revisions + one-click revert, audit log, moderator sessions 8 h; **recommendation: passkey required for moderators too** now that they publish to the homepage (O6) |
| Two buyers racing for the same movie | conditional reservation (one winner), DB partial unique on active orders per movie |
| Overfunding race / goal tampering | `remainingCents` conditional decrement + CHECK; goal/deadline changes STREAMER-only with step-up, audited, extensions shown publicly |
| Admin-entered text shown to everyone (stored XSS by a compromised account) | same sanitizer + React text nodes as reviews; synopsis length cap |
| Third-party tracking via trailers | click-to-load, `youtube-nocookie.com`, only the 11-char id stored, privacy policy mention |
| Upload endpoint as DoS vector | separate nginx location with its own limits (11 MB, 2 r/min per IP), MODERATOR+ only before the body is read (session check), streaming to disk |

## 10. Removed from scope

TMDB integration, licence gate and attribution · viewer search · YouTube sponsorships · catalog rules for viewer-chosen titles · per-season packages bought by one person · moderator approval of movies before payment. The `TMDB_*` settings leave `.env.example` and the boot checks.

## 11. Rework plan for the Phase 1 code

| Area | Change |
|---|---|
| `prisma/schema.prisma` + migrations | new migration replacing Title/CatalogRule/CatalogPackage/Sponsorship with CatalogItem/FranchiseEntry/CatalogRevision/MediaAsset/Campaign/Order; reviewed SQL for the new CHECKs/partial uniques; constraint tests updated |
| `src/server/env.ts`, `.env.example` | drop `TMDB_*`; add `MEDIA_DIR` |
| `src/server/security/csp.ts` | `frame-src` + youtube-nocookie; tests updated |
| `docker/nginx/snippets/security-headers.conf` | Permissions-Policy for the trailer origin; `/media/` location; upload location limits |
| `src/components/layout/*`, `globals.css` | new header (5 tabs, logo), bottom tab bar, neon tokens; TMDB attribution removed from the footer |
| Pages | `/` Filmes hero carousel, `/series`, `/franquias`, detail pages, `/avaliacoes`, `/perfil`; `/entrar` and `/conta` fold into `/perfil` with redirects |
| New | catalog services, dashboard, media pipeline (worker job), trailer modal, campaign progress |
| Tests | authz matrix for new routes, upload fuzz corpus (polyglots, bombs, SVG, wrong extensions), carousel a11y, CSP/header tests updated, 0-violation CSP with the trailer modal open |

**New order:**
- **R1** — redesign foundation: data model, dashboard and media pipeline, header and neon theme, public catalog pages. Needs the Figma file.
- **Phase 2** — payments: movie checkout and campaign contributions, webhook.
- **Phase 3** — reviews.
- **Phase 4** — remaining admin, overlays, media kit.
- **Phase 5** — deploy.

## 12. Questions still open (proposed defaults)

| # | Question | Default |
|---|---|---|
| **O1** | **Figma access** — needed for the layout and the dashboard design | connect the Figma connector in Claude, or export the frames (desktop + mobile, every screen incl. the dashboard) as PNG into `Wiskiflix/ASSETS/FIGMA/` |
| O2 | Button label for series/franchises | "**Contribuir**" |
| O3 | Default campaign length; what visitors see after the deadline | 30 days; "Prazo encerrado — aguardando prorrogação", contributions paused |
| O4 | Max live franchises | 10 |
| O5 | Who opens campaigns | moderator prepares, **streamer opens** (goal + deadline, step-up) |
| O6 | Passkey for moderators | **required** (they can change the homepage) |
| O7 | Media kit, overlays, public queue | kept: media kit + contact in the footer, overlays unchanged, "Próximos na live" strip on Filmes |
| O8 | Movie while its Pix is pending | "Reservado" badge, not purchasable, max 35 min |
| O9 | Home page | `/` = Filmes |
| O10 | Mobile navigation | bottom tab bar with the five tabs |
