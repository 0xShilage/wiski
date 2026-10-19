/**
 * Minimal OpenID Provider standing in for Google in integration tests: discovery, JWKS and a
 * token endpoint that enforces client auth, redirect_uri, one-time codes and PKCE S256.
 * Each issued code carries the claims (and deliberate defects) the test wants.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

export type CodeSpec = {
  sub: string;
  email: string;
  emailVerified?: boolean | string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  /** deliberate defects */
  issuer?: string;
  audience?: string;
  expiresInSec?: number;
  iatOffsetSec?: number;
  authTime?: number;
  signWithOtherKey?: boolean;
  omitNonce?: boolean;
};

export type MockGoogle = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  issueCode(spec: CodeSpec): string;
  tokenRequests: number;
  close(): Promise<void>;
};

export async function startMockGoogle(): Promise<MockGoogle> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key-1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, CodeSpec & { used: boolean }>();
  const clientId = 'test-client.apps.googleusercontent.com';
  const clientSecret = 'test-client-secret-0123456789';
  let issuer = '';
  const state = { tokenRequests: 0 };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/o/oauth2/v2/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/certs`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        scopes_supported: ['openid', 'email', 'profile'],
      });
    }
    if (url.pathname === '/certs') return json(200, { keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        void (async () => {
          state.tokenRequests++;
          const form = new URLSearchParams(raw);
          const spec = codes.get(form.get('code') ?? '');
          if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) {
            return json(401, { error: 'invalid_client' });
          }
          if (!spec || spec.used)
            return json(400, {
              error: 'invalid_grant',
              error_description: 'code invalid or already used',
            });
          spec.used = true;
          if (form.get('redirect_uri') !== spec.redirectUri)
            return json(400, { error: 'invalid_grant', error_description: 'redirect_uri' });
          const verifier = form.get('code_verifier') ?? '';
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          if (challenge !== spec.codeChallenge)
            return json(400, { error: 'invalid_grant', error_description: 'pkce' });
          const now = Math.floor(Date.now() / 1000) + (spec.iatOffsetSec ?? 0);
          const claims: Record<string, unknown> = {
            sub: spec.sub,
            email: spec.email,
            email_verified: spec.emailVerified ?? true,
            azp: clientId,
            auth_time: spec.authTime ?? now,
          };
          if (!spec.omitNonce) claims.nonce = spec.nonce;
          const idToken = await new SignJWT(claims)
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' })
            .setIssuer(spec.issuer ?? issuer)
            .setAudience(spec.audience ?? clientId)
            .setIssuedAt(now)
            .setExpirationTime(now + (spec.expiresInSec ?? 3600))
            .sign(spec.signWithOtherKey ? other.privateKey : privateKey);
          return json(200, {
            access_token: randomBytes(16).toString('hex'),
            token_type: 'Bearer',
            expires_in: 3599,
            scope: 'openid email profile',
            id_token: idToken,
          });
        })();
      });
      return;
    }
    json(404, { error: 'not_found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    get tokenRequests() {
      return state.tokenRequests;
    },
    issueCode(spec) {
      const code = `code-${randomBytes(12).toString('base64url')}`;
      codes.set(code, { ...spec, used: false });
      return code;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
