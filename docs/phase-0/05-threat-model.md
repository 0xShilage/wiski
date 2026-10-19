# 05 — Threat model and security controls

> Status: **rev 3** (guest checkout, VIP perk, season packages, no refunds, origin `wiski.fun`) · Method: asset/actor inventory → trust boundaries → STRIDE per element → abuse cases → controls mapped to files and tests. Controls marked **[P1]…[P5]** land in that phase. · **R1 delta (2026-10-02) at the top — read it first**

## R1 delta (2026-10-02) — new surface and its controls

R1 removed TMDB/YouTube Data API calls (no outbound catalogue requests at all) and added image uploads, a homepage editable by moderators, and trailer embeds. Details and tests: [`../r1/README.md`](../r1/README.md) §4 and [`../r1/test-report.md`](../r1/test-report.md); threats listed in [11-redesign-spec.md](./11-redesign-spec.md) §9.

| Element | Threat | Control (R1) | Where · test |
|---|---|---|---|
| Image upload | **T/E** HTML/SVG/polyglot XSS, decompression bomb, EXIF location leak, path traversal, disk filling | session + role + CSRF + passkey checked before the body is read; raw body (no multipart, no file names); bytes decide the format (JPEG/PNG/WebP/AVIF only); `sharp` 40 MP limit, auto-rotate, metadata stripped, re-encoded to AVIF + WebP under `<sha256-128>-<w>` names; temp file always removed; 20 uploads / 10 min per user and IP | `src/server/media/*` · `media.test.ts` (fuzz corpus) |
| `/media/` | **T/I** content sniffing, script execution, traversal | static from `MEDIA_DIR` via nginx only; name allow-list regex → 404 otherwise; GET only; `nosniff`, `CSP: default-src 'none'; frame-ancestors 'none'; sandbox`, immutable cache | `docker/nginx/snippets/media.conf` · `headers.spec.ts` |
| Upload endpoint | **D** large/slow bodies | only location with `client_max_body_size 11m`; body buffered to disk by nginx; own `limit_req` 2 r/min per IP (burst 2); app re-checks size while streaming | `upload.conf` · `headers.spec.ts`, `media.test.ts` |
| Admin | **S/E** stolen moderator/streamer session defacing the homepage | **passkey required for MODERATOR and STREAMER** (UV required, RP ID/origin pinned, single-use 5-min challenges, counter regression rejected, `mfaAt` ≤ 10 min); STREAMER money actions also need Google step-up; revisions + one-click revert; every write audited | `src/server/auth/passkeys.ts` · `passkeys.test.ts`, `dashboard.spec.ts` |
| Catalogue | **T** lost updates between moderators | `expectedVersion` on every change → 409, editor reloads; full snapshot per revision | `catalog.test.ts`, `dashboard.spec.ts` |
| | **T** over-filling the homepage / slot races | 35/10/10 in a DB trigger under an advisory lock; deferred exclusion constraint per `(kind, slot)` | `db-constraints-r1.test.ts` |
| Admin-entered text | **T/E** stored XSS, bidi spoofing | sanitiser (controls, bidi, zero-width removed; code-point limits) + React text nodes; no `style=`/`dangerouslySetInnerHTML` | `catalog-lib.test.ts`, `csp.spec.ts` |
| Trailer embed | **I** third-party tracking; **T** framing abuse | only the 11-char id stored; `youtube-nocookie.com` iframe created on click and destroyed on close; `frame-src` and Permissions-Policy (`autoplay`, `encrypted-media`, `fullscreen`, `picture-in-picture`) allow that origin only | `carousel.spec.ts` (0 CSP violations with the player open) |
| Movie/campaign money (Phase 2 ready) | **T** two buyers for one movie, overfunding | partial unique `order_one_active_movie`; `camp_remaining` CHECK | `db-constraints-r1.test.ts` |

**Header changes (§7):** CSP `frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com`; Permissions-Policy adds `autoplay`, `encrypted-media`, `fullscreen`, `picture-in-picture` = `(self "https://www.youtube-nocookie.com")`; `/media/` has its own CSP + cache (above). Each header is still present exactly once (`headers.spec.ts`).

**Residual risk 5 (TMDB licence) no longer applies** — TMDB is out of the product. New residual risk: a moderator with a stolen session **and** their unlocked device (passkey) can still edit the homepage until revoked; revert and the audit log bound the damage.

