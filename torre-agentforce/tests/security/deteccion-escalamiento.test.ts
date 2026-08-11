// Por qué el cliente se quedaba hablando con el asistente después de que el agente ya
// lo había escalado.
//
// Encontrado el 11-ago-2026 conduciendo el navegador contra la org real: el agente
// ejecutó `Escalar_Asesor_Humano`, Apex creó el Case 00001116 en la cola Escalamiento
// Postventa con el `Correlation_Id__c` correcto, y la ventana siguió diciendo
// «Asistente de postventa · En línea». El cliente escribía al asistente mientras un
// asesor tenía su caso abierto y sin poder alcanzarlo.
//
// La causa no era un fallo de Salesforce ni del agente. El navegador decidía si hubo
// escalamiento recorriendo `d.resultados` —`message.result` de la Agent API— buscando
// un nombre de acción. Ese arreglo **siempre llega vacío**: el propio
// docs/CONTRATO-AGENT-API.md dice que la secuencia de acciones sólo se obtiene con
// Export Session Tracing Data o con el Testing API. La detección no podía dispararse
// nunca, y el mismo arreglo alimentaba el panel de apoyo visual, que por eso tampoco
// pintó jamás una tarjeta de acción.
//
// Este archivo fija la corrección: la autoridad sobre «esto ya es de una persona» es
// el servidor releyendo Salesforce, no el navegador interpretando la respuesta.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';

const rutas = () => readFile(new URL('../../src/servidor/rutas-publicas.ts', import.meta.url), 'utf8');
const inicio = () => readFile(new URL('../../publico/js/paginas/inicio.js', import.meta.url), 'utf8');

describe('detección de escalamiento', () => {
  it('el servidor relee el Case de la correlación al cerrar el turno', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(fuente.indexOf('emitirActividadReal'));

    assert.match(
      bloque,
      /escalamiento\.escalamientoDeCorrelacion\(sesion\.correlationId!\)/,
      'el turno debe preguntarle a Salesforce si la correlación ya tiene un Case',
    );
    assert.match(
      bloque,
      /emitir\('Escalado'/,
      'el servidor debe avisar al navegador con un evento propio, no dejarlo deducirlo',
    );
    assert.match(
      bloque,
      /sesion\.caseId = abierto\.caseId/,
      'la sesión del servidor debe adoptar el caso: sin eso, /publico/asesor/* sigue cerrado',
    );
  });

  it('el navegador ya no busca el escalamiento en message.result', async () => {
    const fuente = await inicio();

    // La regresión exacta: un `for (const r of d.resultados)` comparando nombres de
    // acción contra una expresión regular. Si vuelve, vuelve el defecto.
    assert.doesNotMatch(
      fuente,
      /ACCION_ESCALA/,
      'la heurística sobre nombres de acción no puede volver: message.result llega vacío',
    );
    assert.match(
      fuente,
      /tipo === 'Escalado'/,
      'el cambio de interlocutor debe colgar del evento que manda el servidor',
    );
  });

  it('el cambio de interlocutor se aplica al terminar el turno, no a media respuesta', async () => {
    const fuente = await inicio();

    // Cambiar la ventana mientras el texto sigue llegando dejaba la última respuesta
    // del asistente a medias y con la cabecera ya cambiada a «Asesor de postventa».
    assert.match(
      fuente,
      /escaladoEn = d;/,
      'el evento se anota durante el stream',
    );
    assert.match(
      fuente,
      /if \(escaladoEn\) adoptarAsesor\(escaladoEn\.caseNumber\);/,
      'y se aplica después de cerrar el turno',
    );
  });
});

describe('apertura de la conversación', () => {
  it('el saludo se manda una sola vez por visita', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf('const abrirSiHaceFalta'),
      fuente.indexOf('const emitirActividadReal'),
    );

    // Cuando Salesforce entrega una sesión inservible, la app la descarta y abre otra.
    // Esa segunda trae su propia bienvenida: sin la guarda, el cliente leía el mismo
    // saludo dos veces —tres con el que pinta la página— antes de una sola respuesta.
    assert.match(
      bloque,
      /if \(sesion\.saludado\) return;/,
      'la reapertura de una sesión inservible no puede volver a saludar',
    );
    assert.match(bloque, /sesion\.saludado = true;/, 'la bandera debe quedar marcada al saludar');
  });

  it('la página sustituye su saludo de cortesía por el del agente', async () => {
    const fuente = await inicio();
    assert.match(
      fuente,
      /saludoLocal\.textContent = d\.texto;/,
      'la bienvenida real debe reemplazar al saludo local en vez de apilarse debajo',
    );
  });
});

describe('actividad del agente', () => {
  it('se relee de Log_Agente__c y no de la respuesta del modelo', async () => {
    const fuente = await readFile(new URL('../../src/servidor/actividad.ts', import.meta.url), 'utf8');

    assert.match(fuente, /FROM Log_Agente__c WHERE Correlation_Id__c/, 'la fuente es la traza de la org');

    // Sólo el código: la cabecera del módulo nombra `message.result` justamente para
    // explicar por qué NO se usa, y hacer fallar la prueba por esa explicación sería
    // castigar el comentario que impide repetir el error.
    const codigo = fuente
      .split('\n')
      .filter((linea) => !/^\s*(\/\/|\*|\/\*)/.test(linea))
      .join('\n');
    assert.doesNotMatch(
      codigo,
      /\bresultados\b|\['result'\]|\.result\b/,
      'no puede volver a depender del arreglo que la Agent API entrega vacío',
    );
  });

  it('no repite una tarjeta ya enviada al navegador', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(fuente.indexOf('const emitirActividadReal'));
    assert.match(
      bloque,
      /sesion\.actividadVista\.add\(a\.folio\)/,
      'sin memoria de folios, cada turno repite toda la actividad anterior',
    );
  });
});

describe('herramienta de consulta del asesor', () => {
  it('usa una correlación propia y no la del cliente', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(fuente.indexOf("sufijo === 'consultar'"));

    assert.match(
      bloque,
      /sesionAsesor\.correlationId = randomUUID\(\)/,
      'la consulta del asesor no puede correr bajo la correlación del cliente: si el ' +
        'asistente escalara durante la consulta, tocaría el caso del cliente',
    );
    assert.match(
      bloque,
      /exigirSesion\(ctx\.cookies, 'admin'\)/,
      'la herramienta es del asesor autenticado, no de cualquier visitante',
    );
  });

  it('no escribe nada en el expediente del cliente', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("sufijo === 'consultar'"),
      fuente.indexOf("sufijo === 'responder'"),
    );

    assert.doesNotMatch(
      bloque,
      /escalamiento\.responder|escribirComentarios/,
      'lo que el cliente recibe lo decide el asesor al responder, no la consulta',
    );
  });
});

describe('cierre de sesión del asesor', () => {
  it('cierra también su conversación con el asistente', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("p === '/publico/salir'"),
      fuente.indexOf("p === '/publico/sucursales'"),
    );

    // Las sesiones de Agent API acumuladas hacen que la org empiece a rechazar las
    // nuevas con 400. Ya había pasado con las del cliente; la del asesor nacía con el
    // mismo defecto.
    assert.match(bloque, /agente\.cerrarSesion\(sesionAgente, 'UserRequest'\)/);
    assert.match(bloque, /agente\.descartarSesion\(sesionAgente\)/, 'si la org no confirma, no se deja contada como viva');
  });
});
