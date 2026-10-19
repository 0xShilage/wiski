'use client';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { type ApiResult, apiFetch, type Problem } from './api-fetch';

/**
 * Browser side of the admin second factor (11 §9). The ceremonies run in the browser's own
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
 * apiFetch for the dashboard: when the 10-minute passkey window has passed, ask for the passkey
 * once and retry; send the browser to Google for a step-up or to enrolment when needed.
 */
export async function adminFetch<T>(
  path: string,
  init: Parameters<typeof apiFetch>[1] = {},
): Promise<ApiResult<T>> {
  let res = await apiFetch<T>(path, init);
  if (!res.ok && res.problem.code === 'PASSKEY_REQUIRED') {
    const v = await verifyPasskey();
    if (!v.ok) return v;
    res = await apiFetch<T>(path, init);
  }
  if (!res.ok && res.problem.code === 'PASSKEY_ENROLL_REQUIRED') {
    window.location.assign(new URL('/perfil/seguranca', window.location.origin).href);
  }
  if (!res.ok && res.problem.code === 'STEP_UP_REQUIRED' && res.problem.stepUpUrl) {
    if (window.confirm('Esta ação pede que você entre com o Google de novo. Continuar?')) {
      window.location.assign(res.problem.stepUpUrl);
    }
  }
  return res;
}
