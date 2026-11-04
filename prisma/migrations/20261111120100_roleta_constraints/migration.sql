-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Roleta, the wheel of fortune (docs/phase-6/README.md §11, 2026-11-04).
-- Hand-written; any change needs a second reviewer. Guarded by
-- tests/integration/roleta.test.ts.
--
-- Review decisions:
--  1. Five spins per viewer per period: n is 1 … 5 and (userId, period, n) is unique (Prisma
--     index), so a sixth spin is impossible even with parallel requests.
--  2. Each prize has its own wheel slice: FILME 0, CUPOM_30 2, VIP_TWITCH 4, DOIS_FILMES 6;
--     "Nada" one of 1, 3, 5, 7, 8. The app can't record a prize on the wrong slice.
--  3. "Nada" has no delivery state; every prize has one. A coupon prize always points to its
--     voucher and nothing else does. Delivered ⇔ deliveredAt set; who delivered only when
--     delivered (NULL for coupons, which the system delivers).
--  4. The Twitch login is only for prizes given by hand (movies, VIP) and is a valid Twitch
--     login (4 … 25 of a-z, 0-9, _).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "RoletaSpin" ADD CONSTRAINT roleta_spin_values CHECK (
  n BETWEEN 1 AND 5 AND
  ((prize = 'FILME' AND slot = 0) OR
   (prize = 'CUPOM_30' AND slot = 2) OR
   (prize = 'VIP_TWITCH' AND slot = 4) OR
   (prize = 'DOIS_FILMES' AND slot = 6) OR
   (prize = 'NADA' AND slot IN (1, 3, 5, 7, 8))));

ALTER TABLE "RoletaSpin" ADD CONSTRAINT roleta_spin_delivery CHECK (
  (prize = 'NADA') = (status IS NULL) AND
  (prize = 'CUPOM_30') = ("voucherId" IS NOT NULL) AND
  (status = 'DELIVERED') = ("deliveredAt" IS NOT NULL) AND
  (status = 'DELIVERED' OR "deliveredById" IS NULL) AND
  ("deliveredAt" IS NULL OR "deliveredAt" >= "createdAt"));

ALTER TABLE "RoletaSpin" ADD CONSTRAINT roleta_spin_twitch CHECK (
  "twitchLogin" IS NULL OR
  (prize IN ('FILME', 'DOIS_FILMES', 'VIP_TWITCH') AND "twitchLogin" ~ '^[a-z0-9_]{4,25}$'));
