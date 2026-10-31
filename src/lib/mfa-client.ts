'use client';
import { type ApiResult, apiFetch } from './api-fetch';

/** Browser side of the authenticator app (TOTP) second factor. */
export type TotpSetup = {
  secret: string;
  uri: string;
  qr: { size: number; path: string };
  expiresAt: string;
};

export const startTotpSetup = () =>
  apiFetch<TotpSetup>('/api/v1/me/totp/setup', { method: 'POST' });

export const enableTotp = (code: string) =>
  apiFetch<{ recoveryCodes: string[]; verifiedUntil: string }>('/api/v1/me/totp/enable', {
    method: 'POST',
    body: { code },
  });

export const verifyTotp = (
  input: { code: string } | { recoveryCode: string },
): Promise<ApiResult<{ verifiedUntil: string; method: string; recoveryLeft: number }>> =>
  apiFetch('/api/v1/me/totp/verify', { method: 'POST', body: input });

export const regenerateRecoveryCodes = () =>
  apiFetch<{ recoveryCodes: string[] }>('/api/v1/me/totp/recovery-codes', { method: 'POST' });

export const disableTotp = () => apiFetch<null>('/api/v1/me/totp', { method: 'DELETE' });
