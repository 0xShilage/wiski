# 04 — Pricing rules specification

> Status: **rev 3 — real prices applied** (movie R$ 20 up to 130 min + R$ 1/min above, R$ 100 per series/anime season with admin override, YouTube disabled, fixed queue-jump tiers, 10 % moderator/VIP perk, no refunds). The engine stays general (runtime bands, per-minute extra, per-season, add-ons) so prices can change from Admin without code changes.

## 1. Principles

1. **The server computes every price.** The client sends only *selections* (movie id or package id, add-on ids, queue-jump tier, voucher code). It may send `expectedTotalCents` purely so the server can answer `409 PRICE_CHANGED` instead of silently charging a different amount.
2. **Integer cents only.** No floats, no `Decimal`, no `toFixed` in the engine. All intermediate values are non-negative safe integers (asserted).
3. **Deterministic and pure.** `price(config, input, context) → breakdown`. No I/O inside the function; buyer perks, voucher state and cap availability are passed in as `context`.
4. **Versioned rules.** A `PriceRuleSet` is immutable once `ACTIVE`; every sponsorship pins `ruleSetId` + the full `breakdown` snapshot. Changing prices = publishing a new version (audited, step-up).
5. **Fail closed.** Unknown add-on, runtime outside limits, disabled kind, inactive package, expired voucher, cap exhausted → explicit error code; never a fallback price.

## 2. Config schema (`PricingConfig` v1, stored as JSON, validated by Zod)

```ts
type Cents = number;          // non-negative safe integer
type Bps = number;            // basis points: 10000 = 100 %
type Kind = 'MOVIE' | 'SERIES' | 'ANIME' | 'YOUTUBE';

interface PricingConfig {
  schemaVersion: 1;
  currency: 'BRL';
  minTotalCents: Cents;       // floor after discounts
  maxTotalCents: Cents;       // sanity ceiling → reject above
  kinds: Record<Kind, KindRule>;
  addOns: AddOn[];            // feature kept; none configured yet
  queueJump: QueueJumpRule;
  discounts: DiscountRule;
}

type KindPricing =
  | { mode: 'RUNTIME_BANDS';                          // base by runtime + per-minute extra
      bands: { upToMinutes: number; baseCents: Cents }[];   // strictly increasing, ≥ 1 band
      perMinuteOverCents: Cents }                     // each minute above the LAST band
  | { mode: 'PER_SEASON'; perSeasonCents: Cents };    // packages = whole seasons

interface KindRule {
  enabled: boolean;
  minRuntimeMinutes: number;
  maxRuntimeMinutes: number;  // sanity guard (also protects session capacity)
  pricing: KindPricing;
}

interface AddOn {
  id: string; label: string; kinds: Kind[]; active: boolean;
  pricing: { type: 'FIXED'; cents: Cents } | { type: 'PERCENT_OF_BASE'; bps: Bps };
}

interface QueueJumpTier {
  id: string; label: string;
  bps: Bps;                                   // 8000..16000 (Zod AND DB CHECK)
  placement: 'AHEAD_OF_REGULAR' | 'TOP';
  dailyCap?: number;                          // optional per-tier cap inside the shared caps
}

interface QueueJumpRule {
  enabled: boolean;
  tiers: QueueJumpTier[];
  dailyCap: number;                           // shared, per America/Sao_Paulo calendar day
  weeklyCap: number;                          // shared, per ISO week (Mon–Sun, BRT)
  perBuyerDailyCap: number;                   // buyer = user id, or normalised contact e-mail
  reservationTtlMinutes: number;              // Pix expiry (30) + grace (5)
}

interface DiscountRule {
  moderatorBps: Bps;                          // MODERATOR or STREAMER, logged in
  vipBps: Bps;                                // isVip user, logged in
  stacking: 'BEST_SINGLE';
  discountsApplyToQueueJump: false;
}
```

Package-level override (series/anime only): `CatalogPackage.priceOverrideCents` + mandatory `priceOverrideReason`, set by the STREAMER (step-up, audited). When present it replaces `perSeasonCents` for that package.

## 3. Active configuration (rev 3)