---

*The sections below are the Phase 0 baseline (rev 3); where they differ from the R1 delta above, the delta wins.*

## 1. Scope and assumptions

- In scope: everything in 01–04 (web, worker, nginx, Postgres, Redis, Docker host, Cloudflare config, CI).
- Assumptions: Cloudflare proxies all public traffic (orange cloud) and the origin IP is never published; one VPS; the streamer and moderators log in with personal Google accounts; Mercado Pago (MP) account already verified for Pix; **buyers may check out as guests** (no login), so a buyer is identified by user id *or* by contact e-mail + an order access token.
- Out of scope: Google/MP/Cloudflare internal security, the streamer's own devices, LivePix/StreamElements (not integrated).

## 2. Assets (what an attacker wants)

| # | Asset | Impact if compromised |
|---|---|---|
| A1 | MP access token, webhook secret | Fake "paid" orders, refunds to self, reading payment data |
| A2 | Payment state (who paid, how much) | Free sponsorships, revenue loss, chargeback disputes |
| A3 | Price rules, vouchers, queue-jump caps | Under-pricing, voucher abuse, queue manipulation |
| A4 | Streamer/moderator sessions | Full admin: prices, refunds, roles, audit read |
| A5 | User PII (e-mail, Google `sub`, guest contact e-mails, IP hashes, contact messages) | LGPD incident (ANPD notification), reputation |
| A6 | Pix QR shown to buyers | **QR swap → buyer pays the attacker** |
| A6b | Guest order access tokens | Viewing someone's order / cancelling their unpaid Pix / claiming it into another account |
| A7 | Overlay channel | Arbitrary text/images live on stream (reputational, ToS) |
| A8 | Reviews/likes integrity | Brigading, defamation, spam |
| A9 | Availability (site, checkout, overlays during live) | Lost sales, broken stream |
| A10 | Audit log | Covering tracks after admin abuse |

## 3. Actors

Anonymous visitor · logged-in viewer (possibly malicious, possibly many Google accounts) · moderator (trusted-but-limited, could be compromised or rogue) · streamer (highest privilege) · MP (trusted webhook sender, but its HTTP channel is not) · automated bots / scrapers / card-testing-style fraud (Pix makes card testing moot) · DDoS botnets · supply-chain attacker (malicious npm package/Action) · someone watching the stream (sees anything shown on screen, e.g. overlay URL).

## 4. Trust boundaries

```
[Internet] ─TB1─ [Cloudflare] ─TB2 (mTLS AOP)─ [nginx] ─TB3─ [web/worker] ─TB4─ [Postgres/Redis]
                                                              └─TB5─ [Google · MP · TMDB · YouTube · stats · e-mail]
[MP] ─TB6 (HMAC)─ webhook path       [OBS] ─TB7 (overlay key→cookie)─ SSE       [Admin] ─TB8 (role + step-up)─ /admin
```

## 5. STRIDE by element

