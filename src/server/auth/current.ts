import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { COOKIE } from './cookies';
import { loadSession, type SessionContext } from './session';

/** Session for Server Components (deduplicated per request). Route handlers use route() instead. */
export const getCurrentSession = cache(async (): Promise<SessionContext | null> => {
  const token = (await cookies()).get(COOKIE.session)?.value;
  return token ? loadSession(token) : null;
});
