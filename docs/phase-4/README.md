# Wiskiflix — Phase 4 (operations: live schedule, orders, people, overlays, media kit, contact)

> Status: **built and tested** · 2026-10-31 · baseline: [`../phase-0/`](../phase-0/README.md) (01 §3.4, 02 §3–§6, 03 §5.5–§5.8, 04 §7–§8, 05 §5, §9, §13, Q10, Q14, Q16–Q19) · results: [`test-report.md`](./test-report.md)

Phase 4 fills in the rest of the dashboard and the pages around the live. The moderators **plan live sessions** and move paid movies and funded campaigns from the queue into them, mark what is **on the air** and what was **watched**. They also approve **sponsor messages and guest names** and **suspend** accounts. The streamer also gets:

- roles and VIP;
- accepting an order that needs attention, and the exception refund;
- **OBS overlays** with live updates (SSE);
- goals, the **media kit** numbers, the **contact inbox**, vouchers, the **audit viewer** and the checkout switch.

Viewers get:

- "Próximos na live" on the home page;
- moving their own date (rescheduling);
- a real contact form and media kit;
- downloading or erasing their data (LGPD).

## 1. What's in the box

| Area | Where | Notes |
|---|---|---|
| Data model | `prisma/schema.prisma`, migrations `20261101120000_phase4_operations` (generated) + `20261101120100_phase4_constraints` (reviewed SQL) | `StreamSession.{startedAt, cancelledAt, nowItemId, version}`, `Campaign.{sessionId, scheduledAt}`; partial unique index `session_one_live` (one LIVE session); CHECKs on sessions, scheduled orders/campaigns (≤ 2 reschedules), overlay keys, goals, stats, contact messages, account status dates |
| Live schedule | `src/server/live/{schedule,public,sponsor}.ts` | sessions (create/edit/start/end/cancel), queue order, schedule/unschedule, now playing, complete, owner rescheduling, the public schedule |
| Orders admin | `src/server/checkout/admin.ts`, `src/server/payments/refunds.ts` | list/detail, text approvals, accept a NEEDS_ATTENTION order, exception refund through Mercado Pago |
| People | `src/server/users/{admin,lgpd}.ts` | suspensions, roles, VIP; data export and account erasure |
| Overlays | `src/server/overlay/{events,state,keys}.ts`, `src/app/overlay/[widget]` | four widgets (`agora`, `fila`, `meta`, `patrocinio`), keys, cookie exchange, Redis pub/sub → SSE, payload schema |
| Goals, media kit, contact | `src/server/goals/goals.ts`, `src/server/mediakit/stats.ts`, `src/server/contact/contact.ts` | measured goals; manual platform numbers; contact form + inbox with a 12-month purge (worker daily job) |
| Streamer tools | `src/server/admin/{settings,vouchers,counts,input}.ts`, `src/server/audit/viewer.ts` | checkout switch, vouchers, sidebar badges, every admin Zod schema, audit page + CSV |
| Dashboard pages | `/admin/{agenda,pedidos,pessoas}` (moderators) and `/admin/{overlays,metas,media-kit,contato,cupons,auditoria,configuracoes}` (streamer; 404 for moderators) | `src/components/admin/{AdminShell,AgendaBoard,OrdersBoard,PeopleBoard,StreamerTools}.tsx`, `admin-page.ts`, `src/styles/ops.css` |
| Public pages | `/` (strip), `/contato`, `/media-kit`, `/pedido/[code]` (reschedule), `/perfil` (Seus dados), `/overlay/[widget]` | `src/components/{live/UpNext,contact/ContactForm,overlay/OverlayClient,account/DataTools}.tsx` |
| Seed | `scripts/seed-dev.ts` | tomorrow's 20:00 session with the sponsored movie booked, one goal (overlay + media kit), four media kit numbers |

### API endpoints added in Phase 4

All admin endpoints need the passkey (≤ 10 min). "Streamer" endpoints answer 404 to moderators. "Step-up" means a Google login in the last 10 minutes.

