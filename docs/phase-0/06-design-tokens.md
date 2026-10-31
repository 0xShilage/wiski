# 06 — Brand assets and design tokens (Tailwind theme proposal)

> Status: **rev 2 — answers applied** (logo = "Wiski" in Black Rockie, font licences confirmed, favicon provided). Visual reference: [`design-preview.png`](./design-preview.png) (rendered from the real SVGs and fonts). Proposed theme file: [`theme.proposal.css`](./theme.proposal.css) (Tailwind CSS v4, CSS-first `@theme`).

## 1. What is in `ASSETS/` (inventory)

| Group | Files | viewBox | Notes |
|---|---|---|---|
| Mascot (squirrel line art) | 4 poses × 5 colours (`SVG - MASCOTE/VERSÃO n-k`) | 578×651 · 732×676 · 729×550 · 558×656 | Single-colour fills, 7–8 KB each |
| FRAME 1 (ornate) | 5 colours | 435.81×598.99 | ~14 KB |
| FRAME 2 (notched double line) | 5 colours | 428.71×563.73 | ~1 KB |
| PONTO (diamond) | 5 colours | 357×357 | 328 B |
| RABINHO (tail) | 5 colours | 412×641 | ~800 B |
| PADRÃO 1 / 2 / 3 (patterns) | 5 colours each | 1080×1080 | 38 KB / 1 KB / 102 KB |
| PNG versions | same set | 1× exports at 72 dpi (e.g. mascot 580×652) | fine for avatars/thumbnails; SVG preferred for anything large or retina |
| Icons (`PNG - ICONS`) | `favicon.png` (lilac) + `SUBMARCA-11…14` (ink, plum, violet, lavender) — the same blackletter monogram with the PONTO diamond as its full stop | 392×195 px PNG, transparent, 1× | only PNG; no SVG version |
| Fonts | Poppins (18 weights, OFL), Black Rockie (TTF/OTF), Escargoth (TTF/OTF) | | licences confirmed by you |

**Logo:** there is no logo file by design — the logo is the word **"Wiski"** set in Black Rockie (your answer to Q1). See §8.

**Safety check:** no `<script>`, event handlers, external references or `foreignObject` in any SVG. Each file has an Illustrator `<style>` block (`.cls-1 { fill: … }`) and fixed ids (`Camada_1`, `Novo_padrão_9`); both matter for inlining (§5).

### Colour → file map (all assets are monochrome; the numeric suffix encodes the colour)

| Asset | ink / noite | plum / ameixa | violet / violeta | lavender / lavanda | lilac / lilás |
|---|---|---|---|---|---|
| FRAME 1 | 1-7 | 1-3 | 1-11 | 1-15 | 1-19 |
| FRAME 2 | 2-6 | 2-2 | 2-10 | 2-14 | 2-18 |
| PONTO | 5 | 1 | 9 | 13 | 17 |
| RABINHO | 8 | 4 | 12 | 16 | 20 |
| MASCOTE 1 | 1-15 | 1-20 | 1-11 | 1-9 | 1-3 |
| MASCOTE 2 | 2-14 | 2-18 | 2-12 | 2-10 | 2-4 |
| MASCOTE 3 | 3-16 | 3-19 | 3-6 | 3-8 | 3-2 |
| MASCOTE 4 | 4-13 | 4-17 | 4-5 | 4-7 | 4-1 |
| PADRÃO 1 | 1-10 | 1-7 | 1-1 | 1-4 | 1-13 |
| PADRÃO 2 | 2-11 | 2-8 | 2-2 | 2-5 | 2-14 |
| PADRÃO 3 | 3-12 | 3-9 | 3-3 | 3-6 | 3-15 |

## 2. Colour tokens

### Brand palette (extracted 1:1 from the SVG fills, unchanged)

| Token | Hex | pt-BR name | Proposed role |
|---|---|---|---|
| `ink` | `#1B1225` | noite | page background (dark-first UI) |
| `plum` | `#4F3D72` | ameixa | borders, dividers, inactive states |
| `violet` | `#736BB2` | violeta | large text, icons, decoration (not body text) |
| `lavender` | `#A99DE0` | lavanda | accent, primary buttons, links, focus ring |
| `lilac` | `#E5DDED` | lilás | body text on dark |

### Contrast matrix (WCAG 2.x ratio, foreground on background)

