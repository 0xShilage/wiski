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

Your 30 hand-made round icons replace the 20 mascot × colour avatars.

| Area | Where | Notes |
|---|---|---|
| Registry | `src/lib/avatars.ts` | Keys `perfil-01` … `perfil-30`. The default (new accounts before onboarding, erased accounts) is `perfil-01`. Unknown or retired keys read from the database fall back to the default. |
| Images | `ASSETS/PROFILE_ICONS/01.png … 30.png` → `npm run avatars` (`scripts/avatars.ts`) → `public/avatars/perfil-NN-{128,256}.webp` | The originals are 1000 px and about 23 MB in total; they stay on your computer and out of git (`.gitignore`). The site uses WebP copies, about 8 KB at 128 px and 21 KB at 256 px, with metadata stripped and transparency kept. Avatars up to 64 CSS px use the 128 px file, larger ones the 256 px file. **To change an icon**, replace its PNG and run `npm run avatars`. |
| Existing accounts | migration `20261104120000_avatars_v2` (column default) + `20261104120100_avatars_v2_constraints` (reviewed SQL) | The old preset in position *n* becomes `perfil-n`, so profiles still look different from each other; anything else becomes the default. People can choose again in Perfil. |
| Picker | `src/components/account/AvatarPicker.tsx` | 30 options, 5 per row on phones and 6 from `sm` up. Each option's accessible name is "Avatar 1" … "Avatar 30". |
| Serving | `src/proxy.ts`, nginx template | `/avatars/*` skips the per-request CSP middleware like `/brand/`, and nginx caches it for a week (stable names). |
| Mascot art | `src/components/brand/Mascote.tsx` | The mascot line art stays for the site's own decoration (empty states, Links page); it is no longer tied to avatars. |

**Rights.** These icons show studio characters and photos of real actors. On 2026-10-31 the site owner confirmed they accept the copyright and image-rights risk of using them on a commercial site. If a takedown request arrives, replace that PNG and run `npm run avatars`; the key stays the same, so no migration is needed.

## 5. Dashboard images and "Adicionar texto?" (2026-10-31, night)

| Change | Where | Notes |
|---|---|---|
| Oversized uploads shrink in the browser | `src/lib/media-downscale.ts`, `MediaDrop.tsx` | **Sizes**: posters scale down to cover 1200 × 1800, backdrops 2560 × 1440, logos fit inside 1920 px. Posters and backdrops are re-encoded as JPEG 0.92, logos as PNG so they keep transparency. **Rules**: the server's checks are unchanged: 600 × 900 is the poster **minimum**, and 10 MB / 40 MP the caps. A file the browser can't decode is sent as it is. **Test**: a browser test uploads a 26 MB, 2400 × 3600 PNG. |
| Backdrop fades on the left | `src/styles/hero.css` | A mask on `.wf-hero__art` dissolves the image's left half into the page with eased stops, so there's no hard edge at any width (checked at 1432, 1920, 2560 and 3440 px). Phones are unchanged. |
| "Adicionar texto?" | `CatalogItem.posterTitle` (default on, migration `20261105120000_poster_title`), editor checkbox under the poster (movies), `HeroCarousel` | **On** (the default for every existing movie): the carousel card draws the movie's name over the poster, as before. **Off**: the card shows only the artwork, for posters with the title already printed on them; the card's accessible name still says the title. **History**: the setting is part of the content snapshot, so it reverts with the rest, and snapshots saved before it existed mean "on". Audit entries record the field name only. |
