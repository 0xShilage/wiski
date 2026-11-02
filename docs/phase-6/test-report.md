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
