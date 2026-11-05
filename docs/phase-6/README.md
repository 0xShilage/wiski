# Wiskiflix — Phase 6 (Links page, progress block, suggestions, 20 series)

> Status: **built and tested** · 2026-10-31 · results [`test-report.md`](./test-report.md) · production packaging stays as in [Phase 5](../phase-5/README.md) (deployment is still pending).

Four changes requested on 2026-10-31:

1. A **Links** tab: a link-in-bio page with the streamer's social links. She edits it in the dashboard.
2. A **progress block** at the bottom of the home page.
3. A **Sugestões** tab, where signed-in viewers suggest titles.
4. **20 live slots for series** instead of 10.

Decisions taken with you before building:

| Question | Answer |
|---|---|
| Who suggests, who reads? | Signed-in viewers suggest. Only moderators and the streamer see the list (Admin › Sugestões) and accept or dismiss each one. Nothing is public, so nothing needs moderation. |
| 8 tabs on a 360 px phone? | Phones show **Filmes · Séries · Franquias · Cronograma · Perfil · Mais**. "Mais" opens Avaliações, Sugestões and Links. Desktop shows all eight tabs in the header. |
| What does the progress block count? | Totals for everything (movies, series, franchises), each with a per-kind split. |
| Franchises? | Stay at 10. Only series go to 20. |

## 1. What's in the box

| Area | Where | Notes |
|---|---|---|
| Data | `prisma/schema.prisma`: `SocialLink`, `Suggestion`, `SuggestionStatus`. Migrations `20261103120000_phase6_links_suggestions` and `20261103120100_phase6_constraints` (reviewed SQL) | **Live slots**: series slots now run 1–20, enforced by the slot-range CHECK and the `catalog_item_guard` trigger, which keeps its advisory lock. **Links**: https-only URL CHECK; positions 1–30, unique and deferred so a reorder commits in one go. **Suggestions**: lengths; a normalised `titleKey`; reviewer and time set exactly when decided; one waiting suggestion per viewer per title (partial unique). |
| Live limits | `src/lib/catalog/pricing.ts` `LIVE_LIMIT` = 35 / **20** / 10 (**50** movies since 2026-11-02, §9) | The dashboard's slot board and sidebar counter now read the same constant, so no copy of the limits is left in the UI. |
| Links | `src/lib/links.ts`, `src/server/links/links.ts`, `/admin/links` (streamer), `/links` (public) | **Address check**: the address is parsed with the WHATWG parser; only https is accepted, with no user name or password, no port and no IP address. A bare "twitch.tv/x" gets https:// added, and international host names are stored as punycode. **Display**: the platform name ("Twitch", "YouTube"…) comes from the host and is shown as text; no third-party logos are drawn. **Editing**: add, edit, show/hide, ↑/↓ reorder and delete; positions stay 1…n. Each change is audited with the field names only, never the values. Links open in the same tab with `rel="me noreferrer"`. |
| Progress | `src/server/catalog/progress.ts`, `src/components/live/ProgressBlock.tsx`, home page | **Watched**: titles with `watchedAt` set, including ones whose slot was later replaced. **Time**: the sum of those titles' catalog runtimes, not the measured stream time (the page says so). **Na fila**: paid movies (PAID or SCHEDULED) plus funded series and franchises (FUNDED or SCHEDULED), with or without a date. |
| Suggestions | `src/server/suggestions/suggestions.ts`, `/sugestoes`, `/admin/sugestoes` (moderators + streamer) | **Who can send**: signed in, username chosen, account active. **Limits**: 5 a day per account, 20 a day per IP, and at most 10 waiting per viewer. **Text**: title, year and note go through the plain-text sanitiser. **Same title twice**: refused while the first is still waiting. **Staff list**: shows "+N pessoas pediram" for the same title, and decisions (accept, dismiss, reopen) are compare-and-set on the status the moderator saw, then audited. **LGPD**: suggestions are in the data export and deleted on account erasure; decided ones are deleted by the worker after 12 months. |
| Navigation | `src/components/layout/{nav-items.ts,TabBar.tsx,NavLinks.tsx}`, `src/styles/layout.css` | Desktop: eight tabs, with the gap narrowed so they fit next to the logo from 761 px. Phone: "Mais" is a native `popover`, which gives light dismiss and Esc without extra script. The open menu is labelled, and the button announces "você está em Links" while you're on one of its pages. |
| API | `POST /api/v1/suggestions` (user) · `GET /api/v1/admin/suggestions`, `PATCH …/[id]` (moderator) · `GET/POST /api/v1/admin/links`, `PATCH/DELETE …/[id]`, `PUT …/order` (streamer) | All go through `route()` and are in the authz matrix. Admin routes need the second factor; the streamer-only ones answer 404 to moderators. |
| Dev seed | `scripts/seed-dev.ts` | 4 links and 2 suggestions, so the pages show something locally. |

## 2. Decisions and deviations

| # | Decision | Why |
|---|---|---|
| D1 | No public list or votes for suggestions | Your choice. It also keeps viewer text off the public site, so there's no new moderation queue. Accepting a suggestion **does not** create a catalog item: it's a note for the curation, and the moderator still adds the title in Catálogo. |
| D2 | Platform names as text, not brand icons | Third-party logos have their own usage rules; a generic chain icon and the name read just as well. |
| D3 | Links open in the same tab | Link-in-bio pages usually do. `noreferrer` keeps our URLs out of other sites' logs, and `me` lets platforms that support it verify the profile. |
| D4 | Progress time = catalog runtimes | The stream's real length isn't recorded per title. The page states what the number means. |
| D5 | `/links` and `/sugestoes` are server-rendered; the only public write is `POST /api/v1/suggestions` | Fewer endpoints. The pages read the database directly. |

## 3. How to use it

- **Links**: Dashboard › Streamer › **Links**. Add each button (name, https address, optional second line), order them with ↑/↓, and hide one without deleting it. The public page is `/links`.
- **Suggestions**: Dashboard › Operação › **Sugestões** (moderators too). The badge counts new ones. Use **Aceitar** for "we'll consider it" and **Dispensar** for "not this time"; the viewer sees "Aceita" or "Não desta vez" under *Suas sugestões*.
- **Series slots**: the Séries board now has 20 slots, and nothing else changes.

## 4. Profile pictures v2 (2026-10-31, later the same day)

Your hand-made round icons replace the 20 mascot × colour avatars: 30 at first, **40 since 2026-11-01** (§7).

