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
| Live limits | `src/lib/catalog/pricing.ts` `LIVE_LIMIT` = 35 / **20** / 10 | The dashboard's slot board and sidebar counter now read the same constant, so no copy of the limits is left in the UI. |
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
| Blanks in the text | `LEGAL_CONTROLLER` in `src/content/legal/privacy.ts` | Filled in: site name (Wiski) and domain (wiski.fun). **Still open**: the controller's name or company name, the contact e-mail and the person responsible. Until all three are set, those spots read "[a definir]" and the page says it is provisional. An e-mail value becomes a `mailto:` link. |
| Text vs. what the site does | for the lawyer (Q13) | The text was published as given. Points to check: §12 says accounts are deleted on request by e-mail, but Perfil also lets people delete their account themselves. §3.2/§4.1 mention the Google profile photo, which the site never stores (people choose a preset picture). The YouTube trailer player (loaded only after a click) and the contact form are not mentioned. |
| Checkout acceptance | unchanged | Checkout still records an acceptance for each of TERMS, PRIVACY and REFUND. When the final text is registered (Q13), the same version and hash go in as both TERMS and PRIVACY, and the API contract does not change. The refund policy (`/reembolso`) stays a separate page. |
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
