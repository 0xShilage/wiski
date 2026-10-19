import 'server-only';
import type { NextRequest } from 'next/server';
import { type z } from 'zod';
import type { Session, User } from '@/generated/prisma/client';
import { type AuditAction, type AuditEntry, audit } from '../audit/audit';
import { COOKIE } from '../auth/cookies';
import { countPasskeys, isMfaFresh } from '../auth/passkeys';
import { loadSession, type SessionContext } from '../auth/session';
import { isStepUpFresh, stepUpUrl } from '../auth/step-up';
import { getEnv } from '../env';
import { logger } from '../log';
import { hit } from '../ratelimit/sliding-window';
import type { RateLimitRule } from '../ratelimit/rules';
import { type AccessLevel, meetsAccess } from '../rbac';
import { redis } from '../redis';
import { clientIp, ipKey } from '../security/client-ip';
import { CSRF_HEADER, isSameOriginRequest, isValidCsrfToken } from '../security/csrf';
import { TURNSTILE_HEADER, verifyTurnstile } from '../security/turnstile';
import { HttpError, Problems, type ProblemField, problemResponse } from './problem';
import { requestIdFrom } from './request-id';

/**
 * The guard pipeline (03 §2). Every Route Handler is wrapped; order matters:
 *
 *   requestId → method allow-list → body size/content-type → rate limit (IP)
 *   → session load → rate limit (user) → access/RBAC → CSRF (mutations) → passkey (admin)
 *   → step-up → Turnstile (where marked) → Zod parse (.strict) → handler (+ audit)
 *   → problem+json mapping
 */

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const DEFAULT_MAX_BODY = 16 * 1024;

type AnyZod = z.ZodType | undefined;
type Infer<S> = S extends z.ZodType ? z.output<S> : undefined;

export type RouteOptions<A extends AccessLevel, B extends AnyZod, Q extends AnyZod> = {
  /** Methods this handler serves (defence in depth on top of Next's per-export routing). */
  methods: readonly ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
  access: A;
  /** 'auto' (default): mutations need same-origin Fetch Metadata + exact Origin, plus the
   *  session-bound token whenever a session exists. 'none': provider callbacks / reports only. */
  csrf?: 'auto' | 'none';
  rateLimit?: RateLimitRule | readonly RateLimitRule[];
  /** Turnstile action name; the token is read from the x-turnstile-token header. */
  turnstile?: string;
  /** Require an interactive login ≤ 10 min old (sensitive admin actions). */
  stepUp?: boolean;
  /** Require a passkey assertion ≤ 10 min old (Session.mfaAt). Default: on for 'moderator' and
   *  'streamer' access (11 §9, O6); only the passkey endpoints themselves turn it off. */
  mfa?: boolean;
  /** Binary body (uploads): not read by the pipeline. Content-Length is mandatory and checked
   *  against `maxBytes` before anything else; the handler streams `req.body` itself, AFTER the
   *  session, role, CSRF and passkey checks. */
  rawBody?: { maxBytes: number; contentTypes: readonly string[] };
  body?: B;
  query?: Q;
  maxBodyBytes?: number;
  /** Accepted request media types for bodies (default application/json). */
  contentTypes?: readonly string[];
  /** Rate-limit failure mode while Redis is unreachable (default: closed for mutations). */
  rateLimitFailOpen?: boolean;
};

export type AuthedUser = User;

export type RouteContext<A extends AccessLevel, B extends AnyZod, Q extends AnyZod, P> = {
  req: NextRequest;
  requestId: string;
  ip: string | null;
  ipKey: string;
  session: A extends 'public' ? Session | null : Session;
  user: A extends 'public' ? AuthedUser | null : AuthedUser;
  body: Infer<B>;
  query: Infer<Q>;
  params: P;
  /** Audit with actor + requestId pre-filled; pass `tx` to write inside a transaction. */
  audit: <K extends AuditAction>(
    entry: Omit<AuditEntry<K>, 'actor' | 'requestId'>,
    tx?: Parameters<typeof audit>[1],
  ) => Promise<void>;
};

type Handler<A extends AccessLevel, B extends AnyZod, Q extends AnyZod, P> = (
  ctx: RouteContext<A, B, Q, P>,
) => Promise<Response | Record<string, unknown> | unknown[]>;

function zodErrors(error: z.ZodError): ProblemField[] {
  return error.issues
    .slice(0, 20)
    .map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
}