| Method · path | Access | Purpose |
|---|---|---|
| `GET /api/v1/admin/live` | moderator | sessions (with entries) + the queue |
| `POST /api/v1/admin/sessions` · `PATCH …/[id]` | moderator | plan a session; edit start/capacity/note (`expectedVersion`; capacity ≥ booked) |
| `POST …/sessions/[id]/start` · `…/end` | moderator | go live (one at a time) · end (nothing on the air; the rest goes back to the queue) |
| `POST …/sessions/[id]/cancel` | streamer | cancel a planned session; everything goes back to the queue |
| `POST /api/v1/admin/schedule` | moderator | `{action: add\|remove\|now\|complete, target: {kind, id, expectedVersion}, sessionId?}` |
| `GET /api/v1/sessions` | public | next sessions: start, note, titles, approved names only |
| `GET · POST /api/v1/orders/[code]/reschedule` | order owner (account or order link) | options; move to another planned session (≥ 24 h before, ≤ 2 times, 60 days ahead) |
| `GET /api/v1/admin/orders` · `…/[id]` | moderator | orders with filters; e-mail and MP id for the streamer only |
| `POST …/orders/[id]/texts` | moderator | approve/reject the sponsor message and the guest name |
| `POST …/orders/[id]/accept` | streamer + step-up | NEEDS_ATTENTION with an approved, verified payment → PAID, if the movie/campaign still has room |
| `POST …/orders/[id]/refund` | streamer + step-up + `Idempotency-Key` | exception refund (04 §8): duplicate payment, processing error, legal requirement |
| `GET /api/v1/admin/users` | moderator | search by username prefix; filters staff/VIP/suspended |
| `POST …/users/[id]/suspend` · `…/unsuspend` | moderator (≤ 7 days); streamer longer or open-ended with step-up | never yourself, the streamer, or a moderator (demote first) |
| `POST …/users/[id]/role` · `…/vip` | streamer + step-up | USER ↔ MODERATOR (ends their sessions) · VIP on/off |
| `GET /api/v1/me/export` · `POST /api/v1/me/erase` | user (erase: step-up + username typed) | LGPD self-service |
| `GET · POST /api/v1/admin/overlay-keys` · `DELETE …/[id]` | streamer (create/revoke: step-up) | keys shown once, stored as SHA-256 |
| `POST /api/v1/overlay/session` | public (key in body) | key → `__Host-wf_overlay` cookie (sealed, HttpOnly, Secure, SameSite Strict, 12 h) |
| `GET /api/v1/overlay/stream?widget=` | overlay cookie | SSE: a snapshot, then live events; the key is re-checked (revocation, widget scope) |
| `GET · POST /api/v1/admin/goals` · `PATCH · DELETE …/[id]` | streamer | goals |
| `GET · PUT /api/v1/admin/stats` · `GET /api/v1/stats` | streamer · public | media kit numbers (manual override; `null` clears) |
| `POST /api/v1/contact` | public · Turnstile `contact` | contact form (honeypot, minimum fill time, 5/h · 20/day per IP) |
| `GET /api/v1/admin/contact` · `PATCH · DELETE …/[id]` | streamer | inbox (NEW/READ/ARCHIVED/SPAM) |
| `GET /api/v1/admin/audit` · `…/audit/export` | streamer | audit viewer, CSV export (audited) |
| `PUT /api/v1/admin/settings` | streamer + step-up | `{ordersOpen}` — the checkout switch |
| `POST /api/v1/admin/vouchers` · `PATCH …/[id]` | streamer + step-up | create, end, cap |

Every route is wrapped in `route()` and listed in the authz matrix: **127 route × method rows × 4 roles**, 64 of them new.

## 2. Running it

After pulling:

```
npm ci
npm run db:migrate            # applies the two Phase 4 migrations
npm run db:drift              # optional check
npm run db:seed -- --reset    # optional: catalogue again + a session, a goal, media kit numbers (development DB only)
npm run dev                   # and `npm run worker` (payments + the daily contact purge)
```

Where to look:

- **/admin/agenda** (sidebar → Operação → Agenda): start the seeded session, press "Agora assistindo", then "Concluído".
- **/admin/pedidos** and **/admin/pessoas**.
- As the streamer (`@wiski` in the seed): the Streamer section — Overlays, Metas, Media kit, Contato, Cupons, Auditoria, Configurações.
- The public side: the home page strip, **/media-kit**, **/contato**, and **/perfil** › Seus dados.

