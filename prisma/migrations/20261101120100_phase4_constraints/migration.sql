-- ─────────────────────────────────────────────────────────────────────────────
-- REVIEWED SQL — Phase 4 (live schedule, admin tools, overlays, media kit, contact) invariants:
-- docs/phase-4/README.md §3, 02 §3–§5, 03 §5.5–§5.6, 04 §7, 05 §5. Hand-written; any change needs
-- a second reviewer. Guarded by tests/integration/db-constraints-p4.test.ts.
--
-- Review decisions:
--  1. "One live at a time" is the partial unique index session_one_live (schema.prisma). What is
--     on screen (nowItemId) only exists while a session is LIVE.
--  2. A movie order carries its session only while it is on the schedule or done (SCHEDULED,
--     WATCHING, COMPLETED); going back to the queue (PAID) or to a refund clears it.
--  3. Every Phase 4 text a visitor or moderator types has a length cap here too, after the
--     application's sanitiser.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Live sessions ══════════════════════════════════════════════════════════

ALTER TABLE "StreamSession" ADD CONSTRAINT ss_values CHECK (
  "capacityMinutes" BETWEEN 15 AND 1440 AND version >= 0 AND
  ("publicNote" IS NULL OR char_length("publicNote") BETWEEN 1 AND 140));
ALTER TABLE "StreamSession" ADD CONSTRAINT ss_lifecycle CHECK (
  (status = 'PLANNED' AND "startedAt" IS NULL AND "cancelledAt" IS NULL AND "endsAt" IS NULL) OR
  (status = 'LIVE' AND "startedAt" IS NOT NULL AND "cancelledAt" IS NULL AND "endsAt" IS NULL) OR
  (status = 'DONE' AND "startedAt" IS NOT NULL AND "endsAt" IS NOT NULL AND "endsAt" >= "startedAt") OR
  (status = 'CANCELLED' AND "cancelledAt" IS NOT NULL));
ALTER TABLE "StreamSession" ADD CONSTRAINT ss_now_playing CHECK ("nowItemId" IS NULL OR status = 'LIVE');

-- ═══ 2. What's on the schedule ═════════════════════════════════════════════════

ALTER TABLE "Order" ADD CONSTRAINT ord_session CHECK (
  ("sessionId" IS NULL OR status IN ('SCHEDULED', 'WATCHING', 'COMPLETED')) AND
  (status NOT IN ('SCHEDULED', 'WATCHING') OR ("sessionId" IS NOT NULL AND "scheduledAt" IS NOT NULL)) AND
  (status <> 'COMPLETED' OR "completedAt" IS NOT NULL));
ALTER TABLE "Order" ADD CONSTRAINT ord_reschedules CHECK ("rescheduleCount" IS NULL OR "rescheduleCount" <= 2);

ALTER TABLE "Campaign" ADD CONSTRAINT camp_schedule CHECK (
  ("sessionId" IS NULL OR status IN ('SCHEDULED', 'WATCHED')) AND
  (status <> 'SCHEDULED' OR ("sessionId" IS NOT NULL AND "scheduledAt" IS NOT NULL)));

-- ═══ 3. Overlays, goals, stats, contact ════════════════════════════════════════

ALTER TABLE "OverlayKey" ADD CONSTRAINT ok_values CHECK (
  char_length(label) BETWEEN 1 AND 40 AND "keyPrefix" ~ '^[A-Za-z0-9_-]{6}$' AND
  cardinality(widgets) BETWEEN 1 AND 4 AND
  widgets <@ ARRAY['agora', 'fila', 'meta', 'patrocinio']::text[] AND
  octet_length("keyHash") = 32);

ALTER TABLE "Goal" ADD CONSTRAINT goal_values CHECK (
  char_length(title) BETWEEN 1 AND 60 AND target > 0 AND ("endsAt" IS NULL OR "endsAt" > "startsAt"));

ALTER TABLE "PlatformStat" ADD CONSTRAINT stat_values CHECK (
  metric ~ '^[a-z0-9_]{2,32}$' AND value >= 0 AND ("manualValue" IS NULL OR "manualValue" >= 0));

ALTER TABLE "ContactMessage" ADD CONSTRAINT contact_values CHECK (
  char_length(name) BETWEEN 1 AND 80 AND
  email = lower(email) AND char_length(email) BETWEEN 6 AND 254 AND
  (company IS NULL OR char_length(company) BETWEEN 1 AND 80) AND
  char_length(subject) BETWEEN 1 AND 120 AND
  char_length(body) BETWEEN 1 AND 4000 AND
  "purgeAfter" > "createdAt");

-- ═══ 4. Accounts ═══════════════════════════════════════════════════════════════

ALTER TABLE "User" ADD CONSTRAINT user_status_times CHECK (
  (status <> 'DELETED' OR "deletedAt" IS NOT NULL) AND
  (status <> 'ACTIVE' OR "suspendedUntil" IS NULL));