| Area | Where | Notes |
|---|---|---|
| Registry | `src/lib/avatars.ts` | Keys `perfil-01` … `perfil-40`. The default (new accounts before onboarding, erased accounts) is `perfil-01`. Unknown or retired keys read from the database fall back to the default. |
| Images | `ASSETS/PROFILE_ICONS/01.png … 40.png` → `npm run avatars` (`scripts/avatars.ts`) → `public/avatars/perfil-NN-{128,256}.webp` | The originals are 1000 px and about 29 MB in total; they stay on your computer and out of git (`.gitignore`). The site uses WebP copies, about 8 KB at 128 px and 21 KB at 256 px, with metadata stripped and transparency kept. Avatars up to 64 CSS px use the 128 px file, larger ones the 256 px file. **To change an icon**, replace its PNG and run `npm run avatars`. |
| Existing accounts | migration `20261104120000_avatars_v2` (column default) + `20261104120100_avatars_v2_constraints` (reviewed SQL) | The old preset in position *n* becomes `perfil-n`, so profiles still look different from each other; anything else becomes the default. People can choose again in Perfil. |
| Picker | `src/components/account/AvatarPicker.tsx` | 40 options, 5 per row on phones and 8 from `sm` up. Each option's accessible name is "Avatar 1" … "Avatar 40". |
| Serving | `src/proxy.ts`, nginx template | `/avatars/*` skips the per-request CSP middleware like `/brand/`, and nginx caches it for a week (stable names). |
| Mascot art | `src/components/brand/Mascote.tsx` | The mascot line art stays for the site's own decoration (empty states, Links page); it is no longer tied to avatars. |

**Rights.** These icons show studio characters and photos of real actors. On 2026-10-31 the site owner confirmed they accept the copyright and image-rights risk of using them on a commercial site. If a takedown request arrives, replace that PNG and run `npm run avatars`; the key stays the same, so no migration is needed.

## 5. Dashboard images and "Adicionar texto?" (2026-10-31, night)

| Change | Where | Notes |
|---|---|---|
| Oversized uploads shrink in the browser | `src/lib/media-downscale.ts`, `MediaDrop.tsx` | **Sizes**: posters scale down to cover 1200 × 1800, backdrops 2560 × 1440, logos fit inside 1920 px. Posters and backdrops are re-encoded as JPEG 0.92, logos as PNG so they keep transparency. **Rules**: the server's checks are unchanged: 600 × 900 is the poster **minimum**, and 10 MB / 40 MP the caps. A file the browser can't decode is sent as it is. **Test**: a browser test uploads a 26 MB, 2400 × 3600 PNG. |
| Backdrop fades on the left | `src/styles/hero.css` | A mask on `.wf-hero__art` dissolves the image's left half into the page with eased stops, so there's no hard edge at any width (checked at 1432, 1920, 2560 and 3440 px). Phones are unchanged. |
| "Adicionar texto?" | `CatalogItem.posterTitle` (default on, migration `20261105120000_poster_title`), editor checkbox under the poster (movies), `HeroCarousel` | **On** (the default for every existing movie): the carousel card draws the movie's name over the poster, as before. **Off**: the card shows only the artwork, for posters with the title already printed on them; the card's accessible name still says the title. **History**: the setting is part of the content snapshot, so it reverts with the rest, and snapshots saved before it existed mean "on". Audit entries record the field name only. |

## 6. Cronograma posters, Assistidos, next seasons (2026-11-01)

| Change | Where | Notes |
|---|---|---|
| Posters on the Cronograma | `src/server/live/public.ts` (`cronograma`), Cronograma page | Each title on a live shows its poster as a small thumbnail. All the posters on the page come from one extra query. |
| **Assistidos** tab | `/assistidos` (`src/app/(site)/assistidos`), `watchedTitles()` in `src/server/catalog/read.ts` | Everything watched on stream, newest first: poster, kind, year and the day it was watched. The intro line gives the totals from the progress block. The filters (Todos · Filmes · Séries · Franquias) are plain links, so they work without JavaScript. Each card opens the title's page with its reviews. Titles whose slot was later replaced still count. |
| Navigation | `nav-items.ts`, `TabBar.tsx`, `layout.css` | **Desktop**: nine tabs, with Assistidos after Cronograma. Between 761 and 1080 px the header uses smaller labels, tighter gaps and a narrower side padding; tested at 761 to 1280 px. **Phones**: "Mais" now opens Assistidos, Avaliações, Sugestões and Links. |
| **Próximas temporadas** | `SeasonRelease` (migrations `20261106120000_season_releases` + `…_constraints`), `src/server/releases/releases.ts`, `/admin/estreias`, Cronograma side panel | **Who**: moderators and the streamer, in the new dashboard section **Estreias** (Operação). **What they enter**: the series (from the catalog, or any name), a season label ("Temporada 3"), the release day and an optional note ("Netflix · data a confirmar"). **Catalog link**: a linked catalog series shows its poster and links to its page, but only once it is public (a draft lends neither). **Window**: the Cronograma lists releases from 7 days ago onward, soonest first, up to 12, and marks past ones "Estreou". **Rules**: release days are calendar days (`DATE`, no time zone). The database checks the text lengths and the date range (2000–2100), and a trigger allows only SERIES items as links. Changes are audited with field names only. **Layout**: the panel sits beside the lives from 1100 px and below them on smaller screens. |

## 7. Links icons, one legal text, 40 profile pictures (2026-11-01, evening)

