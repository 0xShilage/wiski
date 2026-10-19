# 07 — Open questions (rev 7 · 2026-10-02, R1 built; Q26 + Q27 answered)

## A. Resolved — your answers (2026-10-01)

| # | Topic | Decision | Where it changed the spec |
|---|---|---|---|
| Q1 | Logo | "**Wiski**" set in Black Rockie; no logo file | 06 §8 (built from the font's own glyphs) |
| Q2 | Font licences | You hold licences for Black Rockie and Escargoth → both ship | 06 §3 |
| Q3 | Favicon | `ASSETS/PNG - ICONS/favicon.png` | 06 §8 — proposed ink tile because the lilac file is invisible on light tabs |
| Q4 | TMDB | Keep the TMDB design; **commercial licence coming soon** | 03 §5.2: dev uses a free key; production refuses to enable TMDB until `TMDB_LICENSED=true` |
| Q6 | Queue jump | **Fixed tiers** | 04 §2/§5: `prioridade` +80 %, `topo` +160 %, shared daily/weekly caps |
| Q7 | Discounts | **10 %** for moderators and **VIPs** | 04 §4: perk needs login; new `User.isVip` flag; best single discount vs vouchers |
| Q8 | Scheduling | Calendar of stream sessions | unchanged (04 §7) |
| Q9 | Login to sponsor | **Not required** — guest checkout | 01 §3.2, 02, 03 §5.3, 05 §5: contact e-mail, order link token, receipts only after approval |
| Q11 | Series/anime | **Admin builds packages** in the dashboard | `CatalogPackage` = one whole season; viewers pick packages, not TMDB episodes |
| Q12 | YouTube | Paste a link only — **disabled for now** | 04 §3: kind disabled, tab hidden, no YouTube API key needed until you set a price |
| Q5 | Prices | Movie **R$ 20 up to 130 min + R$ 1/min above**; **R$ 100 per season** for series and anime, streamer can override per package | 04 §3 (price grid incl. queue-jump tiers), §9 examples |
| Q13 (partial) | Refunds | Sponsorships **never refunded**; lawyer already contacted | 04 §8: no buyer refunds; STREAMER-only exception tool for duplicates/errors/legal requirement |
| Q21 | Hosting, domain, e-mail | **wiski.fun** on Cloudflare (done). Hostinger dropped (no Brazil server offered); candidate **RedHosting** 2 vCPU · 2 GB · 20 GB | [08-hosting.md](./08-hosting.md): enough for ≈ 1,000 visits/month **if** KVM + Ubuntu 24.04 + images built in CI + memory limits; questions to ask RedHosting |
| Q22 | Mercado Pago | Pessoa física, Pix key registered, production credentials activated; ids `3733347216`/`5754049850745190` are the **test** app (production ids in 09 rev 5) | [09-mercadopago-setup.md](./09-mercadopago-setup.md) — only the payer-visible recipient name is missing |
| Phase 1 | Go-ahead | npm reachable; **Phase 1 built and tested on 2026-10-02** (`binaries.prisma.sh` is still blocked in Claude's workspace — migrations are checked by CI and locally) | [../phase-1/README.md](../phase-1/README.md), [../phase-1/test-report.md](../phase-1/test-report.md) |
| R1 | Redesign foundation | **Built and tested on 2026-10-02** (catalogue, dashboard, passkeys, media pipeline, new theme, desktop resolutions) | [../r1/README.md](../r1/README.md), [../r1/test-report.md](../r1/test-report.md) |
| Q26 | GitHub | **Private** repository `github.com/0xShilage/wiski` (anonymous read access is refused, so it is not public) | first push and repository settings: [../r1/README.md](../r1/README.md) §7; CI, Dependabot and CodeQL start with that push |
| Q27 | Google sign-in | OAuth client (Web application) `333411243821-f80tvc0hpoj3mh3sp9ocmcj17dhet5tc.apps.googleusercontent.com` (a client id is public by design). The **client secret stays with you**: type it into `.env.local` (and later the server's env), never into a chat | redirect URIs and consent screen as in 10 §5; real login testable locally once both values are in `.env.local` ([../r1/README.md](../r1/README.md) §7) |

## F. Redesign — your answers (2026-10-02) → [11-redesign-spec.md](./11-redesign-spec.md)

| Topic | Decision |
|---|---|
| Catalog | No TMDB, no search. Everything handpicked and edited in a moderator dashboard (texts + images). Supersedes Q4, Q11, Q12 and the TMDB items P1-b. |
| Movies | 35 handpicked, arrow-button carousel, full payment by one sponsor, **no approval before payment**; after payment the movie shows "Patrocinado" until watched, then a moderator replaces it |
| Series | 10 handpicked, **crowdfunded** |
| Franchises | **separate handpicked entries, crowdfunded** |
| Crowdfunding | **goal + deadline**; if the goal isn't reached, **the streamer extends the deadline** (money stays); contributions **any amount ≥ R$ 5** |
| Queue jump | kept for single movies (Prioridade +80 %, Topo +160 %), not for contributions |
| Look | layout from the Figma concept, neon glows in the **brand purples only**; logo "Wiski" in Black Rockie unchanged |
| Navigation | Filmes · Séries · Franquias · Avaliações · Perfil; no search button |
| Copy | "Patrocine agora", "Assistir trailer" |
| Payments | unchanged (Pix via Mercado Pago) |

**Approved 2026-10-02:** the whole redesign spec including defaults O2–O10. **O1 resolved:** Figma connector connected — the file contains only the desktop home hero (1440 + 1920); mobile, Séries/Franquias, trailer modal and the dashboard were designed in the same language → [../design/README.md](../design/README.md) (needs your look-over).

## B. Still open

| # | Needed for | What I need |
|---|---|---|
| S1 | ~~now~~ **mostly done (2026-10-02)** | Production Access Token renewed; `DATA.txt` is no longer in the project folder. Optional: also renew the production Client Secret (not used by the site) and the test user's password. |
| **S2** | Phase 2 / 5 | Confirm the **production** `collector_id` and Application ID in Suas integrações › Produção. Rev 4 recorded the **test** ids as if they were production (09 corrected). |
| P1-a | now | Run `npx prisma migrate status` once on your computer (Claude's workspace can't download Prisma's engine binary). |
| P1-c | Phase 2 forms | Cloudflare Turnstile widget for `wiski.fun` + `localhost` (site key + secret; dev uses Cloudflare's test keys). |
| P1-d | Phase 5 | Trusted Types enforcement: Next.js's chunk loader still triggers report-only violations on pages with client components; needs a TT policy for `/_next/static`. |
| **Q13** | Phase 2 (legal texts) | Name payers see as the Pix recipient (for a pessoa física account usually your legal name — confirm with a small Pix), plus the terms / privacy / no-refund texts from your lawyer. The site shows clearly-marked provisional pages until then. |
| **Q21b** | Phase 5 | RedHosting's answers to the checklist in 08 §1 (KVM? data-center city? IPv4? snapshots?) before you buy. |

## C. Defaults now in force (you didn't object) — still easy to change

| # | Default |
|---|---|
| Q10 | Optional sponsor message ≤ 140 chars, shown on stream only after moderator approval |
| Q14 | Orders kept 5 years (confirm with accountant); reviews deleted on account erasure |
| Q15 | Whole stars 1–5; editable with "editado"; spoiler toggle; auto-hide at 3 reports from accounts ≥ 7 days old; "watched" set automatically on COMPLETED + manually by moderators |
| Q16 | Sponsor names public by default, per-order "patrocinar anonimamente" checkbox |
| Q17 | Passkey second factor **required for STREAMER**, optional for moderators |
| Q18 | Media kit: Twitch + YouTube via official APIs, other platforms as manual values; contact form → Admin inbox + e-mail alert |
| Q19 | Goals: count, revenue (shown as % only), minutes watched |
| Q20 | Overlay widgets: Agora assistindo · Próximos da fila (top 5) · Meta · Novo patrocínio |
| Q23 | Posters inside FRAME 2 use `cover` |
| Q24 | Dark theme only; no analytics cookies; error monitoring only if it receives no PII |
| Q25 | TLS target = SSL Labs A+, TLS 1.2/1.3, HSTS preload (no OCSP stapling with Let's Encrypt) |

## D. New defaults from rev 2–3 — veto if you disagree

1. **Tier caps:** shared limit of 5 queue jumps/day and 20/week; max 1 "Topo da fila" per day; 1 jump per buyer per day.
2. **VIP flag** is set only by the STREAMER (step-up, audited). Moderators can't grant it.
3. **Guest display names** (for the queue/overlay) appear only after moderator approval; until then "Anônimo".
4. **Guest order access:** link with the token in the URL fragment + receipt e-mail sent after payment; guests attach the order to a Google account to reschedule.
5. **Package builder:** moderators and the streamer can build season packages; only the streamer can override a package's price (with a reason).
6. **Favicon:** the provided file unchanged, centred on an ink rounded-square tile (see `favicon-preview.png`). A ≥ 1024 px export or SVG of the SUBMARCA would make the 512 px PWA icon sharper — optional.
7. **Price limits:** movies accepted from 1 to 360 min (a 6-hour film would cost R$ 250); order minimum R$ 5,00, maximum R$ 2.000,00.

## E. Decisions I made earlier (unchanged; veto any time)

1. **Auth**: `openid-client` + own server-side sessions (not Auth.js/Better Auth) — full control of `__Host-` cookies, revocation, step-up.
2. **Realtime**: SSE everywhere (order status + overlays); no WebSockets.
3. **Mutations**: Route Handlers with one guard pipeline; no Server Actions.
4. **Jobs**: BullMQ worker container (same image) for webhooks, reconciliation, expiry, stats, e-mail, retention.
5. **Nonce CSP ⇒ all HTML dynamic**: no ISR/static HTML caching; data cached in Redis instead.
6. **Pricing**: versioned JSON rule sets, no stored quotes, `409 PRICE_CHANGED` instead of silent changes.
7. **No user-uploaded images** (preset avatars only).
8. **Code, docs and identifiers in English; all UI copy in pt-BR.**
9. **Brand SVGs**: lossless SVGO (style→attribute, id prefixing) + pixel-diff test, never redrawn.
10. **Header ownership**: CSP + Reporting-Endpoints + cookies + dynamic Cache-Control = app; HSTS, XFO, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, static Cache-Control = nginx; Cloudflare adds none.
