import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AccessDeniedError,
  AuthenticationError,
  FixedWindowRateLimiter,
  ResourceAuthorizer,
  StaticTokenAuthProvider,
  clientNetworkKey,
  createOperationContext,
  loadSecurityConfig,
  isAllowedUpstreamUrl,
  redactSensitive,
  rejectClientSuppliedContext,
  requireRole,
  salesforceAccessPredicate,
  type Principal,
} from '../../src/servidor/security.ts';
import { ErrorSalesforce, HttpRequestError, comoRespuestaHttp } from '../../src/servidor/errores.ts';
import {
  applySecureHeaders,
  corsDecision,
  isPathInside,
  readJsonBody,
  renderExternalOrigin,
} from '../../src/servidor/http-security.ts';

const PUBLIC_ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'publico');

const sinBindings = { contactIds: [], accountIds: [], assetIds: [], workOrderIds: [] } as const;
const clienteBindings = {
  contactIds: ['003gK00000v84f8QAA'],
  accountIds: ['001gK00001GlwYJQAZ'],
  assetIds: ['02igK000002QPUfQAO'],
  workOrderIds: ['0WOgK0000039o8jWAA'],
} as const;
const cliente: Principal = {
  id: 'cliente-uno',
  role: 'cliente',
  authProvider: 'static-token',
  bindings: clienteBindings,
};
const otroCliente: Principal = {
  id: 'cliente-dos',
  role: 'cliente',
  authProvider: 'static-token',
  bindings: { ...sinBindings, assetIds: ['02igK000002QPUgQAO'] },
};
const asesor: Principal = {
  id: 'asesor-uno',
  role: 'asesor',
  authProvider: 'static-token',
  bindings: sinBindings,
};
const admin: Principal = {
  id: 'admin-uno',
  role: 'admin',
  authProvider: 'static-token',
  bindings: sinBindings,
};