| Change | Where | Notes |
|---|---|---|
| **Icons on the Links page** | `src/components/links/PlatformIcon.tsx`, `platform-icons.generated.ts` (from `scripts/platform-icons.ts`), `platformOf()` in `src/lib/links.ts` | Each button shows the platform's icon in a round badge on the left. The platform comes from the link's **host** only (`twitch.tv`, `kick.com`, `amazon.com.br`…), never from the button's name, so a look-alike address gets the generic link icon. **Brand glyphs** (Instagram, Twitch, Discord, Steam, YouTube, Facebook, Letterboxd, Kick, TikTok, plus X, Threads, Bluesky, Spotify and WhatsApp) come from Simple Icons 16.36.0 (CC0), copied into the repo as path data by the script (the package is not a dependency). **Amazon** is no longer in Simple Icons (Amazon asked for its removal), so the wishlist gets a drawn gift box. **Cinefy** has no published glyph, so it gets a drawn clapperboard; its host is matched on `cinefy.app/.gg/.com/.com.br/.io/.tv/.me`. Any other site gets the link icon. |
| Links copy | `/links` | "Onde encontrar a Iara fora daqui." (also the page description). |
| **One legal text** | `src/content/legal/privacy.ts` (text), `src/lib/legal-text.ts` (parser), `src/components/layout/LegalDocument.tsx`, `/privacidade` | Your `ASSETS/TERMS_PRIVACY.docx` ("Política de Privacidade e Proteção de Dados", 17 sections) replaces the separate Termos de uso and Política de privacidade pages, word for word. The text is kept in a small markup (headings, lists, bold, links) and rendered as plain text nodes, so nothing in it can become HTML. Sections have stable anchors (`#secao-1`, `#secao-6-2`…) and a table of contents. **`/termos` redirects to `/privacidade` (308)**. The footer has one link, "Termos e privacidade"; "Canal de privacidade (LGPD)" points to section 1. Checkout, Perfil and Contato link to the same page. |
| Blanks in the text | `LEGAL_CONTROLLER` in `src/content/legal/privacy.ts` | Filled in: site name (Wiski) and domain (wiski.fun). **Still open** at the time: the controller, the contact e-mail and the person responsible (until set, those spots read "[a definir]" and the page says it is provisional). Filled in with the lawyer's final text on 2026-11-03 (§9.3). An e-mail value becomes a `mailto:` link. |
| Text vs. what the site does | for the lawyer (Q13) | The text was published as given. Points to check: §12 says accounts are deleted on request by e-mail, but Perfil also lets people delete their account themselves. §3.2/§4.1 mention the Google profile photo, which the site never stores (people choose a preset picture). The YouTube trailer player (loaded only after a click) and the contact form are not mentioned. |
| Checkout acceptance | unchanged | Checkout still records an acceptance for each of TERMS, PRIVACY and REFUND. When the final text is registered (Q13), the same version and hash go in as both TERMS and PRIVACY, and the API contract does not change. The refund policy (`/reembolso`) stays a separate page (its own text and version since 2026-11-03, §9.3). |
| **40 profile pictures** | `ASSETS/PROFILE_ICONS/01–40.png` → `npm run avatars`, `src/lib/avatars.ts`, `AvatarPicker` | The new set replaces the old pictures. Keys 01–30 keep their numbers, so accounts keep their number with its new picture; 31–40 are new choices. No data migration is needed (the column has no CHECK). The picker shows 8 per row from `sm` up. |

## 8. Release posters, year-only releases, "Meta total" overlay (2026-11-01, night)

| Change | Where | Notes |
|---|---|---|
| **Poster on a release** | `SeasonRelease.posterId` (migration `20261107120000_release_poster_year` + `…_constraints`), `src/server/releases/releases.ts`, Admin › Estreias | Each release can have its own 2:3 poster, uploaded through the media pipeline (the same drop zone as the catalog). It wins over the linked series' poster and also works for series that are only a name. Without one, a linked series lends its poster once it is public, as before. A trigger allows only POSTER assets; removing the poster brings the series' poster back. |
| **Only the year** | `SeasonRelease.yearOnly`, the "Só sei o ano" box in the form | The form swaps the date for "Ano previsto" (2000–2100). The Cronograma and the dashboard show "Previsão: 2027". The release is stored on 31 December of that year, so it sorts after releases with a known day in the same year and stays listed until the year is over. It reads "Estreou" from 1 January, for the usual 7 days. A CHECK keeps year-only rows on 31 December. The API takes `releaseDate` **or** `releaseYear` (both, or neither on create, is refused), and edits can switch between them. |
| **"Meta total" overlay** | widget `meta-total` (`src/server/overlay/events.ts`, `state.ts`, `src/server/goals/total.ts`), `/overlay/meta-total`, Admin › Overlays (OBS) | All the current goals added together: every movie on the Filmes board (its price; met once sponsored), plus every series and franchise (its campaign goal and what it raised, capped at the goal; without a campaign yet, the formula goal with nothing raised). Watched titles and drafts are left out. **On stream**: a big percentage, "N de M títulos garantidos", and one bar per board (Filmes, Séries, Franquias) with its own percentage and count. Like every revenue goal on stream (Q19), no amount ever leaves the server; the event schema has no money field. **Updates**: anything that refreshes "Meta" refreshes it too (payments, refunds, order changes), and so do catalog changes (publishing, replacing a title, editing a title, opening a campaign, lowering a goal). Overlay keys can now hold all five widgets (the database CHECK was widened). |


### 8.1 Overlays in OBS with more than one key (2026-11-01, late)

OBS shares one cookie jar between all its browser sources, but the overlay cookie remembered only the last key exchanged. So a source opened with an older key (without "Meta total") replaced the grant of the newer key, and `/overlay/meta-total` showed "Overlay sem acesso". Now the cookie (`src/server/overlay/keys.ts`) keeps a grant per key, up to 8 and newest first. Each stream picks a grant that lists the widget for a key that is still active, so revoking one key closes only its widgets. Cookies in the old one-key format are still read. The overlay page (`OverlayClient.tsx`) now says what is wrong instead of a generic message: "Chave inválida ou revogada", "Esta chave não inclui “Meta total”", "Sem acesso a …" (no key in the address and none in the cookie), "Sem conexão com o site; tentando de novo…" or "Muitas conexões agora". It retries on its own: after a few seconds when the site is unreachable (for example while `npm run dev` restarts), and every minute when access is refused. Before, it gave up after the first failure.

### 8.2 OBS on `npm run dev`, poster glow, reviews side by side (2026-11-01, late)

| Change | Where | Notes |
|---|---|---|
| **Overlays in OBS over http://localhost** | `overlayCookieSpec()` in `src/server/overlay/keys.ts` | OBS's built-in browser is an older Chromium that drops `__Host-` cookies on `http://localhost` (Chrome only allowed them there later). The key exchange succeeded, but OBS never kept the cookie, so every widget said "Sem acesso". Under `npm run dev` over http (NODE_ENV=development and an `http://` APP_ORIGIN), the overlay cookie is now `wf_overlay_dev`: not Secure, still HttpOnly and SameSite=Strict. Tests and production (https only, enforced by `env.ts`) keep `__Host-wf_overlay`. Checked against `next dev` over http: the exchange sets `wf_overlay_dev`, and the stream answers with the "Meta total" data. |
| Poster glow on Filmes | `.wf-rail--ring .wf-rail__track` in `hero.css` | The rail clips its contents and had 22 px of room above and below, while the active poster's glow reaches about 48 px, so it ended in a hard line. The rail now has 64 px of padding, taken back with negative margins, so the posters don't move. The transparent extra area ignores the pointer, so the text and buttons above stay clickable. |
| Reviews side by side | `.wf-reviews__list` in `reviews.css`, Avaliações page | Review lists (Avaliações, title pages, public profiles) show as many ~340 px columns as fit: three at 1280 px on Avaliações, one on phones. Cards in a row share their height, and the like/report row stays at the bottom. |

### 8.3 45 profile pictures, ordered by colour (2026-11-02)

