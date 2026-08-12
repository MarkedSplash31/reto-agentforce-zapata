/**
 * Contra qué organización levanta el sitio.
 *
 * El repositorio trae los identificadores de la organización del reto como valores por
 * omisión, a propósito: quien lo clona levanta el sitio sin configurar nada. El precio
 * de esa comodidad es una trampa silenciosa — alguien apunta `SF_LOGIN_URL` a SU
 * organización, se olvida de los Ids, y el sitio arranca igual hablando con su org
 * usando el agente y la cola de ésta. El fallo aparecería mucho después, dentro de una
 * conversación, con un error de Salesforce que no dice qué pasó.
 *
 * Aquí se fija que esa mezcla no arranca, y que la comodidad sigue existiendo cuando
 * nadie define nada.
 *
 * Cada caso corre en su propio proceso: `config.ts` lee el entorno al importarse y el
 * caché de módulos de Node no permite reimportarlo con otro.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

/** Arranca `config.ts` con un entorno dado y devuelve qué pasó. */
async function cargarConfig(extra: Record<string, string | undefined>) {
  const base = { ...process.env, APP_ENV: 'development', APP_AUTH_MODE: 'disabled' };
  // Un `.env` de la máquina no puede decidir el resultado de la prueba.
  for (const clave of [
    'SF_LOGIN_URL',
    'SF_AGENT_ID',
    'SF_COLA_ESCALAMIENTO_ID',
    'SF_CASE_QUEUE_ID',
  ]) {
    delete (base as Record<string, string | undefined>)[clave];
  }
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...base, ...extra })) {
    if (v !== undefined) env[k] = String(v);
  }

  const hijo = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '-e',
      "import('./src/servidor/config.ts').then((m) => console.log(JSON.stringify(m.config.identidadPorOmision)))",
    ],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  hijo.stdout.on('data', (c) => (stdout += String(c)));
  hijo.stderr.on('data', (c) => (stderr += String(c)));
  const codigo = await new Promise<number | null>((r) => hijo.once('exit', r));
  return { codigo, stdout, stderr };
}

const ORG_AJENA = 'https://acme-postventa.my.salesforce.com';
const ID_AGENTE_AJENO = '0Xx000000000001AAA';
const ID_COLA_AJENA = '00G000000000001AAA';

test('sin configurar nada, levanta contra la organización del reto y lo dice', async () => {
  const r = await cargarConfig({});
  assert.equal(r.codigo, 0, `no arrancó: ${r.stderr.slice(0, 300)}`);
  const porOmision = JSON.parse(r.stdout.trim() || '[]');
  for (const clave of ['SF_LOGIN_URL', 'SF_AGENT_ID', 'SF_COLA_ESCALAMIENTO_ID', 'SF_CASE_QUEUE_ID']) {
    assert.ok(
      porOmision.includes(clave),
      `${clave} debería constar como tomada del reto; llegó ${JSON.stringify(porOmision)}`,
    );
  }
});

test('otra organización con los Ids del reto no arranca, y el error dice cuáles', async () => {
  const r = await cargarConfig({ SF_LOGIN_URL: ORG_AJENA });
  assert.notEqual(r.codigo, 0, 'arrancó apuntando a otra org con los Ids de ésta');
  assert.match(r.stderr, /SF_AGENT_ID/);
  assert.match(r.stderr, /SF_COLA_ESCALAMIENTO_ID|SF_CASE_QUEUE_ID/);
});

test('otra organización con sus propios Ids arranca sin quejarse', async () => {
  const r = await cargarConfig({
    SF_LOGIN_URL: ORG_AJENA,
    SF_AGENT_ID: ID_AGENTE_AJENO,
    SF_COLA_ESCALAMIENTO_ID: ID_COLA_AJENA,
    SF_CASE_QUEUE_ID: ID_COLA_AJENA,
  });
  assert.equal(r.codigo, 0, `no arrancó: ${r.stderr.slice(0, 300)}`);
  // `SF_CLI_ORG_ALIAS` puede seguir por omisión: nombra una sesión local del CLI, no
  // un registro de la organización, y por eso queda fuera de la comprobación.
  const pendientes = JSON.parse(r.stdout.trim() || '[]').filter((n: string) => n !== 'SF_CLI_ORG_ALIAS');
  assert.deepEqual(pendientes, []);
});

test('definir el mismo host del reto a mano no se confunde con otra organización', async () => {
  // Quien escribe explícitamente la URL del reto está trabajando contra ella: los Ids
  // por omisión son los correctos y no hay nada que reprochar.
  const r = await cargarConfig({
    SF_LOGIN_URL: 'https://orgfarm-1c6625ec2e-dev-ed.develop.my.salesforce.com',
  });
  assert.equal(r.codigo, 0, `no arrancó: ${r.stderr.slice(0, 300)}`);
});
