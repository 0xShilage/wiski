import 'server-only';
import type { Platform, Role } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';
import { Problems } from '../http/problem';

/**
 * Media kit numbers (Q18, 01 §4: cache → last-known-good → manual). Values the streamer types in
 * the dashboard win while set; an API fetcher (Twitch/YouTube, needs app credentials — open item
 * P4-a) would write `value`/`LIVE` without touching the manual override.
 */
export const METRICS = [
  'followers',
  'subscribers',
  'avg_viewers_30d',
  'peak_viewers_30d',
  'hours_streamed_30d',
  'views_30d',
] as const;
export type Metric = (typeof METRICS)[number];

export const METRIC_LABEL: Record<Metric, string> = {
  followers: 'Seguidores',
  subscribers: 'Inscritos',
  avg_viewers_30d: 'Média de espectadores (30 dias)',
  peak_viewers_30d: 'Pico de espectadores (30 dias)',
  hours_streamed_30d: 'Horas de live (30 dias)',
  views_30d: 'Visualizações (30 dias)',
};

export type StatView = {
  platform: Platform;
  metric: Metric;
  value: number;
  source: 'LIVE' | 'MANUAL';
  updatedAt: string;
};

export async function listStats(): Promise<StatView[]> {
  const rows = await db().platformStat.findMany({ orderBy: [{ platform: 'asc' }, { metric: 'asc' }] });
  return rows
    .filter((r) => (METRICS as readonly string[]).includes(r.metric))
    .map((r) => ({
      platform: r.platform,
      metric: r.metric as Metric,
      value: Number(r.manualValue ?? r.value),
      source: r.manualValue !== null ? 'MANUAL' : r.source,
      updatedAt: r.fetchedAt.toISOString(),
    }));
}

type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

/** Streamer: set (value) or clear (null) a manual number. */
export async function setStat(ctx: Ctx, platform: Platform, metric: Metric, value: number | null, now = new Date()) {
  await db().$transaction(async (t) => {
    const existing = await t.platformStat.findUnique({ where: { platform_metric: { platform, metric } } });
    if (value === null) {
      if (!existing) throw Problems.notFound();
      if (existing.source === 'MANUAL') await t.platformStat.delete({ where: { id: existing.id } });
      else await t.platformStat.update({ where: { id: existing.id }, data: { manualValue: null } });
    } else {
      await t.platformStat.upsert({
        where: { platform_metric: { platform, metric } },
        create: { platform, metric, value: BigInt(value), source: 'MANUAL', manualValue: BigInt(value), fetchedAt: now },
        update: { manualValue: BigInt(value), fetchedAt: now },
      });
    }
    await audit(
      { action: 'stats.update', actor: ctx.actor, requestId: ctx.requestId, targetType: 'PlatformStat', targetId: `${platform}:${metric}`, metadata: { platform, metric, manual: value !== null } },
      t,
    );
  });
}
