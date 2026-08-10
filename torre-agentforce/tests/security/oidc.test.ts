import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from 'node:crypto';
import { describe, it } from 'node:test';

import {
  OidcSecurityError,
  createSalesforceOidcBff,
  deriveSalesforcePrincipal,
  type SalesforceOidcBffConfig,
} from '../../src/servidor/oidc.ts';

const USER_ID = '005000000000001AAA';
const CONTACT_ID = '003000000000001AAA';
const ACCOUNT_ID = '001000000000001AAA';
const APP_ORIGIN = 'https://torre.example.test';
const CALLBACK = `${APP_ORIGIN}/auth/salesforce/callback`;
const LOGIN_ORIGIN = 'https://login.salesforce.com';
const INSTANCE_ORIGIN = 'https://acme.my.salesforce.com';

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function jwt(
  privateKey: KeyObject,
  kid: string,
  claims: Record<string, unknown>,
): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = base64url(JSON.stringify(claims));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function config(
  fetcher: typeof fetch,
  overrides: Partial<SalesforceOidcBffConfig> = {},
): SalesforceOidcBffConfig {
  return {
    clientId: 'torre-client-id',
    clientSecret: 'server-only-client-secret',
    loginOrigin: LOGIN_ORIGIN,
    callbackUrls: [CALLBACK],
    allowedOrigins: [APP_ORIGIN],
    allowedSalesforceHosts: ['login.salesforce.com', 'acme.my.salesforce.com'],
    expectedIssuers: [LOGIN_ORIGIN],
    apiVersion: 'v67.0',
    production: true,
    roleMappings: {
      adminPermissionSets: ['Torre_Agentforce_Admin'],
      advisorPermissionSets: ['Torre_Agentforce_Asesor'],
    },
    fetcher,
    ...overrides,
  };
}

function createHappyFetcher(
  key: { privateKey: KeyObject; publicJwk: JsonWebKey; kid: string },
  nonceForCode: ReadonlyMap<string, string>,
  options: {
    rolePermissionSets?: string[];
    instanceOrigin?: string;
    issuer?: string;
    audience?: string | string[];
    nonceOverride?: string;
    onTokenBody?: (body: URLSearchParams) => void;
    onJwks?: () => void;
    jwksDelayMs?: number;
  } = {},
): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    if (url.pathname === '/services/oauth2/token') {
      const body = new URLSearchParams(String(init?.body ?? ''));
      options.onTokenBody?.(body);
      const code = body.get('code') ?? '';
      const nonce = options.nonceOverride ?? nonceForCode.get(code) ?? '';
      const nowSeconds = Math.floor(Date.now() / 1_000);
      return jsonResponse({
        access_token: 'server-only-salesforce-access-token',
        refresh_token: 'server-only-salesforce-refresh-token',
        instance_url: options.instanceOrigin ?? INSTANCE_ORIGIN,
        id_token: jwt(key.privateKey, key.kid, {
          iss: options.issuer ?? LOGIN_ORIGIN,
          aud: options.audience ?? 'torre-client-id',
          nonce,
          sub: `${LOGIN_ORIGIN}/id/00D000000000001AAA/${USER_ID}`,
          exp: nowSeconds + 300,
          iat: nowSeconds,
        }),
      });
    }
    if (url.pathname === '/id/keys') {
      options.onJwks?.();
      if (options.jwksDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.jwksDelayMs));
      }
      return jsonResponse({ keys: [{ ...key.publicJwk, kid: key.kid, alg: 'RS256', use: 'sig' }] });
    }
    if (url.pathname === '/services/oauth2/userinfo') {
      assert.equal(init?.headers instanceof Headers ? init.headers.get('authorization') : undefined, undefined);
      assert.match(String((init?.headers as Record<string, string>)?.Authorization), /^Bearer /);
      return jsonResponse({
        user_id: USER_ID,
        sub: `${LOGIN_ORIGIN}/id/00D000000000001AAA/${USER_ID}`,
      });
    }
    if (url.pathname.endsWith('/query')) {
      const soql = url.searchParams.get('q') ?? '';
      if (soql.includes('FROM User ')) {
        return jsonResponse({
          totalSize: 1,
          done: true,
          records: [{
            Id: USER_ID,
            IsActive: true,
            ContactId: CONTACT_ID,
            Contact: { AccountId: ACCOUNT_ID },
          }],
        });
      }
      if (soql.includes('FROM PermissionSetAssignment ')) {
        return jsonResponse({
          totalSize: options.rolePermissionSets?.length ?? 1,
          done: true,
          records: (options.rolePermissionSets ?? ['Torre_Agentforce_Admin']).map((Name) => ({
            PermissionSet: { Name },
          })),
        });
      }
    }
    return jsonResponse({ error: 'unexpected test endpoint' }, 500);
  };
}

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey,
    publicJwk: publicKey.export({ format: 'jwk' }),
    kid: randomUUID(),
  };
}