describe('configuracion de seguridad', () => {
  it('selecciona proveedor explicito sin fallback entre OIDC y Bearer', () => {
    assert.throws(
      () => loadSecurityConfig({ APP_ENV: 'production', APP_AUTH_MODE: 'required' }),
      /APP_AUTH_PROVIDER explicito/,
    );
    const oidc = loadSecurityConfig({
      APP_AUTH_PROVIDER: 'oidc',
      APP_ENV: 'production',
      APP_AUTH_MODE: 'required',
    });
    assert.equal(oidc.authProvider, 'oidc');
    assert.equal(oidc.authMode, 'required');
    assert.deepEqual(oidc.credentials, []);

    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_PROVIDER: 'oidc',
        APP_ENV: 'production',
        APP_AUTH_MODE: 'required',
        APP_AUTH_CREDENTIALS_JSON: JSON.stringify([{ token: 'x'.repeat(40) }]),
      }),
      /no se admite.*oidc/i,
    );
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_PROVIDER: 'static',
        APP_ENV: 'production',
        APP_AUTH_MODE: 'required',
        APP_AUTH_CREDENTIALS_JSON: JSON.stringify([{ id: 'admin', role: 'admin', token: 'x'.repeat(40) }]),
      }),
      /APP_STATIC_QA_ENABLED/,
    );
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_PROVIDER: 'disabled',
        APP_ENV: 'production',
        APP_AUTH_MODE: 'disabled',
      }),
      /produccion/,
    );
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_PROVIDER: 'oidc',
        APP_ENV: 'development',
        APP_AUTH_MODE: 'disabled',
      }),
      /contradice/,
    );
  });

  it('falla cerrada cuando no hay credenciales y auth es requerida', () => {
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_PROVIDER: 'static',
        APP_STATIC_QA_ENABLED: 'true',
        APP_AUTH_MODE: 'required',
        APP_ENV: 'production',
      }),
      /APP_AUTH_CREDENTIALS_JSON/,
    );
  });

  it('prohibe desactivar autenticacion en produccion', () => {
    assert.throws(
      () => loadSecurityConfig({ APP_AUTH_MODE: 'disabled', NODE_ENV: 'production' }),
      /no puede desactivarse/i,
    );
  });

  it('permite desarrollo sin auth solo de forma explicita', () => {
    const cfg = loadSecurityConfig({ APP_AUTH_MODE: 'disabled', APP_ENV: 'development' });
    assert.equal(cfg.authMode, 'disabled');
    assert.deepEqual(cfg.credentials, []);
    assert.equal(cfg.salesforceCliTimeoutMs, 30_000, 'tolera cold start normal del sf CLI');
    assert.equal(
      loadSecurityConfig({
        APP_AUTH_MODE: 'disabled',
        APP_ENV: 'development',
        SF_CLI_TIMEOUT_MS: '45000',
      }).salesforceCliTimeoutMs,
      45_000,
    );
  });

  it('rechaza un timeout CLI fuera de limites', () => {
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_MODE: 'disabled',
        APP_ENV: 'development',
        SF_CLI_TIMEOUT_MS: '1000',
      }),
      /SF_CLI_TIMEOUT_MS/,
    );
  });

  it('rechaza tokens cortos y origins inseguros de produccion', () => {
    const creds = JSON.stringify([{ id: 'admin', role: 'admin', token: 'corto' }]);
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_PROVIDER: 'static',
        APP_STATIC_QA_ENABLED: 'true',
        APP_AUTH_MODE: 'required',
        APP_ENV: 'production',
        APP_AUTH_CREDENTIALS_JSON: creds,
      }),
      /32 bytes/,
    );

    const valid = JSON.stringify([{ id: 'admin', role: 'admin', token: 'x'.repeat(32) }]);
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_MODE: 'required',
        APP_AUTH_PROVIDER: 'static',
        APP_STATIC_QA_ENABLED: 'true',
        APP_ENV: 'production',
        APP_AUTH_CREDENTIALS_JSON: valid,
        APP_CORS_ORIGINS: 'http://example.com',
      }),
      /HTTPS/,
    );
  });

  it('exige bindings CRM explícitos para clientes y valida el tipo de cada Id', () => {
    const token = 'x'.repeat(32);
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_MODE: 'required',
        APP_AUTH_PROVIDER: 'static',
        APP_STATIC_QA_ENABLED: 'true',
        APP_ENV: 'production',
        APP_AUTH_CREDENTIALS_JSON: JSON.stringify([{ id: 'cliente', role: 'cliente', token }]),
      }),
      /bindings/i,
    );
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_MODE: 'required',
        APP_AUTH_PROVIDER: 'static',
        APP_STATIC_QA_ENABLED: 'true',
        APP_ENV: 'production',
        APP_AUTH_CREDENTIALS_JSON: JSON.stringify([{
          id: 'cliente',
          role: 'cliente',
          token,
          bindings: { assetIds: ['001000000000001AAA'] },
        }]),
      }),
      /Asset.*02i/i,
    );

    const config = loadSecurityConfig({
      APP_AUTH_MODE: 'required',
      APP_AUTH_PROVIDER: 'static',
      APP_STATIC_QA_ENABLED: 'true',
      APP_ENV: 'production',
      APP_AUTH_CREDENTIALS_JSON: JSON.stringify([{
        id: 'cliente',
        role: 'cliente',
        token,
        bindings: clienteBindings,
      }]),
    });
    assert.deepEqual(config.credentials[0]?.bindings, clienteBindings);
  });

  it('no confia en proxies por defecto y valida una allowlist explicita', () => {
    const base = loadSecurityConfig({ APP_AUTH_MODE: 'disabled', APP_ENV: 'development' });
    assert.equal(base.trustedProxies.size, 0);

    const configured = loadSecurityConfig({
      APP_AUTH_MODE: 'disabled',
      APP_ENV: 'development',
      APP_TRUST_PROXY: '127.0.0.1,::1',
    });
    assert.deepEqual([...configured.trustedProxies], ['127.0.0.1', '::1']);
    assert.throws(
      () => loadSecurityConfig({
        APP_AUTH_MODE: 'disabled',
        APP_ENV: 'development',
        APP_TRUST_PROXY: '*',
      }),
      /APP_TRUST_PROXY/,
    );
  });
});

