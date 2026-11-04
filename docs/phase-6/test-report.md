# Phase 6 — test report

> Run: 2026-10-31, Claude's Linux workspace · Node 24.19.0 · Postgres 17.10 (embedded) · Redis 7.0.15 · nginx 1.24 (production template) · Chromium (Playwright 1.64.1, build 1243)
> Tree: branch `phase-6-features`. Build notes: [`README.md`](./README.md).

## Summary

| Suite | Command | Result |
|---|---|---|
| Lint / typecheck / formatting | `npm run lint` · `npm run typecheck` · `npm run format:check` | ✅ |
| Unit | `npm test` | ✅ **312 / 312** (+19: link addresses, platform names, hours and minutes, the tab split) |
| Integration | `npm run test:integration` | ✅ **922 / 922** (+45: 8 authz endpoints × 4 roles, links, suggestions, progress, Phase 6 reviewed SQL, the 20-series limit) |
| E2E (production build behind the production nginx template, 360 + 1280 px) | `npm run build && npm run test:e2e` | ✅ **302 passed**, 0 failed, 0 flaky (44 skipped by design: one-viewport tests) |

## New and changed suites

| File | Covers |
|---|---|
| `tests/integration/community.test.ts` (9) | **Links**: add, edit, hide, reorder and delete, with positions staying 1…n and the audit log holding field names only. Unsafe addresses refused: `http:`, `javascript:`, `data:`, user-info, localhost, IP addresses, ports, spaces, `ftp:`. 30-link cap; moderators get 404; IDN hosts become punycode. **Suggestions**: anonymous → 401; text sanitised (bidi override and zero-width characters removed); same title twice → 409; 5 a day per account → 429; at most 10 waiting; suspended and not-yet-onboarded accounts refused. The staff list groups the same title. Decisions are compare-and-set (a second moderator who still saw "NEW" → 409), audited once, and reopen clears them. LGPD: export, erase, 12-month purge (waiting ones stay). Title keys handle accents, punctuation and non-Latin scripts. **Progress**: watched titles (archived ones included, never-watched excluded), runtime minutes and the queue (PAID and SCHEDULED movies, funded campaigns), per kind. |
| `tests/integration/db-constraints-phase6.test.ts` (4) | `SocialLink`: the https-only URL CHECK, label/note lengths, positions 1–30, unique position checked at COMMIT (a swap in one transaction works). `Suggestion`: lengths, normalised key, year range, reviewer/time exactly when decided, one waiting suggestion per viewer and title. |
| `tests/integration/db-constraints-r1.test.ts` | Limits now 35 / **20** / 10. Series slot 21 and franchise slot 11 are refused; the 21st live series is refused (`WF409`); concurrent publishes stop at exactly 20. |
| `tests/integration/authz.test.ts` | 8 new rows (`/api/v1/suggestions`, `/api/v1/admin/suggestions[/id]`, `/api/v1/admin/links[/id]`, `/api/v1/admin/links/order`) × anonymous / USER / MODERATOR / STREAMER |
| `tests/unit/community.test.ts` (19) | `cleanLinkUrl` (15 hostile or useless inputs), `platformOf` (no match on look-alike hosts such as `twitch.tv.evil.example`), `hoursMinutes`, the desktop/phone tab split |
| `tests/e2e/community.spec.ts` (6) | **Home**: "Nosso progresso" with three tiles and their splits. **/links**: buttons in order; the platform name shows only when it adds information; no new tab; `noreferrer`. **/sugestoes signed out**: a sign-in link that comes back. **Full loop**: viewer suggests, the duplicate is refused, a moderator accepts in the dashboard, the viewer sees "Aceita". **Streamer link editor**: add, move up, hide, and the hidden link is gone from /links. **Phone**: five tabs + "Mais"; the menu opens, closes on Esc, navigates and closes; the button says where you are. |
| `tests/e2e/viewports.spec.ts` (+5) | Logo and eight header tabs on one line with no clipped label and no horizontal scroll at 761, 800, 900, 1024 and 1180 px |
| `tests/e2e/support/pages.ts` (+5 pages) | `/links`, `/sugestoes` (signed out and in), `/admin/sugestoes`, `/admin/links`. They go through the CSP (0 violations, nonce on every script), axe accessibility and layout specs on both viewports. |
| `tests/e2e/design-match.spec.ts` | Header order now includes Sugestões and Links |

## Findings fixed during the run

