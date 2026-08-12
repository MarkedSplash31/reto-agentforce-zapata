/**
 * Qué regla de cobertura se le aplica a una unidad.
 *
 * Con los datos de hoy este código no se equivoca nunca: los 32 pares modelo-sistema
 * de la organización tienen regla básica, y 4 tienen además la extendida. La elección
 * acierta por lo que hay cargado, no por lo que decide.
 *
 * Esta prueba fija las dos direcciones para que siga acertando cuando los datos
 * cambien. La que importa es la segunda: un sistema con SÓLO regla extendida no puede
 * aplicársele a una unidad que no tiene extendida. Si lo hiciera, la evaluaría contra
 * 60 meses y 750 000 km y una unidad fuera de garantía saldría cubierta.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// `datos.ts` arrastra `config.ts`, que exige un entorno declarado al importarse: sin
// esto el módulo revienta con «Produccion exige APP_AUTH_PROVIDER explicito» y la
// prueba parece rota cuando lo que falta es decirle en qué entorno corre. La
// importación es dinámica a propósito, para que ocurra DESPUÉS de fijarlo.
process.env.APP_ENV = 'development';
process.env.APP_AUTH_MODE = 'disabled';
const { elegirRegla } = await import('../src/servidor/datos.ts');

const basica = { Es_Extendida__c: false, Name: 'basica' };
const extendida = { Es_Extendida__c: true, Name: 'extendida' };

test('con las dos reglas, se aplica la que corresponde a la unidad', () => {
  assert.equal(elegirRegla([basica, extendida], false)?.Name, 'basica');
  assert.equal(elegirRegla([basica, extendida], true)?.Name, 'extendida');
  // El orden en que lleguen no puede cambiar el veredicto.
  assert.equal(elegirRegla([extendida, basica], false)?.Name, 'basica');
  assert.equal(elegirRegla([extendida, basica], true)?.Name, 'extendida');
});

test('sin regla extendida, una unidad con extendida conserva la básica', () => {
  // Es el caso de 28 de los 32 pares de la org: quitar este respaldo dejaría sin
  // cobertura a media flota.
  assert.equal(elegirRegla([basica], true)?.Name, 'basica');
});

test('sin regla básica, una unidad sin extendida NO hereda la extendida', () => {
  // El defecto que se está impidiendo. Antes caía en `delSistema[0]` y devolvía la
  // extendida, con lo que la unidad se medía contra una póliza que no es la suya.
  assert.equal(elegirRegla([extendida], false), null);
});

test('sin reglas, no hay regla', () => {
  assert.equal(elegirRegla([], false), null);
  assert.equal(elegirRegla([], true), null);
});