describe('autenticacion y RBAC', () => {
  const token = 'a'.repeat(32);
  const provider = new StaticTokenAuthProvider([
    { id: 'cliente-uno', role: 'cliente', token, bindings: clienteBindings },
  ]);

  it('autentica Bearer valido con comparacion opaca', async () => {
    assert.deepEqual(await provider.authenticate(`Bearer ${token}`), cliente);
  });

  it('responde igual para credencial ausente o invalida', async () => {
    await assert.rejects(() => provider.authenticate(undefined), AuthenticationError);
    await assert.rejects(() => provider.authenticate('Bearer invalido'), AuthenticationError);
  });

  it('aplica RBAC sin confiar en un rol enviado por el cliente', () => {
    assert.throws(() => requireRole(cliente, ['asesor', 'admin']), AccessDeniedError);
    assert.doesNotThrow(() => requireRole(asesor, ['asesor', 'admin']));
    assert.doesNotThrow(() => requireRole(admin, ['admin']));
  });
});

describe('autorizacion por recurso', () => {
  it('construye predicados SOQL sólo desde bindings validados del principal', () => {
    assert.equal(
      salesforceAccessPredicate(cliente, 'asset'),
      "(Id IN ('02igK000002QPUfQAO') OR AccountId IN ('001gK00001GlwYJQAZ') OR ContactId IN ('003gK00000v84f8QAA'))",
    );
    assert.match(
      salesforceAccessPredicate(cliente, 'workOrder'),
      /Id IN \('0WOgK0000039o8jWAA'\).*AssetId IN \('02igK000002QPUfQAO'\).*AccountId IN \('001gK00001GlwYJQAZ'\).*ContactId IN \('003gK00000v84f8QAA'\)/,
    );
    assert.equal(salesforceAccessPredicate(admin, 'asset'), null);
    assert.equal(salesforceAccessPredicate(asesor, 'workOrder'), null);
    assert.throws(
      () => salesforceAccessPredicate({ ...cliente, bindings: sinBindings }, 'asset'),
      AccessDeniedError,
    );
  });

  it('genera contexto opaco ligado al principal y rechaza contexto suplantado', () => {
    const first = createOperationContext(cliente, 'reservar');
    const second = createOperationContext(cliente, 'reservar');
    assert.notEqual(first.correlationId, second.correlationId);
    assert.match(first.correlationId, /^rsv-[0-9a-f]{12}-[0-9a-f-]{36}$/);
    assert.ok(first.correlationId.length <= 64);
    assert.match(first.sessionKey, /^[0-9a-f]{12}-[0-9a-f-]{36}$/);
    assert.equal(first.correlationId.includes(cliente.id), false);
    const nonce = '123e4567-e89b-42d3-a456-426614174000';
    assert.deepEqual(
      createOperationContext(cliente, 'reservar', nonce),
      createOperationContext(cliente, 'reservar', nonce),
      'el mismo nonce del mismo principal conserva idempotencia',
    );
    assert.notDeepEqual(
      createOperationContext(cliente, 'reservar', nonce),
      createOperationContext(otroCliente, 'reservar', nonce),
      'un nonce conocido no permite suplantar otro principal',
    );
    assert.throws(() => createOperationContext(cliente, 'reservar', 'nonce-controlado'), /UUID/i);
    assert.doesNotThrow(() => rejectClientSuppliedContext({ vin: 'permitido' }));
    assert.throws(
      () => rejectClientSuppliedContext({ correlationId: 'suplantado' }),
      /contexto.*servidor/i,
    );
    assert.throws(
      () => rejectClientSuppliedContext({ varSessionKey: 'suplantado' }),
      /contexto.*servidor/i,
    );
  });

  it('evita IDOR de sesiones: solo dueno o admin', () => {
    const authz = new ResourceAuthorizer();
    authz.claim('session', 'sesion-1', cliente);

    assert.doesNotThrow(() => authz.requireAccess('session', 'sesion-1', cliente));
    assert.doesNotThrow(() => authz.requireAccess('session', 'sesion-1', admin));
    assert.throws(() => authz.requireAccess('session', 'sesion-1', otroCliente), AccessDeniedError);
    assert.throws(() => authz.requireAccess('session', 'sesion-1', asesor), AccessDeniedError);
    assert.throws(() => authz.requireAccess('session', 'desconocida', cliente), AccessDeniedError);
  });

  it('permite al asesor solo casos bound por Torre o propiedad de la cola', async () => {
    const authz = new ResourceAuthorizer();
    const boundCase = '500000000000001AAA';
    const queuedCase = '500000000000002AAA';
    const foreignCase = '500000000000003AAA';
    authz.claim('case', boundCase, cliente);
    let verificaciones = 0;

    await assert.doesNotReject(() => authz.requireCaseAccess(boundCase, asesor, async () => {
      verificaciones += 1;
      return false;
    }));
    assert.equal(verificaciones, 0, 'un binding local no consulta Salesforce');

    await assert.doesNotReject(() => authz.requireCaseAccess(queuedCase, asesor, async (caseId) => {
      verificaciones += 1;
      return caseId === queuedCase;
    }));
    assert.equal(verificaciones, 1);
    await assert.rejects(
      () => authz.requireCaseAccess(queuedCase, asesor, async () => false),
      AccessDeniedError,
      'un cambio de OwnerId se respeta; verificar cola no crea un binding permanente',
    );

    await assert.rejects(
      () => authz.requireCaseAccess(foreignCase, asesor, async () => false),
      AccessDeniedError,
    );
    await assert.rejects(
      () => authz.requireCaseAccess('500000000000004AAA', asesor, async () => false),
      AccessDeniedError,
    );

    assert.doesNotThrow(() => authz.requireAccess('case', boundCase, cliente));
    assert.throws(() => authz.requireAccess('case', boundCase, otroCliente), AccessDeniedError);
    await assert.doesNotReject(() => authz.requireCaseAccess(foreignCase, admin, async () => false));
  });
});

