# 03 — API surface

> Status: **rev 3** (guest checkout, VIP perk, per-season series/anime packages, fixed queue-jump tiers, YouTube disabled for now). All JSON APIs are Next.js Route Handlers. No Server Actions for mutations (one explicit, testable guard pipeline for everything). · **R1 delta (2026-10-02) at the top — read it first**

## R1 delta (2026-10-02) — endpoints that exist now

The guard pipeline (§2), conventions (§1) and the Phase 1 auth/account endpoints are unchanged. Full list with access levels: [`../r1/README.md`](../r1/README.md) §1; rules: [11-redesign-spec.md](./11-redesign-spec.md) §8.

**Removed from the plan:** catalog search, TMDB lookups, `catalog/packages`, YouTube resolve, admin `catalog/tv/*`, `packages/*`, `catalog-rules`, `/patrocinar` with tabs.

**Pages:** `/` Filmes (hero carousel) · `/series` · `/franquias` · `/filmes/[slug]` · `/series/[slug]` · `/franquias/[slug]` · `/avaliacoes` (shell until Phase 3) · `/perfil` (sign-in **and** account; `/entrar`, `/conta` → 301) · `/perfil/sessoes` · `/perfil/seguranca` (passkeys, MODERATOR+) · `/admin/catalogo` · `/media-kit`, `/contato`, legal pages.

| Method · path | A | Notes |
|---|---|---|
| `GET /api/v1/catalog/[kind]` · `GET /api/v1/catalog/[kind]/[slug]` | P | `kind` = `movies` \| `series` \| `franchises`; live items in slot order |
| `GET /api/v1/campaigns/[id]` | P (C 5 s) | progress |
| `GET`/`POST /api/v1/admin/catalog/items` · `GET`/`PATCH`/`DELETE …/[id]` | M + passkey | PATCH needs `expectedVersion` (409 when stale); DELETE only for drafts that never went live |
| `POST …/items/[id]/publish` · `…/replace` · `…/watched` · `…/revert` · `GET …/revisions` | M + passkey | publish enforces 35/10/10 (409); replace archives and frees the slot |
| `PUT /api/v1/admin/catalog/slots` | M + passkey | whole reorder/swap in one transaction |
| `POST /api/v1/admin/media?role=POSTER\|BACKDROP\|LOGO` | M + passkey | **raw image body** (not multipart), ≤ 10 MB; 201 new / 200 deduplicated |
| `POST /api/v1/admin/campaigns/[itemId]/open` · `…/extend` · `…/goal` | S↑ + passkey | `[itemId]` is the catalogue item; goal/deadline changes audited |
| `GET /api/v1/me/passkeys` · `DELETE …/[id]` · `POST …/registration/options`, `…/registration`, `…/authentication/options`, `…/authentication` | M | WebAuthn enrol/verify; verification stamps the session (10 min) |
| `GET /media/[file]` | P | development only (nginx serves `/media/` in production) |

**Step-up in R1:** every MODERATOR/STREAMER admin call needs a passkey assertion ≤ 10 min (401 `PASSKEY_ENROLL_REQUIRED` / `PASSKEY_REQUIRED`); STREAMER money actions additionally need Google re-auth ≤ 10 min (`stepUpUrl`). Checkout endpoints (`orders/*`, `campaigns/[id]/contributions`, SSE events, `…/schedule`) arrive in Phase 2.

---

*The sections below are the Phase 0 baseline (rev 3); where they differ from the R1 delta above, the delta wins.*

