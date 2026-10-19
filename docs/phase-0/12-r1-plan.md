# 12 — R1 plan: redesign foundation (hand-off)

> Status: **built and tested** 2026-10-02 — what was delivered, deviations and results: [`../r1/README.md`](../r1/README.md), [`../r1/test-report.md`](../r1/test-report.md) · approved 2026-10-02 · Read first: [11-redesign-spec.md](./11-redesign-spec.md) (rules, data model, API, security), [../design/README.md](../design/README.md) + [`../design/r1-prototype.html`](../design/r1-prototype.html) (visual target), [../phase-1/README.md](../phase-1/README.md) (what exists). Written so any Claude session attached to the Wiskiflix project can start cold.

## 0. Preconditions (check in this order)

1. `curl -sI https://registry.npmjs.org/zod` → **200**. A `403` with `x-deny-reason: host_not_allowed` means package downloads are blocked for this session. Stop and tell the user (on 2026-10-02 a fresh task had npm access while an older one didn't). Never route around the policy.
2. `Documents\Wiskiflix` is connected. Bring the Phase 1 tree into the workspace from `Claude outputs/wiskiflix-phase1.zip`, then apply the newer files from the folder (the folder wins on conflicts). `npm ci` must reproduce the Phase 1 green test suite before anything changes.
3. The Figma connector is available for reference (file `2BEBwLG8vsFYiaX4ZYhTFi`, frames `20:375` and `113:120`; asset downloads from figma.com are blocked in the workspace, so implement from `get_design_context` + the prototype).

## 1. Scope

**In:**
- data model + migration (11 §7)
- dashboard: catalog CRUD, slots, revisions/revert, publish, media upload pipeline
- campaign open/extend/goal endpoints (no payments yet)
- new header + bottom tab bar + neon tokens; public pages Filmes (hero carousel), Séries, Franquias, detail pages, Avaliações (shell), Perfil (sign-in + account merged)
- trailer modal
- passkeys (required for MODERATOR and STREAMER on `/admin`)
- removal of TMDB/YouTube/catalog-rules/packages

**Out:** checkout, Pix, webhook, contributions (Phase 2) · reviews logic (Phase 3) · overlays, media kit, sessions admin (Phase 4) · deploy (Phase 5).

## 2. Work order

| # | Step | Key changes | Done when |
|---|---|---|---|
| 1 | Baseline | unpack Phase 1, `npm ci`, run every suite | Phase 1 test report reproduced |
| 2 | Data model | `CatalogItem`, `FranchiseEntry`, `CatalogRevision`, `MediaAsset`, `Campaign`, `Order` (+ movie/contribution fields); drop `Title`, `CatalogRule`, `CatalogPackage`, `Sponsorship`, `MediaSource`, YOUTUBE/ANIME; repoint `Payment`, `LegalAcceptance`, `VoucherRedemption`, `QueueJumpSlot`, `WatchEvent`, `Review`; reviewed SQL (CHECKs incl. `remainingCents = goal − raised − reserved ≥ 0`, partial unique `(kind, slot)` for live items, kind-specific column CHECKs on `Order`) | migration applies on Postgres 17; constraint tests for every new CHECK/unique; `prisma validate` |
| 3 | Env + headers | remove `TMDB_*` (and the licence boot rule); add `MEDIA_DIR`; CSP `frame-src` + `https://www.youtube-nocookie.com`; nginx Permissions-Policy (`autoplay`, `encrypted-media`, `fullscreen`, `picture-in-picture` for self + that origin), `/media/` location (static, immutable, nosniff, CSP `default-src 'none'`), upload location (`client_max_body_size 11m`, own `limit_req`) | env + CSP unit tests; header e2e (still exactly-once) |
| 4 | Passkeys | `@simplewebauthn/server` + `/browser`; enrol in `/perfil/seguranca`; `/admin/**` and every admin API require a passkey assertion ≤ 10 min (`Session.mfaAt`) for MODERATOR/STREAMER; STREAMER money actions also need Google step-up | integration tests: no passkey → 401 with enrol/verify hint; replayed assertion and wrong origin/RP-ID rejected; counter regression rejected |
| 5 | Media pipeline | `POST /api/v1/admin/media` (multipart, streamed to temp, ≤ 10 MB): byte sniffing (JPEG/PNG/WebP/AVIF only), `sharp` with `limitInputPixels` 40 MP, minimum size per role, auto-rotate, strip metadata, AVIF + WebP widths per 11 §5, content-hash names in `MEDIA_DIR`, original deleted, `MediaAsset` row; processing concurrency 1 with a timeout (inline is fine for R1 volume; move to the BullMQ worker in Phase 2) | fuzz corpus test: SVG, HTML renamed `.jpg`, polyglot JPEG/HTML, PNG bomb, 11 MB, EXIF-GPS (stripped), path-traversal filename, wrong role → each handled; output files contain no metadata |
| 6 | Catalog services + admin API | 11 §8: items CRUD, publish (counts 35/10/10 under an advisory lock), replace/reorder slots, revisions + revert, watched; campaign open/extend/goal (STREAMER + step-up). Sanitiser on all text, Zod `.strict()`, audit every write | authz matrix extended to all new routes × roles; revert restores exact snapshot; publish beyond 35 → 409 |
| 7 | Theme + layout | `globals.css`: glow tokens (design §3); header per design §2; bottom tab bar ≤ 760 px; `/entrar` and `/conta*` fold into `/perfil` (301 redirects); TMDB attribution removed from the footer; footer links: legal, media kit, contact, privacy channel | visual check against `../design/*.png` at 360, 390, 1440, 1920; axe 0 violations |
| 8 | Public pages | `/` Filmes hero carousel (server-rendered first item, client island for arrows/keyboard/swipe, `aria-live`, active card centred, Patrocinado/Reservado states, CTA disabled states, price line); `/series`, `/franquias` (featured + grid, progress from `Campaign`); `/filmes/[slug]`, `/series/[slug]`, `/franquias/[slug]`; `/avaliacoes` shell; images via `<picture>`/`srcset` from `MediaAsset` | e2e: carousel keyboard + buttons + counter; CSP 0 violations on every page **including with the trailer modal open**; no `style=` attributes in SSR HTML |
| 9 | Dashboard UI | `/admin/catalogo` per the prototype: sidebar, slot board (drag reorder with keyboard alternative), editor with live price, YouTube link validation, drop zones, preview "Ver como visitante", draft/publish, history + revert | e2e: moderator creates → uploads → publishes → movie appears in the carousel; revert; second moderator conflict (`version`) handled |
| 10 | Seed + docs | dev seed with **fictional** titles and brand placeholder art (like the prototype); update 02/03/05 summaries; `docs/r1/README.md` + `test-report.md` | all suites green; report written |

## 3. Exit criteria

- All Phase 1 suites still green.
- New suites green: constraints, media fuzz, passkeys, catalog authz matrix, carousel and dashboard e2e.
- CSP 0 violations on every page, with the trailer open.
- Each security header exactly once; `npm audit` clean.
- Pages match the design PNGs at 390 / 1440 / 1920.
- Delivered to `Documents\Wiskiflix` the same way as Phase 1: batches of ≤ 50 files, no `node_modules`, `.next` or secrets; zip in the chat.

## 4. Inputs from the user

None needed to start. Still open from earlier: the Google OAuth client (needed for a real login test), and the GitHub private repository (CI). Turnstile isn't needed until Phase 2.