**OBS overlays:**

1. In /admin/overlays, create a key for the widgets you want and copy the URL it shows once, e.g. `https://wiski.fun/overlay/agora#k=wfo_…`.
2. In OBS, add a Browser source with that URL, size 1920×1080, and leave "Shutdown source when not visible" off.
3. The page swaps the key for a cookie on first load and removes it from the address.
4. Create one key per computer and revoke it from the same page if it leaks.

## 3. Rules as built

| Rule | How |
|---|---|
| Queue order | "Topo da fila", then "Prioridade", then by payment time; funded campaigns join the same queue |
| Capacity | scheduling is a conditional update on the session's free minutes (no overbooking under any race); capacity can't drop below what is booked |
| One live at a time | partial unique index `session_one_live` + compare-and-set on `version`; two simultaneous "Começar live" → one wins |
| On the air | `now` marks one entry `WATCHING` (the previous one goes back to `SCHEDULED`) and updates the overlay; `complete` makes the order `COMPLETED`, the item `WATCHED`, writes a `WatchEvent` with order and session, and opens reviews. The catalogue's "Marcar como assistido" goes through the same code. |
| Ending / cancelling | ending needs nothing on the air; whatever wasn't watched goes back to the queue (with its reschedule count untouched); cancelling (streamer) returns everything |
| Rescheduling (04 §7) | the buyer, from the order page: at least 24 h before the current session, at most 2 times, to a planned session in the next 60 days with room |
| Names and messages (Q10, Q16) | a guest's display name and the sponsor message are private until a moderator approves them; until then the public schedule and the overlays show "Anônimo" and no message |
| Exception refund (04 §8) | Mercado Pago first (idempotency key), then one transaction: order `REFUND_PENDING`, the movie back to `ACTIVE` with its minutes freed, or the contribution taken out of the campaign (a funded campaign opens again); the webhook later confirms `REFUNDED`. MP down → 503, nothing changes. |
| Suspensions | moderators up to 7 days; the streamer longer or open-ended (step-up); a suspended account reads but can't review, like, report or sponsor; a timed suspension lifts itself on the next request after it ends |
| Erasure (Q14) | reviews, likes, reports and passkeys deleted; every session ended; the row anonymised (paid orders stay 5 years for accounting); the username held 30 days; refused for the streamer or with a payment pending |
| Overlay payloads | built only from sanitised text, cut at the widget limits (title 80, name 30, message 140, goal 60) and checked against a strict schema (`plainText(s) === s`, no extra keys, ≤ 5 queue items) before publishing; the page renders text nodes only; revenue goals as a percentage |
| Contact | Turnstile, a hidden honeypot field (filled → "received", nothing stored), a sealed form token (≥ 3 s, ≤ 2 h), plain text, kept 12 months then purged by the worker |
| Audit | every action above writes one audit row with allow-listed metadata (never message texts, e-mails or contact contents); the CSV export guards against spreadsheet formulas |

## 4. Decisions and deviations from the Phase 0 plan

| # | Plan said | Built | Why |
|---|---|---|---|
| D1 | contact form → inbox **+ e-mail alert** | inbox only; the sidebar shows the unread count | the e-mail provider isn't chosen yet (E1) |
| D2 | media kit from the Twitch/YouTube APIs | manual numbers in the dashboard; the table already has `value`/`source` for a fetcher | needs app credentials (open item P4-a) |
| D3 | — | streamer pages answer 404 to moderators (like their APIs) | doesn't reveal what the streamer has |
| D4 | — | AGENTS.md: order/payment state changes are also allowed in `live/schedule.ts`, `checkout/admin.ts`, `payments/refunds.ts` and `catalog/service.ts` (watched) | the schedule, accepting and refunding move orders; each is a compare-and-set with its holds in the same transaction, and audited |

## 5. Open items

