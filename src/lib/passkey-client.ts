'use client';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { type ApiResult, apiFetch, type Problem } from './api-fetch';
import { fetchWithStepUp } from './step-up-client';

/**
 * Browser side of the passkey second factor (11 §9); the authenticator app is in mfa-client.ts. The ceremonies run in the browser's own
 * passkey UI; our API only ever sees signed responses.
 */
const cancelled: Problem = {
  status: 0,
  code: 'PASSKEY_CANCELLED',
  detail: 'A verificação foi cancelada ou expirou. Tente de novo.',
};

export async function enrolPasskey(label: string): Promise<ApiResult<{ id: string }>> {
  const opt = await apiFetch<{ options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>(
    '/api/v1/me/passkeys/registration/options',
    { method: 'POST' },
  );
  if (!opt.ok) return opt;
  let response;
  try {
    response = await startRegistration({ optionsJSON: opt.data.options });
  } catch {
    return { ok: false, problem: cancelled };
  }
  return apiFetch('/api/v1/me/passkeys/registration', {
    method: 'POST',
    body: { response, ...(label ? { label } : {}) },
  });
}

export async function verifyPasskey(): Promise<ApiResult<{ verifiedUntil: string }>> {
  const opt = await apiFetch<{ options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
    '/api/v1/me/passkeys/authentication/options',
    { method: 'POST' },
  );
  if (!opt.ok) return opt;
  let response;
  try {
    response = await startAuthentication({ optionsJSON: opt.data.options });
  } catch {
    return { ok: false, problem: cancelled };
  }
  return apiFetch('/api/v1/me/passkeys/authentication', { method: 'POST', body: { response } });
}

/**
 * apiFetch for the dashboard: when the 96-hour second-factor window has passed, reload so the
 * page shows its verification gate (authenticator code or passkey); for a step-up, confirm on
 * the page with the second factor and send the request again (Google only for accounts without
 * one); to /perfil/seguranca when no second factor is set up yet.
 */
export async function adminFetch<T>(
  path: string,
  init: Parameters<typeof apiFetch>[1] = {},
): Promise<ApiResult<T>> {
  const res = await fetchWithStepUp<T>(path, init);
  if (!res.ok && res.problem.code === 'MFA_REQUIRED') {
    window.location.reload();
  }
  if (!res.ok && res.problem.code === 'MFA_ENROLL_REQUIRED') {
    window.location.assign(new URL('/perfil/seguranca', window.location.origin).href);
  }
  return res;
}
