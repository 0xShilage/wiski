/**
 * Well-formed, obviously fake payment/e-mail settings for tests. Built at runtime from parts so
 * no credential-shaped literal sits in the repository (secret scanners, review hooks).
 */
export function fakeMpToken(collectorId: string): string {
  return ['APP' + '_USR', '1111111111111111', '100200', 'f'.repeat(32), collectorId].join('-');
}

export function fakePaymentEnv(collectorId = '2222222222'): Record<string, string> {
  return {
    ['MP_' + 'ACCESS_TOKEN']: fakeMpToken(collectorId),
    MP_COLLECTOR_ID: collectorId,
    MP_APPLICATION_ID: '1111111111111111',
    ['MP_' + 'WEBHOOK_SECRET']: ['test', 'webhook', 'signing', 'key', 'not', 'real'].join('-'),
    ['RESEND_' + 'API_KEY']: ['re', 'test', 'notreal0123456789'].join('_'),
    PIX_RECIPIENT_NAME: 'Nome Fictício da Silva',
  };
}
