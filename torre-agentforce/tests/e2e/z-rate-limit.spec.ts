import { expect, test } from '@playwright/test';
import { expectDenied } from '../support/http.ts';

test('el límite de intentos de autenticación devuelve 429 y Retry-After', async ({ request }) => {
  const configuredMax = Number(process.env.QA_AUTH_RATE_LIMIT_MAX ?? 24);
  const maximumAttempts = Math.min(Math.max(configuredMax + 8, 32), 256);
  let limitedResponse: Awaited<ReturnType<typeof request.get>> | null = null;

  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const response = await request.get('/api/unidades', {
      headers: {
        Authorization: `Bearer qa-invalid-rate-limit-${String(attempt).padStart(4, '0')}-xxxxxxxxxxxxxxxx`,
      },
    });
    if (response.status() === 429) {
      limitedResponse = response;
      break;
    }
    expect(response.status(), `intento ${attempt + 1} previo al límite`).toBe(401);
  }

  expect(
    limitedResponse,
    `No apareció 429 después de ${maximumAttempts} intentos; ` +
      'si BASE_URL usa otro umbral, define QA_AUTH_RATE_LIMIT_MAX.',
  ).not.toBeNull();
  await expectDenied(limitedResponse!, 429, 'rate limit de autenticación');
  expect(Number(limitedResponse!.headers()['retry-after'])).toBeGreaterThanOrEqual(1);
});

