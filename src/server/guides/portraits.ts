import 'server-only';
import { z } from 'zod';
import type { Role } from '@/generated/prisma/client';
import { allSlots, GUIDE_ID } from '@/lib/guides/dark-s1';
import { type Picture, pictureFrom } from '@/lib/media';
import { audit } from '../audit/audit';
import { db } from '../db';
import { HttpError, Problems } from '../http/problem';

/**
 * Guia de Winden photos (2026-11-12, docs/phase-6/README.md §37): one photo per character version
 * ("<person>:<era>"), uploaded by the team as a PORTRAIT through the media pipeline. The public
 * guide shows a photo only together with its person, so the photos follow the same spoiler gates.
 * Only the guides and slots that exist in the code can be filled in.
 */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

const GUIDES: Record<string, () => Set<string>> = {
  [GUIDE_ID]: () => new Set(allSlots().map((s) => s.slot)),
};

export const portraitInput = z
  .object({
    slot: z.string().max(60),
    assetId: z.uuid().nullable(),
  })
  .strict();

/** slot → picture, for one guide */
export async function guidePortraits(guide: string): Promise<Record<string, Picture>> {
  const rows = await db().guidePortrait.findMany({
    where: { guide },
    select: { slot: true, asset: { select: { width: true, height: true, variants: true } } },
  });
  const out: Record<string, Picture> = {};
  for (const r of rows) {
    const p = pictureFrom(r.asset);
    if (p) out[r.slot] = p;
  }
  return out;
}

/** Puts a photo in a slot (or takes it out, with `assetId: null`). */
export async function setPortrait(
  ctx: Ctx,
  guide: string,
  input: z.infer<typeof portraitInput>,
): Promise<Picture | null> {
  const slots = GUIDES[guide];
  if (!slots) throw new HttpError(404, 'NOT_FOUND', 'Guia não encontrado.');
  if (!slots().has(input.slot))
    throw Problems.validation([{ path: 'slot', message: 'Esse personagem não existe no guia.' }]);

  if (input.assetId === null) {
    await db().$transaction(async (t) => {
      const { count } = await t.guidePortrait.deleteMany({ where: { guide, slot: input.slot } });
      if (count)
        await audit(
          {
            action: 'guide.portrait.remove',
            actor: ctx.actor,
            requestId: ctx.requestId,
            targetType: 'GuidePortrait',
            targetId: `${guide}/${input.slot}`,
            metadata: { guide, slot: input.slot },
          },
          t,
        );
    });
    return null;
  }

  const asset = await db().mediaAsset.findUnique({
    where: { id: input.assetId },
    select: { id: true, role: true, width: true, height: true, variants: true },
  });
  if (!asset || asset.role !== 'PORTRAIT')
    throw Problems.validation([
      { path: 'assetId', message: 'Envie a foto pelo campo do personagem (formato retrato, 3:4).' },
    ]);
  await db().$transaction(async (t) => {
    await t.guidePortrait.upsert({
      where: { guide_slot: { guide, slot: input.slot } },
      create: { guide, slot: input.slot, assetId: asset.id, updatedById: ctx.actor.id },
      update: { assetId: asset.id, updatedById: ctx.actor.id },
    });
    await audit(
      {
        action: 'guide.portrait.set',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'MediaAsset',
        targetId: asset.id,
        metadata: { guide, slot: input.slot },
      },
      t,
    );
  });
  return pictureFrom(asset);
}
