// N3 · Cliente de la Agentforce Agent API.
//
// Este módulo NO pasa por sf.ts. sf.ts habla con el My Domain bajo /services/data;
// la Agent API vive en `config.agentApiHost` (api.salesforce.com) con otra ruta y otro
// contrato. Lo único que comparten es el custodio del token: `proveedorDeToken()`.
//
// Reglas que este archivo respeta al pie de la letra:
//   · el token nunca se loguea ni viaja al navegador
//   · se siguen los `_links` que devuelve la respuesta; la URL canónica es sólo el
//     último recurso cuando la respuesta no trajo enlace
//   · `sequenceId` lo genera el servidor como epoch-ms estrictamente creciente, por sesión
//   · si algo falla, se LANZA con la causa real y el paso que falta. Nunca se degrada
//     a un texto inventado: sin credencial no hay conversación, y así se dice.
//
// Estado verificado el 5-ago-2026: la External Client App está activa y el lifecycle
// real terminó con código 0. Un token CLI ordinario no sustituye esa credencial.
// Evidencia y límites semánticos: docs/CONTRATO-AGENT-API.md §§7–8.

import { createHash, randomUUID } from 'node:crypto';
import { config } from './config.ts';
import { ErrorSalesforce, type DetalleSalesforce } from './errores.ts';
import { isAllowedUpstreamUrl } from './security.ts';
import { proveedorDeToken, seguroParaLog, tokenParaAgentAPI, _olvidarJwtAgente } from './auth.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes del contrato
// ─────────────────────────────────────────────────────────────────────────────

const RUTA_BASE = '/einstein/ai-agent/v1';
const MS_TIMEOUT = config.security.agentApiTimeoutMs;
const MS_INACTIVIDAD_STREAM = 60_000;
const MS_CACHE_ESTADO = 60_000;
const RAZON_INACTIVIDAD = 'agent-api:inactividad';
// Salesforce puede rechazar con 400 la PRIMERA operación de una sesión recién creada:
// el id existe pero aún no se propagó. Un segundo resultó insuficiente en la práctica
// —el turno moría con "Illegal Path Character" pese a que la ruta era válida—, así que
// se espera más y además se reintenta una vez. Ver `reintentarPrimerTurno`.
const MS_PROPAGACION_SESION = 2_500;
// Esperas del reintento del PRIMER turno, en milisegundos. Suman ~21 s en el peor
// caso, que es lo que costó ver funcionar una sesión que empezó devolviendo 400.
// Insistir sobre la misma sesión es más barato y más rápido que abrir otra: abrir
// una nueva reinicia su propia ventana de propagación y encima deja la anterior
// colgando en la org.
const ESPERAS_PROPAGACION = [3_000, 6_000, 12_000] as const;

const PASO_EXTERNAL_CLIENT_APP =
  'La External Client App Torre Agentforce Zapata ya existe. Un humano debe revelar ' +
  'su par consumidor tras reautenticarse, guardarlo directamente en el almacén de ' +
  'secretos como SF_CLIENT_ID/SF_CLIENT_SECRET y arrancar con ' +
  'SF_TOKEN_PROVIDER=client_credentials. Pasos exactos en BLOQUEOS.md §1.';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

/** Clasificación honesta del fallo. Cada valor implica un culpable distinto. */
export type ClaseDeFallo =
  | 'configuracion_invalida' // la Agent API exige la ECA y client_credentials; CLI no sirve.
  | 'gateway_sin_ruta' // 404 vacío: la puerta no enrutó; no atribuir una causa no probada.
  | 'credencial_sin_scopes' // 401/403: la puerta evaluó el token y lo rechazó.
  | 'recurso_no_encontrado' // 404 CON cuerpo: enrutó, pero el agente o la sesión no existen.
  | 'peticion_invalida' // 400/405/415/422: el cuerpo o el método no encajan.
  | 'salesforce' // 5xx / 429 / cualquier otro código servido por Salesforce.
  | 'red' // timeout, DNS, TLS, salida a internet.
  | 'respuesta_ilegible' // 2xx que no encaja con el contrato.
  | 'sesion_desconocida'; // este proceso no custodia esa sesión: no puede saber el sequenceId.

const TIPOS_CONOCIDOS = [
  'ProgressIndicator',
  'TextChunk',
  'EndOfTurn',
  'Inform',
  'SessionEnded',
  'Error',
] as const;

export type TipoEventoAgente = (typeof TIPOS_CONOCIDOS)[number] | 'Desconocido';

export interface ReferenciaCitada {
  tipo: string | null;
  valor: string | null;
}

/**
 * Un evento del turno, ya tipado. Se conservan `planId`, `traceId`, resultados y
 * referencias cuando Salesforce los publica. Esos campos no bastan por sí solos para
 * atribuir un subagente o una acción: eso se verifica en Session Tracing/Testing API.
 */
export interface EventoAgente {
  tipo: TipoEventoAgente;
  /** nombre crudo del campo `event:` del SSE, tal cual llegó */
  evento: string;
  id: string | null;
  timestamp: number | null;
  traceId: string | null;
  planId: string | null;
  originEventId: string | null;
  /** texto del fragmento (TextChunk) o del mensaje completo (Inform) */
  texto: string | null;
  citedReferences: ReferenciaCitada[];
  /** `message.result`: acciones y funciones que el planner invocó en el turno */
  resultados: unknown[];
}

export interface VariableAgente {
  name: string;
  type: string;
  value: unknown;
}

export interface SesionAbierta {
  sessionId: string;
  externalSessionKey: string;
  /** los `_links` que devolvió la respuesta, ya absolutos */
  enlaces: Record<string, string>;
  mensajesIniciales: EventoAgente[];
  abiertaEn: string;
  /** Código realmente medido al crearla; lo usa readiness sin asumir 200. */
  statusHttp: number;
}

export interface RespuestaSincrona {
  sessionId: string;
  sequenceId: number;
  eventos: EventoAgente[];
  /** concatenación de los textos recibidos; vacío si el agente no mandó texto */
  texto: string;
}

export interface SesionCerrada {
  sessionId: string;
  motivo: MotivoFinDeSesion;
  eventos: EventoAgente[];
}

export type MotivoFinDeSesion = 'UserRequest' | 'Transfer' | 'Expiration' | 'Error';