## 1. Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1/*` (JSON), `/api/auth/*` (OIDC redirects), `/api/webhooks/*` (provider callbacks), `/api/csp-report`, `/api/health`. |
| Content type | Requests `application/json` only (415 otherwise; webhook + CSP report have their own allow-lists). Max body 16 KB (32 KB for admin pricing). |
| Errors | RFC 9457 `application/problem+json`: `{ type, title, status, code, detail, errors? }`. `detail` in pt-BR. Never echoes input back unescaped; never includes stack traces. |
| Pagination | Cursor-based: `?cursor=<opaque>&limit=20` (max 50) → `{ items, nextCursor }`. |
| Idempotency | `Idempotency-Key: <uuid>` **required** on `POST /sponsorships` and admin refunds; optional elsewhere. Same key + same buyer (user id or contact e-mail) → same response (stored 24 h). |
| Caching | `Cache-Control: private, no-store` on all authenticated/dynamic responses; public read endpoints `public, max-age=5..60` only where marked **(C)**. |
| Auth | Session cookie `__Host-wf_session` (HttpOnly, Secure, SameSite=Lax, Path=/). Guests reach their own order through `__Host-wf_order` (see §5.3). No bearer tokens for browsers. |
| Time & money | ISO-8601 UTC strings; money as integer `…Cents` fields + `currency: "BRL"`. |

## 2. Guard pipeline (every handler is wrapped; order matters)

```
requestId → method allow-list → body size/content-type → [webhook: signature]
→ rate limit (IP, then user) → session load → CSRF (mutations) → Turnstile (where marked)
→ RBAC / ownership → Zod parse (.strict) → handler → audit (admin/sensitive) → problem+json mapping
```

**CSRF on mutations** (`POST/PUT/PATCH/DELETE`, except webhook + CSP report): (1) `Sec-Fetch-Site` must be `same-origin` when present; (2) `Origin` must equal the canonical origin (exact match, no suffix logic); (3) `x-csrf-token` header must equal `HMAC(sessionId, CSRF_SECRET)` — rendered into a `<meta>` by the root layout and attached by the single `apiFetch()` client. Plus `SameSite=Lax` on the session cookie. Anonymous mutations (quote, guest checkout, contact, overlay session, order-access exchange) have no session to bind a token to, so they get checks (1) + (2), plus Turnstile and an `Idempotency-Key` where marked. Guest mutations on an existing order (cancel unpaid) bind the token to the order cookie instead: `HMAC(orderCookieId, CSRF_SECRET)`.

## 3. Roles

| Capability | Public | USER | MODERATOR | STREAMER |
|---|:-:|:-:|:-:|:-:|
| Browse catalog, queue, reviews, profiles, media kit | ✅ | ✅ | ✅ | ✅ |
| Contact form | ✅ | ✅ | ✅ | ✅ |
| Sponsor (guest checkout — no login needed), view/cancel own unpaid order | ✅ (order link) | ✅ | ✅ | ✅ |
| 10 % perk (needs login): MODERATOR/STREAMER, or USER flagged VIP | | VIP only | ✅ | ✅ |
| Reschedule own sponsorship; attach a guest order to the account | | ✅ | ✅ | ✅ |
| Write/edit/delete own review, like, report | | ✅ | ✅ | ✅ |
| Moderation queue: hide/restore reviews, dismiss reports, approve sponsor messages | | | ✅ | ✅ |
| Suspend users (≤ 7 days) | | | ✅ | ✅ |
| Remove reviews permanently, ban/suspend > 7 days | | | | ✅ |
| Manage sessions/schedule, mark watching/completed; build series/anime packages; approve guest display names | | | ✅ | ✅ |
| Prices, add-ons, queue-jump tiers & caps, catalog rules, vouchers, goals, package price overrides, VIP flag | | | | ✅ (step-up) |
| Exception refunds, role changes, overlay keys, settings, audit log | | | | ✅ (step-up) |

**Step-up** = session `authTime` ≤ 10 min (forces `prompt=login&max_age=600` re-auth with Google) **and** a passkey assertion ≤ 10 min (required for STREAMER, optional for moderators — Q17 default). RBAC is enforced server-side in the handler wrapper (`requireRole`, `requireOwner`) — the admin UI hiding buttons is cosmetic only. Unauthorized access to another user's resource returns **404** (not 403) to avoid existence leaks.

## 4. Pages (pt-BR routes)