| # | Finding | Fix |
|---|---|---|
| F1 | At 761 px the header was 23 px wider than the screen with eight tabs. | 761–880 px: 14 px labels and tighter gaps. The new viewport test covers 761 to 1180 px. |
| F2 | The "Mais" menu's links picked up the tab bar's stacked icon-over-label style, because the bar's rules matched every link inside it. | The bar's rules now match only its direct children; the menu has its own row layout (screenshot checked). |
| F3 | On /links, a button named "Twitch" showed "Twitch" again as its platform tag. | The tag shows only when it differs from the button's name. |

## Addendum — profile pictures v2 (same evening)

| Suite | Result |
|---|---|
| Unit | ✅ 312 / 312 — avatar registry (30 keys, default, labels, file per size, retired keys fall back) and every built WebP checked: 128/256 px, square, alpha kept, under 20/60 KB |
| Integration | ✅ **923 / 923** (+1: the data migration moves old presets by position, sends unknown values to the default, and the column default is `perfil-01`) |
| E2E | Full run: 295 passed. The only failures were both viewports of the onboarding test, whose forced click on the hidden radio landed outside the new full-bleed picture. **Fixed** by centring the radio in its cell. Then re-run: `account-flow` 8 / 8; the accessibility, layout and CSP checks of `/bem-vindo` and `/perfil` and the review cards 32 / 32; `headers.spec` also covers `/avatars/…` (every security header once). |

Screenshots of the picker (360 px) and a profile header (1280 px) were checked by eye.

## Addendum — Cronograma posters, Assistidos, next seasons (2026-11-01)

| Suite | Result |
|---|---|
| Unit | ✅ 313 / 313 (nine tabs; phone "Mais" holds four) |
| Integration | ✅ **947 / 947**. New `releases.test.ts` (6) covers: add/edit/delete with audit; linked series lend name, poster and link; a movie as the series and bad input are refused; viewers get 404; the 7-day window; drafts lend no poster or link; the database CHECKs and the series-only trigger; Assistidos order and kind filter; posters on Cronograma titles. Plus 4 authz rows × 4 roles. |
| E2E | Full run: 321 passed. Two failures, both fixed: the Assistidos grid clashed with the Avaliações class `.wf-watched` (renamed `.wf-seen`), and with it the filter's target size. After the fix: `community`, `a11y-layout` and `csp` specs 212 / 212, the phone filter on one row with no horizontal scroll, and the header with nine tabs from 761 to 1280 px (`viewports.spec`). |

## Addendum — Links icons, one legal text, 40 profile pictures (2026-11-01, evening)

| Suite | Result |
|---|---|
| Lint / typecheck / formatting | ✅ |
| Unit | ✅ **321 / 321** (+8). New `legal-text.test.ts`: the markup parser (headings, loose lists merged, bold, links, blanks) never turns text into markup (`http:`/`javascript:` links, unknown or prototype placeholders like `{constructor}` and raw tags stay text). The published text has sections 1–17 in order with unique anchors, nothing left over from the .docx, and https links to the Google, Mercado Pago and Cloudflare policies. `community.test.ts`: Amazon (storefronts and short links, not `amazon.evil.example`), Steam store, Kick, Cinefy, and every requested platform has a glyph. `rules.test.ts`: 40 avatar keys. Every built WebP (80) is checked for size, shape and alpha. |
| Integration | ✅ **949 / 949** |
| E2E | Full run: **329 passed**, 1 failed, 50 skipped by design. The failure: at 360 px `/privacidade` was wider than the screen, because long policy URLs did not wrap (F1). After the fix, the legal, layout/accessibility, CSP and Links checks were re-run on a fresh build: 20 / 20. New `legal.spec.ts`: `/termos` → 308 → `/privacidade`; 17 sections and contents links that jump to their anchor; the provisional notice and "[a definir]" blanks; the footer's single "Termos e privacidade" link and the LGPD link landing on section 1. `community.spec.ts`: new intro text, a decorative icon (one path, `aria-hidden`) on every seeded link, accessible name unchanged. |

| # | Finding | Fix |
|---|---|---|
| F1 | `/privacidade` overflowed at 360 px: the Mercado Pago and Google policy URLs are single long words. | Links in the text wrap anywhere, and the article's children may shrink (`min-width: 0`). |
| F2 | In the two-column contents, a wrapped entry ("Dados de pagamento e limitações de responsabilidade") had its number on the second line. | Entries align to the top. Screenshot checked. |

