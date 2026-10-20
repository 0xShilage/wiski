import { EnvError, getEnv, isLocalOrigin } from './server/env';
import { provisionalLegalTypes } from './server/legal/legal';

try {
  const env = getEnv();
  // 13 §3 step 5: no real payments under provisional legal texts. The production build in the
  // local test stack (https://localhost) is exempt.
  const provisional = provisionalLegalTypes();
  if (env.NODE_ENV === 'production' && !isLocalOrigin(env) && provisional.length) {
    console.error(
      `[wiskiflix] refusing to start: provisional legal texts (${provisional.join(', ')}) — publish the final versions in src/content/legal.`,
    );
    process.exit(1);
  }
} catch (error) {
  if (error instanceof EnvError) {
    console.error(`[wiskiflix] refusing to start.\n${error.message}`);
    process.exit(1);
  }
  throw error;
}