describe('controles de abuso y evidencia', () => {
  it('usa X-Forwarded-For solo desde proxies explicitamente confiables', () => {
    const trusted = new Set(['10.0.0.4', '10.0.0.5']);
    assert.equal(clientNetworkKey('203.0.113.20', '198.51.100.7', trusted), '203.0.113.20');
    assert.equal(
      clientNetworkKey('10.0.0.5', '198.51.100.7, 10.0.0.4', trusted),
      '198.51.100.7',
    );
    assert.equal(clientNetworkKey('10.0.0.5', 'valor-invalido', trusted), '10.0.0.5');
    assert.equal(clientNetworkKey('::ffff:127.0.0.1', undefined, new Set()), '127.0.0.1');
  });

  it('limita por ventana y calcula Retry-After', () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);
    assert.deepEqual(limiter.consume('cliente-uno', 100), { allowed: true, retryAfterSeconds: 0 });
    assert.deepEqual(limiter.consume('cliente-uno', 200), { allowed: true, retryAfterSeconds: 0 });
    assert.deepEqual(limiter.consume('cliente-uno', 300), { allowed: false, retryAfterSeconds: 1 });
    assert.deepEqual(limiter.consume('cliente-uno', 1_101), { allowed: true, retryAfterSeconds: 0 });
  });

  it('acota la cardinalidad y expulsa determinísticamente la ventana más antigua', () => {
    const limiter = new FixedWindowRateLimiter(1, 10_000);
    assert.equal(limiter.consume('primera', 0).allowed, true);
    assert.equal(limiter.consume('primera', 1).allowed, false);

    // La cota mínima interna es 256. Una identidad adicional obliga a expulsar
    // la ventana más antigua en vez de permitir crecimiento sin límite.
    for (let index = 0; index < 256; index += 1) {
      assert.equal(limiter.consume(`barrido-${index}`, 2).allowed, true);
    }
    assert.equal(limiter.consume('primera', 3).allowed, true);
  });

  it('redacta tokens y PII incluso dentro de objetos anidados', () => {
    const original = {
      Authorization: 'Bearer super-secret-token',
      access_token: '00Dxx!token',
      email: 'persona@example.com',
      telefono: '+52 55 1234 5678',
      vin: '1HGBH41JXMN109186',
      nested: { client_secret: 'shhh', mensaje: 'contacta persona@example.com con Bearer abc.def.ghi' },
    };
    const safe = redactSensitive(original) as Record<string, unknown>;
    const serialized = JSON.stringify(safe);

    for (const secret of ['super-secret-token', '00Dxx!token', 'persona@example.com', '55 1234 5678', '1HGBH41JXMN109186', 'shhh', 'abc.def.ghi']) {
      assert.equal(serialized.includes(secret), false, `se filtro: ${secret}`);
    }
    assert.equal(JSON.stringify(original).includes('persona@example.com'), true, 'no muta la evidencia original');
    const serializedSecret = String(redactSensitive('{"client_secret":"shhh","refresh_token":"refresh-value"}'));
    assert.equal(serializedSecret.includes('shhh'), false);
    assert.equal(serializedSecret.includes('refresh-value'), false);
  });

  it('no filtra mensajes, URLs ni cuerpos internos en errores HTTP', () => {
    const upstream = new ErrorSalesforce('fallo para persona@example.com Bearer abc.def.ghi', {
      operacion: 'consulta.sensible',
      status: 401,
      url: 'https://example.test/query?q=persona%40example.com',
      cuerpo: { access_token: 'token-super-secreto', VIN: '1HGBH41JXMN109186' },
    });
    const response = comoRespuestaHttp(upstream);
    const serialized = JSON.stringify(response);

    assert.equal(response.status, 502, 'un 401 upstream no se confunde con auth de la app');
    assert.match(serialized, /errorId/);
    for (const leaked of ['persona@example.com', 'abc.def.ghi', 'token-super-secreto', '1HGBH41JXMN109186', 'query?q=']) {
      assert.equal(serialized.includes(leaked), false, `se filtro: ${leaked}`);
    }
  });

  it('conserva statuses seguros de errores HTTP controlados', () => {
    const tooLarge = comoRespuestaHttp(new HttpRequestError(413, 'BODY_TOO_LARGE', 'Cuerpo demasiado grande.'));
    assert.equal(tooLarge.status, 413);
    assert.equal((tooLarge.cuerpo as { codigo: string }).codigo, 'BODY_TOO_LARGE');
    assert.match(String((tooLarge.cuerpo as { errorId: string }).errorId), /^[0-9a-f-]{36}$/);
  });
});

