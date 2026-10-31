'use client';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { type ApiResult, apiFetch, type Problem } from './api-fetch';

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
 * page shows its verification gate (authenticator code or passkey); send the browser to Google
 * for a step-up, or to /perfil/seguranca when no second factor is set up yet.
 */
export async function adminFetch<T>(
  path: string,
  init: Parameters<typeof apiFetch>[1] = {},
): Promise<ApiResult<T>> {
  const res = await apiFetch<T>(path, init);
  if (!res.ok && res.problem.code === 'MFA_REQUIRED') {
    window.location.reload();
  }
  if (!res.ok && res.problem.code === 'MFA_ENROLL_REQUIRED') {
    window.location.assign(new URL('/perfil/seguranca', window.location.origin).href);
  }
  if (!res.ok && res.problem.code === 'STEP_UP_REQUIRED' && res.problem.stepUpUrl) {
    if (window.confirm('Esta ação pede que você entre com o Google de novo. Continuar?')) {
      window.location.assign(res.problem.stepUpUrl);
    }
  }
  return res;
}
