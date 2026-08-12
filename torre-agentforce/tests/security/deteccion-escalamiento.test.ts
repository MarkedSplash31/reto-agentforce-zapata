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

describe('la conversación escalada tiene salida', () => {
  // Encontrado el 11-ago-2026 recargando la página después de pedir un asesor: la
  // visita volvía con el asesor, el hilo aparecía VACÍO —lo que el cliente contó vive
  // como contexto interno del expediente y no cruza a su superficie— y no había forma
  // de volver con el asistente. Nada liberaba nunca `caseId`: tres sitios lo ponían y
  // ninguno lo quitaba. Un caso ya cerrado por el asesor seguía atrapando al cliente,
  // que escribía en un expediente desaparecido de la bandeja.

  it('el servidor pregunta por el caso antes de darlo por vigente', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("p === '/publico/sesion'"),
      fuente.indexOf("p === '/publico/acceso'"),
    );

    assert.match(
      bloque,
      /escalamiento\.estadoDeCaso\(sesion\.caseId\)/,
      'la sesión no puede afirmar que hay una persona atendiendo sin preguntárselo a la org',
    );
    assert.match(
      bloque,
      /sesion\.caseId = null/,
      'un caso cerrado tiene que soltarse: si no, el cliente le escribe a nadie',
    );
  });

  it('un fallo de red no suelta el caso', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("p === '/publico/sesion'"),
      fuente.indexOf("p === '/publico/acceso'"),
    );
    // Soltarlo porque la org no contestó mandaría al cliente con el asistente
    // teniendo una persona asignada, que es el defecto contrario y peor.
    assert.match(bloque, /} catch \{/, 'el fallo de la consulta debe quedar contenido');
    const traccatch = bloque.slice(bloque.indexOf('} catch {'));
    assert.doesNotMatch(
      traccatch.slice(0, 300),
      /sesion\.caseId = null/,
      'el catch no puede liberar el caso',
    );
  });

  it('el cliente puede empezar una consulta nueva', async () => {
    const fuente = await inicio();
    assert.match(
      fuente,
      /fetch\('\/publico\/salir', \{ method: 'POST' \}\)/,
      'sin salida, cada recarga devolvía al cliente con el asesor para siempre',
    );
    assert.match(fuente, /nueva\.hidden = false/, 'la salida se enseña cuando hay una persona asignada');
  });

  it('la reanudación no deja una ventana en blanco', async () => {
    const fuente = await inicio();
    assert.match(
      fuente,
      /pintados === 0/,
      'si no hay mensajes publicados hay que decir dónde está el caso, no dejar el hilo vacío',
    );
    assert.match(
      fuente,
      /sesion\.escalamientoCerrado/,
      'un caso cerrado se le dice al cliente en vez de devolverlo a él en silencio',
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

describe('credencial de demo del panel', () => {
  it('en produccion no existe: sin APP_ADMIN_PASS el acceso queda cerrado', async () => {
    const fuente = await readFile(new URL('../../src/servidor/visitante.ts', import.meta.url), 'utf8');
    const bloque = fuente.slice(fuente.indexOf('function claveEsperada'), fuente.indexOf('export function accesoAdminConfigurado'));

    // La credencial fija esta escrita en el repositorio a proposito. Lo que no puede
    // pasar nunca es que un despliegue real quede abierto con ella.
    assert.match(
      bloque,
      /if \(esProduccion\(\)\) return null;/,
      'produccion debe cerrar el acceso en vez de caer en la credencial de demo',
    );
    // Y el orden importa: APP_ADMIN_PASS se evalua ANTES que el entorno, para que
    // definirla gane en cualquier caso.
    assert.ok(
      bloque.indexOf('process.env.APP_ADMIN_PASS') < bloque.indexOf('esProduccion()'),
      'una APP_ADMIN_PASS definida debe ganar siempre sobre la de demo',
    );
  });

  it('se comporta: cierra en produccion, abre en demo, y lo definido gana', async () => {
    const { verificarClaveAdmin, accesoAdminConfigurado, CLAVE_DEMO_ASESOR } = await import(
      '../../src/servidor/visitante.ts'
    );
    const previoEnv = process.env.APP_ENV;
    const previoPass = process.env.APP_ADMIN_PASS;
    try {
      delete process.env.APP_ADMIN_PASS;

      process.env.APP_ENV = 'production';
      assert.equal(accesoAdminConfigurado(), false, 'produccion sin APP_ADMIN_PASS: cerrado');
      assert.equal(verificarClaveAdmin(CLAVE_DEMO_ASESOR), false, 'la de demo no puede abrir produccion');

      process.env.APP_ENV = 'development';
      assert.equal(accesoAdminConfigurado(), true, 'fuera de produccion la demo rige');
      assert.equal(verificarClaveAdmin(CLAVE_DEMO_ASESOR), true);
      assert.equal(verificarClaveAdmin('otra-cosa'), false);

      process.env.APP_ADMIN_PASS = 'una-contrasena-propia';
      assert.equal(verificarClaveAdmin('una-contrasena-propia'), true, 'lo definido debe ganar');
      assert.equal(verificarClaveAdmin(CLAVE_DEMO_ASESOR), false, 'y la de demo deja de servir');
    } finally {
      if (previoEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previoEnv;
      if (previoPass === undefined) delete process.env.APP_ADMIN_PASS;
      else process.env.APP_ADMIN_PASS = previoPass;
    }
  });

  it('no se imprime en la pantalla de acceso', async () => {
    const html = await readFile(new URL('../../publico/acceso.html', import.meta.url), 'utf8');
    const js = await readFile(new URL('../../publico/js/paginas/acceso.js', import.meta.url), 'utf8');
    const { CLAVE_DEMO_ASESOR } = await import('../../src/servidor/visitante.ts');

    // Documentarla en el README y anunciarla por consola le sirve a quien clona el
    // repositorio. Ponerla en la pagina se la regalaria a cualquier visitante de un
    // despliegue, que es una cosa muy distinta.
    assert.ok(!html.includes(CLAVE_DEMO_ASESOR), 'acceso.html no debe llevar la credencial');
    assert.ok(!js.includes(CLAVE_DEMO_ASESOR), 'acceso.js no debe llevar la credencial');
  });
});

describe('la home del cliente vista por un asesor', () => {
  it('le asigna correlación aunque su sesión no naciera de una visita', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf('function sesionVisitante'),
      fuente.indexOf('function vista'),
    );

    // `/publico/acceso` crea la sesión del asesor sin correlación, porque entrar al
    // panel no es una visita. Si el asesor abría luego «Postventa» en la barra, la
    // apertura de conversación llamaba a `abrirSesion(null)` y el asistente se
    // reportaba como no disponible: roto sólo para quien atiende.
    assert.match(
      bloque,
      /if \(!actual\.correlationId\) actual\.correlationId = randomUUID\(\);/,
      'toda sesión que vaya a conversar necesita correlación, venga de donde venga',
    );
  });
});

describe('nada de negocio escrito a mano en la página', () => {
  it('el conteo de talleres se calcula desde la respuesta de la org', async () => {
    const fuente = await inicio();
    assert.doesNotMatch(fuente, /Nueve talleres/, 'un conteo literal deja de ser cierto solo');
    assert.match(fuente, /const cuantos = d\.sucursales\?\.length \?\? 0;/);
  });

  it('no queda ningún teléfono literal en el frontend', async () => {
    const sistema = await readFile(new URL('../../publico/js/sistema.js', import.meta.url), 'utf8');
    const paginaInicio = await inicio();
    // El que había —(55) 2122-0370— es real y sale del sitio público de Zapata, pero no
    // existe en la org: la app lo afirmaba por su cuenta. Los teléfonos que se ven son
    // los de `Sucursal__c.Telefono__c`, interpolados por tarjeta.
    for (const [nombre, texto] of [['sistema.js', sistema], ['inicio.js', paginaInicio]] as const) {
      assert.doesNotMatch(texto, /tel:\+?\d{8,}/, `${nombre} no debe llevar un teléfono literal`);
    }
    assert.match(paginaInicio, /href="tel:\$\{/, 'los de las tarjetas salen del catálogo');
  });
});

describe('la redaccion no puede entrar al flujo de datos', () => {
  it('exigirJson parsea el cuerpo ORIGINAL, no el redactado', async () => {
    const fuente = await readFile(new URL('../../src/servidor/agente.ts', import.meta.url), 'utf8');
    const inicio = fuente.indexOf('function exigirJson');
    const bloque = fuente.slice(inicio, inicio + 900);

    // Esta era la causa de los 400 «intermitentes». `exigirJson` redactaba la respuesta
    // y parseaba el resultado, asi que el sessionId salia con `[REDACTED_PHONE]` dentro
    // cada vez que su timestamp UUIDv7 se parecia a un telefono. La app pedia entonces
    // /sessions/<id-roto>/messages y Jetty contestaba 400 Illegal Path Character antes
    // de enrutar. ~1 de cada 7 turnos. Medido y corregido el 11-ago-2026.
    assert.match(bloque, /const json = intentarJson\(texto\);/, 'se parsea el texto tal cual llego');
    assert.doesNotMatch(
      bloque,
      /intentarJson\(\s*(redactado|seguroParaLog)/,
      'parsear lo redactado corrompe los identificadores que vienen en la respuesta',
    );
  });

  it('la clasificacion de errores tambien mira el cuerpo original', async () => {
    const fuente = await readFile(new URL('../../src/servidor/agente.ts', import.meta.url), 'utf8');
    const bloque = fuente.slice(
      fuente.indexOf('function lanzarPorRespuesta'),
      fuente.indexOf('const detalle: DetalleAgentAPI'),
    );
    // Mismo defecto: clasificar sobre el redactado dejaba `codigoSalesforce` vacio justo
    // cuando mas falta hacia para diagnosticar.
    assert.match(bloque, /intentarJson\(original\)/);
  });

  it('un sessionId deformado se rechaza al recibirlo, no al usarlo', async () => {
    const fuente = await readFile(new URL('../../src/servidor/agente.ts', import.meta.url), 'utf8');
    assert.match(
      fuente,
      /if \(sessionId && !tieneFormaDeUuid\(sessionId\)\)/,
      'sin esta guarda, una corrupcion vuelve a manifestarse como un 400 opaco muy lejos de su origen',
    );
    // Y la comprobacion debe admitir UUIDv7: los sessionId de la Agent API empiezan por
    // un timestamp, y `esUUID` —que solo acepta v1..v5— los rechazaba todos.
    const forma = fuente.slice(fuente.indexOf('function tieneFormaDeUuid'));
    assert.doesNotMatch(forma.slice(0, 300), /\[1-5\]/, 'no puede exigir version 1..5');
  });

  it('las esperas de propagacion ya no cargan con el peso de aquel diagnostico', async () => {
    const fuente = await readFile(new URL('../../src/servidor/agente.ts', import.meta.url), 'utf8');
    assert.match(fuente, /const MS_PROPAGACION_SESION = 0;/, '35/35 turnos medidos sin espera');
    assert.match(
      fuente,
      /const ESPERAS_PROPAGACION = \[1_000, 3_000\] as const;/,
      'red de seguridad de 4 s, no la escalera de 21 s que solo repetia un id roto',
    );
  });
});

describe('coste por turno contra la org', () => {
  it('el navegador no sondea el estado del agente antes de cada mensaje', async () => {
    const fuente = await inicio();
    // Ese sondeo ABRIA Y CERRABA una sesion real por mensaje. Acumuladas, son
    // exactamente las que hacen que la org empiece a rechazar las nuevas con 400.
    assert.doesNotMatch(
      fuente,
      /agente\/estado/,
      'la pagina de cliente no debe pedir /publico/agente/estado: gasta una sesion y no decide nada',
    );
    assert.match(
      fuente,
      /fetch\('\/publico\/agente\/abrir', \{ method: 'POST' \}\)/,
      'la disponibilidad se comprueba abriendo la conversacion, que ademas la deja caliente',
    );
  });

  it('la apertura no gasta una sesion de sonda', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("p === '/publico/agente/abrir'"),
      fuente.indexOf("p === '/publico/agente/mensaje'"),
    );
    assert.match(
      bloque,
      /estadoAgentAPI\(\{ sondear: false \}\)/,
      'quien va a abrir su propia sesion no necesita otra para sondear',
    );
  });

  it('una conversacion precalentada que envejecio se cambia antes de usarla', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(
      fuente.indexOf("p === '/publico/agente/mensaje'"),
      fuente.indexOf("p === '/publico/agente/cerrar'"),
    );
    // Precalentar deja la sesion abierta entre la carga de la pagina y el primer
    // mensaje. Observado: ~2 minutos despues, 400 al primer turno.
    assert.match(bloque, /sesionEnvejecidaSinUso\(sesion\.agentSessionId, MS_SESION_PRECALENTADA_CADUCA\)/);

    const agenteFuente = await readFile(new URL('../../src/servidor/agente.ts', import.meta.url), 'utf8');
    const helper = agenteFuente.slice(agenteFuente.indexOf('export function sesionEnvejecidaSinUso'));
    assert.match(
      helper.slice(0, 400),
      /if \(!sesion \|\| sesion\.tuvoTurnoExitoso\) return false;/,
      'una sesion que ya converso no se descarta jamas: perderia el hilo en curso',
    );
  });

  it('el escalamiento se toma de la traza en vez de una segunda SOQL', async () => {
    const fuente = await rutas();
    const bloque = fuente.slice(fuente.indexOf('const emitirActividadReal'));
    assert.match(bloque, /casoEnLaTraza \?\?/, 'la SOQL extra solo debe correr si la traza no trajo el caso');
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