describe('frontera HTTP', () => {
  function bodyRequest(parts: string[], headers: Record<string, string> = {}) {
    return {
      headers,
      async *[Symbol.asyncIterator]() {
        for (const part of parts) yield Buffer.from(part);
      },
    };
  }

  it('acepta mismo origen y allowlist exacta, nunca comodines implicitos', () => {
    const allowed = new Set(['https://portal.example.com']);
    assert.equal(corsDecision('http://localhost:3000', 'localhost:3000', false, allowed), 'same-origin');
    assert.equal(corsDecision('https://portal.example.com', 'internal:3000', false, allowed), 'allowed');
    assert.equal(corsDecision('https://evil.example.com', 'internal:3000', false, allowed), 'denied');
    assert.equal(corsDecision(undefined, 'internal:3000', false, allowed), 'no-origin');
  });

  it('emite una CSP same-origin sin excepciones inline, eval ni data', () => {
    const headers = new Map<string, string | number | readonly string[]>();
    const response = {
      setHeader(name: string, value: string | number | readonly string[]) {
        headers.set(name, value);
        return response;
      },
    };
    applySecureHeaders(response as unknown as Parameters<typeof applySecureHeaders>[0]);

    const csp = String(headers.get('Content-Security-Policy'));
    assert.equal(csp.includes("'unsafe-inline'"), false);
    assert.equal(csp.includes("'unsafe-eval'"), false);
    assert.equal(csp.includes('data:'), false);
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "script-src-attr 'none'",
      "style-src 'self'",
      "style-src-attr 'none'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ]) {
      assert.ok(csp.includes(directive), `falta la directiva: ${directive}`);
    }
    assert.equal(headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  });

  it('mantiene todos los entrypoints libres de scripts, estilos y handlers inline', () => {
    const htmlFiles = readdirSync(PUBLIC_ROOT).filter((name) => name.endsWith('.html'));
    assert.ok(htmlFiles.length > 0);

    for (const name of htmlFiles) {
      const html = readFileSync(join(PUBLIC_ROOT, name), 'utf8');
      assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc\s*=)[^>]*>/i, `${name} contiene script inline`);
      assert.doesNotMatch(html, /\sstyle\s*=/i, `${name} contiene style inline`);
      assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${name} contiene un handler inline`);

      for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
        const source = match[1];
        assert.match(source, /^\/[A-Za-z0-9._/-]+$/, `${name} carga un script que no es same-origin`);
        assert.equal(existsSync(join(PUBLIC_ROOT, source.slice(1))), true, `${name} referencia ${source} inexistente`);
      }
    }
  });

  it('reconoce same-origin HTTPS detrás de Render sin confiar en headers de proxy', () => {
    const renderOrigin = renderExternalOrigin({
      RENDER: 'true',
      RENDER_EXTERNAL_URL: 'https://torre-agentforce.onrender.com',
    });
    assert.equal(renderOrigin, 'https://torre-agentforce.onrender.com');
    assert.equal(
      corsDecision(
        'https://torre-agentforce.onrender.com',
        'torre-agentforce.onrender.com',
        false,
        new Set(),
        renderOrigin,
      ),
      'same-origin',
    );
    assert.equal(
      corsDecision(
        'https://torre-agentforce.onrender.com',
        'host-falsificado.example.com',
        false,
        new Set(),
        renderOrigin,
      ),
      'denied',
    );
    assert.equal(
      corsDecision(
        'https://evil.example.com',
        'torre-agentforce.onrender.com',
        false,
        new Set(),
        renderOrigin,
      ),
      'denied',
    );
  });

  it('sólo confía en RENDER_EXTERNAL_URL cuando Render lo inyecta y es un origin HTTPS exacto', () => {
    assert.equal(
      renderExternalOrigin({
        RENDER: 'false',
        RENDER_EXTERNAL_URL: 'https://torre-agentforce.onrender.com',
      }),
      undefined,
    );
    assert.throws(
      () => renderExternalOrigin({ RENDER: 'true', RENDER_EXTERNAL_URL: 'http://torre.onrender.com' }),
      /origin HTTPS exacto/,
    );
    assert.throws(
      () => renderExternalOrigin({ RENDER: 'true', RENDER_EXTERNAL_URL: 'https://torre.onrender.com/ruta' }),
      /origin HTTPS exacto/,
    );
    assert.throws(
      () => renderExternalOrigin({ RENDER: 'true', RENDER_EXTERNAL_URL: 'no-es-url' }),
      /URL valida/,
    );
  });

  it('rechaza content type incorrecto, JSON invalido y cuerpos grandes con status preciso', async () => {
    await assert.rejects(
      () => readJsonBody(bodyRequest(['{}'], { 'content-type': 'text/plain' }), 32),
      (error: unknown) => error instanceof HttpRequestError && error.status === 415,
    );
    await assert.rejects(
      () => readJsonBody(bodyRequest(['{'], { 'content-type': 'application/json' }), 32),
      (error: unknown) => error instanceof HttpRequestError && error.status === 400,
    );
    await assert.rejects(
      () => readJsonBody(bodyRequest(['12345'], { 'content-type': 'application/json' }), 4),
      (error: unknown) => error instanceof HttpRequestError && error.status === 413,
    );
  });

  it('acepta JSON UTF-8 dentro del limite', async () => {
    const parsed = await readJsonBody<{ ok: boolean }>(
      bodyRequest(['{"ok":', 'true}'], { 'content-type': 'application/json; charset=utf-8' }),
      32,
    );
    assert.deepEqual(parsed, { ok: true });
  });

  it('impide que links de un upstream exfiltren el Bearer a otro host', () => {
    assert.equal(
      isAllowedUpstreamUrl(
        '/einstein/ai-agent/v1/sessions/abc/messages',
        'https://api.salesforce.com',
        '/einstein/ai-agent/v1/',
      ),
      true,
    );
    assert.equal(
      isAllowedUpstreamUrl(
        'https://api.salesforce.com.evil.test/einstein/ai-agent/v1/sessions/abc',
        'https://api.salesforce.com',
        '/einstein/ai-agent/v1/',
      ),
      false,
    );
    assert.equal(
      isAllowedUpstreamUrl('https://api.salesforce.com/otro', 'https://api.salesforce.com', '/einstein/ai-agent/v1/'),
      false,
    );
  });

  it('no confunde un directorio hermano con un archivo estatico interno', () => {
    const root = 'C:\\app\\publico';
    assert.equal(isPathInside(root, 'C:\\app\\publico\\assets\\app.js'), true);
    assert.equal(isPathInside(root, 'C:\\app\\publico-privado\\secreto.txt'), false);
    assert.equal(isPathInside(root, 'C:\\app\\secreto.txt'), false);
  });
});