| Element | Threat | Control | Phase · file |
|---|---|---|---|
| Google login | **S** OAuth CSRF / login CSRF | `state` (256-bit, sealed cookie, one-time), `SameSite=Lax` cookie | P1 · `src/server/auth/oidc.ts` |
| | **S** code interception | PKCE S256 | P1 |
| | **S** ID-token replay / mix-up | `nonce` check; `iss`, `aud`, `exp`, `iat` skew ≤ 5 min; JWKS from discovery, cached | P1 |
| | **E** account linking by e-mail | identity = `sub` only; require `email_verified`; e-mail never used for lookup | P1 |
| | **T** open redirect via `returnTo` | relative-path allow-list (`^/(?!/)…`), stored inside sealed cookie | P1 |
| Sessions | **S** theft / fixation | 256-bit random token, only SHA-256 in DB, `__Host-` HttpOnly Secure; rotate on login and role change; idle + absolute expiry; list/revoke in `/conta/sessoes`; all sessions revoked on role change/suspension | P1 · `src/server/auth/session.ts` |
| Mutations | **T** CSRF | SameSite=Lax + `Sec-Fetch-Site` + exact `Origin` + per-session HMAC token header | P1 · `src/server/security/csrf.ts` |
| Admin | **E** broken access control / IDOR | server-side `requireRole`/`requireOwner` in the route wrapper; 404 on foreign resources; authz test matrix (every route × every role) | P1/P4 · `src/server/rbac/*`, `tests/integration/authz.spec.ts` |
| | **E** stolen streamer session | step-up re-auth (`max_age=600`) for prices/refunds/roles/keys; passkey second factor required for STREAMER (Q17); admin sessions idle 8 h / absolute 24 h | P4 |
| | **R** admin denies an action | append-only audit log with hash chain; DB grants forbid UPDATE/DELETE | P1 (table) / P4 (UI) |
| Price engine | **T** client price tampering | client never sends prices; `.strict()` Zod; recompute at order creation; `expectedTotalCents` only for 409 | P2 · `src/server/pricing/*` |
| | **T** race on caps/vouchers | unique-index slot allocation; conditional `updateMany` for vouchers and session capacity; integration tests with 50 parallel requests | P2 |
| | **D** cap exhaustion (reserve all queue-jump slots with unpaid Pix — easier now that guests can check out) | Turnstile on every create; max 1 pending order per buyer (user id or normalised e-mail) and 2 per IP (/64); 30-min Pix expiry + 5-min grace; per-buyer daily jump cap; RL on create; Admin can release a reservation manually | P2 |
| Guest checkout | **S/I** order-link token theft or guessing | 256-bit random token, only SHA-256 stored, constant-time compare; token travels in the URL **fragment** (never sent to servers/logs/Referer) and is exchanged once for `__Host-wf_order` (HttpOnly, SameSite=Strict, scoped to that order); RL on the exchange endpoint; `publicCode` alone grants nothing | P2 |
| | **T** claiming someone else's order | claim requires login **and** the order cookie/token; claimed orders can't be re-claimed; audited | P2 |
| | **D/R** e-mail bombing third parties via receipts | receipts are sent **only after the payment is approved** (an attacker would have to pay); no e-mail on order creation; per-address send cap | P2 |
| | **T** offensive guest display names on stream | guest names shown publicly only after moderator approval, otherwise "Anônimo"; same sanitizer + length cap | P2/P4 |
| | **E** perk spoofing (claiming VIP/moderator discount as guest) | perks read from the DB for the logged-in session only; request fields for discounts rejected by `.strict()` | P2 |
| Pix display | **T** QR swap (A6) | QR payload only from our server (never from URL/query); `qr_code_base64` validated (strict base64 charset, decodes to PNG magic bytes, ≤ 64 KB) and rendered as `<img src="data:image/png;base64,…">`; copia-e-cola shown as text; page tells buyer to confirm the **recipient name** in their bank app before paying; strict CSP blocks injected scripts | P2 · `src/app/patrocinar/pedido/[code]` |
| Webhook | **S** forged notification | HMAC-SHA256 over the MP manifest, constant-time compare, secret rotation (current + previous) | P2 · see §6 |
| | **R/T** replay | timestamp tolerance + Redis `SET NX` on `x-request-id` + unique `WebhookEvent.requestId`; replays are harmless anyway (state re-fetched) | P2 |
| | **T** spoofed body data | body ignored except for routing; payment re-fetched from MP API; amount/currency/method/external_reference/collector/live_mode verified | P2 |
| | **D** flood | nginx body ≤ 16 KB + RL; signature check is O(1) before any DB/MP call; fast 200 | P2/P5 |
| Catalog | **I/E** SSRF via YouTube URL | never fetch user URLs; extract 11-char id with strict regex; call fixed Google endpoint | P2 |
| | **I** API key leakage | TMDB/YouTube keys server-only; CI greps client bundle for secret values | P1/P5 |
| Reviews/profiles | **T/E** stored XSS (incl. in admin moderation queue) | plain-text model; server sanitizer (§8); React text nodes; `dangerouslySetInnerHTML` banned by lint (zero uses); strict CSP as backstop | P3 |
| | **S** impersonation via username | ASCII `[a-z0-9_]` only (no homoglyphs), reserved list (admin, moderador, wiskiflix, suporte…), 30-day hold of released names | P1 |
| | **T** brigading/like farming | 1 like per user per review (PK), account age ≥ 24 h to report, RL, auto-hide at 3 reports from distinct accounts ≥ 7 days old, anomaly query in admin | P3 |
| Overlay | **S/T** unauthorized overlay / injection on stream (A7) | key in URL fragment → exchanged for `__Host-` cookie; keys hashed, per-widget scope, revocable, rotate from admin; overlay is read-only; payloads sanitized; sponsor messages require approval (Q10) | P4 |
| Contact form | **D/T** spam, header injection | Turnstile + honeypot + min fill time + RL; e-mail sent as plain text via provider API (no SMTP header assembly from input); `Reply-To` validated address only | P4 |
| Media kit stats | **D** third-party API down | cache → last-known-good → manual override | P4 |
| nginx/app | **T** Host header / cache poisoning | `server_name` exact, `default_server` returns 444; app uses a configured canonical origin (never `Host`) for absolute URLs; HTML/API never cached at CF | P5 |
| | **T** request smuggling | nginx current stable, `proxy_http_version 1.1`, no ambiguous `Transfer-Encoding` passthrough, CF in front | P5 |
| Data stores | **I** DB/Redis exposure | internal Docker network only, no host ports; Redis ACL user without admin commands; Postgres roles: `wf_migrator` (DDL), `wf_app` (DML, audit INSERT/SELECT only) | P5 |
| Supply chain | **T/E** malicious dependency | lockfile + `npm ci`, `npm audit --audit-level=high` gate, Dependabot (npm, Docker, Actions), Actions pinned by SHA, CodeQL, gitleaks, SBOM; minimal deps policy | P1/P5 |
| Logs | **I** PII/payment data in logs | pino redaction list; IP only as keyed HMAC; no Pix payloads; 30-day retention | P1 |

