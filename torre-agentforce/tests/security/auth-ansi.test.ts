import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.APP_ENV = 'development';
process.env.APP_AUTH_MODE = 'disabled';

test('parsea stdout JSON del sf CLI aunque venga envuelto en ANSI', async () => {
  const { _parsearSalidaCliParaPruebas } = await import('../../src/servidor/auth.ts');
  const stdout =
    '\u001B]0;Salesforce CLI\u0007\u001B[32m' +
    '{"status":0,"result":{"accessToken":"token-de-prueba"}}' +
    '\u001B[0m\r\n';

  assert.deepEqual(_parsearSalidaCliParaPruebas(stdout), {
    status: 0,
    result: { accessToken: 'token-de-prueba' },
  });
});
