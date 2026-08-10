// Verificación del nodo N3 contra la org REAL.
//
// Intenta el ciclo completo del contrato: estado → sonda de control sin credencial →
// abrir sesión → mensaje en streaming → mensaje síncrono → cerrar sesión.
//
// La External Client App ya existe, pero el lifecycle sólo puede aprobarse cuando un
// humano custodie su par consumidor fuera del repositorio/chat (BLOQUEOS.md §1).
// Hasta entonces el script debe fallar de forma explícita, sin atribuir una causa no probada.
//
// Códigos de salida:
//   0 = el ciclo completo funcionó contra la org
//   2 = configuración incompleta (ECA no custodiada o proveedor distinto de client_credentials)
//   1 = el ciclo real falló aunque la configuración requerida estaba presente
//
// La evidencia sólo guarda metadatos de protocolo. Nunca payloads, textos del usuario,
// respuestas del agente, sessionId, traceId ni datos de negocio.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, configSegura } from '../src/servidor/config.ts';
import { seguroParaLog } from '../src/servidor/auth.ts';
import { ErrorSalesforce } from '../src/servidor/errores.ts';
import { redactSensitive } from '../src/servidor/security.ts';
import {
  ErrorAgentAPI,
  abrirSesion,
  cerrarSesion,
  enviarMensajeStream,
  enviarMensajeSync,
  estadoAgentAPI,
  requisitosConfiguracionAgentAPI,
  type EventoAgente,
} from '../src/servidor/agente.ts';

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '01-agent-api');
mkdirSync(dir, { recursive: true });

const transcripcion: string[] = [];
function decir(linea = ''): void {
  transcripcion.push(linea);
  console.log(linea);
}

interface Paso {
  nombre: string;
  ok: boolean;
  clase: string | null;
  pasoQueFalta: string | null;
  detalle: unknown;
}

const pasos: Paso[] = [];

function resumirEventos(eventos: EventoAgente[]) {
  return {
    cantidad: eventos.length,
    tipos: eventos.map((evento) => evento.tipo),
    finDeTurno: eventos.some((evento) => evento.tipo === 'EndOfTurn'),
    sesionTerminada: eventos.some((evento) => evento.tipo === 'SessionEnded'),
    contieneError: eventos.some((evento) => evento.tipo === 'Error'),
    fragmentosConTexto: eventos.filter((evento) => evento.texto !== null).length,
    eventosConPlanId: eventos.filter((evento) => evento.planId !== null).length,
    eventosConTraceId: eventos.filter((evento) => evento.traceId !== null).length,
    resultados: eventos.reduce((total, evento) => total + evento.resultados.length, 0),
    referencias: eventos.reduce((total, evento) => total + evento.citedReferences.length, 0),
  };
}

function exigir(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new Error(`Protocolo Agent API inválido: ${mensaje}`);
}

function anotarFallo(nombre: string, e: unknown): Paso {
  const esAgente = e instanceof ErrorAgentAPI;
  const esSf = e instanceof ErrorSalesforce;
  const paso: Paso = {
    nombre,
    ok: false,
    clase: esAgente ? e.clase : null,
    pasoQueFalta: esAgente ? e.pasoQueFalta : null,
    detalle: esSf
      ? {
          operacion: e.detalle.operacion,
          status: e.detalle.status ?? null,
          codigoSalesforce: e.detalle.codigoSalesforce ?? null,
          requestIdHash: esAgente ? e.requestIdHash : null,
        }
      : { tipo: e instanceof Error ? e.name : typeof e },
  };
  pasos.push(paso);
  decir(`FALLA  ${nombre}`);
  decir(`       clase: ${paso.clase ?? 'sin clasificar'}`);
  if (esSf) {
    decir(`       status: ${e.detalle.status ?? '-'}`);
    decir(`       codigo: ${e.detalle.codigoSalesforce ?? '-'}`);
    decir(`       request: ${esAgente ? e.requestIdHash ?? '-' : '-'}`);
  }
  return paso;
}

function anotarOk(nombre: string, detalle: unknown): Paso {
  const paso: Paso = { nombre, ok: true, clase: null, pasoQueFalta: null, detalle };
  pasos.push(paso);
  decir(`OK     ${nombre}`);
  return paso;
}

// ── 0. Terreno ───────────────────────────────────────────────────────────────

const segura = configSegura();
decir('Torre Agentforce — verificación del nodo N3 (Agent API)');
decir(`sello           ${ts}`);
decir(`host            ${segura.agentApiHost}`);
decir(`proveedorToken  ${segura.proveedorToken}`);
decir(`credenciales    ${segura.tieneCredenciales ? 'presentes' : 'AUSENTES'}`);
const faltan = requisitosConfiguracionAgentAPI(
  config.proveedorToken,
  config.clientId,
  config.clientSecret,
);
decir(`requisitos      ${faltan.length ? `faltan ${faltan.join(', ')}` : 'completos'}`);
decir();

