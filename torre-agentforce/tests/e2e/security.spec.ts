import { expect, test } from '@playwright/test';
import {
  authHeaders,
  credential,
  missingCredentialReason,
  type QaRole,
} from '../support/auth.ts';
import { expectDenied, expectJson, expectNoCredentialLeak } from '../support/http.ts';

const REQUIRED_ROLES: QaRole[] = ['clientA', 'clientB', 'advisor', 'admin'];

test.describe('frontera HTTP y RBAC', () => {
  test('gate: existen credenciales de todos los roles de QA', async () => {
    const missing = REQUIRED_ROLES.filter((role) => !credential(role));
    expect(
      missing,
      `BLOQUEO HUMANO: faltan credenciales para ${missing.join(', ')}. ` +
        'Define QA_CLIENT_A_TOKEN, QA_CLIENT_B_TOKEN, QA_ADVISOR_TOKEN y QA_ADMIN_TOKEN.',
    ).toEqual([]);
  });

  test('/salud es público, mínimo y no expone configuración', async ({ request }) => {
    const response = await request.get('/salud');
    const body = await expectJson(response, 200, 'salud pública');
    const raw = JSON.stringify(body);

    expect(body.status).toBe('ok');
    expect(body).not.toHaveProperty('config');
    expect(body).not.toHaveProperty('dependencias');
    expect(raw).not.toMatch(/SF_(?:CLIENT|LOGIN|AGENT|COLA)|clientSecret|access_token/i);
    expectNoCredentialLeak(raw);
  });

  test('una API sin Authorization responde 401 genérico', async ({ request }) => {
    const response = await request.get('/api/unidades');
    const body = await expectDenied(response, 401, 'API sin credencial');

    expect(JSON.stringify(body)).not.toMatch(/salesforce|soql|stack|src[\\/]+servidor/i);
  });

  test('un bearer inválido responde 401 y nunca se refleja', async ({ request }) => {
    const invalid = 'qa-invalid-bearer-that-must-never-be-reflected-20260805';
    const response = await request.get('/api/unidades', {
      headers: { Authorization: `Bearer ${invalid}` },
    });
    const body = await expectDenied(response, 401, 'bearer inválido');
    expectNoCredentialLeak(JSON.stringify(body), [invalid]);
  });

  test('un token en query no autentica el stream SSE', async ({ request }) => {
    const queryCanary = 'qa-query-auth-is-forbidden-xxxxxxxxxxxxxxxx';
    const response = await request.get(
      `/api/escalamiento/500000000000000AAA/stream?access_token=${encodeURIComponent(queryCanary)}`,
    );
    const body = await expectDenied(response, 401, 'token en query');
    expectNoCredentialLeak(JSON.stringify(body), [queryCanary]);
  });

  test('cliente no puede abrir la bandeja del asesor', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    const response = await request.get('/api/escalamiento/bandeja', {
      headers: authHeaders('clientA'),
    });
    await expectDenied(response, 403, 'RBAC cliente → bandeja');
  });

  test('cliente no entra al Agent API headless sin propagación verificable de identidad', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    const state = await request.get('/api/agente/estado', { headers: authHeaders('clientA') });
    await expectDenied(state, 403, 'cliente → estado Agent API');
    const session = await request.post('/api/agente/sesion', {
      headers: authHeaders('clientA'),
      data: {},
    });
    await expectDenied(session, 403, 'cliente → sesión Agent API');
  });

  test('cliente no puede sondear por IDOR un caso que no le pertenece', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    // ID canónico pero deliberadamente no reclamado por clientA. La autorización
    // debe cortar antes de consultar Salesforce y no revelar si el Case existe.
    const response = await request.get('/api/escalamiento/500000000000000AAA', {
      headers: authHeaders('clientA'),
    });
    await expectDenied(response, 403, 'IDOR de Case');
  });

  test('bindings CRM filtran unidades y órdenes y cobertura ajena responde 403', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    test.skip(!credential('clientB'), missingCredentialReason('clientB'));
    const assetId = credential('clientA')?.bindings?.assetIds?.[0];
    expect(assetId, 'clientA debe tener un Asset binding explícito').toBeTruthy();

    const ownUnitsResponse = await request.get('/api/unidades', { headers: authHeaders('clientA') });
    const ownUnits = await expectJson(ownUnitsResponse, 200, 'unidades propias');
    expect(Array.isArray(ownUnits.unidades)).toBe(true);
    expect(ownUnits.unidades as Array<Record<string, unknown>>).toEqual(
      expect.arrayContaining([expect.objectContaining({ Id: assetId })]),
    );
    expect((ownUnits.unidades as Array<Record<string, unknown>>).every((unit) => unit.Id === assetId)).toBe(true);

    const isolatedResponse = await request.get('/api/unidades', { headers: authHeaders('clientB') });
    const isolated = await expectJson(isolatedResponse, 200, 'unidades del segundo cliente');
    const secondAssetId = credential('clientB')?.bindings?.assetIds?.[0];
    expect((isolated.unidades as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
    expect(
      (isolated.unidades as Array<Record<string, unknown>>).every((unit) => unit.Id === secondAssetId),
    ).toBe(true);
    expect((isolated.unidades as Array<Record<string, unknown>>).some((unit) => unit.Id === assetId)).toBe(false);

    const ownOrdersResponse = await request.get('/api/ordenes', { headers: authHeaders('clientA') });
    const ownOrders = await expectJson(ownOrdersResponse, 200, 'órdenes propias');
    expect(
      (ownOrders.ordenes as Array<Record<string, unknown>>).every((order) => order.AssetId === assetId),
    ).toBe(true);

    const foreignCoverage = await request.get(`/api/cobertura/${assetId}`, {
      headers: authHeaders('clientB'),
    });
    await expectDenied(foreignCoverage, 403, 'cobertura de Asset ajeno');
  });

  test('correlationId y sessionKey del navegador se rechazan antes de Salesforce', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    const response = await request.post('/api/agenda/reservar', {
      headers: authHeaders('clientA'),
      data: { correlationId: 'cliente-controla-contexto', sessionKey: 'suplantada' },
    });
    const body = await expectDenied(response, 400, 'contexto suplantado');
    expect(body.codigo).toBe('UNTRUSTED_CONTEXT_FIELD');
  });

  test('sólo admin accede al diagnóstico detallado', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    test.skip(!credential('admin'), missingCredentialReason('admin'));

    const forbidden = await request.get('/api/admin/salud', { headers: authHeaders('clientA') });
    await expectDenied(forbidden, 403, 'cliente → salud admin');

    const allowed = await request.get('/api/admin/salud', { headers: authHeaders('admin') });
    const body = await expectJson(allowed, 200, 'salud admin');
    expectNoCredentialLeak(JSON.stringify(body));
  });

  test('ruta desconocida exige auth antes de revelar el 404', async ({ request }) => {
    const withoutAuth = await request.get('/api/recurso-que-no-existe');
    await expectDenied(withoutAuth, 401, '404 sin auth');

    test.skip(!credential('admin'), missingCredentialReason('admin'));
    const withAuth = await request.get('/api/recurso-que-no-existe', {
      headers: authHeaders('admin'),
    });
    const body = await expectJson(withAuth, 404, '404 autenticado');
    expect(body.error).toBe(true);
  });

  test('rechaza Content-Type no JSON antes de ejecutar un Flow', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    const response = await request.post('/api/agenda/reservar', {
      headers: { ...authHeaders('clientA'), 'Content-Type': 'text/plain' },
      data: '{"vin":"no debe ejecutarse"}',
    });
    await expectDenied(response, 415, 'Content-Type de escritura');
  });

  test('rechaza cuerpos mayores al límite antes de ejecutar un Flow', async ({ request }) => {
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));
    const response = await request.post('/api/agenda/reservar', {
      headers: { ...authHeaders('clientA'), 'Content-Type': 'application/json' },
      data: JSON.stringify({ relleno: 'x'.repeat(40_000) }),
    });
    await expectDenied(response, 413, 'límite de cuerpo');
  });

  test('un Origin no permitido nunca obtiene CORS permisivo', async ({ request }) => {
    const response = await request.get('/salud', {
      headers: { Origin: 'https://attacker.invalid' },
    });
    await expectDenied(response, 403, 'Origin no permitido');
    expect(response.headers()['access-control-allow-origin']).toBeUndefined();
  });
});