Your new set: 21, 22 and 31 have new pictures, and 41–45 are new. `npm run avatars` rebuilt every WebP (90 files). A key is the file's number and never changes meaning, so every account keeps its number with that number's picture, and no data migration was needed. The picker no longer follows the file numbers: it shows `AVATAR_COLOR_ORDER` (`src/lib/avatars.ts`), grouped by background colour — white, light grey, beige, yellow, green, blue, purple, pink, red, brown, black — with lighter pictures first in each group. Nine per row from `sm` up (five rows) and five per row on phones. A unit test checks that the order lists every key exactly once, so **a new picture must be added to that list** as well as to `ASSETS/PROFILE_ICONS`.

## 9. Manual movie price, "Já pago", 50 movies, home page grid and Twitch (2026-11-02)

Migrations `20261108120000_manual_price_orders` (generated) and `20261108120100_manual_price_orders_constraints` (reviewed SQL). Run `npx prisma generate` and `npm run db:migrate`, then restart the dev server and the worker.

| Area | Where | Notes |
|---|---|---|
| 50 live movies | `LIVE_LIMIT.MOVIE`, `itemFieldsInput.slot`, reviewed SQL | The slot-range CHECK (movies 1–50) and the `catalog_item_guard` live-count trigger change together. The trigger keeps its advisory lock and its READ COMMITTED check. Series stay at 20, franchises at 10. |
| Manual movie price | `CatalogItem.manualPriceCents`, editor field "Preço manual (R$)" | **What it does**: replaces the runtime formula (base band + extra minutes), so it becomes the movie's base price. Add-ons, the moderator/VIP discount, vouchers and queue jumps still apply on top. Empty means automatic. **Range**: R$ 5 to R$ 2.000 (CHECK `ci_manual_price`, movies only). **Who**: only the streamer can change it. A moderator's save may resend the same value, and a moderator's revert keeps the current price. It is a snapshot field, so revisions and reverts carry it, and its change is audited by field name. **Where it shows**: the checkout quote and charge (`priceMovie` `baseOverrideCents`), public pages (the price line drops the per-minute explanation), the dashboard and the "Meta total" overlay. Pending Pix orders keep the amount they were created with. |
| "Já pago" | `src/server/checkout/admin.ts` `registerManualPayment` / `undoManualPayment`, `POST/GET /api/v1/admin/orders/manual`, `POST /api/v1/admin/orders/[id]/undo`, Admin › Pedidos | **Purpose**: the streamer registers money received outside the site (a Pix to her own key, a deal made on stream). **Effect**: the title enters the queue like a site sale, in one compare-and-set transaction. A movie goes ACTIVE → SPONSORED with a PAID order. A series or franchise gets a PAID contribution added to its campaign, which turns FUNDED when nothing is left or held. **Amounts**: the default is the movie's checkout price or what is left in the campaign. Any amount can be typed: up to R$ 10.000 for a movie, or up to what the campaign has free. Manual contributions may be under R$ 5 or not whole reais (relaxed `ord_contribution_fields` for `source = MANUAL` only). **What it never does**: create a `Payment` row, call Mercado Pago, send an e-mail, alert on stream or produce an order link. **Optional fields**: a public name and a stream message, both approved as typed. **Safety**: idempotent per form submit (409 `ALREADY_REGISTERED`). Streamer only, with Google step-up; audited as `order.manual` (amount and flags only, never the name). **Undo**: "Desfazer registro" cancels a manual order before it is watched. The movie returns to the catalogue, or the contribution leaves the campaign (a FUNDED campaign opens again). Site payments still go through the refund flow. CHECK `ord_manual`: a manual order is never pending and never keeps an IP key. |
| Home: "Filmes disponíveis" | `src/components/catalog/MovieGrid.tsx` | Just below the carousel: every movie that can be sponsored now (ACTIVE), with poster, year · runtime and price. Movies with a Pix in progress show "Reservado". Sponsored and watched movies leave the grid. |
| Home: "Ao vivo agora" | `src/components/live/TwitchLive.tsx`, `src/lib/twitch.ts`, `liveNow()` | **When it shows**: below "Nosso progresso", while a session is LIVE in Cronograma ("Começar live" → "Encerrar"). **Loading**: like the trailers, the Twitch player (`player.twitch.tv`, `parent` = the host of `APP_ORIGIN`, muted) is created only after "Assistir aqui", so opening the home page sends nothing to Twitch. There is also an "Abrir na Twitch" link. **Headers**: CSP `frame-src` and the nginx Permissions-Policy (autoplay, fullscreen) add `https://player.twitch.tv`. |

### 9.1 "Já pago" in the editor, ring-style goal overlays (2026-11-02, night)

