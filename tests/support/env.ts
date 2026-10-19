/** Deterministic, obviously-fake secrets for tests (never used anywhere else). */
export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: 'postgresql://wf_app:app@127.0.0.1:5432/wiskiflix_test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    CSRF_SECRET: 'test-csrf-secret-test-csrf-secret-test-csrf-secr',
    COOKIE_SEAL_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    IP_HASH_SECRET: 'test-ip-hash-secret-test-ip-hash-secret-test-ip',
    CLIENT_IP_HEADER: 'x-real-ip',
    LOG_LEVEL: 'silent',
    ...overrides,
  };
}
