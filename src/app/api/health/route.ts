import { route } from '@/server/http/route';

/** Liveness only — no dependency details (03 §5.5). */
export const GET = route({ methods: ['GET'], access: 'public' }, async () => ({ status: 'ok' }));
