// Que ningún camino cree una cita en un taller que no atiende ese modelo.
//
// Encontrado el 12-ago-2026 con un cliente tecleando en el sitio: la agenda de la
// página creó la orden 00000072 para un T680 en Querétaro, y `Modelo_Sucursal__c` no
// tiene una sola fila activa para ese par. El agente se niega a hacerlo —la compuerta
// vive en `ZapataAgendaController`, la acción con la que consulta horarios— pero el
// Flow que CREA la orden no la aplica. Cualquier camino que llegue directo al Flow
// podía registrar una cita que el taller no puede honrar.
//
// Un guardrail que sólo cubre uno de los dos caminos no es un guardrail.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';

const rutas = () => readFile(new URL('../src/servidor/rutas-publicas.ts', import.meta.url), 'utf8');

describe('la compuerta de modelo cubre también la agenda de la página', () => {
  it('se comprueba ANTES de invocar el Flow, no después', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("p === '/publico/taller/agendar'"),
      fuente.indexOf("p === '/publico/carretera/reportar'"),
    );

    const compuerta = bloque.indexOf('talleresDelModelo');
    const flow = bloque.indexOf('flows.crearOrdenServicio');
    assert.ok(compuerta > -1, 'la ruta debe preguntar qué talleres atienden el modelo');
    assert.ok(flow > -1, 'la ruta sigue creando la orden con el Flow');
    assert.ok(
      compuerta < flow,
      'comprobar después de crear la orden no sirve de nada: la cita imposible ya existe',
    );
  });

  it('el bloqueo no es un callejón: dice qué talleres sí atienden', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("p === '/publico/taller/agendar'"),
      fuente.indexOf("p === '/publico/carretera/reportar'"),
    );
    assert.match(bloque, /MODELO_NO_ATENDIDO/, 'el motivo debe ser estable para el log');
    assert.match(
      bloque,
      /talleresQueAtienden/,
      'sin las alternativas, al cliente sólo le queda adivinar en qué taller probar',
    );
  });

  it('el bloqueo se responde como política, no como fallo del servicio', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("p === '/publico/taller/agendar'"),
      fuente.indexOf("p === '/publico/carretera/reportar'"),
    );
    // Un guardrail que funciona no puede verse como una app rota: la interfaz pinta
    // distinto `ok:false` de un 5xx.
    const gate = bloque.slice(bloque.indexOf('talleresDelModelo'));
    assert.match(gate.slice(0, 900), /ok: false/, 'el bloqueo viaja como resultado, no como error HTTP');
    assert.match(gate.slice(0, 900), /bloqueado: true/);
  });

  it('sólo se aplica cuando se conocen unidad y taller', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("p === '/publico/taller/agendar'"),
      fuente.indexOf("p === '/publico/carretera/reportar'"),
    );
    // Con un VIN que la org no reconoce no se puede derivar modelo, y bloquear por eso
    // sería inventar una regla: ahí decide el Flow, como siempre.
    assert.match(bloque, /if \(vinPedido && clavePedida\)/);
    assert.match(bloque, /if \(unidad\?\.Product2Id\)/);
  });
});
