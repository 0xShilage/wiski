import { describe, expect, it } from 'vitest';
import { LEGAL_TEXTS } from '@/content/legal/documents';
import { businessDay, businessDayDate, isoWeek } from '@/lib/time/business-day';
import { escapeHtml, render } from '@/server/email/templates';
import { currentLegal, provisionalLegalTypes } from '@/server/legal/legal';
import {
  buyerKeyForEmail,
  contactEmailSchema,
  newPublicCode,
  PUBLIC_CODE_PATTERN,
  uuidv7,
} from '@/server/orders/identity';
import {
  centsToDecimal,
  decimalToCents,
  mapOrderStatus,
  MercadoPagoError,
} from '@/server/payments/mercadopago';
import { canMove } from '@/server/payments/sync';
import { manifest, parseSignature, tsMillis, verifyNotification } from '@/server/payments/webhook';
import { createHmac } from 'node:crypto';

describe('money at the Mercado Pago boundary (no floats)', () => {
  it.each([
    [500, '5.00'],
    [2000, '20.00'],
    [2105, '21.05'],
    [10_540, '105.40'],
    [99_999_999, '999999.99'],
  ])('%i cents → "%s" and back', (cents, text) => {
    expect(centsToDecimal(cents)).toBe(text);
    expect(decimalToCents(text)).toBe(cents);
  });

  it('parses "20", "20.5" and rejects anything else', () => {
    expect(decimalToCents('20')).toBe(2000);
    expect(decimalToCents('20.5')).toBe(2050);
    for (const bad of ['', '-1.00', '1e3', '20.555', '20,00', ' 20.00', 'NaN']) {
      expect(() => decimalToCents(bad)).toThrow(MercadoPagoError);
    }
    expect(() => centsToDecimal(0)).toThrow(RangeError);
    expect(() => centsToDecimal(10.5)).toThrow(RangeError);
  });
});

describe('Orders API status → our forward-only payment state', () => {
  it.each([
    ['action_required', 'waiting_transfer', 'PENDING'],
    ['processing', null, 'IN_PROCESS'],
    ['processed', 'accredited', 'APPROVED'],
    ['processed', 'refunded', 'REFUNDED'],
    ['refunded', null, 'REFUNDED'],
    ['failed', null, 'REJECTED'],
    ['canceled', 'expired', 'CANCELLED'],
    ['cancelled', null, 'CANCELLED'],
    ['charged_back', 'in_process', 'IN_MEDIATION'],
    ['charged_back', 'settled', 'CHARGED_BACK'],
    ['something_new', null, null],
  ] as const)('%s / %s → %s', (status, detail, out) => {
    expect(mapOrderStatus(status, detail)).toBe(out);
  });

  it('never moves backwards (02 §3)', () => {
    expect(canMove('PENDING', 'APPROVED')).toBe(true);
    expect(canMove('APPROVED', 'PENDING')).toBe(false);
    expect(canMove('APPROVED', 'CANCELLED')).toBe(false);
    expect(canMove('CANCELLED', 'APPROVED')).toBe(false);
    expect(canMove('IN_MEDIATION', 'APPROVED')).toBe(true);
    expect(canMove('REFUNDED', 'APPROVED')).toBe(false);
  });
});

describe('notification signature (05 §6)', () => {
  const secret = ['unit', 'signing', 'key', 'fake'].join('-');
  const sign = (id: string, rid: string, ts: string) =>
    createHmac('sha256', secret)
      .update(manifest(id, rid, ts))
      .digest('hex');

  it('parses exactly one ts and one hex v1', () => {
    expect(parseSignature(`ts=1742505638683,v1=${'a'.repeat(64)}`)).toEqual({
      ts: '1742505638683',
      v1: 'a'.repeat(64),
    });
    for (const bad of [
      null,
      '',
      'ts=1742505638683',
      `v1=${'a'.repeat(64)}`,
      `ts=1742505638683,v1=${'a'.repeat(63)}`,
      `ts=abc,v1=${'a'.repeat(64)}`,
      `ts=1742505638683,ts=1742505638684,v1=${'a'.repeat(64)}`,
      `ts=1742505638683,v1=${'a'.repeat(64)},v1=${'b'.repeat(64)}`,
      `ts1742505638683,v1=${'a'.repeat(64)}`,
    ]) {
      expect(parseSignature(bad)).toBeNull();
    }
  });

  it('builds the documented manifest, omitting absent parts', () => {
    expect(manifest('ord01', 'rid', '123')).toBe('id:ord01;request-id:rid;ts:123;');
    expect(manifest(null, 'rid', '123')).toBe('request-id:rid;ts:123;');
    expect(manifest('ord01', null, '123')).toBe('id:ord01;ts:123;');
  });

  it('seconds or milliseconds by magnitude', () => {
    expect(tsMillis('1742505638')).toBe(1_742_505_638_000);
    expect(tsMillis('1742505638683')).toBe(1_742_505_638_683);
  });

  it('verifies, with the previous secret during rotation, and rejects stale', () => {
    const now = 1_742_505_638_683;
    const ts = String(now);
    const v1 = sign('ord01abc', 'req-12345678', ts);
    const base = {
      dataId: 'ORD01ABC',
      requestId: 'req-12345678',
      signature: `ts=${ts},v1=${v1}`,
      now,
    };
    expect(verifyNotification({ ...base, secrets: [secret] })).toBe('ok');
    expect(verifyNotification({ ...base, secrets: ['new-secret-new-secret', secret] })).toBe('ok');
    expect(verifyNotification({ ...base, secrets: ['new-secret-new-secret'] })).toBe(
      'bad-signature',
    );
    expect(verifyNotification({ ...base, secrets: [secret], now: now + 11 * 60_000 })).toBe(
      'stale',
    );
    expect(verifyNotification({ ...base, secrets: [secret], dataId: 'ORD01ABD' })).toBe(
      'bad-signature',
    );
    expect(verifyNotification({ ...base, secrets: [secret], signature: 'garbage' })).toBe(
      'malformed',
    );
  });
});

