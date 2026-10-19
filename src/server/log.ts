import 'server-only';
import pino from 'pino';

/**
 * JSON logs to stdout (01 §5). Redaction list (05 §13): cookies, auth headers, e-mail, tokens,
 * Pix payloads. IPs are never logged raw — only as keyed HMAC (security/client-ip.ts).
 */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.headers["x-turnstile-token"]',
  'res.headers["set-cookie"]',
  '*.email',
  '*.contactEmail',
  '*.token',
  '*.accessToken',
  '*.idToken',
  '*.code',
  '*.codeVerifier',
  '*.qrCode',
  '*.qrCodeBase64',
  '*.password',
  '*.secret',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'wiskiflix-web' },
  messageKey: 'msg',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  formatters: { level: (label) => ({ level: label }) },
});

export type Logger = typeof logger;
