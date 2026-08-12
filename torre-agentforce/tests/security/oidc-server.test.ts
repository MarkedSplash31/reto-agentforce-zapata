import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createPortProbe } from 'node:net';
import { after, before, describe, it } from 'node:test';

const USER_ID = '005000000000001AAA';
const CONTACT_ID = '003000000000001AAA';
const ACCOUNT_ID = '001000000000001AAA';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const kid = randomUUID();
let expectedNonce = '';
let refreshRequests = 0;
let identityServer: Server;
let app: ChildProcessWithoutNullStreams;
let identityOrigin = '';
let appOrigin = '';
let output = '';

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function idToken(): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const now = Math.floor(Date.now() / 1_000);
  const payload = base64url(JSON.stringify({
    iss: identityOrigin,
    aud: 'oidc-integration-client',
    nonce: expectedNonce,
    sub: `${identityOrigin}/id/00D000000000001AAA/${USER_ID}`,
    exp: now + 300,
    iat: now,
  }));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, value: unknown, status = 200): void {
  const encoded = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(encoded),
  });
  res.end(encoded);
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createPortProbe();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No se obtuvo puerto.'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitUntilReady(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (app.exitCode !== null) throw new Error(`El servidor OIDC termino antes de iniciar:\n${output}`);
    try {
      if ((await fetch(`${appOrigin}/salud`)).ok) return;
    } catch {
      // Todavia inicia.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`El servidor OIDC no inicio:\n${output}`);
}

before(async () => {
  const identityPort = await availablePort();
  const appPort = await availablePort();
  identityOrigin = `http://127.0.0.1:${identityPort}`;
  appOrigin = `http://127.0.0.1:${appPort}`;

  identityServer = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', identityOrigin);
      if (url.pathname === '/id/keys') {
        sendJson(res, { keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] });
        return;
      }
      if (url.pathname === '/services/oauth2/token') {
        const form = new URLSearchParams(await body(req));
        if (form.get('grant_type') === 'refresh_token') {
          refreshRequests += 1;
          sendJson(res, {
            access_token: 'oidc-integration-renewed-access-token',
            instance_url: identityOrigin,
          });
          return;
        }
        assert.equal(form.get('grant_type'), 'authorization_code');
        assert.equal(form.get('client_id'), 'oidc-integration-client');
        assert.equal(form.get('client_secret'), 'oidc-integration-secret-value');
        assert.match(form.get('code_verifier') ?? '', /^[A-Za-z0-9_-]{43,128}$/);
        sendJson(res, {
          access_token: 'oidc-integration-access-token',
          refresh_token: 'oidc-integration-refresh-token',
          instance_url: identityOrigin,
          id_token: idToken(),
        });
        return;
      }
      if (url.pathname === '/services/oauth2/userinfo') {
        assert.match(String(req.headers.authorization), /^Bearer oidc-integration-/);
        sendJson(res, {
          user_id: USER_ID,
          sub: `${identityOrigin}/id/00D000000000001AAA/${USER_ID}`,
        });
        return;
      }
      if (url.pathname.endsWith('/query')) {
        const soql = url.searchParams.get('q') ?? '';
        if (soql.includes('FROM User ')) {
          sendJson(res, {
            totalSize: 1,
            done: true,
            records: [{
              Id: USER_ID,
              IsActive: true,
              ContactId: CONTACT_ID,
              Contact: { AccountId: ACCOUNT_ID },
            }],
          });
          return;
        }
        if (soql.includes('FROM PermissionSetAssignment ')) {
          assert.match(soql, /PermissionSet\.Name IN \('Torre_Agentforce_Admin','Torre_Agentforce_Asesor'\)/);
          sendJson(res, {
            totalSize: 1,
            done: true,
            records: [{ PermissionSet: { Name: 'Torre_Agentforce_Admin' } }],
          });
          return;
        }
      }
      sendJson(res, { error: 'unexpected protocol endpoint' }, 500);
    })().catch((error: unknown) => {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    });
  });
  await new Promise<void>((resolve, reject) => {
    identityServer.once('error', reject);
    identityServer.listen(identityPort, '127.0.0.1', resolve);
  });

  app = spawn(process.execPath, ['--experimental-strip-types', 'src/servidor/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      APP_ENV: 'development',
      APP_AUTH_PROVIDER: 'oidc',
      APP_AUTH_MODE: 'required',
      APP_EXTERNAL_ORIGIN: appOrigin,
      APP_OIDC_CALLBACK_URL: `${appOrigin}/auth/salesforce/callback`,
      APP_OIDC_ADMIN_PERMISSION_SETS: 'Torre_Agentforce_Admin',
      APP_OIDC_ADVISOR_PERMISSION_SETS: 'Torre_Agentforce_Asesor',
      APP_AUTH_CREDENTIALS_JSON: '',
      SF_LOGIN_URL: identityOrigin,
      // El proveedor de identidad de esta prueba es una organización distinta de la
      // del reto, así que declara también sus identificadores: `config.ts` rechaza
      // apuntar a una org ajena conservando el agente y la cola del reto.
      SF_AGENT_ID: '0Xx000000000001AAA',
      SF_COLA_ESCALAMIENTO_ID: '00G000000000001AAA',
      SF_CASE_QUEUE_ID: '00G000000000001AAA',
      SF_OIDC_ALLOWED_HOSTS: '127.0.0.1',
      SF_OIDC_EXPECTED_ISSUERS: identityOrigin,
      SF_CLIENT_ID: 'oidc-integration-client',
      SF_CLIENT_SECRET: 'oidc-integration-secret-value',
      SF_TOKEN_PROVIDER: 'cli',
      APP_RATE_LIMIT_MAX: '1000',
      APP_AUTH_RATE_LIMIT_MAX: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', (chunk) => { output += String(chunk); });
  app.stderr.on('data', (chunk) => { output += String(chunk); });
  await waitUntilReady();
});

