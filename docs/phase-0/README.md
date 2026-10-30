# Wiskiflix — Phase 0 (architecture & security design)

> Status: **rev 9 — Phase 2 (payments) done (2026-10-30)** · [../phase-2/README.md](../phase-2/README.md), [../phase-2/test-report.md](../phase-2/test-report.md) · rev 8: R1 done (2026-10-02) · R1: [../r1/README.md](../r1/README.md), [../r1/test-report.md](../r1/test-report.md) · rev 7: redesign approved; design package + R1 build plan ([11](./11-redesign-spec.md), [../design/README.md](../design/README.md), [12](./12-r1-plan.md)) · earlier: rev 4 · 2026-10-02 · site: `https://wiski.fun` (on Cloudflare) · server candidate: RedHosting 2 vCPU / 2 GB · **Phase 1 done (2026-10-02)** — see [../phase-1/README.md](../phase-1/README.md) and [../phase-1/test-report.md](../phase-1/test-report.md). Rev 5 corrections: 07 (new open items S1/S2), 09 (test vs production Mercado Pago ids).

Streamer website (UI in pt-BR) with paid sponsorships (Pix via Mercado Pago, guest checkout allowed), a review community, an admin panel and a media kit. This folder is the design baseline for Phases 1–5.

| Doc | Contents |
|---|---|
| [01-architecture.md](./01-architecture.md) · [architecture.svg](./architecture.svg) | Components, responsibilities, login / guest checkout / webhook / overlay flows, caching, conventions, repo layout |
| [02-data-model.md](./02-data-model.md) · [schema.draft.prisma](./schema.draft.prisma) | Prisma 7 model (28 models), state machines, DB-level constraints, retention |
| [03-api-surface.md](./03-api-surface.md) | Pages, every endpoint with auth/CSRF/Turnstile/rate-limit, RBAC matrix, SSE payloads |
| [04-pricing-spec.md](./04-pricing-spec.md) | Active prices (movie R$ 20 ≤ 130 min + R$ 1/min; R$ 100/season), price grid with queue-jump tiers, algorithm, rounding, caps, vouchers, rescheduling, no-refund policy, worked examples, test plan |
| [05-threat-model.md](./05-threat-model.md) | Assets, actors, trust boundaries, STRIDE (incl. guest checkout), webhook spec, header ownership checklist, rate limits, DDoS, TLS, LGPD |
| [06-design-tokens.md](./06-design-tokens.md) · [theme.proposal.css](./theme.proposal.css) · [design-preview.png](./design-preview.png) · [favicon-preview.png](./favicon-preview.png) | Asset inventory, palette + contrast, fonts, Tailwind v4 theme, avatars, logo "Wiski", favicon |
| [07-open-questions.md](./07-open-questions.md) | What's resolved, what's still open (recipient name + legal texts, RedHosting answers, GitHub, Google OAuth client), defaults in force |
| [08-hosting.md](./08-hosting.md) | 2 GB server sizing (memory/disk budget), conditions, questions for RedHosting, wiski.fun, e-mail, Cloudflare, backups |
| [09-mercadopago-setup.md](./09-mercadopago-setup.md) | Mercado Pago values received, what's secret, where to find things, when each is needed |
| [10-phase-1-plan.md](./10-phase-1-plan.md) | Phase 1 work order, exit criteria, delivery, inputs needed |
| [12-r1-plan.md](./12-r1-plan.md) | **R1 build plan (hand-off):** preconditions, work order, exit criteria for the redesign foundation |
| [13-livepix-alternative.md](./13-livepix-alternative.md) | Payments redesigned for LivePix, for comparison — **not chosen** (Mercado Pago kept, 2026-10-29) |
| [../design/README.md](../design/README.md) · [r1-prototype.html](../design/r1-prototype.html) | **R1 design spec** from the Figma hero + screens designed in the same language (mobile, Séries/Franquias, trailer, dashboard), neon tokens, deviations |
| [11-redesign-spec.md](./11-redesign-spec.md) | **Redesign (rev 6):** handpicked catalog (35 movies, 10 crowdfunded series, crowdfunded franchises), no TMDB/search, moderator dashboard + image uploads, trailer embeds, neon look, data/API/security deltas, rework plan. **Supersedes the catalog parts of 01–06 and 10.** |

## What changed in rev 6 (redesign)

