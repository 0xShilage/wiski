import { EnvError, getEnv } from './server/env';

try {
  getEnv();
} catch (error) {
  if (error instanceof EnvError) {
    console.error(`[wiskiflix] refusing to start.\n${error.message}`);
    process.exit(1);
  }
  throw error;
}