| fg \ bg | ink | plum | violet | lavender | lilac |
|---|---|---|---|---|---|
| **ink** | – | 1.93 | 3.86 | **7.40** | **13.71** |
| **plum** | 1.93 | – | 2.00 | 3.83 | **7.09** |
| **violet** | 3.86 | 2.00 | – | 1.92 | 3.55 |
| **lavender** | **7.40** | 3.83 | 1.92 | – | 1.85 |
| **lilac** | **13.71** | **7.09** | 3.55 | 1.85 | – |

Bold = passes AA for body text (≥ 4.5). Consequences: body text = lilac (or lavender) on ink/surfaces; primary button = **ink text on lavender** (7.40); violet is for ≥ 24 px text, icons and borders only (≥ 3:1 for UI components); never violet text on lilac for body copy.

### Additions (UI-only, need approval; never applied to assets)

| Token | Hex | Why | Contrast |
|---|---|---|---|
| `surface-1/2/3` | `#241A33` / `#2E2141` / `#3A2C53` | cards, inputs, hover — sRGB mixes of ink→plum (18/36/60 %) so they stay on-palette | lilac on them: 12.51 / 11.27 / 9.55 |
| `success` | `#7FD6A4` | "Pagamento aprovado" | 10.40 on ink |
| `warning` | `#F2C46D` | "Pix pendente / expira em…" | 11.12 on ink |
| `danger` | `#FF8F9A` | errors, "recusado" | 8.32 on ink |

Status is never communicated by colour alone (icon + text label always present).

## 3. Typography

| Role | Font | Usage rules |
|---|---|---|
| `font-sans` (body/UI) | **Poppins** 400/500/600/700 | everything readable: body, forms, prices, tables, admin |
| `font-display` | **Escargoth** (caps-only display face) | H1/H2, hero lines, section titles; short strings only |
| `font-brand` | **Black Rockie** (blackletter) | the brand name and 1–3-word accents; never for UI, numbers, prices or anything users must read quickly |

- Glyph check (script): both display fonts cover all pt-BR letters (ã õ ç á é í ó ú â ê ô à ü and caps) but lack **º ª** — the font stack falls back to Poppins for those automatically.
- Loading: `next/font/local`, self-hosted, subset to Latin + Latin-1 + punctuation, `woff2`, `font-display: swap`, preload only Poppins 400/600 + Escargoth. Same-origin → CSP `font-src 'self'`.
- **Licensing:** Poppins is SIL OFL. Black Rockie (UICreative) and Escargoth (Drizy Studio) are commercial; you confirmed you hold the licences, so both ship as self-hosted woff2 subsets. Keep the licence receipts with the project in case a foundry asks.

## 4. Spacing, radii, layout

The assets don't encode a spacing system, so the proposal keeps Tailwind's default 4 px (`0.25rem`) scale and adds only what the assets imply:

- **Aspect ratios from viewBoxes:** `aspect-frame-1` (435.81/598.99), `aspect-frame-2` (428.71/563.73), `aspect-poster` (2/3), `aspect-pattern` (1/1).
- **Poster-in-frame:** FRAME 2's inner border sits at ≈ 4.3 % (x) / 2.8 % (y) of the frame box; the poster window uses 5.5 % / 4 % insets. The window is ≈ 0.73 wide-to-tall vs 0.667 for TMDB posters, so posters use `object-fit: cover` (≈ 9 % of the poster height cropped, top+bottom) — alternative: `contain` with an ink letterbox (decision in Q23).
- **Radii:** sm 6 px (inputs), md 12 px (cards), lg 20 px (hero panels), pill (buttons, chips). Decorative framing comes from the FRAME assets, not from CSS imitations of them.
- **Layout:** mobile-first; container max 72 rem; gutters 16 px → 24 px (md); touch targets ≥ 44 px; bottom-sheet checkout on mobile.
- **Motion:** 150–250 ms `ease-smooth`; all animation disabled under `prefers-reduced-motion`.

## 5. Asset pipeline rules (Phase 1) — how "use as-is" is guaranteed

