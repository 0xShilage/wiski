import 'server-only';
import type { NextRequest } from 'next/server';
import type { User } from '@/generated/prisma/client';
import { Problems } from '../http/problem';
import { idempotencyKeySchema } from './input';
import type { Buyer } from './orders';

/** `Idempotency-Key: <uuid>` is required on order creation (03 §1). */
export function idempotencyKey(req: NextRequest): string {
  const parsed = idempotencyKeySchema.safeParse(req.headers.get('idempotency-key'));
  if (!parsed.success) {
    throw Problems.validation([{ path: '(header) Idempotency-Key', message: 'Envie um UUID.' }]);
  }
  return parsed.data.toLowerCase();
}

export function buyerFrom(ctx: {
  req: NextRequest;
  user: User | null;
  ipKey: string;
  requestId: string;
}): Buyer {
  return {
    user: ctx.user,
    ipKey: ctx.ipKey === 'unknown' ? null : ctx.ipKey,
    requestId: ctx.requestId,
    idempotencyKey: idempotencyKey(ctx.req),
    req: ctx.req,
  };
}