| Route | Access | Notes |
|---|---|---|
| `/` | public | hero, current/next sponsorship, goals, CTA |
| `/patrocinar` | public (no login needed) | tabs: Filmes (TMDB search) · Séries & Animes (admin-built season packages) · YouTube (hidden while the kind is disabled); live price breakdown; TMDB attribution block |
| `/patrocinar/pedido/[code]` | owner session, or order link `#t=<token>` | Pix QR (image + copia-e-cola), countdown, live status; "Vincular à minha conta" for guests |
| `/fila` | public | upcoming sessions and queue (sponsor names per opt-in) |
| `/titulos/[slug]` | public | title page + reviews (if watched on stream) |
| `/avaliacoes` | public | latest reviews, watched titles |
| `/u/[username]` | public | profile, avatar, reviews |
| `/entrar`, `/bem-vindo` | public / new user | login; onboarding (username + avatar) |
| `/conta`, `/conta/patrocinios`, `/conta/sessoes`, `/conta/dados` | user | profile, my sponsorships (reschedule), active sessions, LGPD export/delete |
| `/midia-kit` | public | live stats + contact form |
| `/termos`, `/privacidade`, `/reembolso` | public | versioned legal texts |
| `/admin/**` | MODERATOR+ | dashboard, sponsorships, schedule, moderation, pricing, catalog rules, vouchers, goals, users, overlay keys, stats, contact inbox, audit log, settings |
| `/overlay/[widget]` | overlay key (fragment) | transparent background, no navigation chrome |

## 5. Endpoints

Legend: **A** = auth (P public, U user, M moderator, S streamer, S↑ streamer + step-up, O overlay cookie, H HMAC) · **CSRF** · **TS** = Turnstile · **RL** = rate limit (per IP / per user; see 05 §9) · **(C)** = cacheable.

### 5.1 Auth & account

| Method | Path | A | CSRF | TS | Purpose |
|---|---|---|---|---|---|
| GET | `/api/auth/google/start?returnTo=` | P | – | – | start OIDC (state, nonce, PKCE S256) |
| GET | `/api/auth/google/callback` | P | state | – | finish OIDC, create session |
| POST | `/api/auth/logout` | U | ✅ | – | revoke current session |
| GET | `/api/v1/me` | U | – | – | profile, role, onboarding state, csrf token |
| POST | `/api/v1/me/onboarding` | U | ✅ | – | `{username, avatarKey}` once |
| PATCH | `/api/v1/me/profile` | U | ✅ | – | change avatar; username (1× per 30 days) |
| GET | `/api/v1/usernames/availability?u=` | U | – | – | RL tight; returns `{available}` only |
| GET | `/api/v1/me/sessions` · DELETE `/api/v1/me/sessions/[id]` | U | ✅(del) | – | list / revoke sessions |
| GET | `/api/v1/me/export` | U | – | – | LGPD data export (JSON), RL 1/day |
| POST | `/api/v1/me/delete` | U (fresh auth) | ✅ | – | LGPD erasure request (anonymise) |

### 5.2 Catalog

| Method | Path | A | Purpose |
|---|---|---|---|
| GET | `/api/v1/catalog/movies/search?q=&page=` | P (C 60 s) | TMDB movie search via server, cached 6 h in Redis; `include_adult=false`; catalog rules applied; minimal fields |
| GET | `/api/v1/catalog/movies/[tmdbId]` | P (C) | details + runtime + eligibility |
| GET | `/api/v1/catalog/packages?q=&kind=series\|anime&cursor=` | P (C 60 s) | active admin-built packages (Postgres search, `unaccent`), with title snapshot + runtime |
| POST | `/api/v1/catalog/youtube/resolve` | P, Origin check | `{url}` → extract 11-char id by strict regex (no server-side fetch of the URL), then YouTube Data API `videos.list` (1 quota unit); RL per IP. **Off for now**: returns 404 while YOUTUBE is disabled in the active price rules |