| # | Item | Owner |
|---|---|---|
| P4-a | Twitch and YouTube API credentials for automatic media kit numbers (manual until then) | you |
| P4-b | E-mail alerts for new contact messages and reschedule confirmations wait on the e-mail provider (E1) | you (E1) |
| P4-c | Media kit text and partnership formats are a first draft; adjust in `src/app/(site)/media-kit/page.tsx` or ask for a dashboard editor | you |
| P3-d | Community rules text (what gets a review hidden) for the lawyer, with the terms | you + lawyer (Q13) |

## 6. Changes after delivery (2026-10-31)

Asked for after the Phase 4 hand-over.

### 6.1 Username cooldown by role

Viewers keep **30 days** between username changes; **moderators and the streamer: 5 days** (`usernameCooldownMs()` in `src/server/auth/accounts.ts`). Released names are still held 30 days for everyone.

### 6.2 Authenticator app (2FA) next to passkeys

The admin second factor is now **an authenticator app (TOTP) or a passkey**, whichever the moderator set up; either one counts for **96 hours** (was 10 minutes).

| Piece | How |
|---|---|
| Set-up (`/perfil/seguranca`) | needs a Google login in the last 10 min; when the account already has a factor, that factor too (a stolen Google login can't add its own). A new 160-bit secret waits in Redis for 10 min (encrypted, bound to the session); the QR code is an SVG path drawn by React (no data URL, CSP unchanged) |
| Enabling | the first 6-digit code proves the app has the secret → secret stored **AES-256-GCM-encrypted** with `TOTP_ENCRYPTION_KEY` (new env var, required in production; development/test derive one); **6 single-use recovery codes** shown once (copy / download .txt / "Guardei os códigos"), stored as HMAC-SHA256 |
| The check | RFC 6238 (SHA-1, 6 digits, 30 s, ±1 step). A code is accepted once (`totpLastStep` compare-and-set, also under parallel use). 6 tries per 15 min per account (+ 20 per IP). A recovery code works once, case- and dash-insensitive |
| 96 hours | `Session.mfaAt` counts for 96 h (`src/server/auth/mfa.ts`). Admin sessions still end after 8 h idle / 24 h, so the check is also **remembered in the browser**: a sealed `__Host-wf_mfa` cookie (user, time, epoch; HttpOnly, Secure, Lax) lets the next Google login on the same browser start verified until the 96 h are up. **Logging out clears it.** |
| Revoking | `User.mfaEpoch` invalidates every remembered browser: bumped when the authenticator or a passkey is removed, when the role changes and on account erasure. Removing the last factor also clears every session's check |
| Managing | new recovery codes and turning it off need a fresh check + a fresh Google login; audited (`totp.enable`, `totp.verify` with method, `totp.recovery.regenerate`, `totp.disable`, `mfa.remembered`) — never codes or secrets |
| Unchanged | STREAMER money actions still need a Google login in the last 10 minutes (step-up) |

New endpoints (all MODERATOR+, in the authz matrix): `POST /api/v1/me/totp/setup`, `POST …/enable` `{code}`, `POST …/verify` `{code}` or `{recoveryCode}`, `POST …/recovery-codes`, `DELETE /api/v1/me/totp`. The admin problems are now `MFA_REQUIRED` / `MFA_ENROLL_REQUIRED` (were `PASSKEY_*`). Migrations `20261102120000_mfa_totp` + reviewed `20261102120100_mfa_totp_constraints` (secret ⇔ enabled, sizes, at most 6 unused codes, used codes immutable).

**After pulling:** add `TOTP_ENCRYPTION_KEY` to `.env.local` (32 random bytes, base64url — same format as `COOKIE_SEAL_KEY`, and different from it) before production; locally it is optional. Then `npm ci` (new dependency `qrcode`) and `npm run db:migrate`.

### 6.3 Cronograma

A new public tab, **Cronograma** (`/cronograma`, between Franquias and Avaliações; on phones the bottom bar now has six tabs). It lists, by day (São Paulo time), every upcoming live with the **movies, funded series and franchises already placed in it**, plus lives that ended in the **last two days** with what was watched. Paid titles without a date are not listed; titles left over at the end of a live go back to the queue and disappear from it. Same public facts as the home strip (approved sponsor names or "Anônimo", never e-mails). `cronograma()` in `src/server/live/public.ts`; the dev seed adds yesterday's live.