## 6. Mercado Pago webhook — normative handler spec

```
POST /api/webhooks/mercadopago?data.id=<id>&type=payment
Headers: x-signature: ts=<ts>,v1=<hex>   x-request-id: <uuid>
```

1. **Envelope**: method POST, `content-type` JSON, body ≤ 16 KB, query `type` ∈ {`payment`} (others → 200 `IGNORED`, logged).
2. **Parse** `x-signature` by splitting on `,` then `=`; require exactly one `ts` and one `v1` (hex, 64 chars). Missing/malformed → **401**.
3. **Manifest** (MP documented template): `id:{data.id};request-id:{x-request-id};ts:{ts};` — `data.id` taken from the **query string**, lower-cased if alphanumeric; if a component is absent it is omitted from the manifest exactly as MP specifies.
4. **HMAC**: `hex(HMAC_SHA256(MP_WEBHOOK_SECRET, manifest))`; compare with `crypto.timingSafeEqual` on equal-length buffers; try `MP_WEBHOOK_SECRET_PREVIOUS` during rotation. Mismatch → **401** + security event (no detail in response).
5. **Freshness**: normalise `ts` (MP docs show millisecond values; accept seconds or ms by magnitude) and require `|now − ts| ≤ 10 min` (configurable). Stale → **401**. Missed events are recovered by reconciliation, so a strict window costs nothing.
6. **Replay**: `SET mpwh:{x-request-id} 1 NX EX 86400` — already set → **200** `DUPLICATE` (MP must stop retrying).
7. **Persist + enqueue**: insert `WebhookEvent` (unique `requestId`), enqueue BullMQ `payment.sync` with `jobId = pay:{data.id}` (bursts coalesce), respond **200**. Target p99 < 100 ms; MP's documented limit is 22 s.
8. **Worker `payment.sync`**: `GET /v1/payments/{id}` → verify `external_reference` = our sponsorship id **and** our stored `providerPaymentId` = id; `round(transaction_amount × 100) == amountCents`; `currency_id == "BRL"`; `payment_method_id == "pix"`; `collector_id == MP_COLLECTOR_ID`; `live_mode` matches env. Any mismatch → `NEEDS_ATTENTION` + alert, never `PAID`.
9. **State machine** (idempotent; unique `providerPaymentId`):
   `PENDING → APPROVED | REJECTED | CANCELLED | (expired)`, `APPROVED → REFUNDED | CHARGED_BACK | IN_MEDIATION`, never backwards. Apply only if `date_last_updated ≥ providerUpdatedAt` **and** optimistic `version` matches (concurrent workers can't regress state). Same state again → no-op.
10. **Side effects in the same transaction**: sponsorship `PAID` (or `NEEDS_ATTENTION` for late approval after expiry), slot/voucher `CONSUMED`, audit row; after commit: `PUBLISH` realtime events.
11. **Reconciliation**: every 2 min for stale `PENDING`; on expiry (+ grace) mark `EXPIRED`, release slot/voucher; nightly 48 h sweep.

Tests (Phase 2): bad signature, wrong secret, truncated `v1`, missing headers, uppercase id, stale/future `ts`, replayed `x-request-id`, duplicate deliveries (10× parallel), out-of-order (approved then pending), amount mismatch, foreign payment id, late approval after expiry, MP API 5xx/timeout (retry with backoff), unknown `type`.

## 7. HTTP security headers — ownership and checklist

**Rule: every header has exactly one owner.** nginx strips any upstream copy of the headers it owns (`proxy_hide_header X;` before `add_header X … always;`) so duplicates are impossible even if a library adds one. All nginx headers live in one snippet included in **every** `location` that uses `add_header` (avoids nginx's add_header inheritance trap). Cloudflare **Managed Transforms → "Add security headers" OFF** and Cloudflare HSTS **OFF** (origin owns HSTS) to avoid a third writer.

| Header | Value | Owner | Implemented in | Verified by |
|---|---|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-{N}' 'strict-dynamic'; style-src 'self' 'nonce-{N}'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; manifest-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests; report-to csp; report-uri /api/csp-report` | **App** (needs per-request nonce) | `src/proxy.ts`, `src/server/security/csp.ts` | `tests/e2e/csp.spec.ts` (nonce unique per request, zero violations on every page), `tests/unit/csp.spec.ts` |
| `Content-Security-Policy-Report-Only` | `require-trusted-types-for 'script'; report-to csp` (trial only; policy names allow-listed and moved to enforcing CSP if reports stay clean) | **App** | same | CSP report dashboard |
| `Reporting-Endpoints` | `csp="https://wiski.fun/api/csp-report"` | **App** | `src/proxy.ts` | e2e |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | **nginx** | `docker/nginx/snippets/security-headers.conf` | `scripts/check-headers.sh`, hstspreload.org |
| `X-Frame-Options` | `DENY` (legacy fallback; same policy as `frame-ancestors 'none'`) | **nginx** | snippet | check-headers |
| `X-Content-Type-Options` | `nosniff` | **nginx** | snippet | check-headers |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | **nginx** | snippet | check-headers |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=(), clipboard-write=(self), fullscreen=(self)` | **nginx** | snippet | check-headers |
| `Cross-Origin-Opener-Policy` | `same-origin` | **nginx** | snippet | check-headers |
| `Cross-Origin-Resource-Policy` | `same-origin` | **nginx** | snippet | check-headers |
| `Cache-Control` (static) | `public, max-age=31536000, immutable` | **nginx** (`/_next/static`, `/brand`, `/fonts`) | `docker/nginx/conf.d/wiskiflix.conf` | check-headers |
| `Cache-Control` (dynamic) | `private, no-store` | **App** | route wrapper + `next.config.ts` headers | integration tests |
| `Server` / `X-Powered-By` | removed (`server_tokens off`; `poweredByHeader: false`) | nginx / App | conf / `next.config.ts` | check-headers |
| Cookies | `__Host-wf_session` (HttpOnly; Secure; Path=/; SameSite=Lax), `__Host-wf_oauth` (sealed AES-256-GCM, Lax, 10 min), `__Host-wf_overlay` (Strict, 12 h), `__Host-wf_order` (guest order access; Strict, 30 days; sealed list of ≤ 10 order ids). No Domain attribute. No third-party/analytics cookies. | **App** | `src/server/auth/cookies.ts` | `tests/integration/cookies.spec.ts` |

`check-headers.sh` asserts **each header appears exactly once** on `/`, an API route, a static asset, a 404 and the overlay page; CI runs it against the Compose stack, and it is run against production after deploy together with MDN HTTP Observatory and SSL Labs.

**CSP gotchas handled in Phase 1:** (1) nonces don't cover `style="…"` attributes, so SSR must emit **no inline style attributes** — `style` props are linted out of server components and `next/image` is wrapped (via `getImageProps`) to drop its default inline style in favour of classes; (2) brand SVGs exported from Illustrator contain `<style>` blocks — converted at build time to presentation attributes (lossless, pixel-diff verified, see 06 §5); (3) Cloudflare features that inject scripts (Rocket Loader, Email Obfuscation, Zaraz, Web Analytics auto-inject) must stay off; (4) dev mode adds `'unsafe-eval'` only when `NODE_ENV=development`; (5) "Entrar com Google" is a plain link, not a form, because `form-action 'self'` would also block a form's redirect to `accounts.google.com`.

## 8. Input handling and XSS

1. Zod `.strict()` at every boundary; length limits checked **before** regexes; no catastrophic-backtracking patterns (lint: `regexp/no-super-linear-backtracking`).
2. **Text sanitizer** (`src/server/sanitize/text.ts`, used for review body, report note, sponsor message, contact fields, overlay strings): Unicode NFC → strip C0/C1 controls except `\n` → strip bidi overrides/isolates (U+202A–202E, U+2066–2069) and zero-width chars except ZWJ → strip any markup with an HTML parser configured with zero allowed tags (defence in depth; output is escaped anyway) → collapse > 2 blank lines → trim → enforce max length. URLs stay plain text (never linkified); > 2 URLs auto-holds a review for moderation.
3. **Sinks**: React text nodes (auto-escaped) · plain-text e-mails only · CSV export prefixes cells starting with `= + - @ \t \r` with `'` (CSV injection) · overlay text nodes · no JSON-LD containing user content.
4. Lint: `react/no-danger` = error with zero exceptions (brand SVGs become React components via SVGR at build time, so no `dangerouslySetInnerHTML` is needed anywhere).

## 9. Rate limits (Redis, sliding window; IP = `CF-Connecting-IP` trusted only from Cloudflare ranges, IPv6 keyed by /64)

| Endpoint | Per IP | Per user | Extra |
|---|---|---|---|
| `/api/auth/*` | 20/min | – | nginx `limit_req` 5 r/s |
| catalog search / details | 60/min | – | Redis cache absorbs repeats |
| YouTube resolve (disabled until a price is set) | 20/min | 20/min | protects 10k-unit/day quota; Redis cache by video id |
| quote | 60/min | 60/min | |
| create sponsorship (guest or user) | 10/h | 5/h per buyer (user id or e-mail) | max **1** pending order per buyer, **2** per IP; Turnstile |
| order access exchange / claim | 10/min | 10/min | constant-time token check; failures logged as security events |
| invalid voucher attempts | 5/10 min | 5/10 min | 15-min cool-down + security event |
| order status poll | 30/min | – | SSE preferred; ≤ 3 SSE streams/user, 5/IP |
| create review | 10/h | 5/h · 20/day | Turnstile; title must be watched |
| edit review | – | 20/h | |
| like/unlike | 300/h | 120/h | |
| report | 20/h | 10/h | account ≥ 24 h |
| username availability | 30/min | 30/min | |
| contact | 5/h · 20/day | – | Turnstile + honeypot + min-fill-time |
| overlay session | 10/min | – | |
| webhook | 600/min global | – | cheap HMAC first |
| csp-report | 60/min | – | 8 KB body |
| admin API | 300/min | 300/min | |
| nginx global | `limit_req` 20 r/s burst 40 on `/api/`, `limit_conn` 30/IP | | 429 with `Retry-After` |

**Turnstile** (sponsorship create, review create, contact): server-side siteverify with `secret`, `response`, `remoteip`, `idempotency_key`; require `success`, `hostname == PUBLIC_HOSTNAME`, `action` == the form's action name, token age ≤ 300 s; tokens are single-use. Loaded with the request nonce (Cloudflare documents nonce propagation and `strict-dynamic` support).

## 10. DDoS — what the app can and cannot do

**Application code cannot stop a DDoS.** A volumetric (L3/L4) or large L7 flood saturates the network or the VPS long before any Node.js code runs. The design therefore assumes **Cloudflare (or an equivalent scrubbing proxy) in front at all times**:

- **Edge**: Cloudflare proxy hides the origin IP; DDoS protection + WAF managed rules; rate-limiting rules on `/api/v1/sponsorships`, `/api/v1/contact`, `/api/auth/*`; "Under Attack" mode as the break-glass switch; cache static assets; WAF **skip** rule only for the MP webhook path (still HMAC-verified at origin).
- **Origin lock-down**: firewall accepts 443 only from Cloudflare IP ranges + Authenticated Origin Pulls (mTLS) so the origin can't be hit directly even if its IP leaks; origin IP never in DNS history, e-mail headers or error pages.
- **nginx**: `limit_req`/`limit_conn`, `client_max_body_size 16k` (32k for admin), `client_body_timeout 10s`, `client_header_timeout 10s`, `send_timeout 10s`, `keepalive_timeout 15s`, `proxy_read_timeout 15s` (SSE locations: 1h with heartbeats), `large_client_header_buffers 4 8k`.
- **App**: Redis rate limits, cheap checks first (signature, size, auth) before expensive work (DB, MP, TMDB), aggressive data caching, timeouts on every outbound call (5–10 s) with circuit breakers so a slow third party can't exhaust the event loop.

## 11. TLS

- With Cloudflare proxying, **SSL Labs grades Cloudflare's edge**: set Minimum TLS 1.2, TLS 1.3 on, Always Use HTTPS, SSL mode **Full (strict)**. Origin: Cloudflare Origin CA certificate, TLS 1.2/1.3 only, Mozilla "intermediate" cipher list, AOP client-cert verification.
- **OCSP stapling note:** Let's Encrypt stopped putting OCSP URLs in certificates in 2025 and shut its OCSP responders down on 2025-08-06; revocation is CRL-only now. Stapling is therefore impossible with Let's Encrypt certs, and SSL Labs does not require it for A/A+. If you need OCSP stapling specifically, it requires a CA that still runs OCSP (see Q25). nginx keeps `ssl_stapling` off unless the certificate actually carries an OCSP URL.
- HSTS preload submission only after the whole domain (all subdomains) is HTTPS-only — preload is hard to undo.

## 12. Secrets and configuration

- All secrets in env vars, validated at boot by a Zod schema (`src/server/env.ts`); the process refuses to start on missing/malformed values. `.env.example` lists every key with placeholders (Phase 5).
- Only `NEXT_PUBLIC_ORIGIN` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` may be public. CI fails if any secret value or known token prefix (e.g. MP `APP_USR-`) appears in `.next/static/**`.
- Production secrets live only on the server (Docker secrets / root-owned env file, mode 600), never in the repo or CI logs. Rotation procedure for MP token, webhook secret (dual-secret window), Google client secret, Turnstile secret, cookie keys.

## 13. Logging, audit and LGPD

- **App logs**: JSON (pino), `requestId`, route, status, latency, user id (UUID), IP as monthly-keyed HMAC; redaction of cookies, auth headers, e-mail, Pix payloads; retention 30 days.
- **Audit log**: append-only (trigger + grants), hash-chained, metadata allow-listed; covers auth events of privileged users, role changes, price/catalog/voucher changes, refunds, moderation actions, overlay key changes, settings. Retention proposal: 5 years (Q14).
- **Security events** (alert to streamer e-mail): webhook signature failures spike, CSP violation spike, repeated step-up failures, role change, refund, price publish.
- **LGPD**: data map (purpose, legal basis, retention) in the privacy policy; export + erasure endpoints; erasure anonymises the user (username → `usuario-removido-xxxx`, e-mail nulled after legal retention of orders), reviews removed (Q14 default); guest contact e-mails are used only for the receipt/order link and session-change notices, kept with the order for its retention period, and covered by a short privacy notice at checkout; processors listed (Google, Cloudflare, Mercado Pago, e-mail provider, VPS host); incident-response runbook in Phase 5.

## 14. Host and container hardening (Phase 5)

Multi-stage image, Next.js `standalone` output, non-root user, read-only root FS (+ tmpfs), `no-new-privileges`, `cap_drop: [ALL]`, CPU/memory limits, healthchecks; Postgres/Redis on an `internal: true` network; host: SSH keys only, no root login, firewall (443 from Cloudflare only, SSH from admin IP/VPN), unattended security upgrades; nightly encrypted off-site backups with quarterly restore drills.

## 15. Residual risks (accepted unless you say otherwise)

1. One person with many Google accounts can still post reviews/likes (bounded by rate limits, account age, moderation).
2. A full Cloudflare or Mercado Pago outage stops the site or checkout (the UI shows a clear "pagamentos indisponíveis" state).
3. If the streamer's Google account is fully compromised, step-up re-auth alone would not help — the required STREAMER passkey (Q17) closes this; moderators without a passkey remain a smaller, bounded risk.
4. An overlay key shown on stream by accident grants read-only overlay access until rotated.
5. TMDB: the commercial licence is in progress (Q4). Until it is granted, TMDB is used in development only; production boot refuses to enable TMDB without `TMDB_LICENSED=true`.
6. Guests can use throwaway e-mails; they then lose the receipt/order link (their problem, not a security issue) and per-buyer caps are weaker — the per-IP limits and Turnstile carry that load.
