'use client';

/**
 * The single client for our JSON API (03 §2): same-origin, no cache, JSON in/out, and the
 * session-bound CSRF token from <meta name="csrf-token"> on every request.
 */
export type Problem = {
  status: number;
  code: string;
  detail: string;
  errors?: { path: string; message: string }[];
  stepUpUrl?: string;
  /** "totp", "passkey" or "totp,passkey": confirm on the page instead of Google */
  stepUpFactors?: string;
  enrollUrl?: string;
  verifyUrl?: string;
  currentVersion?: string;
  minGoalCents?: string;
  /** checkout (Phase 2) */
  totalCents?: string;
  remainingCents?: string;
  reason?: string;
};
export type ApiResult<T> = { ok: true; data: T } | { ok: false; problem: Problem };

function csrfToken(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? null;
}

export async function apiFetch<T>(
  path: string,
  init: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    /** binary upload (sent as-is, application/octet-stream) */
    blob?: Blob;
    /** extra request headers (Idempotency-Key, x-turnstile-token, an order-bound CSRF token) */
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult<T>> {
  if (!path.startsWith('/api/')) throw new Error('apiFetch only talks to our own API');
  const headers = new Headers({ accept: 'application/json' });
  const token = csrfToken();
  if (token) headers.set('x-csrf-token', token);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.blob) headers.set('content-type', 'application/octet-stream');
  for (const [k, v] of Object.entries(init.headers ?? {})) headers.set(k, v);
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      ...(init.blob ? { body: init.blob } : {}),
    });
  } catch {
    return {
      ok: false,
      problem: {
        status: 0,
        code: 'NETWORK',
        detail: 'Sem conexão. Verifique sua internet e tente de novo.',
      },
    };
  }
  if (res.ok) return { ok: true, data: (res.status === 204 ? undefined : await res.json()) as T };
  try {
    return { ok: false, problem: (await res.json()) as Problem };
  } catch {
    return {
      ok: false,
      problem: { status: res.status, code: 'UNKNOWN', detail: 'Erro inesperado. Tente de novo.' },
    };
  }
}
