import 'server-only';

/**
 * RFC 9457 problem details (03 §1): `application/problem+json`, stable `code`, pt-BR `detail`,
 * never echoes input, never includes stack traces or internal ids.
 */
export type ProblemField = { path: string; message: string };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly extra: {
      errors?: ProblemField[];
      headers?: Record<string, string>;
      /** extra RFC 9457 extension members (non-sensitive, e.g. a step-up URL) */
      members?: Record<string, string>;
    } = {},
  ) {
    super(`${status} ${code}`);
    this.name = 'HttpError';
  }
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  411: 'Length Required',
  413: 'Content Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

export function problemResponse(error: HttpError, requestId?: string): Response {
  const body: Record<string, unknown> = {
    type: `urn:wiskiflix:problem:${error.code.toLowerCase().replace(/_/g, '-')}`,
    title: TITLES[error.status] ?? 'Error',
    status: error.status,
    code: error.code,
    detail: error.detail,
  };
  if (error.extra.errors?.length) body.errors = error.extra.errors;
  if (error.extra.members) Object.assign(body, error.extra.members);
  const headers = new Headers({
    'content-type': 'application/problem+json; charset=utf-8',
    'cache-control': 'private, no-store',
    ...error.extra.headers,
  });
  if (requestId) headers.set('x-request-id', requestId);
  return new Response(JSON.stringify(body), { status: error.status, headers });
}

// Common errors (pt-BR copy in one place).
export const Problems = {
  unauthenticated: () => new HttpError(401, 'UNAUTHENTICATED', 'Faça login para continuar.'),
  notFound: () => new HttpError(404, 'NOT_FOUND', 'Não encontrado.'),
  forbiddenOrigin: () =>
    new HttpError(
      403,
      'CSRF_REJECTED',
      'Requisição bloqueada por segurança. Recarregue a página e tente de novo.',
    ),
  methodNotAllowed: (allow: string[]) =>
    new HttpError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', {
      headers: { allow: allow.join(', ') },
    }),
  tooLarge: () => new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Conteúdo grande demais.'),
  unsupportedMediaType: () =>
    new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Formato não suportado. Envie JSON.'),
  invalidJson: () => new HttpError(400, 'INVALID_JSON', 'JSON inválido.'),
  validation: (errors: ProblemField[]) =>
    new HttpError(422, 'VALIDATION_FAILED', 'Alguns campos estão inválidos.', { errors }),
  rateLimited: (retryAfterSec: number) =>
    new HttpError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde um pouco e tente de novo.', {
      headers: { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSec))) },
    }),
  stepUpRequired: (stepUpUrl: string) =>
    new HttpError(
      401,
      'STEP_UP_REQUIRED',
      'Confirme sua identidade entrando com o Google novamente.',
      {
        members: { stepUpUrl },
      },
    ),
  /** Admin second factor (11 §9): no passkey yet → enrol at /perfil/seguranca. */
  passkeyEnrollRequired: () =>
    new HttpError(401, 'PASSKEY_ENROLL_REQUIRED', 'Cadastre uma passkey para usar o painel.', {
      members: { enrollUrl: '/perfil/seguranca' },
    }),
  /** Admin second factor: passkey assertion missing or older than 10 minutes. */
  passkeyRequired: () =>
    new HttpError(401, 'PASSKEY_REQUIRED', 'Confirme com sua passkey para continuar.', {
      members: { verifyUrl: '/api/v1/me/passkeys/authentication/options' },
    }),
  conflict: (code: string, detail: string) => new HttpError(409, code, detail),
  turnstileFailed: () =>
    new HttpError(
      403,
      'TURNSTILE_FAILED',
      'Não foi possível confirmar que você é humano. Tente de novo.',
    ),
  unavailable: () =>
    new HttpError(
      503,
      'SERVICE_UNAVAILABLE',
      'Serviço temporariamente indisponível. Tente de novo em instantes.',
    ),
  internal: () => new HttpError(500, 'INTERNAL', 'Erro inesperado. Tente de novo em instantes.'),
} as const;
