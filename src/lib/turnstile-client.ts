'use client';

/**
 * Cloudflare Turnstile in the browser (05 §9). The script is added by our own (nonced) bundle,
 * which `'strict-dynamic'` trusts, through a Trusted Types policy that accepts exactly one URL.
 * Tokens are single-use: the widget is reset after every submit.
 */
export const TURNSTILE_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      action: string;
      theme?: 'dark' | 'light' | 'auto';
      language?: string;
      size?: 'normal' | 'flexible' | 'compact';
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

type TrustedTypesLike = {
  createPolicy: (
    name: string,
    rules: { createScriptURL: (url: string) => string },
  ) => { createScriptURL: (url: string) => unknown };
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;
let policy: { createScriptURL: (url: string) => unknown } | null | undefined;

function scriptUrl(): string {
  if (policy === undefined) {
    const tt = (window as unknown as { trustedTypes?: TrustedTypesLike }).trustedTypes;
    policy = tt
      ? tt.createPolicy('wf-turnstile', {
          createScriptURL: (url) => {
            if (url !== TURNSTILE_SRC) throw new TypeError('script URL not allowed');
            return url;
          },
        })
      : null;
  }
  return (policy ? policy.createScriptURL(TURNSTILE_SRC) : TURNSTILE_SRC) as string;
}

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = scriptUrl();
    s.async = true;
    s.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile missing'));
    };
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error('turnstile load failed'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
