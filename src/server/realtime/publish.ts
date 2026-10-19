import 'server-only';
import { z } from 'zod';
import { logger } from '../log';
import { redis } from '../redis';

/**
 * Realtime events (03 §6) over Redis pub/sub → SSE. Payloads are schema-checked before they are
 * published and carry no personal data (no e-mail, no names): an order channel is readable only
 * by its owner, a campaign channel is public.
 */
export const orderEventSchema = z
  .object({
    type: z.literal('status'),
    code: z.string().regex(/^WF-[0-9A-Z]{6}$/),
    status: z.string().max(20),
    paymentStatus: z.string().max(20),
    at: z.iso.datetime(),
  })
  .strict();

export const campaignEventSchema = z
  .object({
    type: z.literal('progress'),
    goalCents: z.int().nonnegative(),
    raisedCents: z.int().nonnegative(),
    remainingCents: z.int().nonnegative(),
    supporterCount: z.int().nonnegative(),
    state: z.enum(['OPEN', 'PAUSED', 'FUNDED', 'SCHEDULED', 'WATCHED']),
    at: z.iso.datetime(),
  })
  .strict();

export type OrderEvent = z.infer<typeof orderEventSchema>;
export type CampaignEvent = z.infer<typeof campaignEventSchema>;

export const channel = {
  order: (orderId: string) => `wf:order:${orderId}`,
  campaign: (campaignId: string) => `wf:campaign:${campaignId}`,
};

async function publish(ch: string, payload: unknown): Promise<void> {
  try {
    await redis().publish(ch, JSON.stringify(payload));
  } catch (err) {
    // Pages fall back to polling every 4 s; a lost event costs at most that.
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'realtime publish failed');
  }
}

export function publishOrder(orderId: string, e: OrderEvent): Promise<void> {
  return publish(channel.order(orderId), orderEventSchema.parse(e));
}

export function publishCampaign(campaignId: string, e: CampaignEvent): Promise<void> {
  return publish(channel.campaign(campaignId), campaignEventSchema.parse(e));
}
