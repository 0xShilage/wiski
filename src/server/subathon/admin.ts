import 'server-only';
import { remainingAt, type SubathonRates } from '@/lib/subathon';
import { db } from '../db';
import { commandKeyStatus } from './command';
import { readSeStatus, type SeStatus } from './streamelements';
import { ratesOf } from './timer';

/** What Admin › Subathon shows: the open subathon (or the last one), its ledger, StreamElements. */
export type SubathonAdminView = {
  serverNow: string;
  subathon: {
    id: string;
    title: string;
    status: 'READY' | 'RUNNING' | 'PAUSED' | 'ENDED';
    initialSeconds: number;
    remainingSeconds: number;
    endsAt: string | null;
    capSeconds: number | null;
    secondsPerReal: number;
    rates: SubathonRates;
    addedSeconds: number;
    startedAt: string | null;
    endedAt: string | null;
    version: number;
  } | null;
  entries: {
    id: string;
    kind: string;
    label: string | null;
    valueCents: number | null;
    seconds: number;
    appliedSeconds: number;
    at: string;
  }[];
  streamElements: SeStatus | null;
  /** the chat commands' key (2026-11-04): its first characters and date, never the key */
  commandKey: { prefix: string; createdAt: string } | null;
};

export async function subathonAdminView(now = new Date()): Promise<SubathonAdminView> {
  const s = await db().subathon.findFirst({ orderBy: { createdAt: 'desc' } });
  const [entries, se, commandKey] = await Promise.all([
    s
      ? db().subathonEntry.findMany({
          where: { subathonId: s.id },
          orderBy: { createdAt: 'desc' },
          take: 60,
        })
      : Promise.resolve([]),
    readSeStatus(),
    commandKeyStatus(),
  ]);
  return {
    serverNow: now.toISOString(),
    subathon: s
      ? {
          id: s.id,
          title: s.title,
          status: s.status,
          initialSeconds: s.initialSeconds,
          remainingSeconds: remainingAt(s, now.getTime()),
          endsAt: s.endsAt?.toISOString() ?? null,
          capSeconds: s.capSeconds,
          secondsPerReal: s.secondsPerReal,
          rates: ratesOf(s),
          addedSeconds: s.addedSeconds,
          startedAt: s.startedAt?.toISOString() ?? null,
          endedAt: s.endedAt?.toISOString() ?? null,
          version: s.version,
        }
      : null,
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label,
      valueCents: e.valueCents,
      seconds: e.seconds,
      appliedSeconds: e.appliedSeconds,
      at: e.createdAt.toISOString(),
    })),
    streamElements: se,
    commandKey,
  };
}
