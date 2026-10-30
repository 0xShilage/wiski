# Wiskiflix — Phase 3 (reviews, likes, reports, moderation, public profiles)

> Status: **built and tested** · 2026-10-30 · baseline: [`../phase-0/`](../phase-0/README.md) (02 §2, §4–§5, 03 §5.4 + §5.6, 05 §5, §8–§9, Q14, Q15) and [`../phase-0/11-redesign-spec.md`](../phase-0/11-redesign-spec.md) §2.3 · results: [`test-report.md`](./test-report.md)

Phase 3 opens the community side. Once a title has been **watched on stream**, signed-in viewers give it **1–5 whole stars** and a text (with a spoiler toggle), edit it later ("editado") or delete it. Others **like** and **report** reviews. Reports and "too many links" **hide** a review automatically until the **moderation queue** in the dashboard decides. **Public profiles** (`/u/[username]`) list a person's reviews, and **Avaliações** shows the latest reviews and the watched titles with their average.

## 1. What's in the box

| Area | Where | Notes |
|---|---|---|
| Data model | `prisma/schema.prisma`, migrations `20261031120000_phase3_reviews` (generated) + `20261031120100_phase3_constraints` (reviewed SQL) | `Review.heldReason`, `openReportCount`, `moderatedAt`, new indexes; CHECKs; **triggers keep `likeCount` and `openReportCount`** and refuse self-likes/self-reports |
| Text | `src/server/text/sanitize.ts` | same plain-text sanitiser as the catalogue (05 §8), plus `countLinks()`; the emoji ZWJ now survives (👨‍👩‍👧) |
| Reviews | `src/server/reviews/{input,cursor,read,write,moderation}.ts` | read models, keyset pagination, writes, the auto-hide rule, moderation and brigading signals |
| Pages | title pages (`/filmes|series|franquias/[slug]`, watched titles), `/avaliacoes`, `/u/[username]`, `/admin/moderacao` | `src/components/reviews/*`, `src/components/admin/{ModerationQueue,OpsNav,AdminGate}.tsx`, `src/styles/reviews.css` |
| Seed | `scripts/seed-dev.ts` | three fans, six reviews on the watched titles, likes and one open report (so the queue isn't empty) |

### API endpoints added in Phase 3

| Method · path | Access | Purpose |
|---|---|---|
| `GET /api/v1/items/[id]/reviews?sort=recent\|top&cursor=` | public | visible reviews of a watched title; first page also carries the rating summary; `likedByMe`/`mine` when signed in |
| `POST /api/v1/items/[id]/reviews` | user · Turnstile `review` | `{rating, body, containsSpoilers}`; one per person per title |
| `GET /api/v1/reviews?cursor=` | public | latest reviews across titles |
| `PATCH /api/v1/reviews/[id]` | author (others 404) | edit; sets `editedAt` when something changed |
| `DELETE /api/v1/reviews/[id]` | author (others 404) | delete own (likes/reports go with it) |
| `PUT · DELETE /api/v1/reviews/[id]/like` | user | idempotent like/unlike; never your own |
| `POST /api/v1/reviews/[id]/reports` | user, account ≥ 24 h | `{reason, note?}`; one per person (repeats answer the same) |
| `GET /api/v1/users/[username]` · `…/reviews?cursor=` | public | profile (username, avatar, joined month, review count) and reviews — never e-mail |
| `GET /api/v1/admin/moderation/queue` | moderator + passkey | held and reported reviews with their open reports, recently hidden ones, brigading signals |
| `POST /api/v1/admin/moderation/reviews/[id]` | moderator + passkey (REMOVE: streamer) | `{action: HIDE\|RESTORE\|DISMISS\|REMOVE, expectedStatus}`; audited |

Every route is wrapped in `route()` and listed in the authz matrix (63 rows × 4 roles).

## 2. Running it

Nothing new to start: `npm run dev` (and `npm run worker` for payments). After pulling:

```
npm ci
npm run db:migrate      # applies the two Phase 3 migrations
npm run db:drift        # optional check
npm run db:seed -- --reset   # optional: catalogue again + sample reviews (development DB only)
```

Without `--reset`, an existing development catalogue is left alone and gets no sample reviews; write some yourself on a watched title (Turnstile uses Cloudflare's test keys locally, so the widget passes).

Where to look: a watched title such as **/filmes/a-primeira-live**, **/avaliacoes**, **/u/bia_cine**, and **/admin/moderacao** (sidebar → Operação → Moderação, with the waiting count).

## 3. Rules as built

| Rule | How |
|---|---|
| Only after the title was watched | the item has a `WatchEvent` and is `WATCHED` — or `ARCHIVED` after watching. **Watched titles now keep their page after the slot is replaced**, so their reviews stay reachable (they used to 404 once archived). |
| Who can write | signed in, username chosen (else 409 `ONBOARDING_REQUIRED`), account `ACTIVE` (else 403 `ACCOUNT_SUSPENDED`); one review per person per title (409 `REVIEW_EXISTS`) |
| Text | sanitised to plain text (NFC, controls/bidi/zero-width/BOM/tag characters removed, whitespace and blank lines collapsed); 1–2000 **code points after sanitising**, checked by the app (422) and by a CHECK. Markup is not rewritten: `<b>` stays visible text, and React renders it as a text node. |
| Links | never linkified; **more than 2** (`https://…`, `www.…`, `site.com.br`) → `AUTO_HIDDEN` with reason `LINKS` |
| Editing | the author edits a `VISIBLE` review; a review with the moderation (auto-hidden, hidden, removed) is locked (409 `REVIEW_LOCKED`); a `REMOVED` review can't be deleted either, so the person can't post a fresh one on that title |
| Likes | one per person per review (primary key), never your own (422 + trigger), only visible reviews, active accounts; `likeCount` kept by a trigger |
| Reports | account ≥ 24 h (403 `ACCOUNT_TOO_NEW`), not your own, only visible reviews, one per person (idempotent), note ≤ 500 after sanitising. **3 open reports from distinct accounts ≥ 7 days old → `AUTO_HIDDEN` (`REPORTS`)**, audited as `review.autohide`. |
| Who sees what | public lists: `VISIBLE` reviews of existing accounts only. The author sees their own review in any state, with a notice explaining it. |
| Moderation | HIDE (visible/auto-hidden → hidden), RESTORE (auto-hidden/hidden → visible), DISMISS (visible, closes its reports), REMOVE (streamer only, final). Each one is a compare-and-set on the status the moderator saw (409 `REVIEW_CHANGED` if someone acted first), closes the open reports (ACTIONED/DISMISSED) in the same transaction, and writes one audit row (`moderation.review`: action, from, to, number of reports — never text or notes). |
| Brigading signals | in the queue: a review with ≥ 10 likes in 24 h where at least half come from accounts < 7 days old; an account with ≥ 5 reports in 24 h |
| Rate limits (05 §9) | create 10/h per IP, 5/h + 20/day per person · edit/delete 20/h per person · like 300/h per IP, 120/h per person · report 20/h per IP, 10/h per person · public reads 120/min per IP |

## 4. Decisions and deviations from the Phase 0 plan

| # | Plan said | Built | Why |
|---|---|---|---|
| D1 | `/api/v1/titles/[id]/reviews` | `/api/v1/items/[id]/reviews` | R1 replaced `Title` with `CatalogItem` |
| D2 | `DELETE /reviews/[id]` for owner **or moderator** | owner only; moderators use `/admin/moderation/reviews/[id]` | keeps every moderator action behind the passkey gate and in the audit log, through one endpoint |
| D3 | `likeCount` "updated in the same transaction" by the app | database triggers keep `likeCount` and `openReportCount` | exact whatever writes the rows (API, seed, cascades); the trigger's row lock also serialises concurrent reports so the auto-hide count can't be missed |
| D4 | sanitiser strips markup with an HTML parser | markup kept as visible text | consistent with R1's catalogue texts; stripping would mangle honest text like "nota <5"; output is only ever a React text node (and the CSP is the backstop). The XSS corpus tests prove it on the page. |
| D5 | sanitiser keeps ZWJ | ZWJ kept **only inside emoji sequences** | a lone ZWJ is an invisible character (deception); the catalogue sanitiser used to strip it everywhere, breaking 👨‍👩‍👧 |
| D6 | reports: 409 on a second report | 200 `{received: true}` either way | nothing to learn by probing, and a double click isn't an error |
| D7 | `(C 30 s)` caching on public lists | `private, no-store` like every API answer | 05 §7: HTML/API never cached at Cloudflare; lists are cheap keyset queries |
| D8 | — | `/admin/catalogo` and `/admin/moderacao` share one gate (`AdminGate`) and the "Operação" sidebar section | Moderação is the first live item there; the other entries stay "em breve" until Phase 4 |

## 5. Open items

| # | Item | Owner |
|---|---|---|
| P3-a | Suspensions and bans (Phase 4 "users" admin): `SUSPENDED` already blocks writing, liking and reporting, but nothing sets it yet | Phase 4 |
| P3-b | LGPD erasure endpoint (Q14: reviews deleted with the account — the cascade is in place; the endpoint isn't) | Phase 4 |
| P3-c | Appeal path for a hidden review: the notice points to /contato, which is still a placeholder | Phase 4 (contact form) |
| P3-d | Community rules text (what gets a review hidden) for the lawyer's review alongside the terms | you + lawyer (Q13) |
