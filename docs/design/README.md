# Wiski — R1 design spec (from the Figma concept)

> Status: **for approval** · 2026-10-02 · Source: Figma "New Movie – Header Website (Community)", frames `1440` (20:375) and `1920` (113:120). Clickable prototype: [`r1-prototype.html`](./r1-prototype.html) (open it in a browser; `?screen=filmes`, `?screen=series`, `?screen=admin`; resize below 760 px for mobile). All artwork in the prototype is **placeholder** (brand mascot and patterns, fictional titles). Real posters and backdrops come from the dashboard.

| Screen | File |
|---|---|
| Filmes, 1920 | [r1-filmes-1920.png](./r1-filmes-1920.png) |
| Filmes, 1440 | [r1-filmes-1440.png](./r1-filmes-1440.png) · sponsored state [r1-filmes-1440-sponsored.png](./r1-filmes-1440-sponsored.png) |
| Filmes, mobile 390 | [r1-filmes-mobile.png](./r1-filmes-mobile.png) · [r1-filmes-mobile-rail.png](./r1-filmes-mobile-rail.png) |
| Trailer modal | [r1-trailer-modal.png](./r1-trailer-modal.png) |
| Séries (same pattern for Franquias) | [r1-series-1440.png](./r1-series-1440.png) |
| Moderator dashboard | [r1-admin-1440.png](./r1-admin-1440.png) |

## 1. What the Figma file contains — and what it doesn't

The file has **one screen**: the desktop home hero, at 1440 and 1920 px wide. The 1920 version already uses the brand violet `#736BB2`. Not in the file: mobile, series/franchise pages, details, reviews, profile, checkout, and the **dashboard**. I designed those in the same visual language; they are in the prototype for your approval.

## 2. Layout taken from Figma (desktop)

| Element | Figma | Wiski |
|---|---|---|
| Side margins | 120 px @1440, 160 px @1920 | `clamp(20px, 8.333vw, 160px)` (same values at those widths) |
| Header | 40 px from top; logo left; nav right, 18 px, gap 64 px; active item underlined (1.5 px) | same metrics; **"Wiski" logo** (Black Rockie outlines) with a lavender neon glow; nav **Filmes · Séries · Franquias · Avaliações · Perfil**; active item: lilac text, 2 px lavender underline with glow; **no search icon** |
| Backdrop | photo across the frame, mirrored copy on the left half | one 16:9 backdrop anchored right (uploaded in the dashboard) |
| Overlay | `linear-gradient(180deg, #000 70% → 0 → 53%)` + `linear-gradient(90deg, #000 90% @33% → 0 @80%)` | **same stops**, black replaced by ink `#1B1225` (72 % / 0 / 62 % and 94 % → 0) |
| Content block | top 211 px, width 470 px, gaps 24 / 40 px | same |
| Title | SF Pro Display Semibold 72 px, two lines | **Escargoth** (brand display face), `clamp(44px, 3.75vw + 2px, 76px)`, faint lilac glow. SF Pro is Apple's font and can't be served on a website. |
| Meta row | IMDb badge + rating · year │ runtime │ genre, 14 px | **classificação indicativa badge** (official colours L/10/12/14/16/18) · year │ "1 h 55 min" │ genre. There's no IMDb (no external data); after a title is watched, the community rating "★ 4,6 · 128 avaliações" appears here. |
| Synopsis | 16 px / 1.6, 470 px, "See more" in `#736BB2` | same; "Ver mais" in lavender (violet on dark is below 4.5:1 for 16 px text) |
| Buttons | 48 px high, radius 8, "Watch trailer" outline (white 60 %), "Watch now" filled `#736BB2` with dark text `#2E2E2E` + play icon | **"Assistir trailer"** outline with a play icon. **"Patrocine agora"** filled **lavender** with **ink** text (7.4:1) and the PONTO diamond as icon, plus the neon glow. Figma's dark-on-violet is ≈ 3:1, which fails WCAG AA for 16 px text. |
| Under the buttons | — | price line: "Patrocínio: R$ 20,00 · pago por uma pessoa · até 2 h 10 min"; sponsored → "Patrocinado por @… · entra numa das próximas sessões"; reserved → explains the Pix hold |
| Arrows | two 40 × 40 outlined squares, gap 16, at y = 686 | same, plus a **"01 / 35"** counter; keyboard ← → also works; no auto-rotation |
| Poster rail | centred, bottom 80 px, gap 32, cards 176 × 234 radius 12 with black 50 % veil; active card 208 × 277 with 14 % veil | same metrics; ink veil; **active card always in the middle** with a lavender neon outline; badges **Patrocinado** / **Reservado** |

## 3. Neon (brand purples only)

| Token | Value | Used on |
|---|---|---|
| `--glow-sm` | `0 0 6px rgba(169,157,224,.85), 0 0 16px rgba(115,107,178,.55)` | hover on outline buttons and arrows, badges |
| `--glow` | `0 0 8px rgba(169,157,224,.9), 0 0 22px rgba(169,157,224,.55), 0 0 48px rgba(115,107,178,.45)` | primary CTA, active poster card, modal player |
| logo glow | `drop-shadow(0 0 5px rgba(169,157,224,.75)) drop-shadow(0 0 16px rgba(115,107,178,.6))` | header logo |
| progress bar | violet → lavender gradient + `0 0 10px` / `0 0 22px` glow | campaigns |

The glow is decoration only; every text/background pair keeps the 06 §2 contrast. Hover animations are 150–250 ms and turn off with `prefers-reduced-motion`. No blinking or flicker.

## 4. Screens designed in the same language (need your OK)

- **Mobile (≤ 760 px):**
  - logo top-left; the five tabs move to a **fixed bottom tab bar** with icons (active tab glows)
  - hero image on top, fading into the page
  - title 42 px, synopsis clamped to 3 lines
  - **Patrocine agora** first, full width, then Assistir trailer
  - arrows + counter, then a swipeable poster row that starts at the current film
- **Séries / Franquias:**
  - page title, one-line explanation of how crowdfunding works
  - a **featured campaign** (art, seasons/episodes, age rating, neon progress bar, raised / goal, %, days left, supporters, "Mínimo R$ 5", **Contribuir** + Assistir trailer)
  - a grid of campaign cards with three states: open (days left · supporters), **Meta atingida ✓**, **Prazo encerrado — aguardando prorrogação**
- **Trailer:** dark blurred backdrop, 16:9 player with a glow, "Fechar ✕", Esc closes. The YouTube player is created only after the click (11 §6).
- **Dashboard:**
  - **sidebar**: catalogue counts 33/35, 9/10, 4/10; operations; signed-in moderator with "Passkey verificada"
  - **slot board**: 35 numbered slots with state labels (Ativo, Reservado, Patrocinado, Assistido → substituir, Rascunho), empty slots with ＋, drag to reorder
  - **editor panel**: all fields from 11 §4, price computed from the runtime, YouTube link validated, image drop zones with format/size rules, "Ver como visitante", "Salvar rascunho", **Publicar**, version history with **Reverter**

## 5. Assets and deviations

- **Icons** (chevrons, play, tab-bar icons) are simple re-drawn equivalents. My workspace's network policy blocks downloads from figma.com, so the Figma vector files couldn't be fetched. The search icon is removed, and the IMDb logo isn't used (no IMDb data and it's a third-party mark).
- **Brand assets** (logo outlines, PONTO, patterns, mascot) are the unmodified files from `ASSETS/` / `public/brand/`.
- **Film imagery** is data: each movie, series and franchise gets its poster, backdrop and optional title logo in the dashboard. The Figma's Marvel posters are not used anywhere.
