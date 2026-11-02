import 'server-only';
import type { Role } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { db } from '../db';

/** Streamer switches (step-up): today only "orders.open" (checkout on/off, Phase 2 fail-closed gate). */
type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export async function getSettings() {
  const row = await db().appSetting.findUnique({ where: { key: 'orders.open' } });
  return { ordersOpen: row ? row.value !== false : true };
}

export async function setOrdersOpen(ctx: Ctx, open: boolean) {
  await db().$transaction(async (t) => {
    await t.appSetting.upsert({
      where: { key: 'orders.open' },
      create: { key: 'orders.open', value: open },
      update: { value: open },
    });
    await audit(
      {
        action: 'settings.update',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'AppSetting',
        targetId: 'orders.open',
        metadata: { key: 'orders.open', value: open },
      },
      t,
    );
  });
  return getSettings();
}