New direction from 2026-10-02: no TMDB, no search; everything handpicked in a moderator dashboard. Movies: 35 slots, one sponsor pays in full ("Patrocine agora"), no prior approval. Series and franchises: crowdfunded (goal, deadline the streamer can extend, contributions ≥ R$ 5). Navigation: Filmes · Séries · Franquias · Avaliações · Perfil. Neon look in the brand purples, layout from the Figma concept. Payments unchanged. Details and the rework plan: [11-redesign-spec.md](./11-redesign-spec.md).

## What changed in rev 4

1. **Server:** Hostinger dropped. A 2 vCPU / 2 GB / 20 GB VPS (RedHosting) is enough for ≈ 1,000 visits/month **if** it is KVM with Ubuntu 24.04, images are built in CI rather than on the server, and containers run with memory limits (08 §1).
2. **Mercado Pago:** collector and application IDs recorded as non-secret config; production credentials active; only the payer-visible recipient name is missing.
3. **Phase 1 hand-off** written (10). Phase 1 also needs package downloads working in Claude's workspace.

## What changed in rev 3

1. **Prices:** movie R$ 20 up to 130 min, then R$ 1 per extra minute; series and anime R$ 100 per season (one package = one season; the streamer can override a package's price). YouTube disabled until it has a price.
2. **Domain and hosting:** `wiski.fun` behind Cloudflare; Hostinger VPS KVM 2 in São Paulo with plain Ubuntu 24.04 (superseded in rev 4).
3. **Mercado Pago:** webhooks configured in the MP panel (signed with its secret); checklist of what's needed in 09.

## What changed in rev 2

1. **Guest checkout:** no login needed to sponsor. Guests give a contact e-mail and get a private order link (token in the URL fragment). The receipt e-mail is sent only after payment. Logged-in buyers get the perk and can reschedule; guests can attach an order to an account later.
2. **Queue jump = fixed tiers:** "Prioridade" +80 % and "Topo da fila" +160 %, sharing daily/weekly caps that the database enforces.
3. **10 % discount** for moderators and VIPs (new VIP flag, set by the streamer). Not combined with vouchers: the larger discount applies.
4. **Series/anime** are sold as **admin-built packages** (rev 3: one package = one whole season); viewers search TMDB for movies only.
5. **No refunds** for sponsorships; a streamer-only exception tool remains for duplicate payments or errors. Policy text comes from your lawyer.
6. **TMDB:** design kept; production won't enable TMDB until the commercial licence flag is set.
7. **Brand:** logo "Wiski" in Black Rockie (generated from the font's own glyphs); display fonts licensed; favicon from `PNG - ICONS`, shown on an ink tile so it's visible on light browser tabs.

## Phase plan

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 1 ✅ | Scaffold, theme from assets (logo, favicon set, SVG pipeline), Google auth, sessions, CSRF, CSP/headers, rate limiting, audit log | `prisma validate` + migrate, CSP e2e with 0 violations, header-count test, authz matrix green, 0-pixel-diff asset test |
| R1 ✅ | Redesign foundation: handpicked catalogue (35/10/10), moderator dashboard, media pipeline, passkeys, neon theme, Filmes carousel, Séries/Franquias campaigns, detail pages | done 2026-10-02 — [../r1/test-report.md](../r1/test-report.md) |
| 2 ✅ | **Payments** (catalogue moved to R1) — done 2026-10-30, [../phase-2/test-report.md](../phase-2/test-report.md): price engine (movie price, queue-jump tiers, 10 % perk, vouchers), Pix checkout for movies ("Patrocine agora", guest + user) and campaign contributions ("Contribuir", ≥ R$ 5), Mercado Pago webhook, reconciliation, order pages/links, legal acceptance, campaign progress events | Price engine table/property tests, webhook suite (bad signature, replay, duplicates, out-of-order), concurrency tests (one sponsor per movie, no overfunding), guest-token tests |
| 3 | Reviews, likes, reports, moderation, public profiles | Sanitizer tests, XSS payload corpus, rate-limit tests |
| 4 | Remaining admin (sessions/schedule, VIP, users, moderation tools), media kit, contact, overlays (SSE) | Every admin route × role tested, overlay payload sanitization tests |
| 5 | Docker/nginx, `.env.example`, deploy guide (08-hosting), security checklist, test report | Observatory A+, SSL Labs A+, `npm audit` clean, restore drill done |