after(async () => {
  if (app && app.exitCode === null) app.kill();
  await Promise.all([
    app && app.exitCode === null
      ? Promise.race([
          new Promise<void>((resolve) => app.once('exit', () => resolve())),
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ])
      : Promise.resolve(),
    new Promise<void>((resolve) => identityServer.close(() => resolve())),
  ]);
});

describe('rutas OIDC same-origin', () => {
  let cookie = '';
  let csrf = '';

  it('reporta proveedor OIDC sin exponer configuracion ni secretos', async () => {
    const response = await fetch(`${appOrigin}/auth/session`);
    const data = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.deepEqual(data, {
      provider: 'oidc',
      authenticated: false,
      principal: null,
      csrfToken: null,
      expiresAt: null,
      loginPath: '/auth/salesforce/login',
    });
    assert.equal(JSON.stringify(data).includes('secret'), false);
  });

  it('completa login, ignora Bearer y crea cookie HttpOnly', async () => {
    const login = await fetch(
      `${appOrigin}/auth/salesforce/login?returnTo=${encodeURIComponent('/agenda.html')}`,
      { redirect: 'manual' },
    );
    assert.equal(login.status, 302);
    const authorization = new URL(login.headers.get('location') ?? '');
    assert.equal(authorization.origin, identityOrigin);
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    expectedNonce = authorization.searchParams.get('nonce') ?? '';
    const state = authorization.searchParams.get('state') ?? '';

    const callback = await fetch(
      `${appOrigin}/auth/salesforce/callback?code=integration-code&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('location'), '/agenda.html');
    const setCookie = callback.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /^torre_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax;/);
    cookie = setCookie.split(';', 1)[0] ?? '';

    const sessionResponse = await fetch(`${appOrigin}/auth/session`, {
      headers: { Cookie: cookie, Authorization: 'Bearer qa-static-must-not-win-' + 'x'.repeat(40) },
    });
    const session = await sessionResponse.json() as Record<string, unknown>;
    assert.equal(session.authenticated, true);
    assert.deepEqual(session.principal, { id: USER_ID, role: 'admin' });
    assert.match(String(session.csrfToken), /^[A-Za-z0-9_-]{43}$/);
    csrf = String(session.csrfToken);
    const serialized = JSON.stringify(session);
    for (const secret of ['access-token', 'refresh-token', 'integration-secret', 'torre_session']) {
      assert.equal(serialized.includes(secret), false, `se filtro ${secret}`);
    }

    const bearerOnly = await fetch(`${appOrigin}/api/arquitectura`, {
      headers: { Authorization: 'Bearer ' + 'x'.repeat(48) },
    });
    assert.equal(bearerOnly.status, 401, 'Bearer no tiene precedencia en modo OIDC');
    assert.equal(bearerOnly.headers.has('www-authenticate'), false);

    const replay = await fetch(
      `${appOrigin}/auth/salesforce/callback?code=integration-code&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
    assert.equal(replay.status, 401);
  });

  it('aplica Origin + CSRF, renueva y rota la cookie', async () => {
    const missingCsrf = await fetch(`${appOrigin}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: appOrigin },
    });
    assert.equal(missingCsrf.status, 403);

    const wrongOrigin = await fetch(`${appOrigin}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://evil.example.test', 'X-CSRF-Token': csrf },
    });
    assert.equal(wrongOrigin.status, 403);

    const refreshed = await fetch(`${appOrigin}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: appOrigin, 'X-CSRF-Token': csrf },
    });
    const data = await refreshed.json() as Record<string, unknown>;
    assert.equal(refreshed.status, 200);
    assert.equal(refreshRequests, 1);
    const nextCookie = (refreshed.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? '';
    assert.notEqual(nextCookie, cookie);
    assert.notEqual(data.csrfToken, csrf);

    const oldSession = await fetch(`${appOrigin}/auth/session`, { headers: { Cookie: cookie } });
    assert.equal((await oldSession.json() as Record<string, unknown>).authenticated, false);
    cookie = nextCookie;
    csrf = String(data.csrfToken);
  });

  it('cierra sesion y expira la cookie sin aceptar un CSRF ajeno', async () => {
    const denied = await fetch(`${appOrigin}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: appOrigin, 'X-CSRF-Token': 'incorrecto' },
    });
    assert.equal(denied.status, 403);

    const logout = await fetch(`${appOrigin}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: appOrigin, 'X-CSRF-Token': csrf },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
    const session = await fetch(`${appOrigin}/auth/session`, { headers: { Cookie: cookie } });
    assert.equal((await session.json() as Record<string, unknown>).authenticated, false);

    for (const secret of [
      'oidc-integration-secret-value',
      'oidc-integration-access-token',
      'oidc-integration-refresh-token',
    ]) {
      assert.equal(output.includes(secret), false, `el proceso registro ${secret}`);
    }
  });
});
