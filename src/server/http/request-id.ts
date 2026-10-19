import 'server-only';

/** Correlation id: nginx's $request_id when present and well-formed, otherwise a new UUID. */
const FORMAT = /^[\da-f-]{16,64}$/i;

export function requestIdFrom(headers: Headers): string {
  const upstream = headers.get('x-request-id');
  return upstream && FORMAT.test(upstream) ? upstream.toLowerCase() : crypto.randomUUID();
}
