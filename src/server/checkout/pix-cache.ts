import 'server-only';
import { z } from 'zod';
import { logger } from '../log';
import { getPayment, pixPayload } from '../payments/mercadopago/client';
import { redis } from '../redis';

/**
 * Pix QR payloads live only in Redis with TTL = expiry (schema header); when the key is missing
 * (Redis restarted) the payload is re-fetched from Mercado Pago and validated again.
 */
export type PixPayload = { qrCode: string; qrCodeBase64: string };
const schema = z.object({ qrCode: z.string(), qrCodeBase64: z.string() }).strict();
const key = (orderId: string) => `pix:${orderId}`;

export async function cachePix(orderId: string, pix: PixPayload, expiresAt: Date): Promise<void> {
  const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  if (ttl <= 0) return;
  try {
    await redis().set(key(orderId), JSON.stringify(pix), 'EX', ttl);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : 'unknown' }, 'pix cache write failed');
  }
}

export async function loadPix(
  orderId: string,
  providerPaymentId: string | null,
  expiresAt: Date,
): Promise<PixPayload | null> {
  if (expiresAt.getTime() <= Date.now()) return null;
  try {
    const raw = await redis().get(key(orderId));
    if (raw) {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    /* fall through to Mercado Pago */
  }
  if (!providerPaymentId) return null;
  try {
    const mp = await getPayment(providerPaymentId);
    if (mp.status !== 'pending') return null;
    const pix = pixPayload(mp);
    if (pix) await cachePix(orderId, pix, expiresAt);
    return pix;
  } catch {
    return null;
  }
}

export async function dropPix(orderId: string): Promise<void> {
  try {
    await redis().del(key(orderId));
  } catch {
    /* expires by itself */
  }
}
