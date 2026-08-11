// Auditoría de N3 · conformidad de protocolo del cliente Agent API.
//
// QUÉ ES Y QUÉ NO ES ESTO — léelo antes de citar sus resultados:
//   · NO prueba por sí solo que la Agent API de Salesforce funcione. La disponibilidad
//     real se mide aparte con `npm run verificar:agent-api` contra api.salesforce.com.
//   · NO produce ni un solo dato de negocio. Aquí no hay Assets, ni casos, ni varadas,
//     ni respuestas de agente que puedan acabar en pantalla. Nada de lo que emite este
//     harness entra jamás en el camino de la app.
//   · SÍ ejercita el código de src/servidor/agente.ts contra un servidor HTTP de loopback
//     que habla el contrato de docs/CONTRATO-AGENT-API.md §3-§6: SSE real, cabeceras
//     reales, códigos reales, cuerpos reales. Es la única forma de comprobar EJECUTANDO
//     que el parser SSE, el ciclo de mensajes y el cierre no fallan en silencio.
//
// El token que se usa aquí lo emite este mismo harness (`TOKEN_SINTETICO`); no se pide
// nada al CLI ni a la org, así que ninguna credencial real toca este proceso. El harness
// además comprueba que ese token viaje SÓLO en la cabecera Authorization y que no
// aparezca en la evidencia escrita.
//
// Salida: 0 = todas las comprobaciones pasan · 1 = alguna falla (defecto del cliente).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// El servidor simulado tiene que hablar como el real. `abrirSesion` exige desde el
// 11-ago-2026 que el sessionId tenga forma de UUID: sin esa guarda, un identificador
// deformado no fallaba aqui sino mucho mas lejos, como un `400 Illegal Path Character`
// de Jetty que costo tres teorias equivocadas. Los identificadores de este verificador
// eran legibles ('ses-1') y por eso dejaron de pasar la puerta. Se conserva el nombre
// legible en la constante y el valor toma forma de UUID, para que un fallo siga
// diciendo de que sesion habla.
const SES_UNO = '00000000-0000-4000-8000-000000000001'; // ses-1
const SES_401 = '00000000-0000-4000-8000-000000000002'; // ses-401
const SES_CIERRE_CODIGO = '00000000-0000-4000-8000-000000000003'; // ses-cierre-codigo
const SES_CIERRE_RACE = '00000000-0000-4000-8000-000000000004'; // ses-cierre-race
const SES_EVIL = '00000000-0000-4000-8000-000000000005'; // ses-evil
const SES_LINKS_REALES = '00000000-0000-4000-8000-000000000006'; // ses-links-reales
const SES_INEXISTENTE = '00000000-0000-4000-8000-000000000007'; // ses-que-no-existe
const SES_SALUD = '00000000-0000-4000-8000-000000000008'; // ses-salud
const SES_SALUD_SIN_CIERRE = '00000000-0000-4000-8000-000000000009'; // ses-salud-sin-cierre


const TOKEN_SINTETICO = 'TOKEN-LOOPBACK-NO-ES-DE-SALESFORCE-8f3a1c';

// ─────────────────────────────────────────────────────────────────────────────
// Servidor de loopback que habla el contrato
// ─────────────────────────────────────────────────────────────────────────────

interface PeticionVista {
  recibidaEn: number;
  metodo: string;
  ruta: string;
  llevaBearer: boolean;
  tokenEsperado: boolean;
  razonFin: string | null;
  accept: string | null;
  cuerpo: unknown;
}

type Manejador = (req: IncomingMessage, res: ServerResponse, cuerpo: string) => void | Promise<void>;

let manejador: Manejador = (_req, res) => {
  res.writeHead(500).end('sin escenario');
};
let peticiones: PeticionVista[] = [];
let vecesToken = 0;

const servidor = createServer((req, res) => {
  const trozos: Buffer[] = [];
  req.on('data', (t: Buffer) => trozos.push(t));
  req.on('end', () => {
    void (async () => {
      const cuerpo = Buffer.concat(trozos).toString('utf8');
      const auth = req.headers['authorization'] ?? '';
      peticiones.push({
        recibidaEn: Date.now(),
        metodo: req.method ?? '',
        ruta: req.url ?? '',
        llevaBearer: auth.startsWith('Bearer '),
        // Se registra si COINCIDE, nunca el valor. Un log con el token sería el defecto
        // que este mismo harness busca.
        tokenEsperado: auth === `Bearer ${TOKEN_SINTETICO}`,
        razonFin: (req.headers['x-session-end-reason'] as string | undefined) ?? null,
        accept: (req.headers['accept'] as string | undefined) ?? null,
        cuerpo: cuerpo === '' ? null : intentar(cuerpo),
      });

      if ((req.url ?? '').startsWith('/services/oauth2/token')) {
        vecesToken += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: TOKEN_SINTETICO, instance_url: base, token_type: 'Bearer' }));
        return;
      }
      await manejador(req, res, cuerpo);
    })();
  });
});

function intentar(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch (e) {
    void e;
    return t;
  }
}

await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
const puerto = (servidor.address() as AddressInfo).port;
const base = `http://127.0.0.1:${puerto}`;

// El módulo lee config al importarse: hay que fijar el entorno ANTES del import.
process.env.NODE_ENV = 'development';
process.env.APP_ENV = 'development';
process.env.APP_AUTH_MODE = 'disabled';
process.env.SF_AGENT_API_HOST = base;
process.env.SF_LOGIN_URL = base;
process.env.SF_TOKEN_PROVIDER = 'client_credentials';
process.env.SF_CLIENT_ID = 'harness-loopback';
process.env.SF_CLIENT_SECRET = 'harness-loopback';

