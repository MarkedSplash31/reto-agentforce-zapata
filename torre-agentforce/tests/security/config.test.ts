import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

test('SF_CASE_QUEUE_ID exige un Group/Queue Id y no cualquier Id Salesforce', async () => {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '-e', "import('./src/servidor/config.ts')"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: 'development',
        APP_AUTH_MODE: 'disabled',
        SF_CASE_QUEUE_ID: '500000000000001AAA',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += String(chunk)));
  const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve));

  assert.notEqual(exitCode, 0);
  assert.match(stderr, /SF_CASE_QUEUE_ID/);
});