export interface SondaAgentAPI {
  intentada: boolean;
  ok: boolean;
  status: number | null;
  clase: ClaseDeFallo | null;
  ms: number | null;
  url: string;
  detalle: unknown;
}

export interface EstadoAgentAPI {
  disponible: boolean;
  causa: string | null;
  pasoQueFalta: string | null;
  proveedorToken: 'client_credentials' | 'cli';
  requisitosFaltantes: string[];
  agentId: string;
  host: string;
  sonda: SondaAgentAPI;
  verificadoEn: string;
  nota: string | null;
}

export interface OpcionesEnvio {
  variables?: VariableAgente[];
  /** corta el flujo si no llega un byte en este tiempo. Distingue red de silencio. */
  msInactividad?: number;
  /** `EndOfTurn` significa "la respuesta terminó" (contrato §5). Por defecto cierra ahí. */
  cerrarEnFinDeTurno?: boolean;
}

/**
 * La Agent API no acepta el token ordinario del CLI: exige la External Client App
 * con los scopes de Agentforce. Se exporta como función pura para que readiness y
 * el verificador apliquen exactamente la misma puerta de configuración.
 */
export function requisitosConfiguracionAgentAPI(
  proveedor: string = config.proveedorToken,
  clientId: string = config.clientId,
  clientSecret: string = config.clientSecret,
): string[] {
  // La Agent API se alcanza con el JWT de `/agentforce/bootstrap/nameduser`, que se
  // obtiene a partir de CUALQUIER sesión válida de la org. Por eso el secreto de la
  // app cliente dejó de ser requisito: con el CLI autenticado basta, que es
  // exactamente lo que hace `sf agent preview` por dentro.
  //
  // Lo único indispensable es tener una credencial de org utilizable. Si el proveedor
  // es client_credentials, entonces sí hacen falta sus dos valores, porque sin ellos
  // no hay sesión de la que partir.
  const faltan: string[] = [];
  if (proveedor === 'client_credentials') {
    if (!clientId.trim()) faltan.push('SF_CLIENT_ID');
    if (!clientSecret.trim()) faltan.push('SF_CLIENT_SECRET');
  }
  return faltan;
}

/**
 * Fallo de la Agent API con causa clasificada y paso siguiente.
 * Extiende ErrorSalesforce para que `comoRespuestaHttp()` lo trate igual que el resto,
 * pero añade al JSON la clase y el paso que falta: eso es lo que el evaluador lee en
 * pantalla en vez de "error desconocido".
 */
export class ErrorAgentAPI extends ErrorSalesforce {
  declare detalle: DetalleAgentAPI;
  clase: ClaseDeFallo;
  pasoQueFalta: string;
  requestIdHash: string | null;

  constructor(mensaje: string, detalle: DetalleAgentAPI, clase: ClaseDeFallo, pasoQueFalta: string) {
    super(mensaje, detalle);
    this.name = 'ErrorAgentAPI';
    this.clase = clase;
    this.pasoQueFalta = pasoQueFalta;
    this.requestIdHash = detalle.requestIdHash ?? null;
  }

  override aJSON() {
    const base = super.aJSON();
    return {
      ...base,
      // El cuerpo upstream puede traer prompts o datos de negocio; la diagnóstica
      // persistible se limita al código y a una huella del request id.
      cuerpo: null,
      requestIdHash: this.requestIdHash,
      clase: this.clase,
      pasoQueFalta: this.pasoQueFalta,
    };
  }
}