// ── 1. Estado que consume /salud ─────────────────────────────────────────────

decir('1) estadoAgentAPI() — comprobación de credenciales + sonda real');
const estado = await estadoAgentAPI({ forzar: true });
decir(`   disponible   ${estado.disponible}`);
decir(
  `   sonda        intentada=${estado.sonda.intentada} ok=${estado.sonda.ok} ` +
    `status=${estado.sonda.status ?? '-'} clase=${estado.sonda.clase ?? '-'} ms=${estado.sonda.ms ?? '-'}`,
);
if (estado.nota) decir(`   nota         ${seguroParaLog(estado.nota)}`);
pasos.push({
  nombre: 'estadoAgentAPI',
  ok: estado.disponible,
  clase: estado.sonda.clase,
  pasoQueFalta: estado.pasoQueFalta,
  detalle: {
    disponible: estado.disponible,
    proveedorToken: estado.proveedorToken,
    requisitosFaltantes: estado.requisitosFaltantes,
    sonda: {
      intentada: estado.sonda.intentada,
      ok: estado.sonda.ok,
      status: estado.sonda.status,
      clase: estado.sonda.clase,
      ms: estado.sonda.ms,
    },
  },
});
decir();

// ── 2. Sonda de control SIN credencial ───────────────────────────────────────
// Es la prueba que discrimina: si una petición sin Authorization devuelve lo mismo que
// una con token válido, la puerta descarta la ruta antes de mirar el token.

decir('2) sonda de control — misma URL, SIN header Authorization');
const urlControl = `${config.agentApiHost}/einstein/ai-agent/v1/agents/${config.agentId}/sessions`;
let control: Record<string, unknown>;
if (faltan.length) {
  control = { omitida: true, razon: 'configuracion_agent_api_incompleta' };
  decir('   omitida: primero deben custodiarse las credenciales client_credentials');
  pasos.push({
    nombre: 'sondaSinCredencial',
    ok: true,
    clase: null,
    pasoQueFalta: null,
    detalle: control,
  });
} else try {
  const res = await fetch(urlControl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ externalSessionKey: randomUUID() }),
    signal: AbortSignal.timeout(20_000),
  });
  const cuerpo = await res.text();
  control = {
    status: res.status,
    statusText: res.statusText,
    contentType: res.headers.get('content-type'),
    longitudCuerpo: cuerpo.length,
  };
  decir(`   HTTP ${res.status} ${res.statusText} · cuerpo ${cuerpo.length} bytes`);
  decir(`   content-type: ${res.headers.get('content-type') ?? '(ninguno)'}`);
  pasos.push({ nombre: 'sondaSinCredencial', ok: true, clase: null, pasoQueFalta: null, detalle: control });
} catch (e) {
  control = { error: seguroParaLog(e instanceof Error ? e.message : String(e)) };
  anotarFallo('sondaSinCredencial', e);
}
decir();

// ── 3. Ciclo completo ────────────────────────────────────────────────────────

const correlationId = randomUUID();
let sessionId: string | null = null;

decir('3) abrirSesion(externalSessionKey = UUID efímero)');
if (faltan.length) {
  decir('   omitida: falta configuración obligatoria; no se intenta un ciclo que no puede autenticar.');
  pasos.push({
    nombre: 'abrirSesion',
    ok: false,
    clase: 'configuracion_invalida',
    pasoQueFalta: `Configurar ${faltan.join(', ')}.`,
    detalle: { omitida: true },
  });
} else try {
  const sesion = await abrirSesion(correlationId);
  sessionId = sesion.sessionId;
  decir(`   HTTP ${sesion.statusHttp} · sesión creada`);
  decir(`   _links    ${Object.keys(sesion.enlaces).join(', ') || '(ninguno)'}`);
  const resumenInicial = resumirEventos(sesion.mensajesIniciales);
  decir(`   mensajes iniciales ${resumenInicial.cantidad} · tipos ${resumenInicial.tipos.join(', ') || '(ninguno)'}`);
  anotarOk('abrirSesion', {
    statusHttp: sesion.statusHttp,
    enlaces: Object.keys(sesion.enlaces),
    mensajesIniciales: resumenInicial,
  });
} catch (e) {
  anotarFallo('abrirSesion', e);
}
decir();

