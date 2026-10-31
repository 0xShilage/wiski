-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — profile pictures v2 (2026-10-31): the 20 mascot × colour presets are replaced by
-- 30 hand-made icons (src/lib/avatars.ts). Guarded by tests/integration/accounts.test.ts.
--
-- Review decisions:
--  1. Every account keeps a distinct-looking picture: the old preset in position n (pose 1–4 ×
--     ink, plum, violet, lavender, lilac, the order of the old AVATAR_KEYS) becomes perfil-n.
--     People can pick another one in Perfil.
--  2. Anything else that is not a current key (there should be none) becomes the default.
--  3. The column stays without a CHECK: the registry lives in code (Zod enum) and the read path
--     falls back to the default for unknown values.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE "User"
   SET "avatarKey" = 'perfil-' || lpad(array_position(ARRAY[
         'mascote-1-ink', 'mascote-1-plum', 'mascote-1-violet', 'mascote-1-lavender', 'mascote-1-lilac',
         'mascote-2-ink', 'mascote-2-plum', 'mascote-2-violet', 'mascote-2-lavender', 'mascote-2-lilac',
         'mascote-3-ink', 'mascote-3-plum', 'mascote-3-violet', 'mascote-3-lavender', 'mascote-3-lilac',
         'mascote-4-ink', 'mascote-4-plum', 'mascote-4-violet', 'mascote-4-lavender', 'mascote-4-lilac'
       ], "avatarKey")::text, 2, '0')
 WHERE "avatarKey" LIKE 'mascote-%'
   AND array_position(ARRAY[
         'mascote-1-ink', 'mascote-1-plum', 'mascote-1-violet', 'mascote-1-lavender', 'mascote-1-lilac',
         'mascote-2-ink', 'mascote-2-plum', 'mascote-2-violet', 'mascote-2-lavender', 'mascote-2-lilac',
         'mascote-3-ink', 'mascote-3-plum', 'mascote-3-violet', 'mascote-3-lavender', 'mascote-3-lilac',
         'mascote-4-ink', 'mascote-4-plum', 'mascote-4-violet', 'mascote-4-lavender', 'mascote-4-lilac'
       ], "avatarKey") IS NOT NULL;

UPDATE "User"
   SET "avatarKey" = 'perfil-01'
 WHERE "avatarKey" !~ '^perfil-(0[1-9]|[12][0-9]|30)$';
