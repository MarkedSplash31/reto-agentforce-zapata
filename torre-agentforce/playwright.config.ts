import { defineConfig, devices } from '@playwright/test';
import { LOCAL_BASE_URL, LOCAL_CREDENTIALS } from './tests/support/auth.ts';

const externalBaseUrl = process.env.BASE_URL?.trim().replace(/\/+$/, '');
const baseURL = externalBaseUrl || LOCAL_BASE_URL;
// El limitador de autenticación sólo cuenta INTENTOS FALLIDOS, y la suite los provoca
// a propósito: `security.spec.ts` verifica 401/403 una y otra vez. Con la ventana de
// 60 s y un tope de 24, esas denegaciones legítimas agotaban el cupo y las pruebas
// posteriores heredaban un 429 —lo que hacía fallar una prueba distinta en cada
// corrida sin que hubiera defecto alguno—. El tope de QA se separa así del de
// producción (20), que no se toca. `z-rate-limit.spec.ts` lee esta misma variable y
// se adapta, de modo que el 429 se sigue probando de verdad.
const authRateLimitMax = Number(process.env.QA_AUTH_RATE_LIMIT_MAX ?? 200);

if (!Number.isSafeInteger(authRateLimitMax) || authRateLimitMax < 1) {
  throw new Error('QA_AUTH_RATE_LIMIT_MAX debe ser un entero positivo.');
}

// El umbral se publica al entorno del runner: `z-rate-limit.spec.ts` lo lee para saber
// cuántos intentos hacen falta antes del 429. Si el test conserva su propio valor por
// defecto y aquí se cambia el del servidor, los dos se desincronizan y la prueba falla
// sin que exista defecto — que es exactamente lo que pasó al subir este tope.
process.env.QA_AUTH_RATE_LIMIT_MAX = String(authRateLimitMax);

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './output/playwright/test-results',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright/report', open: 'never' }],
    ['json', { outputFile: 'output/playwright/results.json' }],
    ['junit', { outputFile: 'output/playwright/results.xml' }],
  ],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    // Los contextos llevan Bearer reales contra BASE_URL. Las trazas conservan
    // headers de red y por eso se desactivan; HTML/JUnit/JSON y capturas quedan.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'api-and-ui',
      testIgnore: /z-rate-limit\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'security-rate-limit',
      testMatch: /z-rate-limit\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run start:server',
        url: `${LOCAL_BASE_URL}/salud`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          ...process.env,
          PORT: new URL(LOCAL_BASE_URL).port,
          APP_ENV: 'test',
          APP_AUTH_PROVIDER: 'static',
          APP_AUTH_MODE: 'required',
          APP_AUTH_CREDENTIALS_JSON: JSON.stringify(Object.values(LOCAL_CREDENTIALS)),
          APP_RATE_LIMIT_WINDOW_MS: '60000',
          APP_RATE_LIMIT_MAX: '1000',
          APP_AUTH_RATE_LIMIT_MAX: String(authRateLimitMax),
          APP_BODY_LIMIT_BYTES: '32768',
        },
      },
});