| Setting | Value |
|---|---|
| **MOVIE** | `RUNTIME_BANDS`: up to **130 min → R$ 20,00**; **+R$ 1,00 per minute** above 130; accepted runtime 1–360 min |
| **SERIES** | `PER_SEASON`: **R$ 100,00 per season** (admin override per package allowed) |
| **ANIME** | `PER_SEASON`: **R$ 100,00 per season** (admin override per package allowed) |
| **YOUTUBE** | **disabled** (tab hidden, resolve endpoint off, no YouTube API key needed for now) |
| Add-ons | none |
| Queue-jump tiers | `prioridade` "Prioridade" **+80 %** (ahead of regular items) · `topo` "Topo da fila" **+160 %** (first in the session, max 1/day) |
| Queue-jump caps | 5/day and 20/week shared; 1 per buyer per day |
| Perks | moderator/streamer **10 %**, VIP **10 %** (not cumulative); best single discount vs vouchers |
| Minimum / maximum order | R$ 5,00 / R$ 2.000,00 |

**Price grid that results:**

| | Regular | + Prioridade | + Topo da fila |
|---|---|---|---|
| Movie ≤ 130 min | R$ 20,00 | R$ 36,00 | R$ 52,00 |
| Movie 150 min | R$ 40,00 | R$ 72,00 | R$ 104,00 |
| Season (series or anime) | R$ 100,00 | R$ 180,00 | R$ 260,00 |

(Moderator/VIP 10 % applies to the regular part only; the surcharge is never discounted.)

## 4. Algorithm (canonical order — breakdown lines appear in exactly this order)

Notation: `mulBps(a, bps) = floor((a × bps + 5000) / 10000)` → **round half up** to the cent. Both operands are non-negative integers and `a × bps` stays below 2⁵³ for every allowed input (asserted).

| # | Step | Formula | Line label (pt-BR) |
|---|---|---|---|
| 0 | **Runtime** | MOVIE: TMDB `runtime`. SERIES/ANIME: package `runtimeMinutes` (used for session capacity, not price). Must satisfy `min ≤ R ≤ max`; missing → `RUNTIME_UNKNOWN`. | "Duração: 2 h 52 min" (info) |
| 1 | **Base** | RUNTIME_BANDS: first band with `R ≤ upToMinutes`, else last band. PER_SEASON: `package.priceOverrideCents ?? perSeasonCents`. | "Filme" / "Temporada 2" |
| 2 | **Extra minutes** | RUNTIME_BANDS only: `X = max(0, R − lastBand.upToMinutes) × perMinuteOverCents` | "Minutos adicionais (42 × R$ 1,00)" |
| 3 | **Add-ons** | FIXED → `cents`; PERCENT_OF_BASE → `mulBps(B + X, bps)` | one line each |
| 4 | **Subtotal** | `S = B + X + ΣA` | "Subtotal" |
| 5 | **Discount** | perk (logged-in only, read from the DB): `mulBps(S, moderatorBps or vipBps)`; voucher PERCENT `min(mulBps(S, bps), maxDiscountCents ?? ∞)`, FIXED `min(amountCents, S)`; `D = max(perk, voucher)` (tie → perk, voucher not consumed); clamp so `S − D ≥ minTotalCents`. Guests: vouchers only. | "Desconto moderador" / "Desconto VIP" / "Cupom XYZ" |
| 6 | **Queue jump** | reserve a slot (§5); `Q = mulBps(S, tier.bps)` on **S (pre-discount)** | "Prioridade (+80 %)" / "Topo da fila (+160 %)" |
| 7 | **Total** | `T = S − D + Q`; reject if `T < minTotalCents` or `T > maxTotalCents` | "Total" |

Every percentage is rounded half-up at the line where it is applied, and lines are summed as integers, so the displayed lines always add up to the charged total (property-tested).

## 5. Queue-jump caps (fixed tiers)

1. **Shared caps.** All tiers draw from one daily cap (calendar day in America/Sao_Paulo, by purchase time) and one weekly cap (ISO week); `topo` additionally has its own daily cap of 1.
2. **Reservation without serializable transactions.** Insert `QueueJumpSlot(tierId, day, dayIndex, isoWeek, weekIndex)` with the lowest free indexes; `@@unique([day, dayIndex])` and `@@unique([isoWeek, weekIndex])` make over-allocation impossible; unique violation → retry next index (bounded) → none left = `QUEUE_JUMP_SOLD_OUT`. Per-tier and per-buyer caps are counted in the same transaction.
3. **Lifecycle.** Pix approved → `confirmed = true`; expired/cancelled → row deleted by `slots.expire`.
4. **Fairness.** Unpaid reservations hold a slot ≤ 35 min; Turnstile on every checkout; 1 pending order per buyer, 2 per IP.

## 6. Vouchers