function mediaType(header: string | null): { type: string; charset: string | null } | null {
  if (!header) return null;
  const [type, ...params] = header.split(';').map((s) => s.trim().toLowerCase());
  const charset =
    params
      .find((p) => p.startsWith('charset='))
      ?.slice('charset='.length)
      .replace(/"/g, '') ?? null;
  return type ? { type, charset } : null;
}

async function readBody(req: NextRequest, max: number): Promise<string> {
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > max))
    throw Problems.tooLarge();
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw Problems.tooLarge();
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw Problems.invalidJson();
  }
}

/** Same-origin page the request came from (for the step-up return path), else /perfil. */
function refererPath(referer: string | null): string {
  if (!referer) return '/perfil';
  try {
    const url = new URL(referer);
    return url.origin === getEnv().APP_ORIGIN ? url.pathname : '/perfil';
  } catch {
    return '/perfil';
  }
}

async function enforceRateLimit(
  rules: readonly RateLimitRule[],
  dimension: 'perIp' | 'perUser',
  subject: string,
  failOpen: boolean,
): Promise<void> {
  for (const rule of rules) {
    const spec = rule[dimension];
    if (!spec) continue;
    let res;
    try {
      res = await hit(
        redis(),
        `rl:${rule.name}:${dimension === 'perIp' ? 'ip' : 'u'}:${subject}`,
        spec.limit,
        spec.windowMs,
      );
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : 'unknown', rule: rule.name },
        'rate limiter unavailable',
      );
      if (failOpen) continue;
      throw Problems.unavailable();
    }
    if (!res.allowed) throw Problems.rateLimited(res.retryAfterMs / 1000);
  }
}

export function route<
  A extends AccessLevel,
  B extends AnyZod = undefined,
  Q extends AnyZod = undefined,
  P = Record<string, never>,