describe('order identity', () => {
  it('public codes are Crockford base32 (no I, L, O, U)', () => {
    for (let i = 0; i < 500; i++) expect(newPublicCode()).toMatch(PUBLIC_CODE_PATTERN);
  });

  it('UUID v7: version/variant bits, time-ordered', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it('guest buyer key = hash of the normalised e-mail; the e-mail is never in it', () => {
    const k = buyerKeyForEmail('  Ana@Example.COM ');
    expect(k).toBe(buyerKeyForEmail('ana@example.com'));
    expect(k).toMatch(/^e:[0-9a-f]{64}$/);
    expect(k).not.toContain('ana');
  });

  it('contact e-mails: trimmed, lower-cased, strict', () => {
    expect(contactEmailSchema.parse(' Fan@Example.com ')).toBe('fan@example.com');
    for (const bad of [
      'a@b',
      'no-at.example.com',
      'a@@b.com',
      'a b@c.com',
      'x@-bad.com',
      'ç@a.com',
    ]) {
      expect(contactEmailSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('business calendar (America/Sao_Paulo)', () => {
  it('a UTC instant after 21:00 in São Paulo is still that day there', () => {
    expect(businessDay(new Date('2026-10-20T02:30:00Z'))).toBe('2026-10-19');
    expect(businessDayDate(new Date('2026-10-20T02:30:00Z')).toISOString()).toBe(
      '2026-10-19T00:00:00.000Z',
    );
  });

  it.each([
    ['2026-01-01T12:00:00Z', '2026-W01'], // Thursday
    ['2027-01-01T12:00:00Z', '2026-W53'], // Friday → ISO week 53 of 2026
    ['2026-12-28T12:00:00Z', '2026-W53'],
    ['2027-01-04T12:00:00Z', '2027-W01'],
    ['2026-10-19T12:00:00Z', '2026-W43'],
  ])('%s → %s', (iso, week) => {
    expect(isoWeek(new Date(iso))).toBe(week);
  });
});

describe('e-mail templates', () => {
  const ctx = {
    origin: 'https://wiski.fun',
    publicCode: 'WF-7K3Q9X',
    kind: 'MOVIE' as const,
    title: 'O <b>Esquilo</b> & "amigos"',
    totalCents: 2000,
    orderUrl: 'https://wiski.fun/pedido/WF-7K3Q9X#t=abc',
    itemUrl: 'https://wiski.fun/filmes/o-esquilo',
  };

  it('escapes every value in HTML; plain text keeps the title as is', () => {
    const r = render('ORDER_RECEIPT', ctx);
    expect(r.html).not.toContain('<b>Esquilo</b>');
    expect(r.html).toContain('O &lt;b&gt;Esquilo&lt;/b&gt; &amp; &quot;amigos&quot;');
    expect(r.html).not.toMatch(/<img|<script|https?:\/\/(?!wiski\.fun)/);
    expect(r.text).toContain('R$ 20,00');
    expect(r.text).toContain(ctx.orderUrl);
    expect(escapeHtml(`'`)).toBe('&#39;');
  });

  it('subjects cannot carry header breaks', () => {
    const r = render('CAMPAIGN_FUNDED', {
      ...ctx,
      kind: 'CONTRIBUTION',
      title: 'X\r\nBcc: evil@example.com',
    });
    expect(r.subject).not.toMatch(/[\r\n]/);
  });
});

describe('legal texts', () => {
  // A published version's text must never change in place: edit → bump `version` → update here.
  const PINNED: Record<string, string> = {
    'TERMS 2026-10-19-provisorio':
      'ece3df5554c99080172530990c7f142c1dfabf7b0971dcdcea57aa012b090145',
    'PRIVACY 2026-10-19-provisorio':
      'a660a4e37bd68943ec00fd0a044048dfcedf0b43d69b8147eefc89b3b9aa3ece',
    'REFUND 2026-10-19-provisorio':
      '6798fa04ef72fca3f0ec128a1fa24426344601d8bd43a961ccd9ea411a28fa51',
  };

  it('every current version has its pinned hash', () => {
    for (const [type, doc] of Object.entries(currentLegal())) {
      expect(doc.sha256, `${type} ${doc.version}`).toBe(PINNED[`${type} ${doc.version}`]);
    }
  });

  it('provisional texts are marked (production refuses to start with them)', () => {
    expect(provisionalLegalTypes()).toEqual(
      Object.values(LEGAL_TEXTS)
        .filter((t) => t.provisional)
        .map((t) => t.type),
    );
  });
});