- **"Já pago" in the catalog editor** (streamer only). The "No ar" panel of a movie, series or franchise has a "Já pago" button when it can still be registered: a free movie (not reserved, not sponsored), or a campaign that is open or paused and has room. The button opens an amount field (prefilled with the movie's price or what the campaign still needs) and an optional public name. It uses the same `POST /api/v1/admin/orders/manual` as Pedidos, so the rules are the same: step-up, idempotency, audit and "Desfazer registro" in Pedidos.
- **Goal overlays (`/overlay/meta`, `/overlay/meta-total`)**: a ring gauge drawn in-house in `src/components/overlay/GoalRing.tsx`. The style takes after a reference image; no artwork was copied from it.
  - **Ring**: a glowing lavender-to-pink ring around a dark disc with an icon. The icon follows the goal: a heart for sponsorship count, a clock for minutes watched, a sparkle for revenue or the total. The ring also has a bright knob at the end of the arc, twinkling sparkles and a small particle pop when the percentage changes.
  - **Labels**: pill-shaped, shown beside the ring. "Meta batida!" appears at 100 %.
  - **"Meta total"**: one small ring per board (film, TV, stack icons).
  - **CSP**: everything is SVG presentation attributes plus CSS in `ops.css`, so it stays CSP-clean (no inline styles, no `<style>`).
  - **Motion**: off under `prefers-reduced-motion`.
  - **Money**: revenue goals still show only the percentage.

### 9.2 Deploy helpers (2026-11-02, night)

- `worker --publish-legal` (`src/server/legal/publish.ts`): registers the one legal text (`src/content/legal/privacy.ts`, version `LEGAL_UPDATED`, SHA-256 of the exact text) as the current TERMS and PRIVACY document (and, since 2026-11-03, the refund terms as REFUND, §9.3), which opens checkout in production. Idempotent; the same version with a different text is refused (bump `LEGAL_UPDATED`); audited as `legal.publish`.
- `scripts/ops/compose.sh`: `docker compose` for the running release (reads the image digests from `releases/current.env`), for logs, `psql` and one-off commands. The phase-5 deploy guide uses it.
- CI drift check (2026-11-02): the deferred `UNIQUE (position)` on `SocialLink` is visible to Prisma, which cannot express `DEFERRABLE`, so `migrate diff --from-migrations --to-schema` reported a missing index. Migration `20261109120100_link_position_exclusion_constraints` (reviewed SQL) enforces the same rule as a deferred `EXCLUDE USING btree (position WITH =)`, like `ci_live_slot_unique`; a clash now raises SQLSTATE 23P01, which the links service maps to the same 409.
- Worker healthcheck (2026-11-02): Docker Compose's `up --wait` (used by `deploy.sh`, `rollback.sh`, `restore.sh` and the CI smoke test) now refuses a service whose healthcheck is disabled, which failed the first release build. The worker touches `/tmp/wf-worker-alive` after every job round (at most every 10 s) and its healthcheck passes while that file is less than 3 minutes old. `tests/unit/compose-prod.test.ts` requires a healthcheck on every long-running service.
- nginx tmpfs ownership (2026-11-02): the nginx master runs as root without `CAP_DAC_OVERRIDE`, so it cannot write into directories owned by uid 101. `conf.d`, `/var/run/nginx` and `/var/cache/nginx` are now root-owned tmpfs (0755); the master creates the temp directories and hands them to the `nginx` user (CHOWN). The CI smoke test prints the containers and their last log lines when it fails.
- Backups in compose mode (2026-11-02): `backup.sh` and `restore.sh` read the dump's table of contents with the `pg_restore` inside the postgres container (Postgres 17), not the host's (older, or not installed on the server: "unsupported version in file header"). Both take the image digests from the running release record (`releases/`) when the caller did not export them, so the nightly timer and a manual restore drill work after the first deploy.

### 9.3 Final legal texts (2026-11-03)

| What | Where | Notes |
|---|---|---|
| Privacy text, final | `src/content/legal/privacy.ts` | The lawyer's updated `TERMS_PRIVACY.docx`: controller **Strategol Security**, channel `strategol-security@pm.me` (a `mailto:` link), site Wiski / wiski.fun. The separate "Responsável pelo tratamento" line is gone (the controller answers on the channel), so `LEGAL_CONTROLLER` has no `dpo` key and no "[a definir]" or provisional notice is left. One wording fix from the docx ("são processadas pelo Mercado Pago"). The docx is still dated 1 Nov, so `LEGAL_UPDATED` stays `2026-11-01`; nothing was registered in production with that version yet. |
| Refund terms | `src/content/legal/refund.ts`, `/reembolso` | `TERMOS_REEMBOLSO.pdf` ("Termo de Reembolso, Estorno e Restituição de Contribuições Financeiras", 17 sections), word for word in the same markup, rendered by the same `LegalDocument` (`doc="refund"`), with its own table of contents and anchors. `REFUND_UPDATED` = `2026-11-03`. The e-mail is the shared `{email}` value. The signature footer is shown only under the privacy text (the refund terms carry their own closing block). The old placeholder page is removed. |
| Registration | `src/server/legal/publish.ts` | `worker --publish-legal` registers TERMS + PRIVACY with `LEGAL_UPDATED` and the privacy text's SHA-256, and REFUND with `REFUND_UPDATED` and the refund text's SHA-256. Audit `legal.publish` metadata: `{ version, refundVersion, types }`. A changed text needs its own date bumped. |
| Checkout wording | `src/components/checkout/BuyerFields.tsx` | The refund link reads "Termo de reembolso", and "(reembolso só nos casos previstos no termo)" replaces "(pagamentos não são reembolsáveis)", which the new terms contradict. |

### 9.4 Sponsor messages without prior approval (2026-11-03)

| What | Where | Notes |
|---|---|---|
| Shown at once | `src/server/checkout/orders.ts` | A new order's message is created **APPROVED**, so it shows on the "Agora" overlay when the movie plays without a moderator approving it first. It is still the same sanitised text (140 characters, text nodes only, `overlayEventSchema`). The guest **display name** is unchanged: it still waits for approval (Q10). |
| Hide / show again | `reviewTexts` in `src/server/checkout/admin.ts`, Admin › Pedidos | Moderators can hide a message at any time ("Ocultar mensagem" → REJECTED) and show it again ("Mostrar de novo"), as a compare-and-set on the status they saw; the overlays refresh and each change is audited (`order.texts`, the decision only, never the text). Orders created before this change keep "Aprovar mensagem". The buyer's order page says "(ocultada pela moderação)". |
| Checkout copy | `src/components/checkout/BuyerFields.tsx` | "Aparece na live quando o filme passar. A moderação pode ocultar mensagens ofensivas." |

### 9.5 Faster payment confirmation (2026-11-03)

`payment.reconcile` (`src/server/payments/jobs.ts`, `src/worker/main.ts`) now runs every **15 s** in every environment (it was 2 min in production, 20 s in development). A Pix that can still be paid (younger than its 31-minute expiry plus the 4-minute grace) is re-read from Mercado Pago when it was not synced in the last 15 s, so "Pago" reaches the order page within about 15 s even when Mercado Pago's webhook is late or missing. Open payments that are older, or in process / in mediation, keep the 2-minute pace. Cost: one `GET /v1/payments/{id}` per open order every 15 s, at most 50 per round. The webhook stays the fast path, and the order page still updates over SSE as soon as the worker syncs.

### 9.6 Links photo, room above "Nosso progresso" (2026-11-03)

- **Links page picture**: the mascot at the top of `/links` is replaced by Iara's photo, `ASSETS/LINKS_ICON.png` (400 × 400, round, with its own lavender glow). `npm run links-photo` (`scripts/links-photo.ts`) turns it into `public/brand/links-iara-256.webp` (metadata stripped, alpha kept), served from the static `/brand/` location and shown at 120 CSS px through `@/components/Img` with the alt text "Foto da Iara". The circle frame, padding and glow of `.wf-links__avatar` are gone, since the image carries its own.
- **Home spacing**: `.wf-movie-grid` ends with 23 px of padding (was 8 px), so "Nosso progresso" (or "Próximos na live") starts 15 px further below the last row of "Filmes disponíveis".

### 9.7 "Já pago" on a draft series or franchise (2026-11-03)

Until now "Já pago" for a series or franchise appeared only once its campaign was open ("No ar" panel, or Pedidos). A **draft** series or franchise now has it too, next to "Abrir campanha" (streamer only):

- The amount is prefilled with the goal the campaign would open with: the goal typed in the panel, otherwise the formula (seasons × the season price, or the sum of the franchise's films).
- "Abrir e registrar como pago" first opens the campaign (the same `POST /api/v1/admin/campaigns/[id]/open`, with the panel's goal and deadline), then registers the payment (the same `POST /api/v1/admin/orders/manual`). Paying the whole goal leaves it **Meta atingida** and in the queue; a smaller amount leaves the campaign open with that amount raised.
- The two existing endpoints keep their rules: Google step-up, idempotency key, audit, compare-and-set on the campaign's remaining amount, and "Desfazer registro" in Pedidos. If the campaign opens but the payment is refused, the editor shows the now-open campaign, whose own "Já pago" can retry.
- No server code changed.

### 9.8 Search on "Assistidos" (2026-11-03)

- **Search bar**: `/assistidos` has a search box ("Buscar…") above the kind filter: a light field inside a raised purple pill with a magnifier button on the right (styled after a reference the operator chose; drawn in CSS, `IconSearch` in `src/components/ui/icons.tsx`). It is a plain GET form (`?q=…`, with `tipo` kept), so it works without JavaScript and stays CSP-clean.
- **Matching**: `src/lib/search.ts`, used by `watchedTitles()` in `src/server/catalog/read.ts`.
  - Every word must appear in the title or the original title, ignoring case and accents: "cronicas bosque" finds "Crônicas do Bosque".
  - The whole watched history is searched (up to 2,000 titles), newest first, and up to 120 results are shown.
  - The query is capped at 60 characters and 8 words.
- **Page**: the result count ("3 resultados para “…”") is announced as a status. The kind links keep the search. "Limpar" clears it, and an empty result offers to "limpe a busca".

## 10. Subathon timer (2026-11-03)

A countdown that every contribution extends. The site keeps the timer (one source of truth), StreamElements feeds it from the stream, and an OBS widget shows it in the site's look.

### 10.1 What it does

| What | Where | Notes |
|---|---|---|
| **Timer** | `src/server/subathon/timer.ts`, tables `Subathon` + `SubathonEntry` (migration `20261110120000_subathon`, reviewed SQL `…_subathon_constraints`) | One subathon open at a time (`openSlot`, unique). States READY → RUNNING ⇄ PAUSED → ENDED. The clock is in one place: `endsAt` while running, `remainingSeconds` otherwise, so the widget counts down by itself and nothing ticks on the server. A worker job ends a running timer that reached zero (end time = the moment it hit zero). Status changes and setting changes are compare-and-sets on the version the streamer saw, and are audited (`subathon.create/update/status/adjust`). |
| **Value → time** | `src/lib/subathon.ts` | Everything is valued in R$ and converted with one rule: `secondsPerReal` seconds per R$ 1, **60 by default (R$ 1 = 1 minute)**. Stream events get an R$ value set by the streamer: 100 bits (default R$ 5), sub Tier 1/2/3 (R$ 10/20/50), Prime (R$ 10). Tips in US$ or € use two editable rates (US$ 1 = R$ 5,50, € 1 = R$ 6,00 by default); other currencies don't count. Optional cap (hours): time above it isn't added. Each source can be switched off. |
| **Ledger** | `SubathonEntry`, `applyEntry()` | Every change of time is one ledger row with a unique `externalId` per subathon (`order:<id>`, `refund:<id>`, `se:<activity id>`, `manual:<key>`), written in the same transaction as the clock. A repeated source (a re-delivered StreamElements event, the credit job running twice) is a no-op. The row keeps what was asked and what was applied (limited by the cap above, by zero below). Database CHECKs: one clock, ranges (≤ 90 days, 1–3600 s per R$), signs (a refund never adds time). |
| **Site payments** | `src/server/subathon/credits.ts`, worker job `subathon` (every 5 s) | Every order paid while a subathon is open — movie sponsorships, contributions, "Já pago" — adds its total. An order that later leaves the paid states (refunded, charged back, "Desfazer registro") takes back exactly the time it added. The job only reads orders; it never changes one. |
| **StreamElements** | `src/server/subathon/streamelements.ts`, `se-activity.ts` | The worker keeps one WebSocket to StreamElements' Astro gateway (`wss://astro.streamelements.com`), authenticated with the channel's JWT (`STREAMELEMENTS_JWT`, only in `app.env`), subscribed to `channel.activities` (room = the token's channel). **Tips, bits, new subs, resubs, Prime subs and gift subs** add time as they happen; OBS doesn't need to be open. Dashboard test alerts (`isMock`) don't count. Reconnects with StreamElements' reconnect token, or with back-off. Its state (connected / off / error, last event) is shown in Admin › Subathon. The token is never logged or sent to the browser, and the bundle check knows it. |
| **Gift subs** | `GiftLedger` | A community gift ("sub bomb") arrives as one purchase event with the count plus one event per recipient. Each gift is counted once whichever order they arrive in: a purchase of N after k recipients adds N − k, and the remaining recipients are skipped. |
| **OBS widget** | `/overlay/subathon`, `src/components/overlay/SubathonTimer.tsx` | A new widget in Admin › Overlays ("Subathon (timer)"), opened with an overlay key like the others. It shows the title, the clock in the display face with the lavender glow, a state ("Começa em breve", "Pausado", "Fim do subathon!") and a "+5:00 · Sub de …" pop for each contribution (above the clock; the widget sits at the bottom-left of the source, like the others). It counts down from `endsAt` with the server's clock, so a wrong clock on the streaming PC doesn't shift it. Text nodes only; the payload is sanitised and checked against `overlayEventSchema`. |
| **Dashboard** | `/admin/subathon` (streamer only) | Create (name, starting time, R$ rule, cap, event values, what counts), start / pause / resume / end, +5/+10/+30 min or any amount added or removed by hand, the StreamElements status, and the log of everything that entered the timer. |

### 10.2 Setting it up in production

1. **StreamElements token**: StreamElements dashboard → your avatar → **Account** → **Channels** → **Show secrets** → copy the **JWT Token** of the Twitch channel. On the server, add one line to `/etc/wiskiflix/app.env`: `STREAMELEMENTS_JWT=<token>`. Then deploy (or `scripts/ops/compose.sh up -d worker`) so the worker reads it. Admin › Subathon should say **Conectado**. Treat the token like a password: it gives access to the StreamElements account; if it leaks, regenerate it there.
2. **OBS**: Admin › Overlays → new key with **Subathon (timer)** → copy the address into an OBS browser source (about 640 × 360, transparent).
3. **Create the subathon** in Admin › Subathon; contributions already add time while it is READY; press **Iniciar timer** when the live starts.

### 10.3 Chat commands (2026-11-04)

`!pausar`, `!retomar` (moderators) and `!tempo` (everyone) in the StreamElements chatbot, built with StreamElements' `customapi` variable: the command's response is `$(customapi https://wiski.fun/api/v1/subathon/command?a=pausar&k=<key>)`, StreamElements fetches it (GET, no headers) and posts the answer in chat ("⏸️ Timer pausado: faltam 03:12:44.").

| What | Where | Notes |
|---|---|---|
| Key | Admin › Subathon → "Comandos no chat" → **Criar comandos** (`POST/DELETE /api/v1/admin/subathon/command-key`, streamer) | `wfc_` + 256 bits, shown **once** together with the three ready responses to paste into StreamElements (Chatbot → Commands → Custom commands); only its SHA-256 is stored (AppSetting `subathon.commandKey`). **Trocar chave** replaces it (the old commands stop working), **Desligar** removes it. Audited (`subathon.command-key`). |
| Endpoint | `GET /api/v1/subathon/command?a=&k=`, `src/server/subathon/command.ts` | `a` = `pausar`/`pause`, `retomar`/`resume`, `tempo`/`status`; strict query; 30 requests/min per IP. The key is compared in constant time; a wrong, revoked or malformed key is 401 (one answer for all). Answers are one line of plain text (StreamElements keeps 400 bytes). Pausing what isn't running, or resuming what isn't paused, answers politely and changes nothing. Changes go through the same `changeStatus` (compare-and-set) and are audited with `via: "command"` and no actor. |
| Who may use it | the command's **user level** in StreamElements | Moderator for `!pausar` / `!retomar`, Everyone for `!tempo`. The site can't see who typed the command; StreamElements checks that. |
| Logs | nginx logs `$uri` (no query string), the app logs the path only | the key never lands in a log on our side. |

### 10.4 Limits

- Events that happen while the worker is disconnected from StreamElements aren't replayed (Astro has no backlog). The dashboard shows the outage; add the time by hand.
- StreamElements doesn't publish every activity field for Astro, so the parser reads them defensively; the worker logs the field names (never the values) of the first activities so the parsing can be checked after the first live.


## 11. Roleta, the daily wheel of fortune (2026-11-04)

A new public tab, **Roleta** (`/roleta`; on phones under "Mais"), and **Admin › Roleta** for moderators and the streamer.

### 11.1 Rules

- A signed-in viewer with a username has **5 spins per period**. A period starts every day at **17:00 BRT**; unused spins don't carry over (`src/lib/roleta.ts`: `roletaPeriod`, `nextRoletaReset`). Suspended accounts can't spin; signed-out visitors see the wheel, the odds and a sign-in link.
- The **server draws every spin** with `crypto.randomInt` over 15 000 values (the least common multiple of the odds), so the odds are exact: **Cupom de 30 %** 1 in 150, **Filme grátis** 1 in 500, **Dois filmes grátis** 1 in 1 000, **VIP na Twitch** 1 in 2 500, **Nada** the rest (98,99 %). The page only animates the wheel to the slice the server named. The wheel has nine equal slices (four prizes, five "Nada"); the page shows the real odds in a table and says the slices are the same size only for the look.
- The limit holds under parallel requests: each spin takes the next `n` (1 … 5) of its period, `(userId, period, n)` is unique and `n` is CHECKed to 1 … 5.

### 11.2 Prizes

- **Cupom de 30 %**: a personal voucher is created in the same transaction (`ROLETA-XXXXXXXX`, 30 % on one movie, one use, valid 30 days). The winner sees the code under "Seus prêmios" right away; it also appears in Admin › Cupons.
- **Filme grátis / Dois filmes grátis / VIP na Twitch**: given by hand. The winner types their Twitch login on the prize; Admin › Roleta lists it under "Para entregar". Staff create the "Já pago" order(s) for the movie(s) the viewer picks, or `/vip <login>` in the Twitch chat, then **Marcar como entregue** (compare-and-set on the status they saw; "Desfazer entrega" puts it back).
- The streamer can **cancel** a prize (duplicate accounts, abuse); a cancelled coupon's voucher is switched off. Nothing comes back from "Cancelado".
- Admin › Roleta never lists "Nada" spins. It shows today's spins and prizes, and (streamer) the switch **"Roleta aberta para o público"** (`AppSetting roleta.open`, default on, audited).

### 11.3 Data, audit and LGPD

- `RoletaSpin` (migrations `20261111120000_roleta`, `20261111120100_roleta_constraints`): the reviewed CHECKs tie each prize to its slice, give every prize (and only prizes) a delivery state, link coupons (and only coupons) to their voucher, and accept only valid Twitch logins on hand-delivered prizes.
- Audited: `roleta.win` (the prize only, never the coupon code), `roleta.status` (prize, from, to), `settings.update` for the switch. "Nada" spins aren't audited and the worker deletes them after 30 days; prizes stay.
- The data export lists the viewer's spins (with coupon codes); erasing the account deletes them and switches off their coupons.

### 11.4 Notes

- One account per person is the only anti-farming rule (prizes from duplicate accounts can be cancelled). If farming shows up, a minimum account age or a phone check are the next steps.
- Prize draws open to the public can fall under Brazil's rules on promotional distribution of prizes (Lei 5.768/1971); check with the lawyer before announcing the Roleta widely.

## 12. Badges, ranking, queue card, catalog filters and analytics (2026-11-04)

### 12.1 Privacy rule (badges and ranking)

Only facts already public under the viewer's username count: **movie sponsorships and campaign contributions that show the sponsor's name** (anonymous ones never), **visible reviews** and the **likes** they received. Orders count only while paid (refunded, cancelled or unpaid ones don't). **Amounts never appear.** Each viewer has a switch on /perfil — "Mostrar minhas conquistas no perfil público e no ranking" (`User.showAchievements`, default on, audited as `user.achievements.visibility`, included in the data export). Turned off, the badges stay visible to the viewer on /perfil only and they leave the ranking.

### 12.2 Badges

Thirteen badges in `src/lib/achievements.ts` (pure rules; the server only counts): Primeiro patrocínio / Patrocinador / Mecenas / Lenda da fila (1, 5, 10, 25 named sponsorships), Apoiador / Produtor (1, 5 named contributions), Primeira crítica / Crítico / Crítico de cinema (1, 10, 25 visible reviews), Boa de papo / Voz da galera (10, 50 likes received), Veterano (a year of account) and VIP. The public profile shows the earned ones; /perfil shows all thirteen with what's missing ("3 de 5").

### 12.3 Ranking (`/ranking`)

Three boards: **Patrocinadores** (named movie sponsorships) and **Críticos** (visible reviews), each for "Este mês" (the São Paulo calendar month) or "Desde sempre", and **Mais curtidos** (likes received, all time). Top 10, ties share a place (1, 2, 2, 4). Only active accounts with a username that didn't turn the ranking off; the streamer isn't ranked. Linked from the footer, the home progress block and the profiles (the header already holds ten tabs).

### 12.4 "Na fila" on a title page

A paid movie or funded series/franchise shows where it stands (`src/server/live/position.ts`, read-only): **waiting for a date** — its place in the queue (same order as Admin › Agenda: "Topo da fila", "Prioridade", then by payment) and a countdown to the next planned live; **booked on a live** — its place among that live's titles still to play and a rough start time (the live's start, or now once it's on, plus the runtimes before it), with a countdown; **on screen** — "Passando agora na live". Only facts the public Cronograma already shows.

### 12.5 Catalog filters and sort

"Filmes disponíveis" (home) and the campaign grids of Séries and Franquias get a search (title, original title, direction, cast; accents ignored), a genre, a duration (movies: até 1h30, 1h30–2h, mais de 2h) and an order (movies: price, length, year, A–Z; campaigns: closest to the goal, deadline, year, A–Z). The catalog is small (≤ 50 / 20 / 10), so the browser filters what the page already has; the choice is kept in the address (`?q=&genero=&duracao=&ordem=`), so a filtered list can be shared. Pure rules in `src/lib/catalog/filter.ts`.

### 12.6 Admin › Análise (streamer only)

`/admin/analise` with 7 / 30 / 90 days or 12 months: **revenue** (paid orders that weren't refunded, by payment day in São Paulo; split Pix vs "Já pago"; vs the previous period of the same length), paid orders, average ticket, **Pix paid / started** (checkout orders created in the period that got paid), refunds, new accounts, reviews, suggestions; a **revenue chart** by day, week or month; the **titles that raised the most**; the **Roleta** (spins, players, prizes by type, coupons used); the **latest subathons**. Read-only queries (`src/server/admin/analytics.ts`); no API route (the page renders on the server). Charts are SVG with presentation attributes only (the CSP has no `'unsafe-inline'`): one validated hue (`#9d7cf0` on the panel surface — lightness, chroma and contrast checked), 24 px columns with 4 px rounded tops, hairline grid, a hover/keyboard tooltip drawn inside the SVG, and a table view.

## 13. Sponsor names without approval, "Liberar pedidos" (2026-11-04)

Guest sponsor names go live with the order, like messages since 2026-11-03; Pedidos › "Nomes e mensagens" hides or shows either one again (compare-and-set, audited). Migration `20261113120000_texts_no_approval` showed the texts still waiting. Pessoas › **Liberar pedidos** (streamer) clears one account's checkout counters — the hourly caps per account, buyer and the IPs of its recent orders (at most 5), and the coupon cool-down — without changing any limit or cancelling any order; unpaid-order caps are reported back (`src/server/ratelimit/reset.ts`, audited as `user.unthrottle`).

## 14. Series by episode, franchises by film, custom events on a live (2026-11-04)

A live no longer carries a funded series or franchise as one block. `LiveSegment` (`src/server/live/segments.ts`) is a **part** — a season and an episode range of a series ("T1 · E1–E3") or one film of a franchise by position ("Filme 2: O Retorno") — or a custom **event** with a title ("Jogando com os Viewers"), a length and an optional public note.

- **Booking.** Admin › Agenda: a funded campaign in the queue gets "Agendar episódios" / "Agendar filme" with a session picker; the form proposes the episode after the last one booked (or the next film) and a length (episodes × the series' runtime per episode, or the film's runtime), all editable. Every session gets "Adicionar evento". Minutes count against the session's capacity with the same conditional update as a movie. "No começo da live" puts a segment before everything else on that live; otherwise segments follow the queue order by when they were added.
- **The campaign stays in the queue** (status FUNDED) with what was watched and what is booked, until a part is marked **"Concluído · fim da série/franquia"** during a live: that is when the campaign is WATCHED, the title WATCHED and its reviews open (`completeInTx`, the same path as a movie). Plain "Concluído" marks only that part. "Marcar como assistido" in the catalog also finishes it and drops parts still booked.
- **On a live.** "Agora assistindo" works on parts and events (one thing on screen per session — `live_segment_one_playing`; a movie taking over puts the segment back and vice versa). Ending a live: the segment on screen counts as shown, the ones that never came up are SKIPPED (a series part is simply booked again); cancelling a session skips them all.
- **Public.** "Próximos na live" and Cronograma list parts ("Série · T1 · E1–E3") and events (no title page, a star instead of a poster, "Na live"); the title page card shows the next part booked or the one on screen; the "Agora" and "Fila" overlays show them.
- **API.** Same endpoint, `POST /api/v1/admin/schedule`: `action: 'part' | 'event'`, and `target.kind: 'SEGMENT'` for `remove`, `now` and `complete` (`finish: true` = the last part). Audited as `segment.add/remove/now/complete`. Reviewed SQL: `20261114120100_live_segments_constraints` (part ⇔ campaign, episode range or film, lengths, done ⇔ doneAt).
- Whole-campaign booking still works for anything booked that way before (the dashboard no longer offers it for new bookings).

## 15. Overlays that keep working (2026-11-05)

"Novo patrocínio", "Agora assistindo" and "Próximos da fila" sometimes froze or stayed empty in OBS. Causes found and fixed:

1. **The page gave up after one failed reconnect.** Once a stream had opened, the page left reconnecting to the browser's EventSource, which gives up for good on any non-200 answer — a deploy's 502, a 429, an expired cookie. The overlay then showed its last state (or nothing) until OBS reloaded the source. Now the page always reconnects itself with a backoff (1 s, then up to 30 s), and a watchdog reconnects when the server's ping (every 20 s, now a visible `ping` event with the server time) stops for 50 s — a connection that died without closing.
2. **Stream slots leaked on every deploy.** The per-IP stream cap was a counter (+1 on connect, −1 on close). A restarting app never ran the −1, and every reconnect pushed the key's expiry forward, so after a deploy or two OBS sat at the cap and sources were refused ("busy"). Slots are now leases in a Redis sorted set, renewed by each heartbeat and dropped 60 s after the last one (`acquireStreamSlot`, also used by the order and campaign pages).
3. **Too few slots for an OBS with several scenes.** Every browser source is a stream; the cap was 8 per IP. Now 40 for overlays (key-gated), and the key exchange / stream rate limits fit 20–40 sources loading at once (60 and 240 per minute per IP).
4. **Alerts lost in a reconnect gap.** "Novo patrocínio" has no state to resync, so an alert published while the source was reconnecting never showed. Alerts now carry an id and the server time and are kept for 5 minutes (`wf:overlay:patrocinio:recent`, 20 at most); a reconnecting page sends `since` (the server time of the last thing it received) and gets the missed ones, each shown once.
5. **The alert never left with animations off.** With Windows animations off (reduced motion) the CSS animation is disabled and the alert stayed on screen forever; a timer now removes it after 8.5 s either way.
6. **The 12 h overlay cookie.** A source open longer than 12 hours lost access. The page keeps the key from its address in memory and signs in again on a 401.
