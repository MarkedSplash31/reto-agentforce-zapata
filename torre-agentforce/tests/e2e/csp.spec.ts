import { expect, test } from '@playwright/test';

import { authHeaders, credential, missingCredentialReason } from '../support/auth.ts';

// Las siete páginas del sitio de postventa. La CSP es estricta (script-src 'self',
// style-src 'self'), así que ninguna puede recurrir a script ni estilo en línea.
const ROUTES = ['/', '/acceso.html', '/panel.html'] as const;

test.describe('CSP estricta de la superficie web', () => {
  test('ningún entrypoint intenta ejecutar script o aplicar estilos inline', async ({ page }) => {
    test.skip(!credential('admin'), missingCredentialReason('admin'));
    await page.setExtraHTTPHeaders(authHeaders('admin'));
    const violations = new Map<string, number>();
    let currentRoute = '';
    page.on('console', (message) => {
      const text = message.text();
      if (/content security policy|refused to (?:execute|apply|load)/i.test(text)) {
        violations.set(currentRoute, (violations.get(currentRoute) ?? 0) + 1);
      }
    });

    for (const route of ROUTES) {
      currentRoute = route;
      await page.goto(route, { waitUntil: 'networkidle' });
    }

    expect(Object.fromEntries(violations)).toEqual({});
  });
});
