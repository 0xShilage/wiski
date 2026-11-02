import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Role } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { COOKIE, setHostCookie } from '../auth/cookies';
import { db } from '../db';
import { getEnv } from '../env';
import { Problems } from '../http/problem';
import { randomToken, seal, sha256Bytes, unseal } from '../security/crypto';
import { codePointLength, plainText } from '../text/sanitize';
import { WIDGETS, type Widget } from './events';

/**
 * OBS overlay credentials (01 §3.4, 05 §5 A7). The streamer creates a key in the dashboard; the
 * raw key is shown once and only its SHA-256 is stored. The overlay URL carries it in the
 * fragment (`/overlay/agora#k=…`), so it never reaches a log or a Referer; the page exchanges it
 * for `__Host-wf_overlay` (sealed, read-only, 12 h, limited to the key's widgets). Every stream
 * re-checks that the key still exists and isn't revoked.
 *
 * 2026-11-01: OBS shares one cookie jar between all its browser sources, so the cookie holds a
 * grant per key (up to OVERLAY_MAX_GRANTS, newest first) instead of only the last key used. Before,
 * a source opened with an older key replaced the grant of a newer one, and a widget only the newer
 * key allows ("Meta total") was refused.
 */
const PURPOSE = 'overlay-cookie';
export const OVERLAY_SESSION_MS = 12 * 3_600_000;
const KEY_FORMAT = /^wfo_[\w-]{43}$/;

export const OVERLAY_MAX_GRANTS = 8;

/**
 * The overlay cookie's name and Secure flag. OBS's built-in Chromium (an older CEF) drops
 * `__Host-` cookies on http://localhost — Chrome only lifted that later — so `npm run dev` over
 * plain http uses a plain, non-Secure name; anything else (tests, production: https only, see
 * env.ts) keeps `__Host-wf_overlay`. Development only: HttpOnly, SameSite=Strict either way.
 */
export function overlayCookieSpec(env: { NODE_ENV: string; APP_ORIGIN: string } = getEnv()): {
  name: string;
  secure: boolean;
} {
  return env.NODE_ENV === 'development' && env.APP_ORIGIN.startsWith('http://')
    ? { name: 'wf_overlay_dev', secure: false }
    : { name: COOKIE.overlay, secure: true };
}

/** The overlay cookie of a request (whichever name this environment uses). */
export function overlayCookieOf(req: {
  cookies: { get(n: string): { value: string } | undefined };
}) {
  return req.cookies.get(overlayCookieSpec().name)?.value;
}
const grant = z
  .object({ keyId: z.uuid(), widgets: z.array(z.enum(WIDGETS)).min(1).max(WIDGETS.length) })
  .strict();
const cookiePayload = z.object({ grants: z.array(grant).min(1).max(OVERLAY_MAX_GRANTS) }).strict();
export type OverlayGrant = z.infer<typeof grant>;
export type OverlayCookie = z.infer<typeof cookiePayload>;

/** The grants in a cookie (the one-key format of before 2026-11-01 too); [] when invalid. */
function readGrants(raw: string | undefined): OverlayGrant[] {
  if (!raw) return [];
  const v = unseal(raw, keys(), PURPOSE);
  const multi = cookiePayload.safeParse(v);
  if (multi.success) return multi.data.grants;
  const single = grant.safeParse(v);
  return single.success ? [single.data] : [];
}

function keys() {
  const env = getEnv();
  return { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS };
}

type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export async function createOverlayKey(ctx: Ctx, input: { label: string; widgets: Widget[] }) {
  const label = plainText(input.label);
  if (!label || codePointLength(label) > 40) {
    throw Problems.validation([{ path: 'label', message: 'Dê um nome de até 40 caracteres.' }]);
  }
  const widgets = [...new Set(input.widgets)];
  const raw = `wfo_${randomToken(32)}`;
  const row = await db().$transaction(async (t) => {
    const k = await t.overlayKey.create({
      data: { label, widgets, keyHash: sha256Bytes(raw), keyPrefix: raw.slice(4, 10) },
    });
    await audit(
      {
        action: 'overlay.key.create',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'OverlayKey',
        targetId: k.id,
        metadata: { widgets },
      },
      t,
    );
    return k;
  });
  // the only time the raw key leaves the server
  return { key: raw, overlay: publicKey(row) };
}

export async function revokeOverlayKey(ctx: Ctx, id: string, now = new Date()) {
  await db().$transaction(async (t) => {
    const res = await t.overlayKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (res.count !== 1) throw Problems.notFound();
    await audit(
      {
        action: 'overlay.key.revoke',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'OverlayKey',
        targetId: id,
        metadata: {},
      },
      t,
    );
  });
}

export function publicKey(k: {
  id: string;
  label: string;
  keyPrefix: string;
  widgets: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}) {
  return {
    id: k.id,
    label: k.label,
    keyPrefix: k.keyPrefix,
    widgets: k.widgets,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
  };
}

export async function listOverlayKeys() {
  const rows = await db().overlayKey.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  return rows.map(publicKey);
}

/**
 * Key → sealed cookie, keeping the grants of the other keys already in it. A wrong, malformed or
 * revoked key is a 401 with no detail.
 */
export async function exchangeOverlayKey(
  raw: string,
  current?: string,
  now = new Date(),
): Promise<NextResponse> {
  if (!KEY_FORMAT.test(raw)) throw Problems.unauthenticated();
  const k = await db().overlayKey.findUnique({ where: { keyHash: sha256Bytes(raw) } });
  if (!k || k.revokedAt) throw Problems.unauthenticated();
  await db().overlayKey.update({ where: { id: k.id }, data: { lastUsedAt: now } });
  const widgets = k.widgets.filter((w): w is Widget => (WIDGETS as readonly string[]).includes(w));
  const res = NextResponse.json({ widgets });
  const grants = [
    { keyId: k.id, widgets },
    ...readGrants(current).filter((g) => g.keyId !== k.id),
  ].slice(0, OVERLAY_MAX_GRANTS);
  const value = seal({ grants } satisfies OverlayCookie, keys(), PURPOSE, OVERLAY_SESSION_MS);
  const spec = overlayCookieSpec();
  if (spec.secure) {
    setHostCookie(res, COOKIE.overlay, value, {
      maxAgeSec: OVERLAY_SESSION_MS / 1000,
      sameSite: 'strict',
    });
  } else {
    res.cookies.set({
      name: spec.name,
      value,
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/',
      maxAge: OVERLAY_SESSION_MS / 1000,
    });
  }
  return res;
}

/** The grant that opens this widget: in the cookie, for a key that is still active. */
export async function overlayAccess(
  req: NextRequest,
  widget: Widget,
): Promise<OverlayGrant | null> {
  const candidates = readGrants(overlayCookieOf(req)).filter((g) => g.widgets.includes(widget));
  if (!candidates.length) return null;
  const active = await db().overlayKey.findMany({
    where: { id: { in: candidates.map((g) => g.keyId) }, revokedAt: null },
    select: { id: true, widgets: true },
  });
  return (
    candidates.find((g) => active.some((k) => k.id === g.keyId && k.widgets.includes(widget))) ??
    null
  );
}
