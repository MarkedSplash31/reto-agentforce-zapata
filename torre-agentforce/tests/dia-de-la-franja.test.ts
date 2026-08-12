/**
 * El día que la agenda rotula sobre un grupo de franjas.
 *
 * El defecto que fija esta prueba se vio en pantalla el 12 de agosto de 2026: el
 * asistente decía «viernes 14 de agosto de 15:00 a 17:00 — Garantía» y el panel de al
 * lado, sobre la MISMA franja, rotulaba «jueves 13». La organización decía viernes. Un
 * cliente que leyera el panel se presentaba un día antes.
 *
 * La causa era `new Date('2026-08-14')`: eso no es el 14 a medianoche local, es
 * medianoche UTC, que en México (UTC-6) cae a las 18:00 del día 13.
 *
 * `agenda.js` no se puede importar aquí —toca `document` al cargarse—, así que la
 * prueba corre las dos funciones sobre su código fuente, en un proceso con la zona
 * horaria de México. Ejecutarlas es lo único que demuestra que el arreglo está: leer el
 * archivo buscando una cadena no distingue un arreglo de un comentario sobre él.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const fuente = readFileSync(
  resolve(process.cwd(), 'publico', 'js', 'componentes', 'agenda.js'),
  'utf8',
);

/** Extrae una función del módulo por su nombre, sin arrastrar sus importaciones. */
function extraer(nombre: string): string {
  const inicio = fuente.indexOf(`export function ${nombre}(`);
  assert.notEqual(inicio, -1, `agenda.js ya no exporta ${nombre}`);
  let profundidad = 0;
  let i = fuente.indexOf('{', inicio);
  const abre = i;
  for (; i < fuente.length; i += 1) {
    if (fuente[i] === '{') profundidad += 1;
    else if (fuente[i] === '}') {
      profundidad -= 1;
      if (profundidad === 0) break;
    }
  }
  return `function ${nombre}${fuente.slice(fuente.indexOf('(', inicio), abre)}${fuente.slice(abre, i + 1)}`;
}

/** Corre un guion en un proceso con la zona horaria dada y devuelve su salida. */
function enZona(zona: string, guion: string): string {
  return execFileSync(process.execPath, ['-e', guion], {
    encoding: 'utf8',
    env: { ...process.env, TZ: zona },
  }).trim();
}

const PREAMBULO = `
const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
${extraer('diaLocal')}
${extraer('diaLegible')}
`;

test('una franja de las 15:00 del viernes se rotula viernes, no jueves', () => {
  // 21:00Z = 15:00 en México. Es la franja exacta que el panel rotulaba mal.
  const salida = enZona(
    'America/Mexico_City',
    `${PREAMBULO} console.log(diaLegible(diaLocal('2026-08-14T21:00:00.000+0000')));`,
  );
  assert.equal(salida, 'viernes 14 de agosto');
});

test('la última franja del día tampoco se corre al día siguiente', () => {
  // 23:00Z = 17:00 en México, la más tardía del catálogo.
  const salida = enZona(
    'America/Mexico_City',
    `${PREAMBULO} console.log(diaLegible(diaLocal('2026-08-17T23:00:00.000+0000')));`,
  );
  assert.equal(salida, 'lunes 17 de agosto');
});

test('el día que agrupa es el LOCAL del cliente, no el UTC', () => {
  // 02:00Z del día 15 son las 20:00 del 14 en México. Agrupar por la fecha UTC —que es
  // lo que hacía `inicio.slice(0, 10)`— la habría metido en el sábado.
  const salida = enZona(
    'America/Mexico_City',
    `${PREAMBULO} console.log(diaLocal('2026-08-15T02:00:00.000+0000'));`,
  );
  assert.equal(salida, '2026-08-14');
});

test('en una zona al este del meridiano tampoco se adelanta', () => {
  // La comprobación en espejo: en Madrid (UTC+2 en agosto) ese mismo instante es el 15
  // a las 04:00. Si la función se hubiera «arreglado» restando horas a mano, aquí
  // fallaría.
  const salida = enZona(
    'Europe/Madrid',
    `${PREAMBULO} console.log(diaLegible(diaLocal('2026-08-15T02:00:00.000+0000')));`,
  );
  assert.equal(salida, 'sábado 15 de agosto');
});
