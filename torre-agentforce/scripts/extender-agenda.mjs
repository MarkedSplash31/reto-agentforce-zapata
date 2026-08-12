/**
 * Extiende el calendario de talleres hacia adelante.
 *
 * Por qué hace falta. Las 729 franjas de la organización son una semilla con fecha de
 * caducidad: la última cae el 20 de agosto de 2026. Pasado ese día, `Consultar
 * disponibilidad de taller` no devuelve nada, el agente contesta con verdad que no
 * tiene horarios, y la escena del video que enseña una cita creándose deja de existir
 * — no por un defecto, sino porque se acabó el calendario.
 *
 * Qué hace. Copia hacia adelante el patrón semanal que la sucursal YA tiene: mismos
 * días de la semana, mismas horas, mismos tipos de servicio y misma capacidad. No
 * inventa un horario nuevo; repite el que está cargado.
 *
 * Lo que NO decide este script. `Procedencia__c = OPERACIONAL_VERIFICADO` significa que
 * alguien comprobó que ese taller de verdad abre a esa hora. Un programa no puede
 * comprobar eso, y copiarlo sin más convertiría una afirmación operativa en un efecto
 * secundario de una utilidad. Por eso las franjas nuevas nacen con la procedencia que
 * se pida explícitamente:
 *
 *   - por omisión, `SITIO_WEB_CAPACIDAD_ASUMIDA`: aparecen en la agenda, se ven, y la
 *     aplicación las marca como no confirmadas — que es la verdad.
 *   - con `CONFIRM_AGENDA_VERIFICADA=1`, `OPERACIONAL_VERIFICADO`: reservables. Quien
 *     pone esa variable está declarando que el horario de esas sucursales es real.
 *
 * Uso:
 *   node scripts/extender-agenda.mjs --dias 21 --ver          (sólo enseña qué haría)
 *   CONFIRM_EXTENDER_AGENDA=1 node scripts/extender-agenda.mjs --dias 21
 *   CONFIRM_EXTENDER_AGENDA=1 CONFIRM_AGENDA_VERIFICADA=1 node scripts/extender-agenda.mjs \
 *     --dias 21 --sucursal FL-QRO
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ALIAS = process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
const args = process.argv.slice(2);
const opcion = (nombre, porOmision) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : porOmision;
};
const DIAS = Number(opcion('dias', '21'));
const SUCURSAL = opcion('sucursal', null);
const SOLO_VER = args.includes('--ver') || process.env.CONFIRM_EXTENDER_AGENDA !== '1';
const VERIFICADAS = process.env.CONFIRM_AGENDA_VERIFICADA === '1';
const PROCEDENCIA = VERIFICADAS ? 'OPERACIONAL_VERIFICADO' : 'SITIO_WEB_CAPACIDAD_ASUMIDA';

if (!Number.isSafeInteger(DIAS) || DIAS < 1 || DIAS > 120) {
  throw new Error('--dias debe ser un entero entre 1 y 120.');
}

function sf(argumentos, entradaJson) {
  const entorno = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
  delete entorno.SF_API_VERSION;
  delete entorno.SF_ORG_API_VERSION;
  let salida;
  try {
    salida = execFileSync('sf', argumentos, {
      encoding: 'utf8',
      shell: true,
      env: entorno,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      input: entradaJson,
    });
  } catch (e) {
    const crudo = String(e.stdout ?? '');
    let mensaje = e.message;
    try {
      mensaje = JSON.parse(crudo.slice(crudo.indexOf('{'))).message;
    } catch {}
    throw new Error(String(mensaje).split('\n').pop());
  }
  return JSON.parse(salida.slice(salida.indexOf('{'))).result;
}

const soql = (q) => sf(['data', 'query', '-o', ALIAS, '--json', '--api-version', '67.0', '-q', `"${q}"`]);

// ── El patrón que ya existe ──────────────────────────────────────────────────
//
// Se toman los últimos siete días CARGADOS, no los últimos siete naturales: si el
// calendario ya venció, mirar «la semana pasada» no devolvería nada.

const ultimo = soql('SELECT MAX(Inicio__c) ultima FROM Slot_Taller__c').records?.[0]?.ultima;
if (!ultimo) throw new Error('La organización no tiene ninguna franja: no hay patrón que copiar.');

const finPatron = new Date(ultimo);
const iniPatron = new Date(finPatron.getTime() - 6 * 86_400_000);
iniPatron.setUTCHours(0, 0, 0, 0);

const donde = [
  `Inicio__c >= ${iniPatron.toISOString()}`,
  `Inicio__c <= ${finPatron.toISOString()}`,
  ...(SUCURSAL ? [`Sucursal__r.Codigo_Sucursal__c = '${SUCURSAL.replace(/'/g, "\\'")}'`] : []),
];
const patron = soql(
  `SELECT Inicio__c, Fin__c, Tipo_Servicio__c, Capacidad_Total__c, Sucursal__c, ` +
    `Sucursal__r.Codigo_Sucursal__c, Procedencia__c FROM Slot_Taller__c ` +
    `WHERE ${donde.join(' AND ')} ORDER BY Inicio__c`,
).records ?? [];

if (!patron.length) {
  throw new Error(
    `No hay franjas entre ${iniPatron.toISOString().slice(0, 10)} y ${finPatron.toISOString().slice(0, 10)}` +
      (SUCURSAL ? ` para ${SUCURSAL}` : '') + ': no hay patrón que copiar.',
  );
}

// ── Lo que se va a crear ─────────────────────────────────────────────────────
//
// Se repite el patrón en bloques de siete días hasta cubrir DIAS a partir de mañana,
// y se salta cualquier hora que ya exista para esa sucursal: correr el script dos
// veces no debe duplicar la agenda.

const existentes = new Set(
  (
    soql(
      `SELECT Inicio__c, Sucursal__r.Codigo_Sucursal__c FROM Slot_Taller__c ` +
        `WHERE Inicio__c >= ${new Date().toISOString()}`,
    ).records ?? []
  ).map((r) => `${r.Sucursal__r?.Codigo_Sucursal__c}@${new Date(r.Inicio__c).toISOString()}`),
);

const desde = new Date();
desde.setHours(0, 0, 0, 0);
const hasta = new Date(desde.getTime() + DIAS * 86_400_000);

const nuevas = [];
for (let semana = 1; semana * 7 * 86_400_000 <= DIAS * 86_400_000 + 7 * 86_400_000; semana++) {
  const salto = semana * 7 * 86_400_000;
  for (const f of patron) {
    const inicio = new Date(new Date(f.Inicio__c).getTime() + salto);
    if (inicio <= desde || inicio > hasta) continue;
    const clave = `${f.Sucursal__r?.Codigo_Sucursal__c}@${inicio.toISOString()}`;
    if (existentes.has(clave)) continue;
    existentes.add(clave);
    nuevas.push({
      Sucursal__c: f.Sucursal__c,
      Inicio__c: inicio.toISOString(),
      Fin__c: f.Fin__c ? new Date(new Date(f.Fin__c).getTime() + salto).toISOString() : null,
      Tipo_Servicio__c: f.Tipo_Servicio__c,
      Capacidad_Total__c: f.Capacidad_Total__c,
      Capacidad_Usada__c: 0,
      Procedencia__c: PROCEDENCIA,
    });
  }
}

const porSucursal = new Map();
for (const n of nuevas) {
  const cod = patron.find((p) => p.Sucursal__c === n.Sucursal__c)?.Sucursal__r?.Codigo_Sucursal__c ?? n.Sucursal__c;
  porSucursal.set(cod, (porSucursal.get(cod) ?? 0) + 1);
}

console.log(`\nPatrón leído: ${patron.length} franjas del ${iniPatron.toISOString().slice(0, 10)} al ${finPatron.toISOString().slice(0, 10)}.`);
console.log(`Se crearían ${nuevas.length} franjas hasta ${hasta.toISOString().slice(0, 10)}, con Procedencia__c = ${PROCEDENCIA}.`);
for (const [cod, n] of [...porSucursal].sort()) console.log(`  ${cod.padEnd(10)} ${n}`);
if (!VERIFICADAS) {
  console.log(
    '\nNo serán reservables: sin CONFIRM_AGENDA_VERIFICADA=1 nacen como capacidad asumida,\n' +
      'que es lo que la aplicación enseña marcado como no confirmado. Poner esa variable es\n' +
      'declarar que esos talleres abren de verdad a esas horas.',
  );
}

if (SOLO_VER) {
  console.log('\nNada se escribió. Define CONFIRM_EXTENDER_AGENDA=1 para crearlas.');
  process.exit(0);
}
if (!nuevas.length) {
  console.log('\nNo hay nada que crear: el calendario ya cubre ese rango.');
  process.exit(0);
}

// ── Alta ─────────────────────────────────────────────────────────────────────
// Por archivo y `data import bulk`: son cientos de filas y el CLI no acepta un
// `data create record` por cada una sin tardar una eternidad.

const carpeta = mkdtempSync(join(tmpdir(), 'agenda-'));
const archivo = join(carpeta, 'slots.json');
writeFileSync(
  archivo,
  JSON.stringify({
    records: nuevas.map((n, i) => ({ attributes: { type: 'Slot_Taller__c', referenceId: `s${i}` }, ...n })),
  }),
);
try {
  const r = sf([
    'data', 'import', 'tree', '-o', ALIAS, '--json', '--api-version', '67.0', '--files', `"${archivo}"`,
  ]);
  console.log(`\nCreadas ${Array.isArray(r) ? r.length : nuevas.length} franjas.`);
} finally {
  rmSync(carpeta, { recursive: true, force: true });
}