Series/anime are **not** searchable by viewers on TMDB; only packages built in Admin are sponsorable (§5.6).

**TMDB licence gate:** development uses a free TMDB key; production uses TMDB only after the commercial licence is in place. The `TMDB_LICENSED=true` env flag is required for `NODE_ENV=production` to boot with TMDB enabled.

### 5.3 Sponsorships & payments

| Method | Path | A | CSRF | TS | Purpose |
|---|---|---|---|---|---|
| POST | `/api/v1/sponsorships/quote` | P* | Origin check | – | live price breakdown; side-effect free, nothing stored. *Moderator/VIP perk only when logged in. |
| POST | `/api/v1/sponsorships` | P (guest) or U | ✅ (U) / Origin (guest) | ✅ | create order + MP Pix. Body: selection, `contactEmail` (guests; users default to their Google e-mail), optional `displayName` (guests), legal versions, `expectedTotalCents`. Requires `Idempotency-Key`. Returns `{publicCode, accessToken (once), qrCode, qrCodeBase64, expiresAt}` and sets `__Host-wf_order` |
| POST | `/api/v1/sponsorships/[code]/access` | P | Origin check | – | `{token}` from the order link fragment → adds that order to the sealed `__Host-wf_order` cookie (HttpOnly, SameSite=Strict, 30 days, ≤ 10 orders). RL tight; constant-time compare against `accessTokenHash` |
| GET | `/api/v1/sponsorships/[code]` | owner session / order cookie / M | – | – | status, breakdown, Pix payload while pending |
| GET | `/api/v1/sponsorships/[code]/events` | owner session / order cookie | – | – | SSE: `status` events; polling fallback = GET above every 4 s |
| POST | `/api/v1/sponsorships/[code]/cancel` | owner session / order cookie | ✅ | – | only `PENDING_PAYMENT` → cancels MP payment |
| POST | `/api/v1/sponsorships/[code]/claim` | U + order cookie | ✅ | – | attach a guest order to the logged-in account (needed to reschedule) |
| POST | `/api/v1/sponsorships/[code]/reschedule` | U (owner) | ✅ | – | `{sessionId}`; rules in 04 §7 |
| GET | `/api/v1/me/sponsorships` | U | – | – | my orders |
| GET | `/api/v1/sessions?from=&to=` | P (C 30 s) | – | – | upcoming sessions + free capacity |
| GET | `/api/v1/queue` | P (C 5 s) | – | – | public queue (titles, sponsor display names if opted in) |
| GET | `/api/v1/legal/current` | P (C) | – | – | current versions + hashes of terms/privacy/refund |
| POST | `/api/webhooks/mercadopago` | H | – | – | see 05 §6; always fast 200 after verify+enqueue; 401 on bad signature |

### 5.4 Reviews & profiles

