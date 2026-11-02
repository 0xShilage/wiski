import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  amountToCents,
  centsToAmount,
  mapStatus,
  mpDate,
  mpErrorDetail,
  type MpPayment,
  pixPayload,
} from '@/server/payments/mercadopago/client';
import {
  manifest,
  parseSignatureHeader,
  tsToMs,
  verifyMpSignature,
} from '@/server/payments/mercadopago/signature';
import { brtDay, isoWeek } from '@/server/checkout/queue-jump';
import { buyerKeyFor, newPublicCode, PUBLIC_CODE } from '@/server/checkout/buyer';

const KEY = ['unit', 'test', 'signing', 'key', '000000000000'].join('-');
const sign = (text: string) => createHmac('sha256', KEY).update(text).digest('hex');

describe('webhook signature (05 §6)', () => {
  const now = 1_793_300_000_000;
  const ts = String(now);
  const good = () => `ts=${ts},v1=${sign(manifest('123', 'req-1', ts))}`;

  it('manifest template, with absent parts left out and alphanumeric ids lower-cased', () => {
    expect(manifest('123', 'req-1', '9')).toBe('id:123;request-id:req-1;ts:9;');
    expect(manifest('ABC1', 'r', '9')).toBe('id:abc1;request-id:r;ts:9;');
    expect(manifest(null, 'r', '9')).toBe('request-id:r;ts:9;');
    expect(manifest('1', null, '9')).toBe('id:1;ts:9;');
  });
  it('parses ts/v1 in any order, ignores unknown keys, rejects duplicates and bad hex', () => {
    expect(parseSignatureHeader(`v1=${'a'.repeat(64)}, ts=1793300000000`)).toEqual({
      ts: '1793300000000',
      v1: 'a'.repeat(64),
    });
    expect(parseSignatureHeader(`ts=1793300000000,v2=x,v1=${'b'.repeat(64)}`)).not.toBeNull();
    expect(parseSignatureHeader(`ts=1,ts=2,v1=${'a'.repeat(64)}`)).toBeNull();
    expect(parseSignatureHeader(`ts=1793300000000,v1=${'A'.repeat(64)}`)).toBeNull();
    expect(parseSignatureHeader('ts=1793300000000')).toBeNull();
    expect(parseSignatureHeader('x'.repeat(600))).toBeNull();
  });
  it('accepts a valid header; seconds or milliseconds', () => {
    const v = (h: string, t = now) =>
      verifyMpSignature({
        xSignature: h,
        xRequestId: 'req-1',
        dataId: '123',
        secrets: [KEY],
        now: t,
      });
    expect(v(good())).toMatchObject({ ok: true });
    const secs = String(Math.floor(now / 1000));
    expect(v(`ts=${secs},v1=${sign(manifest('123', 'req-1', secs))}`)).toMatchObject({ ok: true });
    expect(tsToMs('1793300000')).toBe(1_793_300_000_000);
  });
  it.each([
    ['no secret', { secrets: [] }, 'no-secret'],
    ['missing', { xSignature: null }, 'missing'],
    ['wrong id', { dataId: '124' }, 'mismatch'],
    ['wrong request id', { xRequestId: 'req-2' }, 'mismatch'],
    ['other secret', { secrets: ['other-secret-other-secret-00000'] }, 'mismatch'],
    ['stale', { now: now + 11 * 60_000 }, 'stale'],
    ['future', { now: now - 11 * 60_000 }, 'stale'],
  ])('%s → %s', (_n, over, reason) => {
    expect(
      verifyMpSignature({
        xSignature: good(),
        xRequestId: 'req-1',
        dataId: '123',
        secrets: [KEY],
        now,
        ...over,
      }),
    ).toEqual({ ok: false, reason });
  });
  it('tries every configured secret (rotation)', () => {
    expect(
      verifyMpSignature({
        xSignature: good(),
        xRequestId: 'req-1',
        dataId: '123',
        secrets: ['new-secret-new-secret-new-secret', KEY],
        now,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe('Mercado Pago boundary helpers', () => {
  it('cents ↔ reais, with the round trip asserted', () => {
    expect(centsToAmount(2100)).toBe(21);
    expect(centsToAmount(10540)).toBe(105.4);
    expect(centsToAmount(1)).toBe(0.01);
    expect(() => centsToAmount(0)).toThrow();
    expect(() => centsToAmount(1.5)).toThrow();
    expect(amountToCents(105.4)).toBe(10540);
    expect(amountToCents(0.1 + 0.2)).toBe(30);
  });
  it('dates carry the fixed −03:00 offset', () => {
    expect(mpDate(new Date('2026-10-30T15:31:00.000Z'))).toBe('2026-10-30T12:31:00.000-03:00');
    expect(mpDate(new Date('2026-10-31T01:00:00.000Z'))).toBe('2026-10-30T22:00:00.000-03:00');
  });
  it('maps every documented status; unknown → null', () => {
    for (const s of [
      'pending',
      'approved',
      'authorized',
      'in_process',
      'in_mediation',
      'rejected',
      'cancelled',
      'refunded',
      'charged_back',
    ]) {
      expect(mapStatus(s)).toBe(s.toUpperCase());
    }
    expect(mapStatus('chargeback_pending')).toBeNull();
  });

  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const pay = (qr_code: string, qr_code_base64: string) =>
    ({
      point_of_interaction: { transaction_data: { qr_code, qr_code_base64 } },
    }) as unknown as MpPayment;
  const EMV = `00020126580014br.gov.bcb.pix${'1'.repeat(30)}`;
  it('accepts a real-looking Pix payload', () => {
    expect(pixPayload(pay(EMV, PNG))).toEqual({ qrCode: EMV, qrCodeBase64: PNG });
  });
  it.each([
    ['SVG instead of PNG', EMV, Buffer.from('<svg onload=alert(1)></svg>').toString('base64')],
    ['not base64', EMV, `${PNG.slice(0, -4)}*!@#`],
    ['url-safe alphabet', EMV, PNG.replace(/\+/g, '-')],
    ['copia-e-cola not EMV', 'https://evil.example/pay', PNG],
    ['control chars in EMV', `${EMV}\n<script>`, PNG],
    [
      'huge image',
      EMV,
      Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(70_000)]).toString('base64'),
    ],
  ])('rejects %s', (_n, code, b64) => expect(pixPayload(pay(code, b64))).toBeNull());
});

describe('calendar for queue-jump caps (America/Sao_Paulo)', () => {
  it('uses the BRT calendar day', () => {
    expect(brtDay(new Date('2026-10-31T02:59:59Z')).toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(brtDay(new Date('2026-10-31T03:00:00Z')).toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });
  it('ISO weeks, including week 53 and year boundaries', () => {
    expect(isoWeek(new Date('2026-10-30T15:00:00Z'))).toBe('2026-W44');
    expect(isoWeek(new Date('2026-12-31T15:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2027-01-03T15:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2027-01-04T15:00:00Z'))).toBe('2027-W01');
    expect(isoWeek(new Date('2025-12-29T15:00:00Z'))).toBe('2026-W01');
    // the week turns at Monday 00:00 BRT (= 03:00 UTC)
    expect(isoWeek(new Date('2026-11-02T03:30:00Z'))).toBe('2026-W45');
    expect(isoWeek(new Date('2026-11-02T02:30:00Z'))).toBe('2026-W44');
  });
});

describe('buyer keys and public codes', () => {
  it('users by id, guests by normalised e-mail hash', () => {
    expect(buyerKeyFor('0190a000-0000-7000-8000-000000000001', 'x@y.com')).toBe(
      'u:0190a000-0000-7000-8000-000000000001',
    );
    const a = buyerKeyFor(null, ' Ana@Example.COM ');
    expect(a).toBe(buyerKeyFor(null, 'ana@example.com'));
    expect(a).toMatch(/^e:[0-9a-f]{64}$/);
    expect(a).not.toContain('ana');
  });
  it('public codes use Crockford base32', () => {
    for (let i = 0; i < 500; i++) expect(newPublicCode()).toMatch(PUBLIC_CODE);
  });
});

describe('Mercado Pago error details in the log (2026-11-02)', () => {
  it('keeps the codes and the message, masks e-mails and long numbers', () => {
    expect(
      mpErrorDetail({
        message: 'Collector user without key enabled for QR render',
        error: 'bad_request',
        status: 400,
        cause: [{ code: 13253, description: 'Collector user without key enabled for QR render' }],
      }),
    ).toEqual({
      code: '13253',
      message: 'Collector user without key enabled for QR render | bad_request',
    });
    const d = mpErrorDetail({
      message: 'Payer email forbidden: comprador@example.com, user 123456789',
      cause: [{ code: 'x"; drop', description: 'linha\u0007 nova\u202e' }],
    });
    expect(d.code).toBeNull(); // only plain codes are kept
    expect(d.message).toContain('<email>');
    expect(d.message).toContain('<n>');
    expect(d.message).not.toMatch(/example\.com|123456789/);
    expect([...d.message!].some((c) => c.charCodeAt(0) < 32 || c === '\u202e')).toBe(false);
  });
  it('anything else logs nothing extra', () => {
    expect(mpErrorDetail('not json')).toEqual({ code: null, message: null });
    expect(mpErrorDetail({ message: 42 })).toEqual({ code: null, message: null });
    expect(mpErrorDetail({ message: 'x'.repeat(5000) }).message).toHaveLength(200);
  });
});