Note: the environment's Playwright now looks for Chromium build 1248 while 1243 is installed; the runs above used `PW_CHROMIUM_EXECUTABLE` (supported by `playwright.config.ts`) pointing at the installed headless shell.

## Addendum — release posters, year-only releases, "Meta total" (2026-11-01, night)

| Suite | Result |
|---|---|
| Lint / typecheck / formatting | ✅ |
| Unit | ✅ 321 / 321 |
| Integration | ✅ **956 / 956** (+7). `releases.test.ts`: an own poster wins over the series' poster (also on unlinked releases), and removing it brings the series' poster back. Year-only releases are stored on 31 December, sort after dated ones in the same year, switch to an exact day and back, and read "Estreou" only once the year is over. Refused: a backdrop as poster, date and year together, neither, years outside 2000–2100, and non-integer or text years. Audit records `poster`/`yearOnly` and the changed field names. Database: the year-only CHECK and the poster-role trigger. `overlay.test.ts`: "Meta total" over SSE = R$ 45 of R$ 140 → 32 %, 1 of 3 titles; watched and draft titles left out; no amount in the payload; the key only opens what it lists. All five widgets fit on one key, and a paid order pushes a fresh "Meta total" through Redis. Edge cases: titles with no goal are skipped, over-raised campaigns are capped, an empty board is 0 %. `db-constraints-p4`: five widgets allowed, six refused. |
| E2E | Full run: **326 passed**, 2 failed (both viewports of the Cronograma check), 50 skipped by design. Cause: the new seeded year-only release made a "the one unlinked row" locator match two rows. Fixed by filtering by name and asserting the seeded "Maré Alta" row ("Previsão: 2027", own poster). Re-run: `community` + `operations` 20 / 20, `operations` + `csp` 103 / 103. New tests: a moderator adds a year-only release with an uploaded poster, and the Cronograma shows "Previsão" and the poster. `/overlay/meta-total` shows the percentage, the title count and three per-board bars, with no "R$". |

| # | Finding | Fix |
|---|---|---|
| F1 | On the "Meta total" overlay, the per-board bars used the browser's default progress style (green on grey), and their lengths varied with the width of the numbers next to them. | Bars use the site's progress style; the numbers have a fixed, right-aligned column. Screenshot at 1920 × 1080 checked. |

## Addendum — several overlay keys in one OBS (2026-11-01, late)

| Suite | Result |
|---|---|
| Unit | ✅ 321 / 321 |
| Integration | ✅ **958 / 958** (+2). Exchanging an older key after a newer one keeps both grants: "Meta total" and "Fila" open, and "Meta", which neither key lists, does not. Revoking one key closes only its widgets. Up to 8 keys are remembered (the 9th pushes out the oldest), and a tampered cookie counts as empty. |
| E2E | `operations` 5 / 5; `operations` + `two-factor` + `csp` + `headers` 147 / 148 before one test fix. New: two keys in one browser, the way OBS works (newer, then older, then the newer widget again with no key in the address), plus the "not in this key" and "invalid key" messages. Fix: that test had changed only the `#k=` fragment on the same page, which does not reload it; it now loads the page fresh, as OBS does. |

## Addendum — OBS on npm run dev, poster glow, reviews side by side (2026-11-01, late)

| Suite | Result |
|---|---|
| Lint / typecheck | ✅ |
| Integration | `overlay.test.ts` ✅ 51 / 51 (+1: the cookie name and flag for development over http versus everything else) |
| Manual reproduction | `next dev` over http against the test stack: the key exchange sets `wf_overlay_dev` (HttpOnly, SameSite=Strict), and `/api/v1/overlay/stream?widget=meta-total` with that cookie answers 200 with the "Meta total" event. The same request with the `__Host-` name is refused, as expected in development. |
| E2E | `reviews`, `carousel`, `design-match`, `viewports`, `operations` ✅ 56 / 56; `a11y-layout` + `csp` for the affected pages ✅ 16 / 16. New check: on Avaliações at 1280 px, two cards share a row with the same height; at 360 px they stack. Screenshots checked: the active poster's glow at 1920 × 1080 now fades out, and Avaliações shows three cards per row. |

## Addendum — 45 profile pictures by colour (2026-11-02)

