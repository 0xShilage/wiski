import { z } from 'zod';
import { route } from '@/server/http/route';
import { logger } from '@/server/log';
import { RL } from '@/server/ratelimit/rules';

/**
 * CSP violation reports (05 §7): Reporting API (`application/reports+json`) and the legacy
 * `report-uri` format (`application/csp-report`). 8 KB max, rate-limited, sampled logging.
 * Only a few non-sensitive fields are logged; document URLs lose their query string.
 */
const stripQuery = (u: unknown) =>
  typeof u === 'string' ? u.split(/[?#]/)[0]!.slice(0, 300) : undefined;
const short = (v: unknown) => (typeof v === 'string' ? v.slice(0, 120) : undefined);

type Normalised = {
  directive?: string | undefined;
  blocked?: string | undefined;
  document?: string | undefined;
  disposition?: string | undefined;
  sample?: string | undefined;
};

function normalise(json: unknown): Normalised[] {
  const items: unknown[] = Array.isArray(json) ? json.slice(0, 20) : [json];
  return items.flatMap((item) => {
    const r = z.record(z.string(), z.unknown()).safeParse(item);
    if (!r.success) return [];
    const legacy = z.record(z.string(), z.unknown()).safeParse(r.data['csp-report']);
    const body = legacy.success
      ? legacy.data
      : z.record(z.string(), z.unknown()).safeParse(r.data.body).data;
    if (!body) return [];
    return [
      {
        directive: short(
          body.effectiveDirective ?? body['effective-directive'] ?? body['violated-directive'],
        ),
        blocked: stripQuery(body.blockedURL ?? body['blocked-uri']),
        document: stripQuery(body.documentURL ?? body['document-uri']),
        disposition: short(body.disposition),
        sample: short(body.sample ?? body['script-sample']),
      },
    ];
  });
}

let windowStart = 0;
let logged = 0;
const MAX_LOGGED_PER_MINUTE = 30;

export const POST = route(
  {
    methods: ['POST'],
    access: 'public',
    csrf: 'none', // browsers send these cross-context without our headers
    rateLimit: RL.cspReport,
    rateLimitFailOpen: true,
    maxBodyBytes: 8 * 1024,
    contentTypes: ['application/reports+json', 'application/csp-report', 'application/json'],
    // Untrusted, loosely-shaped browser reports: parsed defensively by normalise().
    body: z.unknown(),
  },
  async ({ body: json, requestId }) => {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      logged = 0;
    }
    for (const report of normalise(json)) {
      if (logged++ < MAX_LOGGED_PER_MINUTE)
        logger.warn({ requestId, csp: report }, 'csp violation');
    }
    return new Response(null, { status: 204 });
  },
);
