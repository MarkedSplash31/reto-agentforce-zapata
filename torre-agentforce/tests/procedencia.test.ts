// Que la respuesta del agente se lea, y que su procedencia no se pierda.
//
// Observado el 12-ago-2026 preguntándole al agente por un código SPN desde el sitio:
// antes de contestar recitaba tres renglones de fontanería —«Material consultado: …»,
// «Estado de la fuente: v1.0-sintetica-no-verificada», «Advertencia de procedencia:
// [FUENTE SINTETICA NO VERIFICADA] … verifica la política vigente con una fuente
// operacional antes de tomar una decisión»— y la respuesta útil quedaba enterrada
// debajo. Esa advertencia está escrita PARA EL MODELO; el cliente estaba leyendo una
// instrucción interna.
//
// Las dos garantías que no se pueden romper: no perder texto del agente, y no
// descartar la procedencia — sale del cuerpo para enseñarse marcada.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { separarProcedencia } = await import('../publico/js/procedencia.js');

const REAL = [
  'Material consultado: Codigos de falla SPN y FMI mas frecuentes, Luces de tablero: significado y accion inmediata',
  'Estado de la fuente: v1.0-sintetica-no-verificada',
  'Advertencia de procedencia: [FUENTE SINTETICA NO VERIFICADA] Material de apoyo del reto;',
  'no debe presentarse como oficial ni confirmada. Verifica la politica vigente con una',
  'fuente operacional antes de tomar una decision.',
  '',
  'El material no verificado consultado indica:',
  '- El codigo SPN 3251 FMI 0 corresponde a presion diferencial del DPF alta.',
].join('\n');

describe('la procedencia sale del cuerpo de la respuesta', () => {
  it('separa el preámbulo real del agente y deja la respuesta legible', () => {
    const { cuerpo, marcas } = separarProcedencia(REAL);
    assert.match(cuerpo, /^El material no verificado consultado indica:/);
    assert.doesNotMatch(cuerpo, /Material consultado:/);
    assert.doesNotMatch(cuerpo, /Advertencia de procedencia/);
    assert.equal(marcas.length, 3);
  });

  it('la advertencia se recoge completa, aunque ocupe varias líneas', () => {
    const { marcas } = separarProcedencia(REAL);
    const advertencia = marcas.find((m) => /Advertencia/i.test(m.etiqueta));
    assert.ok(advertencia, 'la advertencia no puede descartarse');
    assert.match(advertencia.valor, /fuente operacional antes de tomar una decision\.$/);
  });

  it('conserva la versión de la fuente, que es lo que se enseña marcado', () => {
    const { marcas } = separarProcedencia(REAL);
    const version = marcas.find((m) => /Estado de la fuente/i.test(m.etiqueta));
    assert.equal(version?.valor, 'v1.0-sintetica-no-verificada');
  });

  it('una respuesta sin preámbulo se deja intacta', () => {
    const texto = 'Para agendar tu servicio necesito el VIN de la unidad.';
    const { cuerpo, marcas } = separarProcedencia(texto);
    assert.equal(cuerpo, texto);
    assert.equal(marcas.length, 0);
  });

  it('si quitar el preámbulo dejaría la respuesta vacía, NO se quita', () => {
    // Perder lo unico que dijo el agente por depurarlo seria peor que el defecto.
    const soloPreambulo = 'Material consultado: Politica de grua\nEstado de la fuente: v1.0-sintetica-no-verificada';
    const { cuerpo, marcas } = separarProcedencia(soloPreambulo);
    assert.equal(cuerpo, soloPreambulo);
    assert.equal(marcas.length, 0);
  });

  it('no se come una línea que sólo parece una etiqueta', () => {
    const texto = 'Tu cita: jueves 13 de agosto a las 09:00.\nTe esperamos.';
    const { cuerpo, marcas } = separarProcedencia(texto);
    assert.equal(cuerpo, texto);
    assert.equal(marcas.length, 0);
  });

  it('aguanta texto vacío o nulo', () => {
    assert.equal(separarProcedencia('').cuerpo, '');
    assert.equal(separarProcedencia(null).cuerpo, '');
    assert.equal(separarProcedencia(undefined).marcas.length, 0);
  });
});