const eventosStream: EventoAgente[] = [];
if (sessionId) {
  decir('4) enviarMensajeStream — SSE');
  try {
    for await (const evento of enviarMensajeStream(
      sessionId,
      'Necesito reportar una unidad varada. ¿Qué datos te doy?',
    )) {
      eventosStream.push(evento);
      decir(
        `   ${evento.tipo.padEnd(18)} texto=${evento.texto !== null} ` +
          `plan=${evento.planId !== null} trace=${evento.traceId !== null}`,
      );
    }
    const resumen = resumirEventos(eventosStream);
    exigir(resumen.finDeTurno || resumen.sesionTerminada, 'el stream terminó sin evento final');
    exigir(!resumen.contieneError, 'el stream incluyó Error');
    anotarOk('enviarMensajeStream', resumen);
  } catch (e) {
    anotarFallo('enviarMensajeStream', e);
  }
  decir();

  decir('5) enviarMensajeSync');
  try {
    const r = await enviarMensajeSync(sessionId, 'Gracias, eso era todo.');
    decir(`   respuesta recibida · ${r.eventos.length} mensajes`);
    const resumen = resumirEventos(r.eventos);
    exigir(resumen.cantidad > 0, 'la respuesta síncrona no trajo messages');
    exigir(!resumen.contieneError, 'la respuesta síncrona incluyó Error');
    anotarOk('enviarMensajeSync', {
      tieneTexto: r.texto.length > 0,
      eventos: resumen,
    });
  } catch (e) {
    anotarFallo('enviarMensajeSync', e);
  }
  decir();

  decir('6) cerrarSesion (x-session-end-reason: UserRequest)');
  try {
    const r = await cerrarSesion(sessionId, 'UserRequest');
    const resumen = resumirEventos(r.eventos);
    exigir(resumen.sesionTerminada, 'el cierre no incluyó SessionEnded');
    decir(`   cerrada y confirmada · ${resumen.tipos.join(', ')}`);
    anotarOk('cerrarSesion', { motivo: r.motivo, eventos: resumen });
  } catch (e) {
    anotarFallo('cerrarSesion', e);
  }
} else {
  decir('4-6) enviarMensajeStream / enviarMensajeSync / cerrarSesion — no se intentan:');
  decir('     sin sesión abierta no hay nada que probar, y fingir una sería inventar datos.');
  pasos.push({
    nombre: 'cicloDeMensajes',
    ok: false,
    clase: 'no_intentado',
    pasoQueFalta: 'Abrir sesión primero. El fallo real está en el paso abrirSesion.',
    detalle: null,
  });
}
decir();

// ── 4. Veredicto ─────────────────────────────────────────────────────────────

const fallos = pasos.filter((p) => !p.ok);
// Exit 2 queda reservado EXCLUSIVAMENTE a configuración ausente. Si las variables
// existen, un 401/403/404 es un fallo real de scopes/ruta/agente y nunca un "bloqueo esperado".
const codigo = faltan.length > 0 ? 2 : fallos.length === 0 ? 0 : 1;
const sinClasificar = fallos.filter((p) => p.clase === null);
const clasesVistas = [...new Set(fallos.map((p) => p.clase ?? 'sin clasificar'))].join(', ');
const veredicto =
  codigo === 0
    ? 'VERDE — el ciclo completo funcionó contra la org'
    : codigo === 2
      ? 'BLOQUEADO — falta configuración obligatoria de la External Client App'
      : sinClasificar.length > 0
        ? `ROJO — falló SIN clasificar (${clasesVistas}): eso es un defecto del cliente, no del entorno`
        : `ROJO — falló por una causa distinta al bloqueo conocido (${clasesVistas}): revisa el paso que falta de cada fallo`;

decir(veredicto);
if (codigo === 2) {
  decir('       La ECA ya existe; falta custodiar su par consumidor localmente tras la rotación.');
  decir('       Pasos exactos: BLOQUEOS.md §0–§1.');
  decir('       Diagnóstico completo: docs/CONTRATO-AGENT-API.md §7.');
}

const salida = {
  ts,
  veredicto,
  codigoSalida: codigo,
  config: {
    host: segura.agentApiHost,
    proveedorToken: segura.proveedorToken,
    tieneCredenciales: segura.tieneCredenciales,
  },
  requisitosFaltantes: faltan,
  estado: {
    disponible: estado.disponible,
    proveedorToken: estado.proveedorToken,
    requisitosFaltantes: estado.requisitosFaltantes,
    sonda: pasos.find((paso) => paso.nombre === 'estadoAgentAPI')?.detalle ?? null,
  },
  pasos,
};

const archivoJson = join(dir, `ciclo-completo.${ts}.json`);
const archivoTxt = join(dir, `consola.${ts}.txt`);
const jsonSeguro = JSON.stringify(redactSensitive(salida), null, 2);
// Gate local de la propia evidencia: jamás se escribe un JSON cortado a mitad.
JSON.parse(jsonSeguro);
writeFileSync(archivoJson, jsonSeguro + '\n');
writeFileSync(archivoTxt, transcripcion.map((linea) => seguroParaLog(linea)).join('\n') + '\n');

console.log(`\nevidencia: evidencia/01-agent-api/ciclo-completo.${ts}.json`);
console.log(`evidencia: evidencia/01-agent-api/consola.${ts}.txt`);
process.exit(codigo);
