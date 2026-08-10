import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { ErrorSalesforce, comoRespuestaHttp } from '../../src/servidor/errores.ts';
import { redactSensitive } from '../../src/servidor/security.ts';

const projectRoot = process.cwd();

function isIgnored(path: string): boolean {
  const result = spawnSync('git', ['check-ignore', '--no-index', '-q', path], {
    cwd: projectRoot,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, `git check-ignore no debe fallar para ${path}`);
  return result.status === 0;
}

describe('custodia de evidencia y sanitización', () => {
  it('ignora evidencia cruda, metadata, outputs y secretos, pero conserva .env.example', () => {
    const gitignore = readFileSync(resolve(projectRoot, '.gitignore'), 'utf8');
    for (const required of ['evidencia/', '.metadata-org/', 'output/', 'coverage/', '.env', 'salesforce-exports/']) {
      assert.match(gitignore, new RegExp(`^${required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    }

    for (const ignored of [
      'evidencia/canary.json',
      '.metadata-org/force-app/main/default/canary.xml',
      'output/playwright/results.json',
      'coverage/lcov.info',
      '.env',
      'salesforce-exports/export.csv',
    ]) {
      assert.equal(isIgnored(ignored), true, `${ignored} debe permanecer fuera de Git`);
    }
    assert.equal(isIgnored('.env.example'), false, '.env.example debe seguir siendo documentable');
  });

  it('redacta secretos y PII anidados sin mutar la evidencia original', () => {
    const canaries = {
      authorization: 'Bearer qa-super-secret-token-1234567890',
      access_token: '00Dxx0000000000!sensitive-token',
      cookie: '__Host-session=sensitive-cookie-value',
      email: 'persona.sensible@example.com',
      phone: '+52 55 1234 5678',
      vin: '1HGBH41JXMN109186',
      nested: {
        url: 'https://example.test/callback?access_token=url-secret-token',
        client_secret: 'client-secret-canary',
      },
    };
    const original = structuredClone(canaries);
    const safe = JSON.stringify(redactSensitive(canaries));

    for (const secret of [
      'qa-super-secret-token-1234567890',
      'sensitive-token',
      'sensitive-cookie-value',
      'persona.sensible@example.com',
      '55 1234 5678',
      '1HGBH41JXMN109186',
      'url-secret-token',
      'client-secret-canary',
    ]) {
      assert.equal(safe.includes(secret), false, `se filtró el canary ${secret}`);
    }
    assert.deepEqual(canaries, original, 'sanitizar no debe alterar la evidencia original');
  });

  it('un fallo upstream conserva sólo un error correlacionable y nunca el cuerpo sensible', () => {
    const upstream = new ErrorSalesforce(
      'Salesforce rechazó a persona.sensible@example.com con Bearer qa-secret-token-1234567890',
      {
        operacion: 'qa.evidence.boundary',
        status: 500,
        url: 'https://example.my.salesforce.com/services/data?q=1HGBH41JXMN109186',
        cuerpo: {
          refresh_token: 'refresh-secret-canary',
          password: 'password-secret-canary',
          vin: '1HGBH41JXMN109186',
        },
      },
    );
    const response = comoRespuestaHttp(upstream);
    const serialized = JSON.stringify(response);

    assert.equal(response.status, 502);
    assert.match(serialized, /errorId/);
    assert.match(serialized, /UPSTREAM_FAILURE/);
    for (const secret of [
      'persona.sensible@example.com',
      'qa-secret-token-1234567890',
      'refresh-secret-canary',
      'password-secret-canary',
      '1HGBH41JXMN109186',
      'my.salesforce.com',
    ]) {
      assert.equal(serialized.includes(secret), false, `la respuesta pública filtró ${secret}`);
    }
  });
});