interface DetalleAgentAPI extends DetalleSalesforce {
  /** Huella irreversible para correlacionar soporte sin persistir el request id real. */
  requestIdHash?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de sesiones — el `sequenceId` vive aquí, no en el navegador
// ─────────────────────────────────────────────────────────────────────────────

interface SesionViva {
  sessionId: string;
  externalSessionKey: string;
  enlaces: Record<string, string>;
  secuencia: number;
  abiertaEn: string;
  operableEn: number;
  /** Falso hasta que la sesión completa su primer turno sin error. */
  tuvoTurnoExitoso: boolean;
}

const sesiones = new Map<string, SesionViva>();

export interface ResumenSesion {
  sessionId: string;
  externalSessionKey: string;
  secuencia: number;
  abiertaEn: string;
  enlaces: string[];
}

/** Lo que /salud puede enseñar sin exponer nada sensible. */
export function sesionesActivas(): ResumenSesion[] {
  return [...sesiones.values()].map((s) => ({
    sessionId: s.sessionId,
    externalSessionKey: s.externalSessionKey,
    secuencia: s.secuencia,
    abiertaEn: s.abiertaEn,
    enlaces: Object.keys(s.enlaces),
  }));
}

/**
 * ¿Esta sesión llegó a completar un turno?
 *
 * Salesforce a veces devuelve una sesión que nunca acepta un mensaje: contesta 400 al
 * primer turno y a todos los siguientes. Quien custodia la conversación necesita
 * distinguir «se rompió una sesión que ya funcionaba» —donde reabrir perdería el hilo—
 * de «esta sesión nació inservible», donde reabrir es justo lo que hay que hacer.
 */
export function sesionTuvoTurnoExitoso(sessionId: string): boolean {
  return sesiones.get(sessionId)?.tuvoTurnoExitoso === true;
}

/**
 * Olvida una sesión que la puerta de enlace ya no atiende. No intenta cerrarla: si
 * Salesforce rechaza sus mensajes, también rechazará el DELETE, y ese error taparía
 * el motivo real. La sesión caduca sola del lado de Salesforce.
 */
export function descartarSesion(sessionId: string): void {
  sesiones.delete(sessionId);
}

function exigirSesion(sessionId: string, operacion: string): SesionViva {
  const s = sesiones.get(sessionId);
  if (s) return s;
  throw new ErrorAgentAPI(
    `Este proceso no custodia la sesión ${sessionId}, así que no puede saber por qué ` +
      `sequenceId va la conversación. Inventar el contador rompería el turno en silencio.`,
    { operacion },
    'sesion_desconocida',
    'Abrir una sesión nueva con abrirSesion(); la anterior murió con el proceso o se abrió fuera de aquí.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// URLs
// ─────────────────────────────────────────────────────────────────────────────

function urlSesiones(): string {
  return `${config.agentApiHost}${RUTA_BASE}/agents/${encodeURIComponent(config.agentId)}/sessions`;
}

/** Último recurso: sólo se usa cuando la respuesta no trajo el `_link` correspondiente. */
function urlCanonicaSesion(sessionId: string, sufijo: string): string {
  return `${config.agentApiHost}${RUTA_BASE}/sessions/${encodeURIComponent(sessionId)}${sufijo}`;
}

function extraerEnlaces(crudo: unknown): Record<string, string> {
  const enlaces: Record<string, string> = {};
  const links = comoObjeto(comoObjeto(crudo)?.['_links']);
  if (!links) return enlaces;
  for (const [nombre, valor] of Object.entries(links)) {
    const href =
      typeof valor === 'string' ? valor : comoTexto(comoObjeto(valor)?.['href']);
    // URL.canParse evita un try/catch que acabaría tragándose el fallo en silencio.
    if (href && isAllowedUpstreamUrl(href, config.agentApiHost, `${RUTA_BASE}/`)) {
      enlaces[nombre] = new URL(href, config.agentApiHost).toString();
    }
  }
  return enlaces;
}

function fusionarEnlaces(sesion: SesionViva, crudo: unknown): void {
  const nuevos = extraerEnlaces(crudo);
  for (const [k, v] of Object.entries(nuevos)) sesion.enlaces[k] = v;
}

function enlaceConSufijo(
  sesion: SesionViva,
  nombres: string[],
  sufijo: '/messages' | '/messages/stream',
): string | null {
  for (const nombre of nombres) {
    const enlace = sesion.enlaces[nombre];
    if (!enlace) continue;
    const ruta = new URL(enlace).pathname.replace(/\/+$/, '');
    if (ruta.endsWith(sufijo)) return enlace;
  }
  return null;
}

function siguienteSequenceId(sesion: SesionViva): number {
  // La colección oficial usa un timestamp. Date.now() conserva milisegundos; el
  // máximo con +1 evita duplicados cuando llegan dos mensajes en el mismo tick.
  const siguiente = Math.max(Date.now(), sesion.secuencia + 1);
  sesion.secuencia = siguiente;
  return siguiente;
}

async function esperarPropagacionSesion(sesion: SesionViva): Promise<void> {
  const restante = sesion.operableEn - Date.now();
  if (restante > 0) await esperar(restante);
}

// ─────────────────────────────────────────────────────────────────────────────
// Transporte
// ─────────────────────────────────────────────────────────────────────────────

interface OpcionesLlamada {
  metodo: 'GET' | 'POST' | 'DELETE';
  operacion: string;
  accept: string;
  cuerpo?: unknown;
  cabeceras?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface RespuestaCruda {
  res: Response;
  origenToken: 'client_credentials' | 'cli';
}

async function intento(url: string, op: OpcionesLlamada, token: string): Promise<Response> {
  const signal = op.signal ?? AbortSignal.timeout(op.timeoutMs ?? MS_TIMEOUT);
  try {
    return await fetch(url, {
      method: op.metodo,
      headers: {
        // El token vive aquí y sólo aquí. Nunca se imprime, nunca sale al navegador.
        Authorization: `Bearer ${token}`,
        Accept: op.accept,
        ...(op.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...op.cabeceras,
      },
      ...(op.cuerpo !== undefined ? { body: JSON.stringify(op.cuerpo) } : {}),
      signal,
    });
  } catch (e) {
    const nombre = e instanceof Error ? e.name : '';
    const porInactividad = e instanceof Error && e.message === RAZON_INACTIVIDAD;
    const porTiempo = porInactividad || nombre === 'TimeoutError' || nombre === 'AbortError';
    throw new ErrorAgentAPI(
      porTiempo
        ? `${op.operacion}: la petición a ${url} se agotó por tiempo sin recibir respuesta. ` +
          `Esto es RED, no credencial: el gateway ni siquiera contestó.`
        : `${op.operacion}: no se pudo contactar ${url} — ${mensajeDe(e)}. ` +
          `Esto es RED (DNS, TLS o salida a internet), no credencial.`,
      { operacion: op.operacion, url, cuerpo: seguroParaLog(mensajeDe(e)) },
      'red',
      `Comprobar salida a internet hacia ${config.agentApiHost} desde esta máquina ` +
        `(BLOQUEOS.md §6 para el despliegue).`,
    );
  }
}

async function llamar(url: string, op: OpcionesLlamada): Promise<RespuestaCruda> {
  // La clave puede estar resuelta por el proveedor aunque no venga del entorno.
  const faltaClave = proveedorDeToken().requisitosFaltantes().includes('SF_CLIENT_ID');
  const faltan = requisitosConfiguracionAgentAPI(
    proveedorDeToken().nombre,
    faltaClave ? '' : (config.clientId || 'resuelta-desde-la-org'),
    config.clientSecret,
  );
  if (faltan.length) {
    throw new ErrorAgentAPI(
      `${op.operacion}: la Agent API exige una External Client App con client_credentials; ` +
        `falta ${faltan.join(' y ')}. El token del CLI no sustituye los scopes sfap_api/chatbot_api.`,
      { operacion: op.operacion, url },
      'configuracion_invalida',
      PASO_EXTERNAL_CLIENT_APP,
    );
  }
  const prov = proveedorDeToken();
  // La Agent API no acepta el token de sesión de la org: exige el JWT que emite
  // /agentforce/bootstrap/nameduser. Ver auth.ts para el porqué del intercambio.
  let jwt = await tokenParaAgentAPI();
  let res = await intento(url, op, jwt);

  // 401 → puede ser caducidad. Se renueva UNA vez y se reintenta UNA vez.
  // Si vuelve 401, no es caducidad: es la credencial, y así se reporta.
  if (res.status === 401) {
    await res.text(); // drenar el cuerpo del intento fallido
    _olvidarJwtAgente();
    jwt = await tokenParaAgentAPI(true);
    res = await intento(url, op, jwt);
  }

  return { res, origenToken: prov.nombre };
}

/** Traduce una respuesta no-OK a la causa REAL. Nunca dice "error desconocido". */
function lanzarPorRespuesta(args: {
  res: Response;
  cuerpo: string;
  operacion: string;
  url: string;
  origenToken: 'client_credentials' | 'cli';
}): never {
  const { res, operacion, url, origenToken } = args;
  const status = res.status;
  const redactado = seguroParaLog(args.cuerpo);
  const vacio = redactado.trim() === '';

  let codigo: string | undefined;
  let esJson = false;
  if (!vacio) {
    const json = intentarJson(redactado);
    if (json !== undefined) {
      esJson = true;
      codigo = extraerCodigoError(json);
    }
  }

  const detalle: DetalleAgentAPI = {
    operacion,
    status,
    url,
    // El cuerpo puede contener prompts, respuestas o datos de clientes. Sólo se
    // inspecciona para clasificar/capturar errorCode y nunca queda en el Error.
    cuerpo: null,
    codigoSalesforce: codigo,
    requestIdHash: huellaRequestId(res),
  };

  if (status === 404 && vacio) {
    throw new ErrorAgentAPI(
      `${operacion} respondió 404 con cuerpo vacío. La puerta de enlace ${config.agentApiHost} ` +
        `no enrutó esta petición. La misma respuesta sin Authorization o con un agentId ` +
        `inventado no permite atribuir por sí sola la causa. El lifecycle se verificó antes ` +
        `con esta ECA; revisar el agentId, la activación y los scopes actuales y correlacionar ` +
        `con la huella del request id. Ver docs/CONTRATO-AGENT-API.md.`,
      detalle,
      'gateway_sin_ruta',
      PASO_EXTERNAL_CLIENT_APP,
    );
  }

  if (status === 401 || status === 403) {
    throw new ErrorAgentAPI(
      `${operacion} respondió ${status}. Aquí la puerta SÍ evaluó el token (origen «${origenToken}») ` +
        `y lo rechazó: la credencial existe pero no trae los scopes api, ` +
        `refresh_token/offline_access, chatbot_api y sfap_api, o el ` +
        `usuario de ejecución de la app cliente no tiene el permission set Zapata_Agente_Servicio. ` +
        `Es un problema de credencial, no de enrutado.`,
      detalle,
      'credencial_sin_scopes',
      'Revisar en la External Client App: los cuatro scopes (api, refresh_token/offline_access, ' +
        'chatbot_api, sfap_api) y el ' +
        'usuario de Run As con el permission set Zapata_Agente_Servicio (BLOQUEOS.md §1, pasos 2 y 4).',
    );
  }

  if (status === 404) {
    throw new ErrorAgentAPI(
      esJson
        ? `${operacion} respondió 404 con un error JSON de Salesforce${codigo ? ` (${codigo})` : ''}: ` +
          `la petición SÍ se enrutó y el recurso no existe. Revisa el agentId (${config.agentId}) o ` +
          `el sessionId, no la app cliente.`
        : `${operacion} respondió 404 con una página, no con un error de API (content-type ` +
          `«${res.headers.get('content-type') ?? 'ninguno'}»). Contestó un servidor web, no la Agent ` +
          `API: casi siempre significa que el host ${config.agentApiHost} no es el de la Agent API o ` +
          `que la ruta no es la del contrato.`,
      detalle,
      'recurso_no_encontrado',
      esJson
        ? 'Confirmar el BotDefinition.Id del agente por SOQL y que la sesión siga viva.'
        : `Confirmar SF_AGENT_API_HOST: la Agent API vive en api.salesforce.com, no en el My Domain ` +
          `(docs/CONTRATO-AGENT-API.md §3).`,
    );
  }

  if (status === 400 || status === 405 || status === 415 || status === 422) {
    throw new ErrorAgentAPI(
      `${operacion} respondió ${status}${codigo ? ` (${codigo})` : ''}: la petición no encaja con ` +
        `el contrato (cuerpo, método o sequenceId).`,
      detalle,
      'peticion_invalida',
      'Contrastar el cuerpo enviado con docs/CONTRATO-AGENT-API.md §3 y §4.',
    );
  }

  throw new ErrorAgentAPI(
    `${operacion} respondió ${status}${codigo ? ` (${codigo})` : ''}. Contestó Salesforce, no la red.` +
      (status === 429 ? ' Es límite de peticiones.' : ''),
    detalle,
    'salesforce',
    status >= 500
      ? 'Reintentar y, si persiste, escalar a Salesforce con el traceId de la respuesta.'
      : 'Leer el cuerpo devuelto: trae el errorCode de Salesforce.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Operaciones del contrato
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Abre sesión. `externalSessionKey` queda en los event logs del agente y se inyecta
 * como `$Context.RoutableId`, que es lo que el planner lee para llenar las entradas
 * de correlación de las acciones.
 *
 * No se mapean a `@variables.RoutableId`: esa variable sólo se llena cuando existe
 * una MessagingSession, y por la Agent API no la hay. Con las acciones mapeadas ahí,
 * los Flows recibían `varCorrelationId` vacío y guardaban `CONV-<InterviewGuid>`, así
 * que la cita y el reporte de carretera quedaban huérfanos de la conversación que los
 * originó. Se comprobó en la org el 6-ago-2026 comparando Log_Agente__c: la acción
 * Apex —sin mapeo declarativo— traía el UUID correcto y los Flows —con mapeo— no.
 * Ver `variablesDeCorrelacion` para las alternativas que se probaron y por qué no hay
 * un binding declarativo posible.
 */
export async function abrirSesion(externalSessionKey: string): Promise<SesionAbierta> {
  if (!esUUID(externalSessionKey)) {
    throw new ErrorAgentAPI(
      'abrirSesion exige un externalSessionKey UUID válido: Salesforce usa esa llave para ' +
        'correlacionar la conversación y rechaza identificadores prefijados o inventados.',
      { operacion: 'agente.abrirSesion' },
      'peticion_invalida',
      'Pasar un UUID canónico (por ejemplo, el resultado de crypto.randomUUID()).',
    );
  }

  const url = urlSesiones();
  const operacion = 'agente.abrirSesion';
  const { res, origenToken } = await llamar(url, {
    metodo: 'POST',
    operacion,
    accept: 'application/json',
    cuerpo: {
      externalSessionKey,
      instanceConfig: { endpoint: config.loginUrl },
      streamingCapabilities: { chunkTypes: ['Text'] },
      bypassUser: true,
      variables: variablesDeCorrelacion(externalSessionKey),
    },
  });

  const texto = await res.text();
  if (!res.ok) lanzarPorRespuesta({ res, cuerpo: texto, operacion, url, origenToken });

  const crudo = exigirJson(texto, operacion, res.status, url);
  const sessionId = comoTexto(comoObjeto(crudo)?.['sessionId']);
  if (!sessionId) {
    throw new ErrorAgentAPI(
      `${operacion} respondió ${res.status} pero sin sessionId. La respuesta no encaja con el ` +
        `contrato §3 y no se va a fingir una sesión con ella.`,
      { operacion, status: res.status, url, cuerpo: seguroParaLog(texto).slice(0, 2000) },
      'respuesta_ilegible',
      'Contrastar la respuesta con docs/CONTRATO-AGENT-API.md §3.',
    );
  }

  const enlaces = extraerEnlaces(crudo);
  const abiertaEn = new Date().toISOString();
  sesiones.set(sessionId, {
    sessionId,
    externalSessionKey,
    enlaces,
    secuencia: 0,
    abiertaEn,
    // La org real devuelve Start Session antes de que todas sus réplicas acepten
    // la primera operación. Cinco ciclos controlados pasaron 5/5 con esta ventana.
    operableEn: Date.now() + MS_PROPAGACION_SESION,
    tuvoTurnoExitoso: false,
  });

  return {
    sessionId,
    externalSessionKey,
    enlaces,
    mensajesIniciales: mapearMensajesDeRespuesta(crudo),
    abiertaEn,
    statusHttp: res.status,
  };
}

/**
 * Manda un mensaje y va emitiendo los eventos del SSE conforme llegan.
 * Es un generador asíncrono: quien lo consume decide si los reenvía al navegador,
 * los acumula o los descarta. Si el flujo se corta, se lanza; nunca se cierra el turno
 * con un texto a medias haciéndolo pasar por completo.
 */
export async function* enviarMensajeStream(
  sessionId: string,
  texto: string,
  opciones?: OpcionesEnvio,
): AsyncGenerator<EventoAgente, void, void> {
  const operacion = 'agente.enviarMensajeStream';
  const sesion = exigirSesion(sessionId, operacion);
  await esperarPropagacionSesion(sesion);
  // La respuesta real observada nombra `messages` al enlace de streaming. Sólo se
  // sigue un link cuyo path coincida con la operación para no mandar sync a /stream.
  const url =
    enlaceConSufijo(sesion, ['messagesStream', 'messages'], '/messages/stream') ??
    urlCanonicaSesion(sessionId, '/messages/stream');
  // Avanza aunque el envío falle: repetir un sequenceId sería peor que saltarlo.
  const sequenceId = siguienteSequenceId(sesion);
  const msInactividad = opciones?.msInactividad ?? MS_INACTIVIDAD_STREAM;
  const cerrarEnFin = opciones?.cerrarEnFinDeTurno ?? true;

  const controlador = new AbortController();
  let reloj: ReturnType<typeof setTimeout> | null = null;
  const rearmar = (): void => {
    if (reloj) clearTimeout(reloj);
    reloj = setTimeout(() => controlador.abort(new Error(RAZON_INACTIVIDAD)), msInactividad);
  };
  rearmar();

  try {
    let { res, origenToken } = await llamar(url, {
      metodo: 'POST',
      operacion,
      accept: 'text/event-stream',
      cuerpo: cuerpoDeMensaje(sequenceId, texto, opciones?.variables),
      signal: controlador.signal,
    });

    // Primer turno de una sesión nueva: un 400 aquí es propagación, no contrato.
    //
    // Antes se reintentaba UNA vez tras 2.5 s y, si volvía a fallar, se daba la sesión
    // por perdida. Medido contra la org el 7-ago-2026: no alcanza. Hubo conversaciones
    // en las que los tres primeros turnos murieron así, quemando una sesión cada uno,
    // y el cuarto funcionó ~30 s después del primer intento. El cliente veía tres
    // errores seguidos por algo que sólo necesitaba tiempo.
    //
    // Ahora se insiste sobre LA MISMA sesión con esperas crecientes. Sólo aplica al
    // primer turno: una sesión que ya funcionó y luego devuelve 400 sí es un problema
    // de contrato y debe reportarse de inmediato.
    for (const espera of ESPERAS_PROPAGACION) {
      if (res.status !== 400 || sesion.tuvoTurnoExitoso) break;
      await res.text(); // drenar el cuerpo del intento fallido
      await esperar(espera);
      const reintento = await llamar(url, {
        metodo: 'POST',
        operacion,
        accept: 'text/event-stream',
        cuerpo: cuerpoDeMensaje(siguienteSequenceId(sesion), texto, opciones?.variables),
        signal: controlador.signal,
      });
      res = reintento.res;
      origenToken = reintento.origenToken;
    }

    if (!res.ok) {
      const cuerpo = await res.text();
      lanzarPorRespuesta({ res, cuerpo, operacion, url, origenToken });
    }
    sesion.tuvoTurnoExitoso = true;

    const tipoContenido = res.headers.get('content-type') ?? '';
    if (!tipoContenido.includes('text/event-stream')) {
      const cuerpo = seguroParaLog(await res.text()).slice(0, 2000);
      throw new ErrorAgentAPI(
        `${operacion} respondió ${res.status} con content-type «${tipoContenido || 'ninguno'}» en ` +
          `vez de text/event-stream. La respuesta no encaja con el contrato §5 y no se va a ` +
          `interpretar a la fuerza.`,
        { operacion, status: res.status, url, cuerpo },
        'respuesta_ilegible',
        'Contrastar la respuesta con docs/CONTRATO-AGENT-API.md §5.',
      );
    }

    let recibioFin = false;
    for await (const bloque of leerBloquesSSE(res, operacion, url, rearmar, controlador)) {
      const evento = mapearBloque(bloque);
      yield evento;
      if (evento.tipo === 'Error') {
        throw new ErrorAgentAPI(
          `${operacion}: el agente emitió un evento Error${evento.texto ? ` (${evento.texto})` : ''}. ` +
            'El turno no se considera terminado correctamente.',
          { operacion, status: res.status, url },
          'salesforce',
          'Revisar el traceId/planId del turno en Salesforce y corregir la acción que falló antes de reintentar.',
        );
      }
      if (evento.tipo === 'EndOfTurn' || evento.tipo === 'SessionEnded') {
        recibioFin = true;
        if (evento.tipo === 'SessionEnded') sesiones.delete(sessionId);
        if (cerrarEnFin) return;
      }
    }
    if (!recibioFin) {
      throw new ErrorAgentAPI(
        `${operacion}: Salesforce cerró el flujo SSE sin EndOfTurn ni SessionEnded. ` +
          'El turno quedó truncado y no se entrega como completo.',
        { operacion, status: res.status, url },
        'respuesta_ilegible',
        'Reintentar el turno y revisar la traza de Agentforce; el stream debe finalizar con EndOfTurn o SessionEnded.',
      );
    }
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}

/** Variante síncrona del contrato §4. Devuelve el turno completo de una vez. */
export async function enviarMensajeSync(
  sessionId: string,
  texto: string,
  opciones?: OpcionesEnvio,
): Promise<RespuestaSincrona> {
  const operacion = 'agente.enviarMensajeSync';
  const sesion = exigirSesion(sessionId, operacion);
  await esperarPropagacionSesion(sesion);
  const url =
    enlaceConSufijo(sesion, ['messagesSync', 'messages'], '/messages') ??
    urlCanonicaSesion(sessionId, '/messages');
  const sequenceId = siguienteSequenceId(sesion);

  const { res, origenToken } = await llamar(url, {
    metodo: 'POST',
    operacion,
    accept: 'application/json',
    cuerpo: cuerpoDeMensaje(sequenceId, texto, opciones?.variables),
  });

  const cuerpo = await res.text();
  if (!res.ok) lanzarPorRespuesta({ res, cuerpo, operacion, url, origenToken });

  const crudo = exigirJson(cuerpo, operacion, res.status, url);
  fusionarEnlaces(sesion, crudo);
  const eventos = exigirMensajesDeRespuesta(crudo, operacion, res.status, url);
  const error = eventos.find((evento) => evento.tipo === 'Error');
  if (error) {
    throw new ErrorAgentAPI(
      `${operacion}: el agente devolvió un evento Error${error.texto ? ` (${error.texto})` : ''}.`,
      { operacion, status: res.status, url },
      'salesforce',
      'Revisar el traceId/planId del turno en Salesforce y corregir la acción que falló antes de reintentar.',
    );
  }

  return {
    sessionId,
    sequenceId,
    eventos,
    texto: eventos.map((e) => e.texto ?? '').join(''),
  };
}

/** Cierra la sesión. El header `x-session-end-reason` es OBLIGATORIO (contrato §6). */
export async function cerrarSesion(
  sessionId: string,
  motivo: MotivoFinDeSesion = 'UserRequest',
): Promise<SesionCerrada> {
  const operacion = 'agente.cerrarSesion';
  const sesion = exigirSesion(sessionId, operacion);
  await esperarPropagacionSesion(sesion);
  const url = sesion.enlaces['end'] ?? urlCanonicaSesion(sessionId, '');

  const opcionesCierre: OpcionesLlamada = {
    metodo: 'DELETE',
    operacion,
    accept: 'application/json',
    cabeceras: { 'x-session-end-reason': motivo },
  };

  const respuesta = await llamar(url, opcionesCierre);
  const cuerpo = await respuesta.res.text();

  const { res, origenToken } = respuesta;
  if (!res.ok) lanzarPorRespuesta({ res, cuerpo, operacion, url, origenToken });

  const crudo = exigirJson(cuerpo, operacion, res.status, url);
  const eventos = exigirMensajesDeRespuesta(crudo, operacion, res.status, url);
  if (!eventos.some((evento) => evento.tipo === 'SessionEnded')) {
    throw new ErrorAgentAPI(
      `${operacion} respondió ${res.status} pero no confirmó SessionEnded. ` +
        'La sesión permanece registrada porque no hay evidencia de que Salesforce la cerrara.',
      { operacion, status: res.status, url },
      'respuesta_ilegible',
      'Reintentar el cierre; la respuesta contractual debe incluir un mensaje SessionEnded.',
    );
  }

  // Sólo se olvida la sesión después de una confirmación contractual explícita.
  sesiones.delete(sessionId);
  return { sessionId, motivo, eventos };
}

// ─────────────────────────────────────────────────────────────────────────────
// Estado — lo que consume /salud
// ─────────────────────────────────────────────────────────────────────────────

let cacheEstado: { en: number; valor: EstadoAgentAPI } | null = null;

/**
 * Comprueba credenciales y hace una SONDA REAL (abre una sesión y la cierra).
 * El resultado se cachea unos segundos porque cada sonda abre una sesión de verdad en
 * la org; el `verificadoEn` dice de cuándo es la medición, así que no engaña a nadie.
 */
export async function estadoAgentAPI(opciones?: {
  forzar?: boolean;
  msCache?: number;
}): Promise<EstadoAgentAPI> {
  const msCache = opciones?.msCache ?? MS_CACHE_ESTADO;
  if (!opciones?.forzar && cacheEstado && Date.now() - cacheEstado.en < msCache) {
    return cacheEstado.valor;
  }
  const valor = await medirEstado();
  cacheEstado = { en: Date.now(), valor };
  return valor;
}

async function medirEstado(): Promise<EstadoAgentAPI> {
  const prov = proveedorDeToken();
  // La clave puede venir del entorno o haberla leído el proveedor desde la org, así
  // que se le pregunta a él en vez de mirar la variable: si no, se reporta como
  // faltante algo que sí está resuelto.
  const faltaClaveSegunProveedor = prov.requisitosFaltantes().includes('SF_CLIENT_ID');
  const faltan = requisitosConfiguracionAgentAPI(
    prov.nombre,
    faltaClaveSegunProveedor ? '' : (config.clientId || 'resuelta-desde-la-org'),
    config.clientSecret,
  );
  const url = urlSesiones();
  const base = {
    proveedorToken: prov.nombre,
    requisitosFaltantes: faltan,
    agentId: config.agentId,
    host: config.agentApiHost,
    verificadoEn: new Date().toISOString(),
  };

  if (faltan.length) {
    return {
      ...base,
      disponible: false,
      causa:
        `No hay credenciales de External Client App: falta ${faltan.join(' y ')}. ` +
        `Sin ellas no existe token que la puerta de enlace acepte.`,
      pasoQueFalta: PASO_EXTERNAL_CLIENT_APP,
      sonda: { intentada: false, ok: false, status: null, clase: null, ms: null, url, detalle: null },
      nota: 'No se sondeó: sin credenciales la sonda sólo confirmaría lo que ya se sabe.',
    };
  }

  const t0 = Date.now();
  try {
    const sesion = await abrirSesion(randomUUID());
    // Lo que mide esta sonda es si la Agent API deja ABRIR una sesión. El cierre es
    // limpieza: Salesforce puede rechazarlo con 400 si llega antes de que la sesión
    // se propague, y esa sesión caduca sola. Dejar que un cierre fallido reportara
    // "agente no disponible" era mentir sobre algo que sí funciona.
    //
    // Pero tampoco se puede decir lo contrario: antes se publicaba
    // `cierreConfirmado: true` y una nota afirmando que Salesforce confirmó el
    // SessionEnded aunque el cierre hubiera fallado. Eso era afirmar una confirmación
    // que nunca llegó. Ahora se mide y se dice tal cual.
    const cierreConfirmado = await cerrarSesion(sesion.sessionId, 'UserRequest').then(
      () => true,
      () => false,
    );
    const ms = Date.now() - t0;
    return {
      ...base,
      disponible: true,
      causa: null,
      pasoQueFalta: null,
      sonda: {
        intentada: true,
        ok: true,
        status: sesion.statusHttp,
        clase: null,
        ms,
        url,
        detalle: { enlaces: Object.keys(sesion.enlaces), cierreConfirmado },
      },
      nota: cierreConfirmado
        ? 'Sonda real: se abrió una sesión y Salesforce confirmó SessionEnded al cerrarla.'
        : 'Sonda real: se abrió una sesión. El cierre NO quedó confirmado; la conversación ' +
          'funciona y esa sesión caduca sola, pero conviene revisar si se repite.',
    };
  } catch (e) {
    const ms = Date.now() - t0;
    const esAgente = e instanceof ErrorAgentAPI;
    const esSf = e instanceof ErrorSalesforce;
    return {
      ...base,
      disponible: false,
      causa: mensajeDe(e),
      pasoQueFalta: esAgente
        ? e.pasoQueFalta
        : `Resolver el fallo de credencial antes de la Agent API. ${PASO_EXTERNAL_CLIENT_APP}`,
      sonda: {
        intentada: true,
        ok: false,
        status: esSf ? e.detalle.status ?? null : null,
        clase: esAgente ? e.clase : null,
        ms,
        url,
        detalle: esSf ? e.aJSON() : { mensaje: seguroParaLog(mensajeDe(e)) },
      },
      nota: null,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE
// ─────────────────────────────────────────────────────────────────────────────

interface BloqueSSE {
  evento: string;
  datos: string;
}

/**
 * Parser de text/event-stream. Corta por línea en blanco, junta las líneas `data:` con
 * salto de línea (como manda el formato) e ignora comentarios `:`.
 */
async function* leerBloquesSSE(
  res: Response,
  operacion: string,
  url: string,
  rearmar: () => void,
  controlador: AbortController,
): AsyncGenerator<BloqueSSE, void, void> {
  const cuerpo = res.body;
  if (!cuerpo) {
    throw new ErrorAgentAPI(
      `${operacion} devolvió ${res.status} sin cuerpo legible: no hay flujo que leer.`,
      { operacion, status: res.status, url },
      'respuesta_ilegible',
      'Contrastar con docs/CONTRATO-AGENT-API.md §5.',
    );
  }

  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      let trozo: Awaited<ReturnType<typeof lector.read>>;
      try {
        trozo = await lector.read();
      } catch (e) {
        const porInactividad =
          (e instanceof Error && e.message === RAZON_INACTIVIDAD) ||
          (controlador.signal.aborted &&
            controlador.signal.reason instanceof Error &&
            controlador.signal.reason.message === RAZON_INACTIVIDAD);
        throw new ErrorAgentAPI(
          porInactividad
            ? `${operacion}: el flujo SSE se quedó sin datos y se cortó por inactividad. ` +
              `El turno quedó incompleto; no se entrega lo recibido como si estuviera terminado.`
            : `${operacion}: el flujo SSE se rompió — ${mensajeDe(e)}.`,
          { operacion, url, cuerpo: seguroParaLog(mensajeDe(e)) },
          'red',
          'Reintentar el turno. Si se repite, revisar la salida a internet y el proxy.',
        );
      }

      if (trozo.done) break;
      rearmar();
      buffer += decodificador.decode(trozo.value, { stream: true }).replace(/\r\n/g, '\n');

      let corte = buffer.indexOf('\n\n');
      while (corte !== -1) {
        const bruto = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        const bloque = interpretarBloque(bruto);
        if (bloque) yield bloque;
        corte = buffer.indexOf('\n\n');
      }
    }

    // Lo que quedó sin línea en blanco final también cuenta: descartarlo perdería el
    // último evento del turno.
    const ultimo = interpretarBloque(buffer);
    if (ultimo) yield ultimo;
  } finally {
    await lector.cancel().catch((e: unknown) => {
      console.error(`[agente] al cerrar el flujo SSE: ${seguroParaLog(mensajeDe(e))}`);
    });
  }
}

function interpretarBloque(bruto: string): BloqueSSE | null {
  let evento = '';
  const datos: string[] = [];
  for (const linea of bruto.split('\n')) {
    if (linea === '' || linea.startsWith(':')) continue;
    const sep = linea.indexOf(':');
    const campo = sep === -1 ? linea : linea.slice(0, sep);
    const valor = sep === -1 ? '' : linea.slice(sep + 1).replace(/^ /, '');
    if (campo === 'event') evento = valor;
    else if (campo === 'data') datos.push(valor);
  }
  if (!evento && datos.length === 0) return null;
  return { evento, datos: datos.join('\n') };
}

function mapearBloque(bloque: BloqueSSE): EventoAgente {
  const vacio: EventoAgente = {
    tipo: 'Desconocido',
    evento: bloque.evento || 'sin-nombre',
    id: null,
    timestamp: null,
    traceId: null,
    planId: null,
    originEventId: null,
    texto: null,
    citedReferences: [],
    resultados: [],
  };

  if (bloque.datos.trim() === '') return vacio;

  const carga = intentarJson(bloque.datos);
  if (carga === undefined) {
    return vacio;
  }
  return mapearPayload(carga, bloque.evento);
}

function mapearPayload(carga: unknown, nombreEvento: string): EventoAgente {
  const raiz = comoObjeto(carga);
  const mensaje = comoObjeto(raiz?.['message']);
  const tipo =
    comoTipo(mensaje?.['type']) ?? comoTipo(raiz?.['type']) ?? comoTipo(nombreEvento) ?? 'Desconocido';

  return {
    tipo,
    evento: nombreEvento || tipo,
    id: comoTexto(mensaje?.['id']),
    timestamp: comoNumero(raiz?.['timestamp']),
    traceId: comoTexto(raiz?.['traceId']) ?? comoTexto(mensaje?.['traceId']),
    planId: comoTexto(mensaje?.['planId']) ?? comoTexto(raiz?.['planId']),
    originEventId: comoTexto(raiz?.['originEventId']),
    texto: comoTexto(mensaje?.['message']) ?? comoTexto(mensaje?.['text']),
    citedReferences: mapearReferencias(mensaje?.['citedReferences']),
    resultados: Array.isArray(mensaje?.['result']) ? (mensaje['result'] as unknown[]) : [],
  };
}

/** Las respuestas no-stream traen `messages: [...]`; se mapean a la misma forma. */
function mapearMensajesDeRespuesta(crudo: unknown): EventoAgente[] {
  const lista = comoObjeto(crudo)?.['messages'];
  if (!Array.isArray(lista)) return [];
  return lista.map((m) => mapearPayload({ message: m }, comoTexto(comoObjeto(m)?.['type']) ?? ''));
}

function exigirMensajesDeRespuesta(
  crudo: unknown,
  operacion: string,
  status: number,
  url: string,
): EventoAgente[] {
  const lista = comoObjeto(crudo)?.['messages'];
  if (!Array.isArray(lista) || lista.length === 0) {
    throw new ErrorAgentAPI(
      `${operacion} respondió ${status} pero no incluyó un arreglo messages no vacío.`,
      { operacion, status, url },
      'respuesta_ilegible',
      'Contrastar la respuesta con el contrato Agent API: el resultado debe incluir messages.',
    );
  }
  return lista.map((m) => mapearPayload({ message: m }, comoTexto(comoObjeto(m)?.['type']) ?? ''));
}

function mapearReferencias(valor: unknown): ReferenciaCitada[] {
  if (!Array.isArray(valor)) return [];
  return valor.map((r) => {
    const o = comoObjeto(r);
    return { tipo: comoTexto(o?.['type']), valor: comoTexto(o?.['value']) };
  });
}

function cuerpoDeMensaje(sequenceId: number, texto: string, variables?: VariableAgente[]) {
  return { message: { sequenceId, type: 'Text', text: texto }, variables: variables ?? [] };
}

/**
 * La correlación que se inyecta al abrir la sesión.
 *
 * Sólo se puede mandar como variable de CONTEXTO. Se probaron las dos alternativas
 * declarativas y las dos están cerradas, así que conviene no volver a intentarlas:
 *
 *   · declarar una variable propia del agente y mandarla aquí por nombre → la Agent
 *     API responde 400 `InternalVariableMutationAttemptException`;
 *   · enlazarla en el bundle con `source: @Context.RoutableId` → el compilador de
 *     Agent Script sólo admite @MessagingSession, @MessagingEndUser y @VoiceCall.
 *
 * Por eso es el planner quien copia este valor a las entradas de correlación,
 * guiado por las descripciones del bundle. Es el mismo mecanismo con el que la
 * acción Apex de escalamiento acumula en esta org 26 casos con el UUID correcto.
 * La verificación e2e relee Salesforce justamente para que un fallo aquí salga en
 * rojo y no en silencio.
 */
function variablesDeCorrelacion(externalSessionKey: string): VariableAgente[] {
  return [{ name: '$Context.RoutableId', type: 'Text', value: externalSessionKey }];
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

function comoObjeto(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function comoTexto(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function comoNumero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * La documentación nombra los eventos en PascalCase (`TextChunk`) pero el flujo real
 * los emite en mayúsculas con guión bajo (`TEXT_CHUNK`). Se aceptan las dos formas.
 *
 * Esto no es cosmético: con sólo la forma documentada, cada turno del agente llegaba
 * como "Desconocido", el texto nunca se acumulaba y la conversación entera parecía
 * un fallo del servicio cuando en realidad había respondido bien.
 */
function normalizarNombreEvento(v: string): string {
  return v.replace(/[_\s-]/g, '').toLowerCase();
}

const TIPOS_POR_NOMBRE = new Map<string, TipoEventoAgente>(
  TIPOS_CONOCIDOS.map((t) => [normalizarNombreEvento(t), t]),
);

function comoTipo(v: unknown): TipoEventoAgente | null {
  if (typeof v !== 'string') return null;
  return TIPOS_POR_NOMBRE.get(normalizarNombreEvento(v)) ?? null;
}

function extraerCodigoError(valor: unknown): string | undefined {
  const raiz = Array.isArray(valor) ? comoObjeto(valor[0]) : comoObjeto(valor);
  const error = comoObjeto(raiz?.['error']);
  const candidatos = [
    raiz?.['errorCode'],
    raiz?.['code'],
    error?.['errorCode'],
    error?.['code'],
    typeof raiz?.['error'] === 'string' ? raiz['error'] : null,
  ];
  for (const candidato of candidatos) {
    const codigo = comoTexto(candidato);
    // Un código es metadato de diagnóstico; nunca se acepta una frase/payload aquí.
    if (codigo && /^[A-Za-z][A-Za-z0-9_.:-]{1,100}$/.test(codigo)) return codigo;
  }
  return undefined;
}

function huellaRequestId(res: Response): string | undefined {
  const requestId = res.headers.get('x-request-id');
  if (!requestId) return undefined;
  return createHash('sha256').update(requestId, 'utf8').digest('hex').slice(0, 16);
}

function esUUID(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor,
  );
}

/** JSON.parse que devuelve `undefined` en vez de lanzar. Quien llama decide qué hacer. */
function intentarJson(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch (e) {
    void e; // el fallo no se traga: los llamantes reportan el texto crudo en su lugar
    return undefined;
  }
}

function exigirJson(texto: string, operacion: string, status: number, url: string): unknown {
  const redactado = seguroParaLog(texto);
  const json = intentarJson(redactado);
  if (json === undefined) {
    throw new ErrorAgentAPI(
      `${operacion} respondió ${status} con algo que no es JSON.`,
      { operacion, status, url, cuerpo: redactado.slice(0, 2000) },
      'respuesta_ilegible',
      'Contrastar la respuesta con docs/CONTRATO-AGENT-API.md.',
    );
  }
  return json;
}

function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}