function assertOidcCode(expected: string) {
  return (error: unknown): boolean =>
    error instanceof OidcSecurityError && error.code === expected;
}

describe('Salesforce OAuth/OIDC BFF', () => {
  it('genera Authorization Code + PKCE S256 y consume state una sola vez', async () => {
    const key = keyMaterial();
    const nonces = new Map<string, string>();
    let tokenBody: URLSearchParams | undefined;
    const bff = createSalesforceOidcBff(config(
      createHappyFetcher(key, nonces, { onTokenBody: (body) => { tokenBody = body; } }),
    ));

    const started = bff.beginAuthorization({
      origin: APP_ORIGIN,
      callbackUrl: CALLBACK,
      returnTo: '/agenda.html',
    });
    const authorize = new URL(started.authorizationUrl);
    assert.equal(authorize.origin, LOGIN_ORIGIN);
    assert.equal(authorize.pathname, '/services/oauth2/authorize');
    assert.equal(authorize.searchParams.get('response_type'), 'code');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.match(authorize.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
    assert.equal(authorize.searchParams.get('state'), started.state);
    assert.equal(authorize.searchParams.get('nonce'), started.nonce);
    nonces.set('authorization-code', started.nonce);

    const completed = await bff.completeAuthorization({
      callbackUrl: `${CALLBACK}?code=authorization-code&state=${encodeURIComponent(started.state)}`,
      origin: APP_ORIGIN,
    });
    assert.equal(completed.returnTo, '/agenda.html');
    assert.equal(completed.principal.role, 'admin');
    assert.equal(tokenBody?.get('grant_type'), 'authorization_code');
    assert.equal(tokenBody?.get('redirect_uri'), CALLBACK);
    const verifier = tokenBody?.get('code_verifier') ?? '';
    assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
    assert.equal(
      createHash('sha256').update(verifier).digest('base64url'),
      authorize.searchParams.get('code_challenge'),
    );
    assert.equal(JSON.stringify(completed).includes('salesforce-access-token'), false);
    assert.equal(JSON.stringify(completed).includes('client-secret'), false);

    await assert.rejects(
      () => bff.completeAuthorization({
        callbackUrl: `${CALLBACK}?code=authorization-code&state=${encodeURIComponent(started.state)}`,
        origin: APP_ORIGIN,
      }),
      assertOidcCode('OIDC_STATE_INVALID'),
    );
  });

  it('rechaza origin y callback que no coinciden exactamente con sus allowlists', async () => {
    const bff = createSalesforceOidcBff(config(async () => jsonResponse({})));
    assert.throws(
      () => bff.beginAuthorization({
        origin: 'https://torre.example.test.evil.test',
        callbackUrl: CALLBACK,
      }),
      assertOidcCode('OIDC_ORIGIN_DENIED'),
    );
    assert.throws(
      () => bff.beginAuthorization({
        origin: APP_ORIGIN,
        callbackUrl: `${CALLBACK}/extra`,
      }),
      assertOidcCode('OIDC_CALLBACK_DENIED'),
    );

    const started = bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    await assert.rejects(
      () => bff.completeAuthorization({
        callbackUrl: `${APP_ORIGIN}/otra-ruta?code=x&state=${started.state}`,
        origin: APP_ORIGIN,
      }),
      assertOidcCode('OIDC_CALLBACK_DENIED'),
    );
  });

  it('expira state por TTL, aplica cuota y GC permite nuevos intentos', () => {
    let now = 1_000;
    const bff = createSalesforceOidcBff(config(async () => jsonResponse({}), {
      now: () => now,
      authAttemptTtlMs: 30_000,
      maxAuthAttempts: 1,
    }));
    bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    assert.throws(
      () => bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK }),
      assertOidcCode('OIDC_CAPACITY_EXCEEDED'),
    );
    now = 31_001;
    const stats = bff.garbageCollect();
    assert.equal(stats.authAttemptsRemoved, 1);
    assert.doesNotThrow(() => bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK }));
  });

  it('valida firma RS256, issuer, audience y nonce antes de consultar al usuario', async () => {
    const scenarios = [
      { overrides: { issuer: 'https://evil.example.test' }, code: 'OIDC_ISSUER_INVALID' },
      { overrides: { audience: 'otro-cliente' }, code: 'OIDC_AUDIENCE_INVALID' },
      { overrides: { nonceOverride: 'nonce-ajeno' }, code: 'OIDC_NONCE_INVALID' },
    ] as const;

    for (const scenario of scenarios) {
      const key = keyMaterial();
      const nonces = new Map<string, string>();
      const bff = createSalesforceOidcBff(config(createHappyFetcher(key, nonces, scenario.overrides)));
      const started = bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
      nonces.set('code', started.nonce);
      await assert.rejects(
        () => bff.completeAuthorization({
          callbackUrl: `${CALLBACK}?code=code&state=${started.state}`,
          origin: APP_ORIGIN,
        }),
        assertOidcCode(scenario.code),
      );
    }
  });

  it('rechaza una firma que no corresponde al JWKS publicado', async () => {
    const signingKey = keyMaterial();
    const publishedKey = keyMaterial();
    const nonces = new Map<string, string>();
    const baseFetcher = createHappyFetcher(signingKey, nonces);
    const bff = createSalesforceOidcBff(config(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      if (url.pathname === '/id/keys') {
        return jsonResponse({
          keys: [{
            ...publishedKey.publicJwk,
            kid: signingKey.kid,
            alg: 'RS256',
            use: 'sig',
          }],
        });
      }
      return baseFetcher(input, init);
    }));
    const started = bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    nonces.set('code', started.nonce);
    await assert.rejects(
      () => bff.completeAuthorization({
        callbackUrl: `${CALLBACK}?code=code&state=${started.state}`,
        origin: APP_ORIGIN,
      }),
      assertOidcCode('OIDC_ID_TOKEN_INVALID'),
    );
  });

  it('rechaza instance_url fuera de la allowlist sin enviarle el Bearer', async () => {
    const key = keyMaterial();
    const nonces = new Map<string, string>();
    let requests = 0;
    const inner = createHappyFetcher(key, nonces, { instanceOrigin: 'https://evil.example.test' });
    const bff = createSalesforceOidcBff(config(async (input, init) => {
      requests += 1;
      return inner(input, init);
    }));
    const started = bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    nonces.set('code', started.nonce);
    await assert.rejects(
      () => bff.completeAuthorization({
        callbackUrl: `${CALLBACK}?code=code&state=${started.state}`,
        origin: APP_ORIGIN,
      }),
      assertOidcCode('OIDC_SALESFORCE_HOST_DENIED'),
    );
    assert.equal(requests, 2, 'solo token + JWKS; no se consulta el host no permitido');
  });

  it('mapea roles por Permission Set y liga clientes a Contact/Account', () => {
    const mappings = {
      adminPermissionSets: ['Torre_Agentforce_Admin'],
      advisorPermissionSets: ['Torre_Agentforce_Asesor'],
    };
    const namedUser = {
      id: USER_ID,
      active: true,
      contactId: CONTACT_ID,
      accountId: ACCOUNT_ID,
    };
    assert.equal(
      deriveSalesforcePrincipal(namedUser, ['Torre_Agentforce_Admin'], mappings).role,
      'admin',
    );
    assert.equal(
      deriveSalesforcePrincipal(namedUser, ['Torre_Agentforce_Asesor'], mappings).role,
      'asesor',
    );
    const customer = deriveSalesforcePrincipal(namedUser, [], mappings);
    assert.equal(customer.role, 'cliente');
    assert.deepEqual(customer.bindings.contactIds, [CONTACT_ID]);
    assert.deepEqual(customer.bindings.accountIds, [ACCOUNT_ID]);
    assert.throws(
      () => deriveSalesforcePrincipal({ id: USER_ID, active: true }, [], mappings),
      assertOidcCode('OIDC_ROLE_DENIED'),
    );
    assert.throws(
      () => deriveSalesforcePrincipal({ ...namedUser, active: false }, ['Torre_Agentforce_Admin'], mappings),
      assertOidcCode('OIDC_USER_INACTIVE'),
    );
  });

  it('emite cookie HttpOnly __Host- en produccion y cookie local acotada en desarrollo', async () => {
    const key = keyMaterial();
    const nonces = new Map<string, string>();
    const prod = createSalesforceOidcBff(config(createHappyFetcher(key, nonces)));
    const started = prod.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    nonces.set('code', started.nonce);
    const completed = await prod.completeAuthorization({
      callbackUrl: `${CALLBACK}?code=code&state=${started.state}`,
      origin: APP_ORIGIN,
    });
    assert.match(completed.setCookie, /^__Host-torre_session=/);
    assert.match(completed.setCookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax;/);
    assert.equal(completed.setCookie.includes('Domain='), false);

    const localCallback = 'http://127.0.0.1:3000/auth/salesforce/callback';
    const local = createSalesforceOidcBff(config(async () => jsonResponse({}), {
      production: false,
      loginOrigin: 'http://127.0.0.1:4040',
      expectedIssuers: ['http://127.0.0.1:4040'],
      allowedSalesforceHosts: ['127.0.0.1'],
      allowedOrigins: ['http://127.0.0.1:3000'],
      callbackUrls: [localCallback],
    }));
    assert.equal(local.cookieName, 'torre_session');
    assert.match(local.clearCookie(), /^torre_session=; Path=\/; HttpOnly; SameSite=Lax;/);
    assert.equal(local.clearCookie().includes('; Secure;'), false);
  });

  it('autentica una sesion opaca, rota invalidando la anterior y expira por TTL', async () => {
    let now = Date.now();
    const key = keyMaterial();
    const nonces = new Map<string, string>();
    const bff = createSalesforceOidcBff(config(createHappyFetcher(key, nonces), {
      now: () => now,
      sessionTtlMs: 60_000,
    }));
    const started = bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    nonces.set('code', started.nonce);
    const completed = await bff.completeAuthorization({
      callbackUrl: `${CALLBACK}?code=code&state=${started.state}`,
      origin: APP_ORIGIN,
    });
    const cookie = completed.setCookie.split(';', 1)[0] ?? '';
    const authenticated = bff.authenticate(cookie);
    assert.equal(authenticated.principal.id, USER_ID);
    assert.equal(authenticated.salesforce.instanceUrl, INSTANCE_ORIGIN);
    assert.equal(authenticated.salesforce.accessToken, 'server-only-salesforce-access-token');
    assert.throws(
      () => bff.authenticate(`${cookie}; ${cookie}`),
      assertOidcCode('OIDC_SESSION_INVALID'),
      'una cabecera con cookie duplicada es ambigua y se rechaza',
    );

    const rotated = bff.rotateSession(cookie);
    assert.notEqual(rotated.setCookie.split(';', 1)[0], cookie);
    assert.throws(() => bff.authenticate(cookie), assertOidcCode('OIDC_SESSION_INVALID'));
    const rotatedCookie = rotated.setCookie.split(';', 1)[0] ?? '';
    assert.doesNotThrow(() => bff.authenticate(rotatedCookie));

    now += 60_001;
    assert.throws(() => bff.authenticate(rotatedCookie), assertOidcCode('OIDC_SESSION_INVALID'));
  });

  it('renueva el token Salesforce una sola vez ante llamadas concurrentes', async () => {
    const key = keyMaterial();
    const nonces = new Map<string, string>();
    const baseFetcher = createHappyFetcher(key, nonces);
    let refreshRequests = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      const body = new URLSearchParams(String(init?.body ?? ''));
      if (url.pathname === '/services/oauth2/token' && body.get('grant_type') === 'refresh_token') {
        refreshRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(body.get('refresh_token'), 'server-only-salesforce-refresh-token');
        return jsonResponse({
          access_token: 'server-only-renewed-access-token',
          instance_url: INSTANCE_ORIGIN,
        });
      }
      return baseFetcher(input, init);
    };
    const bff = createSalesforceOidcBff(config(fetcher));
    const started = bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    nonces.set('code', started.nonce);
    const completed = await bff.completeAuthorization({
      callbackUrl: `${CALLBACK}?code=code&state=${started.state}`,
      origin: APP_ORIGIN,
    });
    const cookie = completed.setCookie.split(';', 1)[0] ?? '';
    const [first, second] = await Promise.all([
      bff.refreshSalesforceSession(cookie),
      bff.refreshSalesforceSession(cookie),
    ]);
    assert.equal(refreshRequests, 1);
    assert.equal(first.salesforce.accessToken, 'server-only-renewed-access-token');
    assert.equal(second.salesforce.accessToken, 'server-only-renewed-access-token');
  });

  it('exige Origin exacto y CSRF constante para mutaciones y logout', async () => {
    const key = keyMaterial();
    const nonces = new Map<string, string>();
    const bff = createSalesforceOidcBff(config(createHappyFetcher(key, nonces)));
    const started = bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    nonces.set('code', started.nonce);
    const completed = await bff.completeAuthorization({
      callbackUrl: `${CALLBACK}?code=code&state=${started.state}`,
      origin: APP_ORIGIN,
    });
    const cookie = completed.setCookie.split(';', 1)[0] ?? '';
    const session = bff.authenticate(cookie);

    assert.doesNotThrow(() => bff.assertMutationAllowed({
      method: 'POST',
      origin: APP_ORIGIN,
      csrfToken: completed.csrfToken,
    }, session));
    assert.throws(() => bff.assertMutationAllowed({
      method: 'POST',
      origin: 'https://evil.example.test',
      csrfToken: completed.csrfToken,
    }, session), assertOidcCode('OIDC_ORIGIN_DENIED'));
    assert.throws(() => bff.assertMutationAllowed({
      method: 'PATCH',
      origin: APP_ORIGIN,
      csrfToken: 'csrf-invalido',
    }, session), assertOidcCode('OIDC_CSRF_INVALID'));

    assert.throws(
      () => bff.logout({ cookieHeader: cookie, origin: APP_ORIGIN, csrfToken: 'incorrecto' }),
      assertOidcCode('OIDC_CSRF_INVALID'),
    );
    const loggedOut = bff.logout({
      cookieHeader: cookie,
      origin: APP_ORIGIN,
      csrfToken: completed.csrfToken,
    });
    assert.match(loggedOut.setCookie, /Max-Age=0/);
    assert.throws(() => bff.authenticate(cookie), assertOidcCode('OIDC_SESSION_INVALID'));
  });

  it('deduplica en single-flight la descarga concurrente de JWKS', async () => {
    const key = keyMaterial();
    const nonces = new Map<string, string>();
    let jwksRequests = 0;
    const fetcher = createHappyFetcher(key, nonces, {
      onJwks: () => { jwksRequests += 1; },
      jwksDelayMs: 20,
    });
    const bff = createSalesforceOidcBff(config(fetcher));
    const first = bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    const second = bff.beginAuthorization({ origin: APP_ORIGIN, callbackUrl: CALLBACK });
    nonces.set('first', first.nonce);
    nonces.set('second', second.nonce);

    await Promise.all([
      bff.completeAuthorization({
        callbackUrl: `${CALLBACK}?code=first&state=${first.state}`,
        origin: APP_ORIGIN,
      }),
      bff.completeAuthorization({
        callbackUrl: `${CALLBACK}?code=second&state=${second.state}`,
        origin: APP_ORIGIN,
      }),
    ]);
    assert.equal(jwksRequests, 1);
  });
});