| Suite | Result |
|---|---|
| Unit | ✅ 321 / 321 (45 keys; the colour order is a permutation of the keys; every built WebP checked) |
| E2E | `account-flow` ✅ 8 / 8; the picture-related `a11y-layout`, `csp` and `headers` checks pass. The onboarding test now checks 45 options, colour order (Avatar 9 first, Avatar 39 last) and picks the new Avatar 44 with the keyboard: on the 360 px run, a forced click on that option landed on the fixed tab bar. |

## Addendum — Mercado Pago refusals explained in the log (2026-11-02)

When Mercado Pago refuses a request, the server log (`mercadopago error`) now carries MP's error codes (`causes`) and `message`, cut to 200 characters, sanitised, with e-mails and long digit runs masked. Before, it carried the HTTP status only, which wasn't enough to tell an account without a Pix key (code 13253) from a refused payer e-mail or bad credentials. Unit 323 / 323 (+2: what is kept, what is masked, non-JSON bodies). Integration 959 / 959.

## Addendum — manual price, "Já pago", 50 movies, home grid and Twitch (2026-11-02)

| Suite | Result |
|---|---|
| Unit | ✅ 327 / 327 (+2: the manual price replaces base + extra minutes, discounts and queue jumps still apply; CSP `frame-src` includes the Twitch player) |
| Integration | ✅ 984 / 984 — new `manual-orders.test.ts` (9): manual price in quote, checkout charge, public reads and the total goal; streamer-only and range checks; "Já pago" for a movie (SPONSORED, PAID, no Payment, no MP call, audited without the name), idempotency, campaign amounts (any amount, FUNDED when complete, a pending Pix keeps its share), undo for movies and funded campaigns, site orders not undoable, step-up. `db-constraints-phase6` (+2): `ci_manual_price`, `ord_manual`, relaxed contribution rule for MANUAL only. `db-constraints-r1` / `catalog`: the 51st movie is refused. Authz matrix: +3 rows. |
| E2E | ✅ after rebuilding (the first full run, 320 passed, used a stale build: "34/35" in the sidebar): the affected specs (community, operations, headers, csp, a11y-layout, carousel, viewports, design-match, dashboard) 0 failures, `community` 19 / 19 — `community` (+2): the available-movies grid below the carousel; the Twitch block only while a session is LIVE (the count excludes the seeded movie with a Pix in progress, shown as "Reservado"), nothing requested from Twitch before the click, the player URL after it. `operations` (+1): "Já pago" in Pedidos and its undo. `headers`: Permissions-Policy delegates autoplay/fullscreen to youtube-nocookie and the Twitch player only. |

## Addendum — "Já pago" in the editor, ring-style goal overlays (2026-11-02, night)

| Suite | Result |
|---|---|
| E2E | ✅ dashboard + operations + csp: 111 passed, 0 failed — `dashboard` (+1): the streamer registers a live movie as paid from the editor, the tile turns "Patrocinado", no second "Já pago", undone in Pedidos. `operations`: the "Meta" and "Meta total" overlays render with the new rings (same text checks: percentage, "X de Y títulos garantidos", one entry per board, no "R$"). `csp`: no violations. |

## Addendum — deploy helpers (2026-11-02, night)

| Suite | Result |
|---|---|
| Integration | ✅ 987 / 987 (+3 `legal-publish.test.ts`: the three types registered with the text hash and seen by checkout, idempotent re-run, an older current version replaced, the same version with another text refused and rolled back) |
| Ops | `shellcheck -S warning scripts/ops/compose.sh` clean; `npm run build:worker` builds the `--publish-legal` entry |

## Addendum — final legal texts (2026-11-03)

| Suite | Result |
|---|---|
| Lint / types | ✅ `eslint src tests`, `tsc --noEmit` clean |
| Unit | ✅ 331 / 331 — `legal-text.test.ts` (+2): every placeholder the privacy text uses is filled in and the e-mail is an address; the refund terms parse to sections 1–17 with anchors, name the refund cases (duplicated payment, processing error), use the `{email}` channel and leave no markup characters in the text |
| Integration | ✅ 987 / 987 — `legal-publish.test.ts`: TERMS/PRIVACY with the privacy version and hash, REFUND with its own version and hash, checkout sees all three, re-run a no-op |
| E2E | ✅ legal + checkout + a11y-layout specs on a fresh production build, 360 + 1280 px: 102 passed, 0 failed — `legal` (+1): `/privacidade` has no provisional notice and no blanks, names Strategol Security in section 1, `mailto:` channel; `/reembolso` shows the refund title, "Reembolso · Última atualização 3 de novembro de 2026", 17 contents links, the duplicated-payment case and the channel |

