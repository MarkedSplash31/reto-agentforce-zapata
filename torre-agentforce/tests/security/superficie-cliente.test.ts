// Lo que la superficie de clientes NO debe dejar salir, y los tiempos del socket.
//
// Las dos cosas que fija este archivo se rompieron de verdad y en silencio:
//
//   1. `/publico/asesor/conversacion` devolvía TODOS los CaseComment del expediente,
//      incluidos los que Apex inserta con IsPublished=false: el resumen escrito para
//      el asesor, el contexto estructurado con sus huellas y los Ids internos de
//      Asset y WorkOrder. Un visitante sin cuenta los leía enteros.
//
//   2. `keepAliveTimeout` valía los 5 s que trae Node, por debajo de la ventana en
//      la que un cliente reutiliza el socket. El resultado era un ECONNRESET
//      intermitente que parecía un fallo de la aplicación y no lo era.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('vista de conversación del cliente', () => {
  it('el filtro de publicados va en el SOQL, no en el mapeo', async () => {
    const { readFile } = await import('node:fs/promises');
    const fuente = await readFile(new URL('../../src/servidor/escalamiento.ts', import.meta.url), 'utf8');

    // Traer los comentarios internos y descartarlos después dejaría la fuga a un
    // refactor de distancia. Tienen que quedar fuera de la consulta.
    assert.match(
      fuente,
      /soloPublicados \? `AND IsPublished = true `/,
      'conversacion() debe filtrar IsPublished en la consulta cuando la vista es del cliente',
    );
  });

  it('la ruta pública pide explícitamente sólo lo publicado', async () => {
    const { readFile } = await import('node:fs/promises');
    const fuente = await readFile(new URL('../../src/servidor/rutas-publicas.ts', import.meta.url), 'utf8');

    const ruta = fuente.slice(fuente.indexOf("p === '/publico/asesor/conversacion'"));
    // Hasta la ruta siguiente: el bloque tiene dos `return true;` y cortar en el
    // primero dejaba fuera justamente la línea que interesa.
    const bloque = ruta.slice(0, ruta.indexOf("p === '/publico/asesor/responder'"));
    assert.match(
      bloque,
      /conversacion\(sesion\.caseId, \{ soloPublicados: true \}\)/,
      'la superficie de clientes no puede pedir la conversación completa',
    );
  });

  it('el panel del asesor sí conserva la vista completa', async () => {
    const { readFile } = await import('node:fs/promises');
    const fuente = await readFile(new URL('../../src/servidor/rutas-publicas.ts', import.meta.url), 'utf8');

    const panel = fuente.slice(fuente.indexOf("p.startsWith('/publico/panel/caso/')"));
    assert.match(
      panel,
      /json\(res, 200, await escalamiento\.conversacion\(caseId\)\)/,
      'el asesor necesita las notas internas: son suyas',
    );
  });
});

describe('tiempos del socket HTTP', () => {
  it('keepAlive queda por debajo de headers, y headers por debajo de request', async () => {
    const { readFile } = await import('node:fs/promises');
    const fuente = await readFile(new URL('../../src/servidor/index.ts', import.meta.url), 'utf8');

    // Node cierra conexiones sanas si headersTimeout <= keepAliveTimeout, y el orden
    // se rompe con un descuido de una línea. Se fija aquí.
    assert.match(fuente, /servidor\.keepAliveTimeout = securityConfig\.keepAliveTimeoutMs;/);
    assert.match(fuente, /servidor\.headersTimeout = servidor\.keepAliveTimeout \+ 5_000;/);
    assert.match(
      fuente,
      /servidor\.requestTimeout = Math\.max\(\s*securityConfig\.requestTimeoutMs,\s*servidor\.headersTimeout \+ 5_000,?\s*\);/,
    );
  });

  it('el valor por omisión de keepAlive supera la ventana de reutilización de un cliente', async () => {
    const { loadSecurityConfig } = await import('../../src/servidor/security.ts');
    const config = loadSecurityConfig({
      APP_ENV: 'development',
      APP_AUTH_PROVIDER: 'disabled',
      APP_AUTH_MODE: 'disabled',
    } as NodeJS.ProcessEnv);

    // Los clientes HTTP sueltan el socket ocioso alrededor de los 4 s y los
    // balanceadores alrededor de los 60 s. Quedarse por debajo devuelve la carrera.
    assert.ok(
      config.keepAliveTimeoutMs >= 60_000,
      `keepAliveTimeoutMs es ${config.keepAliveTimeoutMs}; por debajo de 60 s reaparece el ECONNRESET intermitente`,
    );
  });
});
