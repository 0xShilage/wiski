import 'server-only';
import { getEnv } from '../env';
import { logger } from '../log';
import type { EmailContent } from './templates';

/**
 * Where e-mails go (08 §3): Resend's HTTPS API when RESEND_API_KEY is set (required in
 * production); otherwise the development transport writes a one-line notice to the log (never
 * the address or the order link) and keeps the message in memory for /dev tooling and tests.
 */
export type Outgoing = EmailContent & { to: string; idempotencyKey: string };
export type SendResult = { providerMessageId: string };

export class EmailSendError extends Error {
  constructor(
    readonly code: 'unavailable' | 'rejected' | 'invalid-response',
    readonly status: number | null,
  ) {
    super(`email ${code}${status ? ` ${status}` : ''}`);
    this.name = 'EmailSendError';
  }
}

const memory: (Outgoing & { at: Date })[] = [];
export function devOutbox(): readonly (Outgoing & { at: Date })[] {
  return memory;
}
export function clearDevOutbox(): void {
  memory.length = 0;
}

export async function sendEmail(msg: Outgoing): Promise<SendResult> {
  const env = getEnv();
  if (!env.RESEND_API_KEY) {
    memory.push({ ...msg, at: new Date() });
    if (memory.length > 200) memory.shift();
    logger.info({ subject: msg.subject }, 'e-mail (dev transport, not sent)');
    return { providerMessageId: `dev_${memory.length}` };
  }
  let res: Response;
  try {
    res = await fetch(`${env.RESEND_API_BASE.replace(/\/$/, '')}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        'idempotency-key': msg.idempotencyKey,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
  } catch {
    throw new EmailSendError('unavailable', null);
  }
  if (res.status >= 500 || res.status === 429) throw new EmailSendError('unavailable', res.status);
  if (!res.ok) throw new EmailSendError('rejected', res.status);
  const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!json || typeof json.id !== 'string')
    throw new EmailSendError('invalid-response', res.status);
  return { providerMessageId: json.id.slice(0, 128) };
}
