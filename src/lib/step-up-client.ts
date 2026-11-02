'use client';
import { type ApiResult, apiFetch, type Problem } from './api-fetch';

/**
 * "Confirme que é você" (2026-11-01). Actions that need a recent proof of presence answer
 * STEP_UP_REQUIRED. Accounts with a second factor confirm on the page (authenticator code,
 * recovery code or passkey, in <StepUpHost/>), then the request is sent again; accounts without
 * one go to Google. Google can't be asked to re-check the password, so the factor is the real
 * proof for admins.
 */
export type StepUpFactors = { totp: boolean; passkey: boolean };
type Ask = (factors: StepUpFactors) => Promise<boolean>;

let host: Ask | null = null;

/** Called by <StepUpHost/> on mount (one per page). */
export function registerStepUpHost(ask: Ask | null) {
  host = ask;
}

export function factorsOf(problem: Problem): StepUpFactors | null {
  const list = (problem.stepUpFactors ?? '').split(',');
  const f = { totp: list.includes('totp'), passkey: list.includes('passkey') };
  return f.totp || f.passkey ? f : null;
}

/**
 * Handle a STEP_UP_REQUIRED problem: true when the person confirmed on the page (send the
 * request again), false when they cancelled or were sent to Google.
 */
export async function confirmPresence(problem: Problem): Promise<boolean> {
  const factors = factorsOf(problem);
  if (factors && host) return host(factors);
  if (
    problem.stepUpUrl &&
    window.confirm('Esta ação pede que você entre com o Google de novo. Continuar?')
  ) {
    window.location.assign(new URL(problem.stepUpUrl, window.location.origin).href);
  }
  return false;
}

/** apiFetch that confirms presence when asked and then retries once. */
export async function fetchWithStepUp<T>(
  path: string,
  init: Parameters<typeof apiFetch>[1] = {},
): Promise<ApiResult<T>> {
  const res = await apiFetch<T>(path, init);
  if (!res.ok && res.problem.code === 'STEP_UP_REQUIRED' && (await confirmPresence(res.problem))) {
    return apiFetch<T>(path, init);
  }
  return res;
}
