import 'server-only';
import type { ContactStatus, Role } from '@/generated/prisma/client';
import { audit } from '../audit/audit';
import { normaliseEmail } from '../checkout/buyer';
import { db } from '../db';
import { getEnv } from '../env';
import { HttpError, Problems } from '../http/problem';
import { seal, unseal } from '../security/crypto';
import { codePointLength, plainText } from '../text/sanitize';

/**
 * Contact form (03 §5.5, 05 §5 "Contact form", Q18): brands and partners write to the streamer.
 * Turnstile + honeypot + a minimum fill time (a sealed timestamp issued with the page) + rate
 * limits; text sanitised to plain text; stored in the dashboard inbox and purged after 12 months
 * (LGPD). The e-mail alert waits for the e-mail provider (E1).
 */
const PURPOSE = 'contact-form';
export const MIN_FILL_MS = 3_000;
const FORM_TTL_MS = 2 * 3_600_000;
export const RETENTION_MS = 365 * 86_400_000;

function keys() {
  const env = getEnv();
  return { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS };
}

/** Issued with the page; proves the form was open for a few seconds. */
export function contactFormToken(now = new Date()): string {
  return seal({ t: now.getTime() }, keys(), PURPOSE, FORM_TTL_MS);
}

export const ContactProblems = {
  tooFast: () => new HttpError(422, 'FORM_TOO_FAST', 'Espere alguns segundos e envie de novo.'),
  expired: () =>
    new HttpError(
      422,
      'FORM_EXPIRED',
      'O formulário expirou. Recarregue a página e envie de novo.',
    ),
};

function field(
  raw: string | undefined,
  path: string,
  max: number,
  opts: { multiline?: boolean; optional?: boolean } = {},
) {
  const v = raw === undefined ? '' : plainText(raw, { multiline: opts.multiline ?? false });
  if (!v) {
    if (opts.optional) return null;
    throw Problems.validation([{ path, message: 'Preencha este campo.' }]);
  }
  if (codePointLength(v) > max)
    throw Problems.validation([{ path, message: `Use no máximo ${max} caracteres.` }]);
  return v;
}

export async function submitContact(
  input: {
    name: string;
    email: string;
    company?: string | undefined;
    subject: string;
    body: string;
    website: string;
    formToken: string;
  },
  now = new Date(),
): Promise<{ received: true }> {
  const issued = unseal<{ t: number }>(input.formToken, keys(), PURPOSE);
  if (!issued || typeof issued.t !== 'number' || now.getTime() - issued.t > FORM_TTL_MS) {
    throw ContactProblems.expired();
  }
  if (now.getTime() - issued.t < MIN_FILL_MS) throw ContactProblems.tooFast();
  // honeypot: a bot filled the hidden field — answer as if it worked, store nothing
  if (input.website.trim() !== '') return { received: true };
  const name = field(input.name, 'name', 80)!;
  const company = field(input.company, 'company', 80, { optional: true });
  const subject = field(input.subject, 'subject', 120)!;
  const body = field(input.body, 'body', 4000, { multiline: true })!;
  const email = normaliseEmail(input.email); // format checked by the route's schema
  await db().contactMessage.create({
    data: {
      name,
      email,
      company,
      subject,
      body,
      purgeAfter: new Date(now.getTime() + RETENTION_MS),
    },
  });
  return { received: true };
}

// ── inbox (streamer) ──

export async function listContact(q: { status?: ContactStatus; before?: string }) {
  const rows = await db().contactMessage.findMany({
    where: {
      ...(q.status ? { status: q.status } : { status: { in: ['NEW', 'READ'] } }),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 31,
  });
  const more = rows.length > 30;
  const shown = rows.slice(0, 30);
  return {
    messages: shown.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
      purgeAfter: m.purgeAfter.toISOString(),
    })),
    next: more ? shown.at(-1)!.createdAt.toISOString() : null,
    unread: await db().contactMessage.count({ where: { status: 'NEW' } }),
  };
}

type Ctx = { actor: { id: string; role: Role }; requestId: string | null };

export async function setContactStatus(ctx: Ctx, id: string, status: ContactStatus) {
  await db().$transaction(async (t) => {
    const res = await t.contactMessage.updateMany({ where: { id }, data: { status } });
    if (res.count !== 1) throw Problems.notFound();
    await audit(
      {
        action: 'contact.status',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'ContactMessage',
        targetId: id,
        metadata: { to: status },
      },
      t,
    );
  });
}

export async function deleteContact(ctx: Ctx, id: string) {
  await db().$transaction(async (t) => {
    const res = await t.contactMessage.deleteMany({ where: { id } });
    if (res.count !== 1) throw Problems.notFound();
    await audit(
      {
        action: 'contact.delete',
        actor: ctx.actor,
        requestId: ctx.requestId,
        targetType: 'ContactMessage',
        targetId: id,
        metadata: {},
      },
      t,
    );
  });
}

/** Worker: LGPD retention. */
export async function purgeContact(now = new Date()): Promise<number> {
  const res = await db().contactMessage.deleteMany({ where: { purgeAfter: { lt: now } } });
  return res.count;
}