- Code: uppercase canonical, 8–24 chars `[A-Z0-9-]`, generated with ≥ 40 bits of entropy (vanity codes allowed but flagged).
- Validity: `active`, window, `appliesToKinds`, `minSubtotalCents`, `maxPerUser` (per buyer, RESERVED + CONSUMED), `maxRedemptions` (conditional `updateMany` — race-free).
- Brute force: 5 invalid codes / 10 min per IP and per buyer → 15-min cool-down + security event.

## 7. Rescheduling

Logged-in owners only (guests attach the order to an account first). Up to **24 h before** the session, max **2** times, to any `PLANNED` session in the next 60 days with free capacity; tier priority kept; free; capacity moved atomically; audited. If the streamer cancels a session, orders return to `PAID` and owners are asked to pick a new one (counter not incremented).

## 8. Refunds

Sponsorships are **non-refundable** (final wording from your lawyer). A cancelled session means rescheduling, not a refund. A STREAMER-only exception tool exists for duplicate payments, processing errors or a refund counsel says is legally required (step-up, idempotency key, audit).

## 9. Worked examples (active config)

| # | Input | Computation | Total |
|---|---|---|---|
| E1 | Movie 128 min | ≤ 130 → B = 2000 | **R$ 20,00** |
| E2 | Movie exactly 130 min (band edge) | inclusive upper bound → B = 2000, X = 0 | **R$ 20,00** |
| E3 | Movie 131 min | B = 2000, X = 1 × 100 | **R$ 21,00** |
| E4 | Movie 172 min, VIP, **Prioridade** | B = 2000; X = 42 × 100 = 4200; S = 6200; D = mulBps(6200, 1000) = 620; Q = mulBps(6200, 8000) = 4960; T = 6200 − 620 + 4960 | **R$ 105,40** |
| E5 | Season package, **Topo da fila** | S = 10000; Q = mulBps(10000, 16000) = 16000 | **R$ 260,00** |
| E6 | Anime season with streamer override R$ 150,00 | B = 15000 (override wins) | **R$ 150,00** |
| E7 | Rounding: voucher 12,5 % on movie 131 min | D = floor((2100 × 1250 + 5000) / 10000) = 263 (exact 262.5 → 263) | **R$ 18,37** |
| E8 | FIXED voucher R$ 50,00 on a R$ 20,00 movie | Dv = 2000 → clamp to S − minTotal: D = 1500 | **R$ 5,00** |
| E9 | 6th queue jump of the day / 2nd "Topo" of the day | no free slot | **409 QUEUE_JUMP_SOLD_OUT** |
| E10 | Moderator + 5 % voucher on a R$ 20,00 movie | perk 200 vs voucher 100 → perk (voucher not consumed) | **R$ 18,00** |
| E11 | YouTube link | kind disabled | **422 KIND_DISABLED** |

(All re-computed by script; they become Vitest fixtures in Phase 2.)

## 10. Error codes

`KIND_DISABLED`, `TITLE_BLOCKED`, `PACKAGE_INACTIVE`, `RUNTIME_UNKNOWN`, `RUNTIME_OUT_OF_RANGE`, `ADDON_INVALID`, `VOUCHER_INVALID`, `VOUCHER_EXPIRED`, `VOUCHER_SOLD_OUT`, `VOUCHER_USER_LIMIT`, `QUEUE_JUMP_DISABLED`, `QUEUE_JUMP_TIER_INVALID`, `QUEUE_JUMP_SOLD_OUT`, `QUEUE_JUMP_BUYER_LIMIT`, `TOTAL_ABOVE_LIMIT`, `PRICE_CHANGED`, `SPONSORSHIPS_CLOSED`, `PENDING_ORDER_EXISTS`.

## 11. Test plan (Phase 2, Vitest)

- **Table tests** for E1–E11 and every error code; both pricing modes; override vs default season price.
- **Band edges**: 129 / 130 / 131 min; min − 1, min, max, max + 1; synthetic multi-band configs so the general band logic stays covered even though the active config has one band.
- **Rounding**: `mulBps` at .4999 / .5 / .5001; bps = 0, 1, 9999, 10000, 16000.
- **Perks**: guest, USER, VIP, MODERATOR, STREAMER, VIP + MODERATOR; perk vs voucher tie; perk never taken from the request.
- **Property tests** (fast-check): total = Σ lines; total within [min, max] or error; integers only; monotonic in runtime; discount ≤ S; Q independent of discount.
- **Caps**: 50 concurrent reservations never exceed shared/tier/buyer caps (real Postgres); release frees a slot; day/week boundaries in America/Sao_Paulo; ISO week 53.
- **Tamper tests**: client price/discount/tier fields rejected (`.strict()`); `expectedTotalCents` mismatch → 409, never charge.
