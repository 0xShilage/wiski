'use client';
import { useEffect } from 'react';
import { NEON_COOKIE, NEON_MAX_AGE } from '@/lib/neon';

/**
 * Rendered only on a browser's first visit (no neon cookie): the logo already carries
 * `wf-logo--ignite` from the server, so the flicker starts with the first paint; this just
 * remembers it, so later visits get the logo already lit.
 */
export function NeonIgnite() {
  useEffect(() => {
    document.cookie = `${NEON_COOKIE}=1; Path=/; Max-Age=${NEON_MAX_AGE}; Secure; SameSite=Lax`;
  }, []);
  return null;
}
