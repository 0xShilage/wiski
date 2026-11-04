import { z } from 'zod';
import type { SubathonRates } from './subathon-time';

/**
 * Subathon timer (2026-11-03, docs/phase-6/README.md §10) — shared by the server, the dashboard
 * and the OBS widget. Every contribution is valued in R$ and converted with one rule:
 * `secondsPerReal` seconds per R$ 1 (60 by default: R$ 1 = 1 minute). Stream events (bits, subs,
 * gift subs, Prime) get an R$ value set by the streamer. The zod-free helpers are in
 * `./subathon-time` (re-exported here) so the OBS widget never loads zod.
 */
export * from './subathon-time';

const cents = z.int().min(0).max(1_000_000); // up to R$ 10.000,00 per event

export const subathonCountSchema = z
  .object({
    /** site payments: movie sponsorships, contributions, "Já pago" */
    site: z.boolean(),
    /** StreamElements tips */
    tips: z.boolean(),
    bits: z.boolean(),
    /** new subscriptions */
    subs: z.boolean(),
    /** renewals shared in chat */
    resubs: z.boolean(),
    prime: z.boolean(),
    gifts: z.boolean(),
  })
  .strict();

export const subathonRatesSchema = z
  .object({
    /** value of 100 bits */
    bits100Cents: cents,
    tier1Cents: cents,
    tier2Cents: cents,
    tier3Cents: cents,
    primeCents: cents,
    /** tips in another currency (2026-11-03): what US$ 1 and € 1 are worth here, in R$ cents */
    usdCents: z.int().min(0).max(10_000),
    eurCents: z.int().min(0).max(10_000),
    count: subathonCountSchema,
  })
  .strict();

// the schema and the hand-written type must stay the same shape
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _shapeCheck: Same<z.infer<typeof subathonRatesSchema>, SubathonRates> = true;
void _shapeCheck;