1. `ASSETS/` stays untouched as the source of truth. A script copies files to `public/brand/` with ASCII slugs only (e.g. `VERSÃO 1-15.svg` → `mascote-1-ink.svg`, `PADRÃO 2-8.svg` → `padrao-2-plum.svg`).
2. SVGs are compiled to React components (SVGR) for inlining, with **only lossless SVGO transforms**: `inlineStyles` + `convertStyleToAttrs` (moves `.cls-1 { fill }` into a `fill` attribute — required because strict CSP blocks `<style>` inside inline SVG) and `prefixIds` (unique ids when several SVGs share a page). Path data, precision, colours and geometry are **not** touched (`convertPathData`, `cleanupNumericValues`, `convertColors` etc. disabled).
3. A Playwright test renders every original and every processed SVG at 2× and requires **0 differing pixels**. Any diff fails CI.
4. PNGs go through `next/image` (AVIF/WebP, responsive sizes) with no recolouring, cropping or filters. Large patterns (PADRÃO 1/3) are used as CSS backgrounds from `/brand/*.svg` (same-origin, cached immutable).
5. Wordmark: "Wiski" in Black Rockie (§8) — produced from the font itself, never hand-drawn.

## 6. Component cues derived from the assets

| Pattern | Asset use |
|---|---|
| Rating 1–5 | 5 × PONTO: lavender = filled, plum = empty, plus a text label "4/5" (accessible name `Nota 4 de 5`) |
| Poster cards | FRAME 2 around the poster window; FRAME 1 for featured/"assistido na live" titles |
| Backgrounds | PADRÃO 2 (1 KB) at 25–35 % opacity on hero/empty states; PADRÃO 1/3 for the media kit |
| Accents | RABINHO as section ornament / quote mark on reviews |
| Empty states, 404, loading | mascot poses (static; no animation of the artwork itself) |
| Overlays (OBS) | transparent background, lilac/lavender on ink panels, Escargoth titles |

## 7. Preset avatars

> **Superseded 2026-10-31:** 30 hand-made round icons, keys `perfil-01` … `perfil-30`, default `perfil-01`, WebP built by `npm run avatars` — see [../phase-6/README.md §4](../phase-6/README.md#4-profile-pictures-v2-2026-10-31-later-the-same-day). The original design is kept below for reference.

20 presets = 4 mascot poses × 5 colours, each shown on a fixed background chosen for contrast, with a plum ring. The mascot file is placed unmodified and centred (`object-fit: contain`, 78 % of the circle).

| Mascot colour | Background | Contrast (graphic, ≥ 3:1 needed) |
|---|---|---|
| ink | lilac | 13.71 |
| plum | lilac | 7.09 |
| violet | lilac | 3.55 |
| lavender | ink | 7.40 |
| lilac | plum | 7.09 |

Keys: `mascote-{1..4}-{ink|plum|violet|lavender|lilac}`; default `mascote-4-lavender`. Stored as `User.avatarKey`, validated against a Zod enum generated from the registry. Users can't upload images (no moderation or EXIF-stripping burden, no image-based XSS/malware surface).

## 8. Logo and favicon (rev 2)

**Logo — "Wiski" in Black Rockie.** Phase 1 generates `public/brand/logo-wiski-{ink,lilac,lavender}.svg` at build time from the licensed font's own glyph outlines, shaped with the font's kerning (`opentype.js`), filled with palette colours. Result: the exact font shapes, no font-loading flash in the header, crisp at any size, CSP-safe (SVGR component, presentation attributes only). Accessible name "Wiski"; the header links home. Default colours: lilac on dark backgrounds, ink on light ones. Minimum height 24 px; clear space = height of the PONTO diamond on each side.

**Favicon — `PNG - ICONS/favicon.png`.** Checked at tab sizes in [`favicon-preview.png`](./favicon-preview.png):

1. The file is lilac on transparent. On a light browser tab (white) it is almost invisible — lilac vs white is **1.32 : 1** (panel A, left).
2. It is 2 : 1 wide, so in a square 16 px icon the mark is about 16 × 8 px.

Proposal (panel B): use the file **unchanged**, centred at 84 % width on a square ink (#1B1225) tile with rounded corners. It reads on light and dark tabs and matches the site background. Outputs: `favicon.ico` (16/32/48), `icon.png` (32), `apple-icon.png` (180), PWA `icon-192.png` / `icon-512.png`, Open Graph image with mascot + logo.

The source is 392 px wide, so the 512 px icon needs a slight upscale. A larger export (≥ 1024 px) or an SVG of the SUBMARCA would make the big icons crisp — optional.

The four `SUBMARCA` colour variants become the secondary mark: footer, overlays, loading states and e-mail headers.
