import 'server-only';
import type { Campaign, CatalogItem } from '@/generated/prisma/client';
import { DEFAULT_CAMPAIGN_DAYS, franchiseGoalCents, seriesGoalCents } from '@/lib/catalog/pricing';
import { audit } from '../audit/audit';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';
import { type Actor, CatalogProblems, catalogTx, goLiveInTx } from './service';

/**
 * Crowdfunding campaigns for series and franchises (11 §2.2). A moderator prepares the item;
 * the STREAMER opens it (goal + deadline), extends deadlines and lowers goals — money actions
 * that need the Google step-up on top of the passkey (route options). Contributions arrive in
 * Phase 2; the money columns already carry their CHECKs.
 */
type Ctx = { actor: Actor; requestId: string | null };
const DAY = 86_400_000;

export const CampaignProblems = {
  notCampaign: () =>
    new HttpError(409, 'NOT_A_CAMPAIGN', 'Só séries e franquias têm campanha de contribuições.'),
  goalTooLow: (minCents: number) =>
    new HttpError(
      409,
      'GOAL_BELOW_RAISED',
      'A meta não pode ficar abaixo do que já foi arrecadado ou reservado.',
      { members: { minGoalCents: String(minCents) } },
    ),
};

export async function formulaGoal(item: CatalogItem): Promise<number | null> {
  if (item.kind === 'SERIES') return item.seasonCount ? seriesGoalCents(item.seasonCount) : null;
  if (item.kind === 'FRANCHISE') {
    const entries = await db().franchiseEntry.findMany({ where: { franchiseId: item.id } });
    return entries.length ? franchiseGoalCents(entries) : null;
  }
  return null;
}

/** Display state derived from the row and the clock (a passed deadline pauses contributions). */
export function campaignState(
  c: Pick<Campaign, 'status' | 'deadlineAt'>,
  now = new Date(),
): 'OPEN' | 'PAUSED' | 'FUNDED' | 'SCHEDULED' | 'WATCHED' {
  if (c.status === 'OPEN' && c.deadlineAt.getTime() <= now.getTime()) return 'PAUSED';
  return c.status;
}

export async function openCampaign(
  ctx: Ctx,
  itemId: string,
  input: { expectedVersion: number; goalCents?: number | undefined; days?: number | undefined },
  now = new Date(),
) {
  const item = await db().catalogItem.findUnique({
    where: { id: itemId },
    include: { campaign: true },
  });
  if (!item) throw Problems.notFound();
  if (item.kind === 'MOVIE') throw CampaignProblems.notCampaign();
  if (item.status !== 'DRAFT' || item.campaign) {
    throw CatalogProblems.invalidState('Esta campanha já foi aberta.');
  }
  if (item.version !== input.expectedVersion) throw CatalogProblems.versionConflict(item.version);
  const formula = await formulaGoal(item);
  const goalCents = input.goalCents ?? formula;
  if (!goalCents || !formula) {
    throw CatalogProblems.incomplete([
      {
        path: item.kind === 'SERIES' ? 'seasonCount' : 'franchiseEntries',
        message: 'Sem dados para calcular a meta.',
      },
    ]);
  }
  const deadlineAt = new Date(now.getTime() + (input.days ?? DEFAULT_CAMPAIGN_DAYS) * DAY);
  return catalogTx(item.kind, async (t) => {
    const slot = await goLiveInTx(t, item, item.slot, now);
    const campaign = await t.campaign.create({
      data: {
        itemId,
        goalCents,
        remainingCents: goalCents,
        deadlineAt,
        openedAt: now,
        openedById: ctx.actor.id,
      },
    });
    await audit(
      {
        action: 'catalog.publish',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'CatalogItem',
        targetId: itemId,
        metadata: { kind: item.kind, slot, version: item.version },
      },
      t,
    );
    await audit(
      {
        action: 'campaign.open',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Campaign',
        targetId: campaign.id,
        metadata: { goalCents, formulaGoalCents: formula, deadlineAt: deadlineAt.toISOString() },
      },
      t,
    );
    return campaign;
  });
}

async function campaignOf(itemId: string) {
  const c = await db().campaign.findUnique({ where: { itemId }, include: { item: true } });
  if (!c) throw Problems.notFound();
  return c;
}

/** New deadline = max(now, current deadline) + days. Re-opens a paused campaign (shown publicly). */
export async function extendCampaign(ctx: Ctx, itemId: string, days: number, now = new Date()) {
  const c = await campaignOf(itemId);
  if (c.status !== 'OPEN' && c.status !== 'PAUSED') {
    throw CatalogProblems.invalidState('Só campanhas abertas ou pausadas podem ser prorrogadas.');
  }
  const deadlineAt = new Date(Math.max(now.getTime(), c.deadlineAt.getTime()) + days * DAY);
  return catalogTx(c.item.kind, async (t) => {
    const res = await t.campaign.updateMany({
      where: { id: c.id, version: c.version },
      data: { deadlineAt, status: 'OPEN', extensions: { increment: 1 }, version: { increment: 1 } },
    });
    if (res.count !== 1) throw CatalogProblems.versionConflict(c.version);
    await audit(
      {
        action: 'campaign.extend',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Campaign',
        targetId: c.id,
        metadata: { deadlineAt: deadlineAt.toISOString(), extensions: c.extensions + 1 },
      },
      t,
    );
    // Contributors with an e-mail get a notice (Phase 2, with contributions).
    return t.campaign.findUniqueOrThrow({ where: { id: c.id } });
  });
}

/**
 * Lower the goal (STREAMER). Never below raised + reserved; lowering it to exactly the amount
 * raised completes the campaign ("Meta atingida").
 */
export async function lowerGoal(ctx: Ctx, itemId: string, goalCents: number, now = new Date()) {
  const c = await campaignOf(itemId);
  if (c.status !== 'OPEN' && c.status !== 'PAUSED') {
    throw CatalogProblems.invalidState('A meta só pode mudar enquanto a campanha está aberta.');
  }
  if (goalCents >= c.goalCents) {
    throw Problems.validation([
      { path: 'goalCents', message: 'A nova meta deve ser menor que a atual.' },
    ]);
  }
  const floor = c.raisedCents + c.reservedCents;
  if (goalCents < floor) throw CampaignProblems.goalTooLow(floor);
  const funded = goalCents === c.raisedCents && c.reservedCents === 0;
  return catalogTx(c.item.kind, async (t) => {
    // Conditional on the money columns too: a contribution landing in between makes this a 409.
    const res = await t.campaign.updateMany({
      where: {
        id: c.id,
        version: c.version,
        raisedCents: c.raisedCents,
        reservedCents: c.reservedCents,
      },
      data: {
        goalCents,
        remainingCents: goalCents - c.raisedCents - c.reservedCents,
        version: { increment: 1 },
        ...(funded ? { status: 'FUNDED', fundedAt: now } : {}),
      },
    });
    if (res.count !== 1) throw CatalogProblems.versionConflict(c.version);
    if (funded) {
      await t.catalogItem.update({ where: { id: itemId }, data: { status: 'FUNDED' } });
    }
    await audit(
      {
        action: 'campaign.goal',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'Campaign',
        targetId: c.id,
        metadata: { fromCents: c.goalCents, toCents: goalCents, funded },
      },
      t,
    );
    return t.campaign.findUniqueOrThrow({ where: { id: c.id } });
  });
}
