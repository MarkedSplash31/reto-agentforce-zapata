import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:net';
import { after, before, describe, it } from 'node:test';

const clienteToken = 'cliente-'.padEnd(40, 'c');
const asesorToken = 'asesor-'.padEnd(40, 's');
const adminToken = 'admin-'.padEnd(40, 'a');
let child: ChildProcessWithoutNullStreams;
let baseUrl = '';
let output = '';

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No se obtuvo puerto.'));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitUntilReady(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`El servidor termino antes de iniciar:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/salud`);
      if (response.ok) return;
    } catch {
      // Todavia esta iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`El servidor no inicio:\n${output}`);
}

before(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--experimental-strip-types', 'src/servidor/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      APP_ENV: 'production',
      APP_BUILD_ID: 'security-test-build',
      APP_AUTH_PROVIDER: 'static',
      APP_STATIC_QA_ENABLED: 'true',
      APP_AUTH_MODE: 'required',
      APP_AUTH_CREDENTIALS_JSON: JSON.stringify([
        {
          id: 'cliente-test',
          role: 'cliente',
          token: clienteToken,
          bindings: { assetIds: ['02igK000002QPUfQAO'] },
        },
        { id: 'asesor-test', role: 'asesor', token: asesorToken },
        { id: 'admin-test', role: 'admin', token: adminToken },
      ]),
      APP_CORS_ORIGINS: 'https://portal.example.com',
      APP_BODY_LIMIT_BYTES: '1024',
      APP_AUTH_RATE_LIMIT_MAX: '20',
      APP_RATE_LIMIT_MAX: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => (output += String(chunk)));
  child.stderr.on('data', (chunk) => (output += String(chunk)));
  await waitUntilReady();
});

after(async () => {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
});

describe('servidor endurecido', () => {
  it('deja /salud publica y minima con headers seguros', async () => {
    const response = await fetch(`${baseUrl}/salud`);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body).sort(), ['build', 'status']);
    assert.equal(body.build, 'security-test-build');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(response.headers.get('content-security-policy') ?? '', /object-src 'none'/);
  });

  it('exige Bearer y no acepta tokens en query', async () => {
    const missing = await fetch(`${baseUrl}/api/arquitectura`);
    assert.equal(missing.status, 401);
    assert.match(missing.headers.get('www-authenticate') ?? '', /^Bearer/);

    const query = await fetch(`${baseUrl}/api/arquitectura?access_token=${adminToken}`);
    assert.equal(query.status, 401);
    assert.equal((await query.text()).includes(adminToken), false);
  });

  it('aplica RBAC antes de ejecutar la ruta', async () => {
    const response = await fetch(`${baseUrl}/api/arquitectura`, {
      headers: { Authorization: `Bearer ${clienteToken}` },
    });
    assert.equal(response.status, 403);
  });

  it('separa 401/403 y rechaza contexto de identidad enviado por el navegador', async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/arquitectura`);
    const unauthenticatedBody = await unauthenticated.json() as Record<string, unknown>;
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticatedBody.codigo, 'AUTHENTICATION_REQUIRED');

    const forbidden = await fetch(`${baseUrl}/api/arquitectura`, {
      headers: { Authorization: `Bearer ${clienteToken}` },
    });
    const forbiddenBody = await forbidden.json() as Record<string, unknown>;
    assert.equal(forbidden.status, 403);
    assert.equal(forbiddenBody.codigo, 'ACCESS_DENIED');
    assert.notEqual(unauthenticatedBody.errorId, forbiddenBody.errorId);
    assert.match(forbidden.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);

    const spoofed = await fetch(`${baseUrl}/api/agenda/reservar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clienteToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ correlationId: 'elegido-por-cliente' }),
    });
    const spoofedBody = await spoofed.json() as Record<string, unknown>;
    assert.equal(spoofed.status, 400);
    assert.equal(spoofedBody.codigo, 'UNTRUSTED_CONTEXT_FIELD');
  });

  it('no expone artefactos de datos por el servidor estatico', async () => {
    const response = await fetch(`${baseUrl}/datos/arquitectura.json`);
    assert.equal(response.status, 404);
  });

  it('limita media type y bytes antes de llamar servicios externos', async () => {
    const wrongType = await fetch(`${baseUrl}/api/agente/sesion`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${asesorToken}`, 'Content-Type': 'text/plain' },
      body: '{}',
    });
    assert.equal(wrongType.status, 415);

    const tooLarge = await fetch(`${baseUrl}/api/agente/sesion`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${asesorToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(2_000) }),
    });
    assert.equal(tooLarge.status, 413);
  });

  it('deniega CORS no listado y permite preflight exacto sin autenticarlo', async () => {
    const denied = await fetch(`${baseUrl}/salud`, { headers: { Origin: 'https://evil.example.com' } });
    assert.equal(denied.status, 403);

    const preflight = await fetch(`${baseUrl}/api/arquitectura`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://portal.example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://portal.example.com');
  });
});