const agente = await import('../src/servidor/agente.ts');
const { ErrorAgentAPI } = agente;

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de aserción
// ─────────────────────────────────────────────────────────────────────────────

interface Comprobacion {
  caso: string;
  afirmacion: string;
  ok: boolean;
  observado: unknown;
}

const comprobaciones: Comprobacion[] = [];
const transcripcion: string[] = [];

function decir(l = ''): void {
  transcripcion.push(l);
  console.log(l);
}

let casoActual = '';
function caso(nombre: string): void {
  casoActual = nombre;
  peticiones = [];
  decir();
  decir(`── ${nombre}`);
}

function afirmar(afirmacion: string, ok: boolean, observado?: unknown): void {
  comprobaciones.push({ caso: casoActual, afirmacion, ok, observado: observado ?? null });
  decir(`   ${ok ? 'PASA ' : 'FALLA'} ${afirmacion}`);
  if (!ok) decir(`         observado: ${JSON.stringify(observado ?? null)}`);
}

function claseDe(e: unknown): string {
  return e instanceof ErrorAgentAPI ? e.clase : e instanceof Error ? `sin clasificar (${e.name})` : 'no-error';
}

async function capturar(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    const v = await fn();
    return { sinError: true, valor: v };
  } catch (e) {
    return e;
  }
}

function comoValor<T>(resultado: unknown): T | null {
  if (typeof resultado !== 'object' || resultado === null || !('sinError' in resultado)) return null;
  return (resultado as { valor?: T }).valor ?? null;
}

function sse(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
}

function cuerpoSesion(sessionId: string, prefijo = base): unknown {
  return {
    sessionId,
    _links: {
      messages: { href: `${prefijo}/einstein/ai-agent/v1/sessions/${sessionId}/messages` },
      messagesStream: { href: `${prefijo}/einstein/ai-agent/v1/sessions/${sessionId}/messages/stream` },
      end: { href: `${prefijo}/einstein/ai-agent/v1/sessions/${sessionId}` },
    },
    messages: [
      {
        type: 'Inform',
        id: 'm-0',
        planId: 'plan-0',
        message: 'Sesión iniciada por el harness de protocolo.',
        result: [],
        citedReferences: [],
      },
    ],
  };
}

function json(res: ServerResponse, status: number, cuerpo: unknown, tipo = 'application/json'): void {
  res.writeHead(status, { 'Content-Type': tipo });
  res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
}

/**
 * Un id de sesión con forma de UUID derivado del nombre del caso.
 *
 * El servidor simulado no puede inventar un identificador libre: `abrirSesion` exige
 * forma de UUID (ver el bloque de constantes de arriba). Se deriva del sufijo en vez de
 * sortearlo para que dos corridas del verificador produzcan el mismo id y un fallo se
 * pueda reproducir tal cual.
 */
