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
