/** Ports of the browser-test stack (tests/e2e/support/stack.ts); importing this starts nothing. */
export const HTTPS_PORT = Number(process.env.E2E_HTTPS_PORT ?? 8443);
export const HTTP_PORT = Number(process.env.E2E_HTTP_PORT ?? 8081);