## Addendum — sponsor messages without prior approval (2026-11-03)

| Suite | Result |
|---|---|
| Lint / types | ✅ clean |
| Unit | ✅ 331 / 331 |
| Integration | ✅ 988 / 988 — `orders-admin.test.ts`: a new order's message is shown at once while the guest name stays private until approved; a moderator hides the message and shows it again (each change audited with the decision only, never the text); the same decision twice, or a decision on an order without a message, is 409 `NOTHING_TO_REVIEW`; a stale version is 409 |
| E2E | ✅ checkout + operations + a11y-layout + csp on a fresh production build, 360 + 1280 px: 198 passed, 0 failed |

## Addendum — faster payment confirmation (2026-11-03)

| Suite | Result |
|---|---|
| Integration | ✅ `webhook.test.ts` 45 / 45 — reconciliation runs every 15 s; a payable Pix is re-read after 15 s (not after 10 s) and turns PAID; a 40-minute-old open payment is not re-read after 30 s, only after 2 min; "finds an approval whose webhook never came" unchanged |

## Addendum — subathon timer (2026-11-03)

| Suite | Result |
|---|---|
| Lint / types / format | ✅ clean (`--max-warnings=0`) |
| Unit | ✅ 353 / 353 — new `subathon.test.ts` (18): R$ → seconds (R$ 1 = 60 s), BRL/USD/EUR tips, rates schema; clock and delta text; time left from `endsAt`; Astro frame → activity; tips, bits, subs by tier, Prime, resubs, gift subs (single, community purchase in both shapes, recipients); switched-off sources, follows/raids and dashboard test alerts don't count; label limits; the gift ledger counts each gift once in either order and after its window; the channel id from the JWT |
| Integration | ✅ 1025 / 1025 (full run; `db-constraints-p4.test.ts` now allows six widgets on a key and still refuses seven); `subathon.test.ts` 16 / 16: one open subathon (second refused), start → pause → resume → end with the time kept, stale version / wrong state 409, a timer at zero ends at that moment and takes no more time, settings audited by field name; ledger (READY vs RUNNING, idempotent per source, cap, zero floor, manual adjust audited, nothing without an open subathon); site orders credited once and refunds debited exactly once, orders before the subathon and switched-off site payments ignored; StreamElements tip + bits + sub, a re-delivered activity ignored, a 5-sub community gift counted as 5 with recipients before and after the purchase; overlay keys with the new widget; reviewed CHECKs. Authz matrix: the five new endpoints, streamer only |
| E2E | ✅ full run on a production build, 360 + 1280 px: **353 passed**, 0 failed, 57 skipped by design. New `subathon.spec.ts`: the streamer creates a subathon (rule preview "Sub Tier 1: R$ 10,00 → +10:00"), the OBS widget opened with a real key shows "Começa em breve", counts down after "Iniciar timer", "+5 min" in the dashboard pops "+5:00 · Tempo adicionado pela streamer" on the widget over SSE and lands in the log, "Pausado", "Encerrar" → "Fim do subathon!" and 00:00:00. `/admin/subathon` added to the CSP / accessibility / layout page list (and a moderator gets 404) |

### Found and fixed during the run

- **Overlay keys couldn't include the new widget**: the database allow-list of widget names (`OverlayKey.ok_values`) didn't have `subathon`, so creating an OBS key for the timer would have failed in production. The subathon constraints migration replaces the CHECK (now 6 widgets).
- **zod in the OBS page**: the widget imported the shared module that also defines the request schemas, so zod reached the overlay bundle and probed for `eval` (a CSP violation on every overlay page). The clock and pricing helpers moved to a zod-free `src/lib/subathon-time.ts`.
- **Widget pops**: each pop's removal timer was cancelled by the next update (pops could stay); one timer per pop now. The StreamElements connector subscribes on open (not on a `welcome` frame) and sends the channel `room` from the token.

## Addendum — subathon chat commands (2026-11-04)

| Suite | Result |
|---|---|
| Integration | ✅ `subathon.test.ts` 19 / 19 (+3): `!pausar` / `!retomar` / `!tempo` answer one line of plain text and change the timer through the same compare-and-set, audited with `via: "command"` and no actor; only the key's hash is stored; a wrong, malformed, replaced or revoked key is 401 and changes nothing; an unknown action or an extra query parameter is 422. Authz matrix: the key endpoints are streamer only, the command endpoint answers 401 without a valid key for every role |
| E2E | ✅ `subathon.spec.ts`: "Criar comandos" shows the three StreamElements responses; a GET of the `!pausar` URL through nginx (as `customapi` does) answers `text/plain` "⏸️ Timer pausado: faltam …", the OBS widget shows "Pausado", a wrong key is 401, the dashboard catches up within its refresh |