function idDeSesion(sufijo: string): string {
  const h = createHash('sha1').update(sufijo).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Abre una sesión válida y devuelve su id; se usa como preámbulo de varios casos.
async function abrirSesionValida(sufijo: string): Promise<string> {
  manejador = (_req, res) => json(res, 200, cuerpoSesion(idDeSesion(sufijo)));
  const s = await agente.abrirSesion(randomUUID());
  return s.sessionId;
}

decir('Torre Agentforce — auditoría N3: conformidad de protocolo (servidor de loopback)');
decir(`base            ${base}`);
decir('ATENCIÓN: esto NO mide la disponibilidad de la Agent API real. Ver cabecera del script.');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Ciclo feliz completo: abrir → stream → sync → cerrar
// ─────────────────────────────────────────────────────────────────────────────

caso('1. ciclo completo del contrato §3-§6');
{
  manejador = (req, res) => {
    const url = req.url ?? '';
    if (req.method === 'POST' && url.endsWith('/sessions')) return json(res, 200, cuerpoSesion(SES_UNO));
    if (req.method === 'POST' && url.endsWith('/messages/stream')) {
      sse(res);
      res.write(': latido\n\n');
      res.write(
        'event: ProgressIndicator\ndata: {"timestamp":1,"traceId":"tr-1","message":{"type":"ProgressIndicator","id":"p1","message":"Buscando"}}\n\n',
      );
      res.write(
        'event: TextChunk\ndata: {"timestamp":2,"traceId":"tr-1","message":{"type":"TextChunk","id":"c1","message":"Hola "}}\n\n',
      );
      res.write(
        'event: TextChunk\ndata: {"timestamp":3,"traceId":"tr-1","message":{"type":"TextChunk","id":"c2","message":"mundo"}}\n\n',
      );
      res.write(
        'event: Inform\ndata: {"timestamp":4,"traceId":"tr-1","message":{"type":"Inform","id":"i1","planId":"plan-7",' +
          '"message":"Listo","result":[{"function":"Crear_Reporte_Varada","status":"ok"}],' +
          '"citedReferences":[{"type":"Knowledge","value":"ka-1"}]}}\n\n',
      );
      res.write('event: EndOfTurn\ndata: {"timestamp":5,"message":{"type":"EndOfTurn","id":"e1"}}\n\n');
      // No se cierra el flujo: el turno debe cerrarse por EndOfTurn, no por fin de socket.
      return;
    }
    if (req.method === 'POST' && url.endsWith('/messages')) {
      return json(res, 200, {
        messages: [{ type: 'Inform', id: 'i2', planId: 'plan-8', message: 'De nada', result: [], citedReferences: [] }],
      });
    }
    if (req.method === 'DELETE') return json(res, 200, { messages: [{ type: 'SessionEnded', reason: 'ClientRequest' }] });
    return json(res, 500, { error: 'ruta no prevista en el escenario' });
  };

  const sesion = await agente.abrirSesion(randomUUID());
  afirmar('abrirSesion devuelve el sessionId del servidor', sesion.sessionId === SES_UNO, sesion.sessionId);
  afirmar('abrirSesion expone los _links del contrato', Object.keys(sesion.enlaces).sort().join(',') === 'end,messages,messagesStream', Object.keys(sesion.enlaces));
  afirmar('el mensaje de bienvenida se mapea', sesion.mensajesIniciales.length === 1 && sesion.mensajesIniciales[0]?.tipo === 'Inform', sesion.mensajesIniciales.map((m) => m.tipo));
  afirmar('el DTO de sesión no expone la respuesta cruda', !Object.hasOwn(sesion, 'crudo'), Object.keys(sesion));
  const inicio = peticiones.find((p) => p.metodo === 'POST' && p.ruta.endsWith('/sessions'));
  const cuerpoInicio = inicio?.cuerpo as { variables?: Array<Record<string, unknown>> } | undefined;
  afirmar(
    'Start Session fija la correlación server-side como $Context.RoutableId',
    cuerpoInicio?.variables?.length === 1 &&
      cuerpoInicio.variables[0]?.name === '$Context.RoutableId' &&
      cuerpoInicio.variables[0]?.type === 'Text' &&
      cuerpoInicio.variables[0]?.value === sesion.externalSessionKey,
    cuerpoInicio?.variables,
  );

  const eventos: unknown[] = [];
  const tipos: string[] = [];
  let texto = '';
  const abiertaAlClienteEn = Date.now();
  const inicioSecuencias = Date.now();
  for await (const ev of agente.enviarMensajeStream(sesion.sessionId, 'hola', { msInactividad: 4000 })) {
    eventos.push(ev);
    tipos.push(ev.tipo);
    if (ev.tipo === 'TextChunk') texto += ev.texto ?? '';
  }
  afirmar('el stream entrega los 5 eventos y corta en EndOfTurn', tipos.join(',') === 'ProgressIndicator,TextChunk,TextChunk,Inform,EndOfTurn', tipos);
  afirmar('los TextChunk se concatenan sin perder nada', texto === 'Hola mundo', texto);
  const inform = eventos.find((e) => (e as { tipo: string }).tipo === 'Inform') as
    | { planId: string | null; traceId: string | null; resultados: unknown[]; citedReferences: unknown[] }
    | undefined;
  afirmar('planId se conserva cuando Salesforce lo publica', inform?.planId === 'plan-7', inform?.planId);
  afirmar('traceId llega al evento', inform?.traceId === 'tr-1', inform?.traceId);
  afirmar('message.result llega al evento (funciones invocadas)', inform?.resultados.length === 1, inform?.resultados);
  afirmar('citedReferences llega al evento', inform?.citedReferences.length === 1, inform?.citedReferences);
  afirmar('los DTO de evento no exponen payload crudo', eventos.every((e) => !Object.hasOwn(e as object, 'crudo')));

  const sinc = await agente.enviarMensajeSync(sesion.sessionId, 'gracias');
  const finSecuencias = Date.now();
  afirmar('enviarMensajeSync devuelve el texto del turno', sinc.texto === 'De nada', sinc.texto);
  afirmar('el DTO síncrono no expone la respuesta cruda', !Object.hasOwn(sinc, 'crudo'), Object.keys(sinc));

  const cerrada = await agente.cerrarSesion(sesion.sessionId, 'UserRequest');
  afirmar('cerrarSesion mapea el SessionEnded', cerrada.eventos[0]?.tipo === 'SessionEnded', cerrada.eventos.map((e) => e.tipo));
  afirmar('el DTO de cierre no expone la respuesta cruda', !Object.hasOwn(cerrada, 'crudo'), Object.keys(cerrada));

  const envios = peticiones.filter((p) => p.ruta.includes('/messages'));
  // Antes esto exigía lo contrario: que el primer turno esperara ~1 s a que la sesión
  // «propagara». Ese retraso se puso creyendo que los 400 intermitentes venían de una
  // sesión todavía no visible en la puerta. El 11-ago-2026 se midió la causa real —la
  // app corrompía el propio sessionId al redactarlo para el log y pedía una URL con
  // corchetes dentro, que Jetty rechaza— y la espera quedó en cero, porque sólo añadía
  // demora al mismo identificador roto. Lo que se fija ahora es justamente eso: que no
  // vuelva a colarse una espera artificial delante del primer turno del cliente.
  afirmar(
    'la primera operación no espera propagación: sale de inmediato',
    (envios[0]?.recibidaEn ?? 0) - abiertaAlClienteEn < 500,
    (envios[0]?.recibidaEn ?? 0) - abiertaAlClienteEn,
  );
  const secuencias = envios.map(
    (p) => (p.cuerpo as { message?: { sequenceId?: number } })?.message?.sequenceId,
  );
  afirmar(
    'sequenceId usa epoch-ms y crece estrictamente incluso si dos mensajes salen en el mismo milisegundo',
    secuencias.length === 2 &&
      secuencias.every(
        (id) =>
          Number.isSafeInteger(id) &&
          (id as number) >= inicioSecuencias &&
          (id as number) <= finSecuencias + 1,
      ) &&
      (secuencias[1] as number) > (secuencias[0] as number),
    secuencias,
  );
  afirmar('el stream pide Accept: text/event-stream', peticiones.find((p) => p.ruta.endsWith('/stream'))?.accept === 'text/event-stream', peticiones.find((p) => p.ruta.endsWith('/stream'))?.accept);
  const del = peticiones.find((p) => p.metodo === 'DELETE');
  afirmar('el DELETE lleva x-session-end-reason (obligatorio §6)', del?.razonFin === 'UserRequest', del?.razonFin);
  afirmar('todas las peticiones a la Agent API llevan el token en Authorization', peticiones.filter((p) => p.ruta.includes('/einstein/')).every((p) => p.tokenEsperado), peticiones.filter((p) => p.ruta.includes('/einstein/')).map((p) => p.llevaBearer));
  afirmar('la sesión cerrada deja de estar registrada', !agente.sesionesActivas().some((s) => s.sessionId === SES_UNO), agente.sesionesActivas().map((s) => s.sessionId));
}

// ─── Enlaces observados en la colección oficial ───────────────────────────────────────────────────────────

caso('1b. _links real no confunde el endpoint streaming con el síncrono');
{
  peticiones = [];
  manejador = (req, res) => {
    const url = req.url ?? '';
    if (req.method === 'POST' && url.endsWith('/agents/0XxgK0000022RhJSAU/sessions')) {
      return json(res, 200, {
        sessionId: SES_LINKS_REALES,
        _links: {
          // Así responde la colección oficial: `messages` apunta a streaming y
          // no existe una clave `messagesStream` separada.
          messages: { href: `${base}/einstein/ai-agent/v1/sessions/ses-links-reales/messages/stream` },
          end: { href: `${base}/einstein/ai-agent/v1/sessions/ses-links-reales` },
        },
        messages: [{ type: 'Inform', message: 'inicio' }],
      });
    }
    if (req.method === 'POST' && url.endsWith('/messages')) {
      return json(res, 200, { messages: [{ type: 'Inform', message: 'ok' }] });
    }
    if (req.method === 'POST' && url.endsWith('/messages/stream')) {
      return json(res, 400, { errorCode: 'WRONG_ENDPOINT' });
    }
    if (req.method === 'DELETE') {
      return json(res, 200, { messages: [{ type: 'SessionEnded' }] });
    }
    return json(res, 500, { errorCode: 'UNEXPECTED_ROUTE' });
  };

  const sesion = await agente.abrirSesion(randomUUID());
  const respuesta = await capturar(() => agente.enviarMensajeSync(sesion.sessionId, 'x'));
  afirmar(
    'sync usa /messages canónico cuando el link `messages` recibido termina en /messages/stream',
    comoValor<{ texto: string }>(respuesta)?.texto === 'ok',
    claseDe(respuesta),
  );
  afirmar(
    'el request síncrono nunca se envió al endpoint /stream',
    peticiones.some((p) => p.metodo === 'POST' && p.ruta.endsWith('/messages')) &&
      !peticiones.some((p) => p.metodo === 'POST' && p.ruta.endsWith('/messages/stream')),
    peticiones.map((p) => `${p.metodo} ${p.ruta}`),
  );
  await agente.cerrarSesion(sesion.sessionId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. El flujo se corta ANTES de EndOfTurn — turno truncado
// ─────────────────────────────────────────────────────────────────────────────

caso('2. el SSE se corta sin EndOfTurn (turno truncado)');
{
  const sid = await abrirSesionValida('trunc');
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/messages/stream')) {
      sse(res);
      res.write('event: TextChunk\ndata: {"message":{"type":"TextChunk","id":"c1","message":"La cobertura de tu"}}\n\n');
      res.end(); // el servidor se cae a media frase
      return;
    }
    return json(res, 500, { error: 'ruta no prevista' });
  };

  const vistos: string[] = [];
  const r = await capturar(async () => {
    for await (const ev of agente.enviarMensajeStream(sid, 'x', { msInactividad: 4000 })) vistos.push(ev.tipo);
  });
  afirmar(
    'un turno cortado a media frase LANZA en vez de darse por terminado',
    r instanceof Error,
    r instanceof Error ? `${claseDe(r)}: ${r.message.slice(0, 160)}` : { seEntregoComoCompleto: vistos },
  );
  afirmar('y los fragmentos recibidos se entregan antes de lanzar', vistos.includes('TextChunk'), vistos);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Evento Error dentro del stream
// ─────────────────────────────────────────────────────────────────────────────

caso('3. el agente emite un evento Error a mitad del turno');
{
  const sid = await abrirSesionValida('err');
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/messages/stream')) {
      sse(res);
      res.write('event: TextChunk\ndata: {"message":{"type":"TextChunk","id":"c1","message":"Un momento"}}\n\n');
      res.write('event: Error\ndata: {"message":{"type":"Error","id":"x1","message":"El planner falló al invocar la acción"}}\n\n');
      res.end();
      return;
    }
    return json(res, 500, { error: 'ruta no prevista' });
  };

  const vistos: string[] = [];
  const r = await capturar(async () => {
    for await (const ev of agente.enviarMensajeStream(sid, 'x', { msInactividad: 4000 })) vistos.push(ev.tipo);
  });
  afirmar(
    'un evento Error del agente LANZA (no se pinta como un mensaje más)',
    r instanceof Error,
    r instanceof Error ? `${claseDe(r)}: ${r.message.slice(0, 160)}` : { seEntregoComoNormal: vistos },
  );
  afirmar('el evento Error igual se entrega para que quede en la traza', vistos.includes('Error'), vistos);
}