| Method | Path | A | CSRF | TS | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/titles/[id]/reviews?sort=recent\|top&cursor=` | P (C 30 s) | – | – | visible reviews; spoilers flagged |
| POST | `/api/v1/titles/[id]/reviews` | U | ✅ | ✅ | `{rating 1-5, body ≤ 2000, containsSpoilers}`; only if title has a WatchEvent; one per user/title |
| PATCH | `/api/v1/reviews/[id]` | owner | ✅ | – | edit (sets `editedAt`) |
| DELETE | `/api/v1/reviews/[id]` | owner / M | ✅ | – | delete own / moderator remove |
| PUT · DELETE | `/api/v1/reviews/[id]/like` | U | ✅ | – | idempotent like/unlike; cannot like own review |
| POST | `/api/v1/reviews/[id]/reports` | U | ✅ | – | `{reason, note?}`; one per user/review; account age ≥ 24 h |
| GET | `/api/v1/users/[username]` · `/reviews?cursor=` | P (C 60 s) | – | – | public profile (username, avatar, joined month, reviews) — never e-mail |

### 5.5 Media kit, overlays, security endpoints

| Method | Path | A | CSRF | TS | Purpose |
|---|---|---|---|---|---|
| GET | `/api/v1/stats` | P (C 60 s) | – | – | platform stats from cache → last-known-good → manual |
| POST | `/api/v1/contact` | P | Origin check | ✅ | `{name, email, company?, subject, body, website(honeypot)}` + min-fill-time check |
| POST | `/api/v1/overlay/session` | P (key in body) | Origin check | – | exchange overlay key → `__Host-wf_overlay` cookie |
| GET | `/api/v1/overlay/stream?widget=` | O | – | – | SSE: `now-playing`, `queue`, `goal`, `new-sponsorship` |
| POST | `/api/csp-report` | P | – | – | `application/reports+json` and legacy `application/csp-report`; 8 KB max; sampled logging |
| GET | `/api/health` | P | – | – | liveness (no dependency details); readiness at `/api/ready` reachable only from the Docker network (nginx `deny all` externally) |

### 5.6 Admin (`/api/v1/admin/*`, all CSRF-protected, all audited)

| Resource | Methods | Role |
|---|---|---|
| `sponsorships` (list/filter/detail), `…/[id]/status` (schedule, watching, completed), `…/[id]/reschedule`, `…/[id]/message` and `…/[id]/display-name` (approve/reject) | GET, POST | M |
| `…/[id]/refund` (exception tool: duplicate / processing error / legal requirement; `Idempotency-Key`), `…/[id]/cancel` | POST | S↑ |
| `catalog/tv/search?q=`, `catalog/tv/[tmdbId]`, `catalog/tv/[tmdbId]/season/[n]` (TMDB lookups for the package builder) | GET | M |
| `packages` (create from a whole season — runtime and episode count read from TMDB server-side; activate/deactivate; reorder) | GET, POST, PATCH | M |
| `packages/[id]/price` (per-package price override with mandatory reason; clear to return to the per-season price) | PATCH | S↑ |
| `sessions` | GET, POST, PATCH, DELETE | M (create/edit), S (delete) |
| `watch-events` | POST, DELETE | M |
| `moderation/reports`, `moderation/reviews/[id]` (hide/restore/remove) | GET, POST | M (remove: S) |
| `users`, `users/[id]/suspend`, `users/[id]/role`, `users/[id]/vip` | GET, POST | M (suspend ≤ 7 d) · S↑ (role, ban, VIP) |
| `pricing/rule-sets` (list, draft CRUD, `…/[id]/publish`, `…/preview` with sample inputs) | GET, POST, PATCH | S↑ |
| `catalog-rules`, `vouchers`, `goals`, `settings` | GET, POST, PATCH, DELETE | S↑ (goals: S) |
| `overlay-keys` (create returns raw key once, revoke) | GET, POST, DELETE | S↑ |
| `stats` (manual overrides, force refresh) | GET, PATCH, POST | S |
| `contact` (inbox, mark read/spam, delete) | GET, PATCH, DELETE | S |
| `audit-log?cursor=&action=&actor=` (read-only, CSV export) | GET | S |

## 6. Realtime events (SSE payloads — JSON, schema-validated before publish)

```ts
type OrderEvent   = { type: 'status'; code: string; status: SponsorshipStatus; paymentStatus: PaymentStatus; at: string };
// sponsor = approved username/guest display name, or "Anônimo" (null) — never an e-mail
type OverlayEvent =
  | { type: 'now-playing'; title: string; kind: MediaKind; sponsor: string | null; message: string | null }
  | { type: 'queue'; items: { title: string; sponsor: string | null; jumped: boolean }[] }   // max 10
  | { type: 'goal'; title: string; current: number; target: number; metric: GoalMetric }
  | { type: 'new-sponsorship'; title: string; sponsor: string | null };
```

All strings in overlay payloads are passed through the same sanitizer as reviews (plain text, NFC, control/bidi chars stripped, length-capped) **before** publishing, and rendered as text nodes on the overlay page.
