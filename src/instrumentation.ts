/**
 * Runs once when a Next.js server instance starts. The Node-only part validates the environment
 * so a misconfigured deployment fails fast at boot (10 §2 step 2, 05 §12).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