caso('3b. SessionEnded en SSE limpia el registro local');
{
  const sid = await abrirSesionValida('fin-en-stream');
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/messages/stream')) {
      sse(res);
      res.write('event: SessionEnded\ndata: {"message":{"type":"SessionEnded","id":"fin"}}\n\n');
      return;
    }
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const vistos: string[] = [];
  for await (const ev of agente.enviarMensajeStream(sid, 'x', { msInactividad: 4000 })) {
    vistos.push(ev.tipo);
  }
  afirmar('el consumidor recibe SessionEnded', vistos.join(',') === 'SessionEnded', vistos);
  afirmar(
    'SessionEnded elimina la sesión del registro sin requerir otro DELETE',
    !agente.sesionesActivas().some((s) => s.sessionId === sid),
    agente.sesionesActivas().map((s) => s.sessionId),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 200 sin `messages` en la respuesta síncrona
// ─────────────────────────────────────────────────────────────────────────────

caso('4. respuesta síncrona 200 sin messages');
{
  const sid = await abrirSesionValida('vacio');
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/messages')) return json(res, 200, { algo: 'que no es el contrato' });
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const r = await capturar(() => agente.enviarMensajeSync(sid, 'x'));
  afirmar(
    'un 200 sin messages LANZA en vez de devolver un turno vacío',
    r instanceof Error,
    r instanceof Error ? `${claseDe(r)}: ${r.message.slice(0, 160)}` : r,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Clasificación de códigos HTTP — incluido el 403 que la org nunca alcanza
// ─────────────────────────────────────────────────────────────────────────────

caso('5. clasificación de fallos HTTP');
{
  const tabla: Array<{ nombre: string; status: number; cuerpo: unknown; tipo?: string; clase: string }> = [
    { nombre: '404 con cuerpo vacío', status: 404, cuerpo: '', clase: 'gateway_sin_ruta' },
    { nombre: '403 (token sin scopes)', status: 403, cuerpo: [{ errorCode: 'FORBIDDEN', message: 'no' }], clase: 'credencial_sin_scopes' },
    { nombre: '404 con error JSON', status: 404, cuerpo: [{ errorCode: 'NOT_FOUND', message: 'agente' }], clase: 'recurso_no_encontrado' },
    { nombre: '404 con HTML', status: 404, cuerpo: '<html>404</html>', tipo: 'text/html', clase: 'recurso_no_encontrado' },
    { nombre: '400 petición inválida', status: 400, cuerpo: [{ errorCode: 'INVALID_SEQUENCE' }], clase: 'peticion_invalida' },
    { nombre: '429 límite', status: 429, cuerpo: [{ errorCode: 'REQUEST_LIMIT_EXCEEDED' }], clase: 'salesforce' },
    { nombre: '500 de Salesforce', status: 500, cuerpo: [{ errorCode: 'SERVER_ERROR' }], clase: 'salesforce' },
  ];

  for (const t of tabla) {
    manejador = (_req, res) => json(res, t.status, t.cuerpo, t.tipo ?? 'application/json');
    const r = await capturar(() => agente.abrirSesion(randomUUID()));
    afirmar(`${t.nombre} → clase ${t.clase}`, r instanceof ErrorAgentAPI && r.clase === t.clase, claseDe(r));
    afirmar(`${t.nombre} nombra el paso que falta`, r instanceof ErrorAgentAPI && r.pasoQueFalta.length > 20, r instanceof ErrorAgentAPI ? r.pasoQueFalta.slice(0, 60) : null);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. 401 → renovación y UN reintento
// ─────────────────────────────────────────────────────────────────────────────

caso('6. 401 provoca renovación de token y un único reintento');
{
  vecesToken = 0;
  let intentos = 0;
  manejador = (_req, res) => {
    intentos += 1;
    if (intentos === 1) return json(res, 401, [{ errorCode: 'INVALID_SESSION_ID' }]);
    return json(res, 200, cuerpoSesion(SES_401));
  };
  const s = await agente.abrirSesion(randomUUID());
  afirmar('tras un 401 se renueva el token y se reintenta una vez', s.sessionId === SES_401, { intentos, vecesToken });
  await agente.cerrarSesion(s.sessionId, 'UserRequest').catch(() => undefined);

  // Y un 401 persistente NO se reintenta en bucle: se reporta como credencial.
  intentos = 0;
  manejador = (_req, res) => {
    intentos += 1;
    return json(res, 401, [{ errorCode: 'INVALID_SESSION_ID' }]);
  };
  const r = await capturar(() => agente.abrirSesion(randomUUID()));
  afirmar('un 401 persistente se reporta como credencial_sin_scopes, sin bucle', r instanceof ErrorAgentAPI && r.clase === 'credencial_sin_scopes' && intentos === 2, { clase: claseDe(r), intentos });
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Stream que responde 200 pero no es SSE
// ─────────────────────────────────────────────────────────────────────────────

caso('7. el stream responde 200 con JSON en vez de text/event-stream');
{
  const sid = await abrirSesionValida('nosse');
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/messages/stream')) return json(res, 200, { messages: [] });
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const r = await capturar(async () => {
    for await (const _ of agente.enviarMensajeStream(sid, 'x', { msInactividad: 4000 })) void _;
  });
  afirmar('content-type que no es SSE → respuesta_ilegible', r instanceof ErrorAgentAPI && r.clase === 'respuesta_ilegible', claseDe(r));
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Silencio de red en mitad del stream
// ─────────────────────────────────────────────────────────────────────────────

caso('8. el flujo se queda mudo (no llega un byte)');
{
  const sid = await abrirSesionValida('mudo');
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/messages/stream')) {
      sse(res);
      res.write('event: TextChunk\ndata: {"message":{"type":"TextChunk","id":"c1","message":"pensando"}}\n\n');
      return; // y aquí se queda callado para siempre
    }
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const t0 = Date.now();
  const r = await capturar(async () => {
    for await (const _ of agente.enviarMensajeStream(sid, 'x', { msInactividad: 400 })) void _;
  });
  const ms = Date.now() - t0;
  afirmar('el silencio corta por inactividad y LANZA como red', r instanceof ErrorAgentAPI && r.clase === 'red', claseDe(r));
  afirmar('y corta cerca del plazo configurado, no al minuto', ms < 3000, `${ms} ms`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. `_links` apuntando a otro host — el token no puede salir de ahí
// ─────────────────────────────────────────────────────────────────────────────

caso('9. la respuesta trae _links hacia otro host');
{
  manejador = (req, res) => {
    const url = req.url ?? '';
    if (url.endsWith('/sessions')) return json(res, 200, cuerpoSesion(SES_EVIL, 'https://host-ajeno.invalid'));
    if (url.endsWith('/messages/stream')) {
      sse(res);
      res.write('event: TextChunk\ndata: {"message":{"type":"TextChunk","id":"c1","message":"ok"}}\n\n');
      res.write('event: EndOfTurn\ndata: {"message":{"type":"EndOfTurn","id":"e1"}}\n\n');
      return;
    }
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const s = await agente.abrirSesion(randomUUID());
  const ajenos = Object.values(s.enlaces).filter((u) => !u.startsWith(base));
  afirmar('ningún _link de otro origen queda como destino del token', ajenos.length === 0, ajenos);

  const tipos: string[] = [];
  const r = await capturar(async () => {
    for await (const ev of agente.enviarMensajeStream(s.sessionId, 'x', { msInactividad: 4000 })) tipos.push(ev.tipo);
  });
  afirmar('y el turno sigue funcionando por la URL canónica del contrato', !(r instanceof Error) && tipos.includes('EndOfTurn'), r instanceof Error ? `${claseDe(r)}: ${r.message.slice(0, 120)}` : tipos);
  await agente.cerrarSesion(s.sessionId, 'UserRequest').catch(() => undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Trozos partidos por la mitad y UTF-8 partido en dos paquetes
// ─────────────────────────────────────────────────────────────────────────────

caso('10. eventos partidos entre paquetes TCP y UTF-8 a caballo');
{
  const sid = await abrirSesionValida('trozos');
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/messages/stream')) {
      sse(res);
      const payload = Buffer.from(
        'event: TextChunk\ndata: {"message":{"type":"TextChunk","id":"c1","message":"garantía extendida ✅"}}\n\n' +
          'event: EndOfTurn\ndata: {"message":{"type":"EndOfTurn","id":"e1"}}\n\n',
        'utf8',
      );
      // Se parte en tres, con cortes dentro de un carácter multibyte y dentro del bloque.
      let i = 0;
      const trozos = [payload.subarray(0, 47), payload.subarray(47, 96), payload.subarray(96)];
      const siguiente = (): void => {
        if (i >= trozos.length) return;
        res.write(trozos[i]!);
        i += 1;
        setTimeout(siguiente, 15);
      };
      siguiente();
      return;
    }
    return json(res, 500, { error: 'ruta no prevista' });
  };
  let texto = '';
  const tipos: string[] = [];
  const r = await capturar(async () => {
    for await (const ev of agente.enviarMensajeStream(sid, 'x', { msInactividad: 4000 })) {
      tipos.push(ev.tipo);
      if (ev.tipo === 'TextChunk') texto += ev.texto ?? '';
    }
  });
  afirmar('el parser reensambla los eventos partidos', !(r instanceof Error) && tipos.join(',') === 'TextChunk,EndOfTurn', r instanceof Error ? claseDe(r) : tipos);
  afirmar('y el UTF-8 partido no se corrompe', texto === 'garantía extendida ✅', texto);
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Último bloque sin línea en blanco final
// ─────────────────────────────────────────────────────────────────────────────

caso('11. el último bloque llega sin la línea en blanco de cierre');
{
  const sid = await abrirSesionValida('sincierre');
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/messages/stream')) {
      sse(res);
      res.write('event: TextChunk\ndata: {"message":{"type":"TextChunk","id":"c1","message":"parte 1"}}\n\n');
      res.write('event: EndOfTurn\ndata: {"message":{"type":"EndOfTurn","id":"e1"}}');
      res.end();
      return;
    }
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const tipos: string[] = [];
  const r = await capturar(async () => {
    for await (const ev of agente.enviarMensajeStream(sid, 'x', { msInactividad: 4000 })) tipos.push(ev.tipo);
  });
  afirmar('el último evento no se pierde', tipos.includes('EndOfTurn'), r instanceof Error ? `${claseDe(r)} · ${tipos.join(',')}` : tipos);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Clave externa inválida y cierre incompleto
// ─────────────────────────────────────────────────────────────────────────────

caso('12. rechaza una externalSessionKey que no sea UUID');
{
  manejador = (_req, res) => json(res, 500, { error: 'no debía contactar al servidor' });
  const r = await capturar(() => agente.abrirSesion('torre-no-es-uuid'));
  afirmar(
    'una clave externa fuera de contrato falla antes de hacer HTTP',
    r instanceof ErrorAgentAPI && r.clase === 'peticion_invalida' && peticiones.length === 0,
    { clase: claseDe(r), peticiones: peticiones.length },
  );
}

caso('13. cierre 200 sin SessionEnded no se acepta');
{
  const sid = await abrirSesionValida('cierre-incompleto');
  manejador = (req, res) => {
    if (req.method === 'DELETE') return json(res, 200, { messages: [{ type: 'Inform', message: 'todavía abierta' }] });
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const r = await capturar(() => agente.cerrarSesion(sid));
  afirmar(
    'cerrar exige SessionEnded y lanza si falta',
    r instanceof ErrorAgentAPI && r.clase === 'respuesta_ilegible',
    claseDe(r),
  );
  afirmar(
    'una sesión sin cierre confirmado sigue en el registro local',
    agente.sesionesActivas().some((s) => s.sessionId === sid),
    agente.sesionesActivas().map((s) => s.sessionId),
  );
}

caso('13b. un 400 de cierre no se reintenta ni se disfraza');
{
  let deletes = 0;
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/sessions')) return json(res, 200, cuerpoSesion(SES_CIERRE_RACE));
    if (req.method === 'DELETE') {
      deletes += 1;
      if (deletes === 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('');
        return;
      }
      return json(res, 200, { messages: [{ type: 'SessionEnded' }] });
    }
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const sesion = await agente.abrirSesion(randomUUID());
  const r = await capturar(() => agente.cerrarSesion(sesion.sessionId));
  afirmar(
    'un 400 vacío sigue siendo peticion_invalida, como documenta Salesforce',
    r instanceof ErrorAgentAPI && r.clase === 'peticion_invalida',
    claseDe(r),
  );
  afirmar('el cierre hizo un solo DELETE: no reintenta errores semánticos', deletes === 1, deletes);
  afirmar(
    'sin SessionEnded la sesión permanece registrada para mostrar el fallo real',
    agente.sesionesActivas().some((s) => s.sessionId === sesion.sessionId),
    agente.sesionesActivas().map((s) => s.sessionId),
  );
}

caso('13c. diagnóstico de cierre conserva sólo código y huella del requestId');
{
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/sessions')) return json(res, 200, cuerpoSesion(SES_CIERRE_CODIGO));
    if (req.method === 'DELETE') {
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'x-request-id': 'request-id-sintetico-que-no-debe-salir',
      });
      res.end(JSON.stringify({ errorCode: 'INVALID_REQUEST', message: 'detalle que no se persiste' }));
      return;
    }
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const sesion = await agente.abrirSesion(randomUUID());
  const r = await capturar(() => agente.cerrarSesion(sesion.sessionId));
  const detalle = r instanceof ErrorAgentAPI
    ? (r.detalle as { codigoSalesforce?: string; requestIdHash?: string })
    : {};
  afirmar('el código INVALID_REQUEST se conserva como metadato', detalle.codigoSalesforce === 'INVALID_REQUEST', detalle.codigoSalesforce);
  afirmar(
    'el requestId se conserva como huella irreversible de 16 hex, no como identificador crudo',
    typeof detalle.requestIdHash === 'string' && /^[a-f0-9]{16}$/.test(detalle.requestIdHash),
    detalle.requestIdHash ?? null,
  );
  afirmar(
    'la serialización del error no contiene requestId ni mensaje upstream crudos',
    r instanceof ErrorAgentAPI &&
      !JSON.stringify(r.aJSON()).includes('request-id-sintetico') &&
      !JSON.stringify(r.aJSON()).includes('detalle que no se persiste'),
  );
  afirmar(
    'el error en memoria tampoco retiene el cuerpo upstream',
    r instanceof ErrorAgentAPI && r.detalle.cuerpo === null,
    r instanceof ErrorAgentAPI ? r.detalle.cuerpo : null,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. Sesión que este proceso no custodia
// ─────────────────────────────────────────────────────────────────────────────

caso('14. sesión desconocida');
{
  manejador = (_req, res) => json(res, 200, { messages: [] });
  const r1 = await capturar(() => agente.enviarMensajeSync(SES_INEXISTENTE, 'x'));
  afirmar('enviarMensajeSync sobre una sesión ajena → sesion_desconocida', r1 instanceof ErrorAgentAPI && r1.clase === 'sesion_desconocida', claseDe(r1));
  const r2 = await capturar(() => agente.cerrarSesion(SES_INEXISTENTE));
  afirmar('cerrarSesion sobre una sesión ajena → sesion_desconocida', r2 instanceof ErrorAgentAPI && r2.clase === 'sesion_desconocida', claseDe(r2));
  afirmar('y no se contactó al servidor por una sesión inventada', peticiones.filter((p) => p.ruta.includes('/einstein/')).length === 0, peticiones.map((p) => p.ruta));
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. estadoAgentAPI: sonda real y caché honesta
// ─────────────────────────────────────────────────────────────────────────────

caso('15. estadoAgentAPI hace sonda real y reporta el status medido');
{
  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/sessions')) {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cuerpoSesion(SES_SALUD)));
      return;
    }
    if (req.method === 'DELETE') return json(res, 200, { messages: [{ type: 'SessionEnded' }] });
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const est = await agente.estadoAgentAPI({ forzar: true });
  afirmar('la sonda reporta disponible', est.disponible, est.causa);
  afirmar('el status de la sonda es el MEDIDO, no un 200 supuesto', est.sonda.status === 201, est.sonda.status);
  afirmar('la sonda abre y cierra de verdad (hubo DELETE)', peticiones.some((p) => p.metodo === 'DELETE'), peticiones.map((p) => `${p.metodo} ${p.ruta}`));
  afirmar('la sonda no deja sesiones colgando en el registro', !agente.sesionesActivas().some((s) => s.sessionId === SES_SALUD), agente.sesionesActivas().map((s) => s.sessionId));

  const est2 = await agente.estadoAgentAPI();
  afirmar('la segunda lectura viene de caché con el mismo verificadoEn', est2.verificadoEn === est.verificadoEn, [est.verificadoEn, est2.verificadoEn]);

  manejador = (req, res) => {
    if ((req.url ?? '').endsWith('/sessions')) return json(res, 201, cuerpoSesion(SES_SALUD_SIN_CIERRE));
    if (req.method === 'DELETE') return json(res, 200, { messages: [{ type: 'Inform', message: 'no cerrada' }] });
    return json(res, 500, { error: 'ruta no prevista' });
  };
  const sinCierre = await agente.estadoAgentAPI({ forzar: true });
  // Lo que decide si el sitio ofrece el chat es si la Agent API deja ABRIR sesión. Un
  // cierre no confirmado no impide conversar y la sesión caduca sola, así que poner
  // readiness en rojo por eso apagaría el asistente por un fallo de limpieza. Lo que
  // NO se tolera es afirmar una confirmación que no llegó: eso sí se comprueba.
  const detalle = sinCierre.sonda.detalle as { cierreConfirmado?: boolean } | null;
  afirmar(
    'con abrir bien y cerrar sin confirmar, la readiness sigue verde',
    sinCierre.disponible === true && sinCierre.sonda.ok === true,
    { disponible: sinCierre.disponible, ok: sinCierre.sonda.ok },
  );
  afirmar(
    'pero NO se afirma un cierre que Salesforce no confirmó',
    detalle?.cierreConfirmado === false && /NO quedó confirmado/.test(sinCierre.nota ?? ''),
    { cierreConfirmado: detalle?.cierreConfirmado, nota: sinCierre.nota },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. Configuración exclusiva y el token no se escribe en ningún sitio
// ─────────────────────────────────────────────────────────────────────────────

caso('16. configuración Agent API y custodia de token');
{
  // Este contrato se corrigió con evidencia contra la org el 6-ago-2026. Antes decía
  // que el CLI no era un proveedor válido para la Agent API; eso resultó falso, y la
  // creencia contraria —que el par consumidor era el único camino— costó días.
  //
  // Lo comprobado:
  //   · client_credentials va DIRECTO a api.salesforce.com: HTTP 200 y sessionId real.
  //     Necesita sus dos valores, y por eso se siguen exigiendo.
  //   · el CLI llega por el canje de `/agentforce/bootstrap/nameduser` y no necesita
  //     ningún secreto de app cliente. Es válido, pero sólo en local: la imagen de
  //     producción no lleva el Salesforce CLI (BLOQUEOS.md §6).
  afirmar(
    'client_credentials exige sus dos valores',
    agente.requisitosConfiguracionAgentAPI('client_credentials', '', '').sort().join(',') ===
      'SF_CLIENT_ID,SF_CLIENT_SECRET',
    agente.requisitosConfiguracionAgentAPI('client_credentials', '', ''),
  );
  afirmar(
    'el CLI no exige secreto de app cliente: alcanza la Agent API por el canje de JWT',
    agente.requisitosConfiguracionAgentAPI('cli', '', '').length === 0,
    agente.requisitosConfiguracionAgentAPI('cli', '', ''),
  );
  manejador = (_req, res) => json(res, 403, [{ errorCode: 'FORBIDDEN', message: `Bearer ${TOKEN_SINTETICO} rechazado` }]);
  const r = await capturar(() => agente.abrirSesion(randomUUID()));
  const serializado = r instanceof ErrorAgentAPI ? JSON.stringify(r.aJSON()) : JSON.stringify(r);
  afirmar('ni siquiera si el servidor lo devuelve en el cuerpo del error', !serializado.includes(TOKEN_SINTETICO), serializado.slice(0, 200));
  const estado = JSON.stringify(await agente.estadoAgentAPI({ forzar: true }));
  afirmar('ni en el estado que consume /salud', !estado.includes(TOKEN_SINTETICO), estado.slice(0, 200));
  afirmar('ni en el listado de sesiones activas', !JSON.stringify(agente.sesionesActivas()).includes(TOKEN_SINTETICO));
}

// ─────────────────────────────────────────────────────────────────────────────
// Veredicto
// ─────────────────────────────────────────────────────────────────────────────

servidor.close();

const fallidas = comprobaciones.filter((c) => !c.ok);
decir();
decir(`comprobaciones: ${comprobaciones.length} · pasan ${comprobaciones.length - fallidas.length} · fallan ${fallidas.length}`);
for (const f of fallidas) decir(`   FALLA  [${f.caso}] ${f.afirmacion}`);
const veredicto = fallidas.length === 0
  ? 'VERDE — el cliente cumple el contrato §3-§6 y falla ruidosamente en cada desvío probado'
  : `ROJO — ${fallidas.length} comprobación(es) fallan: el cliente tiene defectos`;
decir();
decir(veredicto);
decir('Recordatorio: este loopback no sustituye el gate real `npm run verificar:agent-api`.');

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '01-agent-api');
mkdirSync(dir, { recursive: true });
const salida = {
  ts,
  que_es: 'Conformidad de protocolo de src/servidor/agente.ts contra un servidor de loopback que habla el contrato. NO es la Agent API real, NO contiene datos de negocio.',
  veredicto,
  total: comprobaciones.length,
  fallan: fallidas.length,
  comprobaciones,
};
const textoSalida = JSON.stringify(salida, null, 1);
if (textoSalida.includes(TOKEN_SINTETICO)) {
  throw new Error('El harness iba a escribir el token en la evidencia. Se aborta: eso es exactamente lo que no debe pasar.');
}
writeFileSync(join(dir, `protocolo-loopback.${ts}.json`), textoSalida);
writeFileSync(join(dir, `protocolo-loopback.${ts}.txt`), transcripcion.join('\n') + '\n');
console.log(`\nevidencia: evidencia/01-agent-api/protocolo-loopback.${ts}.json`);
console.log(`evidencia: evidencia/01-agent-api/protocolo-loopback.${ts}.txt`);
process.exit(fallidas.length === 0 ? 0 : 1);
