import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { test } from 'node:test';

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('No se obtuvo puerto.'));
      probe.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function runDrain(mode: 'graceful' | 'forced'): Promise<{ code: number | null; output: string }> {
  const port = await availablePort();
  const setup = mode === 'forced'
    ? `
      const { connect } = await import('node:net');
      const { once } = await import('node:events');
      const socket = connect(${port}, '127.0.0.1');
      await once(socket, 'connect');
      socket.write('GET /salud HTTP/1.1\\r\\nHost: localhost\\r\\n');
    `
    : '';
  const script = `
    const serverModule = await import('./src/servidor/index.ts');
    await new Promise((resolve) => setTimeout(resolve, 100));
    ${setup}
    const started = Date.now();
    const first = serverModule._drenarServidorParaPruebas();
    const second = serverModule._drenarServidorParaPruebas();
    const results = await Promise.all([first, second]);
    console.log('DRAIN_RESULT=' + JSON.stringify({ results, elapsed: Date.now() - started }));
  `;
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        APP_ENV: 'development',
        APP_AUTH_MODE: 'disabled',
        APP_SHUTDOWN_TIMEOUT_MS: mode === 'forced' ? '300' : '2000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => (output += String(chunk)));
  child.stderr.on('data', (chunk) => (output += String(chunk)));
  const code = await new Promise<number | null>((resolve, reject) => {
    const guard = setTimeout(() => {
      child.kill();
      reject(new Error(`El hijo no termino:\n${output}`));
    }, 5_000);
    child.once('exit', (exitCode) => {
      clearTimeout(guard);
      resolve(exitCode);
    });
  });
  return { code, output };
}

test('drenado es idempotente y termina limpio sin conexiones activas', async () => {
  const result = await runDrain('graceful');
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /DRAIN_RESULT=.*"forced":false/);
});

test('drenado fuerza sockets atascados al vencer el timeout acotado', async () => {
  const result = await runDrain('forced');
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /DRAIN_RESULT=.*"forced":true/);
  const elapsed = Number(/"elapsed":(\d+)/.exec(result.output)?.[1]);
  assert.ok(elapsed >= 250 && elapsed < 2_000, `timeout inesperado ${elapsed}ms:\n${result.output}`);
});
