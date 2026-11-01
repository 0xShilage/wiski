import 'server-only';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { getEnv, isGoogleLoginConfigured } from '../env';
import { safeEqual, seal, unseal } from '../security/crypto';
import { safeReturnTo } from '../security/return-to';

/**
 * Google sign-in — OpenID Connect authorization code flow with PKCE (S256), state and nonce
 * (01 §3.1, 05 §5), using openid-client v6 (OpenID-certified RP). The per-login secrets travel
 * in the sealed, one-time `__Host-wf_oauth` cookie (AES-256-GCM, 10 min), never in the URL.
 */
export const CALLBACK_PATH = '/api/auth/google/callback';
export const OAUTH_COOKIE_TTL_MS = 10 * 60_000;
export const STEP_UP_MAX_AGE_SEC = 600;
const IAT_SKEW_SEC = 300;
const MAX_TOKEN_AGE_SEC = 600;
const SEAL_PURPOSE = '__Host-wf_oauth';

export class LoginError extends Error {
  constructor(
    /** pt-BR error key shown on /perfil?erro=… */
    readonly reason: 'cancelado' | 'expirado' | 'email' | 'falha' | 'indisponivel' | 'conta',
    message: string = reason,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

const oauthCookieSchema = z
  .object({
    s: z.string().min(32).max(128), // state
    n: z.string().min(32).max(128), // nonce
    v: z.string().min(43).max(128), // PKCE code_verifier
    r: z.string().max(512), // returnTo (already validated)
    m: z.number().int().positive().optional(), // max_age for step-up
  })
  .strict();
export type OAuthCookie = z.infer<typeof oauthCookieSchema>;

let configPromise: Promise<oidc.Configuration> | undefined;

/** Discovery (cached per process; retried after a failure). */
export function oidcConfig(): Promise<oidc.Configuration> {
  if (!isGoogleLoginConfigured()) return Promise.reject(new LoginError('indisponivel'));
  if (!configPromise) {
    const env = getEnv();
    const insecure = env.NODE_ENV === 'test' && new URL(env.GOOGLE_ISSUER).protocol === 'http:';
    configPromise = oidc
      .discovery(
        new URL(env.GOOGLE_ISSUER),
        env.GOOGLE_CLIENT_ID!,
        { client_secret: env.GOOGLE_CLIENT_SECRET!, id_token_signed_response_alg: 'RS256' },
        oidc.ClientSecretPost(env.GOOGLE_CLIENT_SECRET!),
        { timeout: 10, ...(insecure ? { execute: [oidc.allowInsecureRequests] } : {}) },
      )
      .then((config) => {
        // openid-client, per OIDC Core §3.1.3.7, trusts TLS for ID tokens from the token
        // endpoint and skips their JWS check by default. 05 §5 requires the JWKS signature check.
        oidc.enableNonRepudiationChecks(config);
        return config;
      })
      .catch((err: unknown) => {
        configPromise = undefined;
        throw err;
      });
  }
  return configPromise;
}

/** Test helper. */
export function resetOidcConfig(): void {
  configPromise = undefined;
}

export function redirectUri(): string {
  return `${getEnv().APP_ORIGIN}${CALLBACK_PATH}`;
}

/** Build the Google authorization URL and the sealed cookie that binds the callback to it. */
export async function beginLogin(opts: {
  returnTo: string | null;
  stepUp: boolean;
}): Promise<{ url: URL; cookie: string }> {
  const config = await oidcConfig();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const params: Record<string, string> = {
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    // Google supports only none/consent/select_account and has no reauth request (it ignores
    // prompt=login and max_age): a step-up shows the account chooser, and asks for auth_time
    // (returned only if enabled for the client); the second factor is the real admin step-up.
    prompt: 'select_account',
  };
  if (opts.stepUp) {
    params.claims = JSON.stringify({ id_token: { auth_time: { essential: true } } });
  }
  const payload: OAuthCookie = {
    s: state,
    n: nonce,
    v: verifier,
    r: safeReturnTo(opts.returnTo),
    ...(opts.stepUp ? { m: STEP_UP_MAX_AGE_SEC } : {}),
  };
  const env = getEnv();
  const cookie = seal(
    payload,
    { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS },
    SEAL_PURPOSE,
    OAUTH_COOKIE_TTL_MS,
  );
  return { url: oidc.buildAuthorizationUrl(config, params), cookie };
}

export function readOAuthCookie(value: string | undefined): OAuthCookie | null {
  if (!value) return null;
  const env = getEnv();
  const raw = unseal(
    value,
    { current: env.COOKIE_SEAL_KEY, previous: env.COOKIE_SEAL_KEY_PREVIOUS },
    SEAL_PURPOSE,
  );
  const parsed = oauthCookieSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(254),
  email_verified: z.literal(true, { error: 'unverified' }),
  iat: z.number(),
  auth_time: z.number().optional(),
});

export type GoogleIdentity = { sub: string; email: string; authTime: Date };

/**
 * Finish the flow: constant-time state check, code exchange with the PKCE verifier, ID-token
 * validation (signature via JWKS, iss, aud, exp/iat, nonce, max_age) by openid-client, then our
 * own checks: `email_verified` must be true; identity is `sub`, never the e-mail.
 */
export async function completeLogin(
  callbackUrl: URL,
  cookie: OAuthCookie | null,
): Promise<GoogleIdentity> {
  const params = callbackUrl.searchParams;
  if (params.get('error')) {
    throw new LoginError(params.get('error') === 'access_denied' ? 'cancelado' : 'falha');
  }
  if (!cookie) throw new LoginError('expirado', 'missing or invalid oauth cookie');
  const state = params.get('state');
  if (!state || !safeEqual(state, cookie.s)) throw new LoginError('expirado', 'state mismatch');
  if (!params.get('code')) throw new LoginError('falha', 'missing code');

  const config = await oidcConfig();
  let claims: unknown;
  try {
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: cookie.v,
      expectedState: cookie.s,
      expectedNonce: cookie.n,
      idTokenExpected: true,
    });
    claims = tokens.claims();
  } catch (err) {
    throw new LoginError(
      'falha',
      err instanceof Error ? `token exchange: ${err.message}` : 'token exchange',
    );
  }
  const parsed = claimsSchema.safeParse(claims);
  if (!parsed.success) {
    const unverified = parsed.error.issues.some((i) => i.path[0] === 'email_verified');
    throw new LoginError(unverified ? 'email' : 'falha', 'id_token claims rejected');
  }
  const { sub, email, iat, auth_time } = parsed.data;
  // iat skew ≤ 5 min (05 §5); the code was just exchanged, so the token must be fresh too.
  const nowSec = Date.now() / 1000;
  if (iat > nowSec + IAT_SKEW_SEC || iat < nowSec - MAX_TOKEN_AGE_SEC) {
    throw new LoginError('falha', 'id_token iat out of range');
  }
  return { sub, email: email.toLowerCase(), authTime: new Date((auth_time ?? iat) * 1000) };
}