## Addendum — Roleta (2026-11-04)

| Suite | Result |
|---|---|
| Lint / types / format | ✅ clean (`--max-warnings=0`); no schema drift beyond the two known exclusion constraints |
| Unit | ✅ 360 / 360 — new `roleta.test.ts`: every one of the 15 000 draw values maps to a prize with exactly 1/150, 1/500, 1/1 000, 1/2 500 (and 14 849 "Nada"); out-of-range draws refused; nine slices, each prize on its own; periods start at 17:00 BRT (16:59 is still the day before), the next renewal, "hoje"/"amanhã" text. Navigation: ten tabs, Roleta under "Mais" |
| Integration | ✅ 1075 / 1075 (full run); `roleta.test.ts` 11 / 11: five spins through the API then 409; renewal at 17:00 without stacking; nine parallel spins → exactly five, numbered 1…5; onboarding / suspended / closed refusals and the audited switch; coupon voucher (30 %, one use, 30 days, code never in the audit); Twitch login validation and ownership; Admin list without "Nada", counts; compare-and-set, streamer-only cancel that switches the voucher off, no way back from cancelled; 30-day purge of "Nada"; LGPD export and erase; reviewed CHECKs. Authz matrix: six new endpoints |
| E2E | ✅ `roleta.spec.ts`, `community.spec.ts`, `design-match.spec.ts`, `viewports.spec.ts` (ten tabs on one line from 761 px), `a11y-layout.spec.ts` and `csp.spec.ts` with `/roleta` (signed out and in) and `/admin/roleta`: a viewer spins five times until "Sem giros hoje"; a won movie gets the viewer's Twitch login, a moderator marks it delivered, the viewer sees "Entregue" |

## Addendum — badges, ranking, queue card, catalog filters, analytics (2026-11-04)

| Suite | Result |
|---|---|
| Lint / types / format | ✅ clean (`--max-warnings=0`) |
| Unit | ✅ new `community-catalog.test.ts` (15): badge thresholds and progress; search (accents, direction, cast), genre, duration buckets, every sort with missing values last, campaign sorts, the address round trip; queue estimate (done titles skipped, a live running late estimates from now), countdown text; analytics buckets (BRT days, Monday weeks, calendar months), sums, change, ticks; ranking ties (1, 2, 2, 4) and the São Paulo month |
| Integration | ✅ new `community-analytics.test.ts` (7): badges count named, paid sponsorships/contributions and visible reviews/likes — never anonymous, refunded or hidden ones; the switch is saved, audited, exported, read by the public profile; the ranking leaves out the opted-out, the suspended and the streamer, ties share a place, month vs all time, critics and likes boards; a title waiting (2º de 2, next live) → booked (2º, start + 95 min) → playing; a funded series queues; revenue excludes pending and refunded orders, Pix vs "Já pago", previous period and change, series sum, top titles, conversion |
| E2E | ✅ new `community-catalog.spec.ts`: home search/sort/duration narrow the grid and stay in the address, "Limpar filtros", a shared link opens filtered; the seeded paid movie shows its queue card; /ranking lists @luana_v, no amounts, period switch; a VIP viewer's badge on the public profile, 13 on /perfil, the switch hides them; Admin › Análise: revenue, the chart (30 columns), keyboard tooltip, table view, 12-month view. `/ranking`, filtered Filmes/Séries and `/admin/analise` (a moderator gets 404) added to the CSP / accessibility / layout page list |

### Found and fixed during the run

- **Accessibility:** the chart's focusable hit areas carried `aria-label` on a plain SVG `rect` (prohibited without a role) → `role="img"`; locked badges were dimmed as a whole, failing text contrast → only the ring is dimmed; the ranking position used `aria-label` on a `span` → screen-reader-only text.
- **The opt-out switch** only moved after the save answered → optimistic, with a rollback on error.
- **Polish from the screenshots:** the filter count ("31 filmes" under "30 filmes esperando patrocínio") now reads "N de M" only while a filter is on; shorter default options so the selects fit at 360 px; the chart tooltip moves beside a column that reaches the top.