>(options: RouteOptions<A, B, Q>, handler: Handler<A, B, Q, P>) {
  const rules =
    options.rateLimit === undefined
      ? []
      : Array.isArray(options.rateLimit)
        ? options.rateLimit
        : [options.rateLimit as RateLimitRule];
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const contentTypes = options.contentTypes ?? ['application/json'];

  return async function wrapped(
    req: NextRequest,
    routeCtx?: { params?: Promise<P> },
  ): Promise<Response> {
    const started = performance.now();
    const requestId = requestIdFrom(req.headers);
    const method = req.method.toUpperCase();
    const ip = clientIp(req.headers);
    const ipk = ipKey(ip);
    let userId: string | undefined;
    let response: Response;

    try {
      // 1. method allow-list
      if (!options.methods.includes(method as (typeof options.methods)[number])) {
        throw Problems.methodNotAllowed([...options.methods]);
      }
      const isMutation = MUTATIONS.has(method);

      // 2. body size / content type (before any expensive work)
      let rawBody = '';
      if (options.rawBody) {
        const declared = req.headers.get('content-length');
        if (declared === null || !/^\d{1,9}$/.test(declared)) {
          throw new HttpError(411, 'LENGTH_REQUIRED', 'Envie o tamanho do arquivo.');
        }
        if (Number(declared) > options.rawBody.maxBytes) throw Problems.tooLarge();
        const mt = mediaType(req.headers.get('content-type'));
        if (!mt || !options.rawBody.contentTypes.includes(mt.type)) {
          throw Problems.unsupportedMediaType();
        }
      } else if (isMutation || options.body) {
        const hasBody =
          req.headers.get('content-length') !== '0' &&
          (req.body !== null || options.body !== undefined);
        if (hasBody) {
          rawBody = await readBody(req, maxBody);
          if (rawBody.length > 0) {
            const mt = mediaType(req.headers.get('content-type'));
            if (
              !mt ||
              !contentTypes.includes(mt.type) ||
              (mt.charset !== null && mt.charset !== 'utf-8')
            ) {
              throw Problems.unsupportedMediaType();
            }
          }
        }
      }

      // 3. rate limit per IP (cheap, before touching the DB)
      const failOpen = options.rateLimitFailOpen ?? !isMutation;
      await enforceRateLimit(rules, 'perIp', ipk, failOpen);

      // 4. session load
      let ctxSession: SessionContext | null = null;
      const token = req.cookies.get(COOKIE.session)?.value;
      if (token) ctxSession = await loadSession(token);
      userId = ctxSession?.user.id;

      // 5. rate limit per user
      if (ctxSession) await enforceRateLimit(rules, 'perUser', ctxSession.user.id, failOpen);

      // 6. access level (401 when anonymous; 404 when the role is insufficient — no existence leak)
      if (options.access !== 'public') {
        if (!ctxSession) throw Problems.unauthenticated();
        if (!meetsAccess(ctxSession.user.role, options.access)) throw Problems.notFound();
      }

      // 7. CSRF on mutations
      if (isMutation && (options.csrf ?? 'auto') === 'auto') {
        if (!isSameOriginRequest(req.headers)) throw Problems.forbiddenOrigin();
        if (ctxSession && !isValidCsrfToken(req.headers.get(CSRF_HEADER), ctxSession.session.id)) {
          throw Problems.forbiddenOrigin();
        }
      }

      // 7b. passkey (admin second factor)
      const mfa = options.mfa ?? (options.access === 'moderator' || options.access === 'streamer');
      if (mfa && ctxSession && !isMfaFresh(ctxSession.session)) {
        throw (await countPasskeys(ctxSession.user.id)) === 0
          ? Problems.passkeyEnrollRequired()
          : Problems.passkeyRequired();
      }

      // 8. step-up
      if (options.stepUp && ctxSession && !isStepUpFresh(ctxSession.session)) {
        throw Problems.stepUpRequired(stepUpUrl(refererPath(req.headers.get('referer'))));
      }

      // 9. Turnstile
      if (options.turnstile) {
        const result = await verifyTurnstile(
          req.headers.get(TURNSTILE_HEADER),
          options.turnstile,
          ip,
        );
        if (!result.ok) {
          logger.warn({ requestId, reason: result.reason, ipKey: ipk }, 'turnstile rejected');
          throw Problems.turnstileFailed();
        }
      }

      // 10. Zod parse — query and body (.strict() schemas reject unknown keys)
      let query: unknown = undefined;
      if (options.query) {
        const search = req.nextUrl.searchParams;
        const keys = [...search.keys()];
        if (new Set(keys).size !== keys.length) {
          throw Problems.validation([{ path: '(query)', message: 'Parâmetro repetido.' }]);
        }
        const parsed = options.query.safeParse(Object.fromEntries(search.entries()));
        if (!parsed.success) throw Problems.validation(zodErrors(parsed.error));
        query = parsed.data;
      }
      let body: unknown = undefined;
      if (options.body) {
        let json: unknown;
        try {
          json = rawBody.length ? JSON.parse(rawBody) : undefined;
        } catch {
          throw Problems.invalidJson();
        }
        const parsed = options.body.safeParse(json);
        if (!parsed.success) throw Problems.validation(zodErrors(parsed.error));
        body = parsed.data;
      } else if (!options.rawBody && rawBody.trim().length > 0) {
        // A handler that declares no body must not silently accept one.
        throw Problems.validation([{ path: '(body)', message: 'Esta rota não aceita corpo.' }]);
      }

      const params = ((await routeCtx?.params) ?? {}) as P;
      const actor = ctxSession ? { id: ctxSession.user.id, role: ctxSession.user.role } : null;
      const result = await handler({
        req,
        requestId,
        ip,
        ipKey: ipk,
        session: (ctxSession?.session ?? null) as RouteContext<A, B, Q, P>['session'],
        user: (ctxSession?.user ?? null) as RouteContext<A, B, Q, P>['user'],
        body: body as Infer<B>,
        query: query as Infer<Q>,
        params,
        audit: (entry, tx) =>
          audit({ ...entry, actor, requestId } as AuditEntry<typeof entry.action>, tx),
      });
      response = result instanceof Response ? result : Response.json(result);
    } catch (error) {
      if (error instanceof HttpError) {
        response = problemResponse(error, requestId);
      } else {
        logger.error(
          {
            requestId,
            err:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : 'unknown',
          },
          'unhandled error',
        );
        response = problemResponse(Problems.internal(), requestId);
      }
    }

    if (!response.headers.has('cache-control'))
      response.headers.set('cache-control', 'private, no-store');
    response.headers.set('x-request-id', requestId);
    logger.info(
      {
        requestId,
        method,
        path: req.nextUrl.pathname,
        status: response.status,
        ms: Math.round(performance.now() - started),
        userId,
        ipKey: ipk,
      },
      'request',
    );
    return response;
  };
}
