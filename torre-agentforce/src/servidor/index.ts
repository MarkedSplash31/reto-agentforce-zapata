// N7 · Servidor de la Torre.
//
// Es un intermediario, no un almacén: no persiste datos de negocio. Los lee y los
// escribe en Salesforce.
//
// Responsabilidades:
//   · custodiar el token OAuth — jamás llega al navegador
//   · proxy hacia la Agent API con streaming al cliente
//   · consultas de sólo lectura para las vistas
//   · invocación de Flows para las escrituras
//   · canal de escalamiento
//   · /salud, que reporta el estado REAL de cada dependencia

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { config, configSegura, securityConfig } from './config.ts';
import { HttpRequestError, comoRespuestaHttp } from './errores.ts';
import { proveedorDeToken, prepararProveedorDeToken } from './auth.ts';
import {
  AuthenticationError,
  ClientSuppliedContextError,
  DevelopmentAuthProvider,
  FixedWindowRateLimiter,
  RateLimitError,
  ResourceAuthorizer,
  StaticTokenAuthProvider,
  clientNetworkKey,
  createOperationContext,
  rejectClientSuppliedContext,
  requireRole,
  type AuthProvider,
  type Principal,
  type Role,
} from './security.ts';
import { applyCors, applySecureHeaders, isPathInside, readJsonBody } from './http-security.ts';
import { consultar } from './sf.ts';
import * as datos from './datos.ts';
import * as flows from './flows.ts';
import * as escalamiento from './escalamiento.ts';
import * as agente from './agente.ts';
import { rutasPublicas } from './rutas-publicas.ts';
import {
  OidcSecurityError,
  createSalesforceOidcBff,
  type AuthenticatedOidcSession,
  type SalesforceOidcBff,
} from './oidc.ts';

const RAIZ_PUBLICA = resolve(process.cwd(), 'publico');
const authProvider: AuthProvider | null =
  securityConfig.authProvider === 'static'
    ? new StaticTokenAuthProvider(securityConfig.credentials)
    : securityConfig.authProvider === 'disabled'
      ? new DevelopmentAuthProvider()
      : null;
const oidcBff: SalesforceOidcBff | null = config.oidc
  ? createSalesforceOidcBff({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      loginOrigin: config.loginUrl,
      callbackUrls: [config.oidc.callbackUrl],
      allowedOrigins: [config.oidc.externalOrigin],
      allowedSalesforceHosts: config.oidc.allowedSalesforceHosts,
      expectedIssuers: config.oidc.expectedIssuers,
      apiVersion: config.apiVersion,
      production: securityConfig.appEnv === 'production',
      roleMappings: {
        adminPermissionSets: config.oidc.adminPermissionSets,
        advisorPermissionSets: config.oidc.advisorPermissionSets,
      },
      scopes: config.oidc.scopes,
      sessionTtlMs: config.oidc.sessionTtlMs,
      authAttemptTtlMs: config.oidc.authAttemptTtlMs,
      maxSessions: config.oidc.maxSessions,
      maxAuthAttempts: config.oidc.maxAuthAttempts,
      requestTimeoutMs: securityConfig.salesforceTimeoutMs,
    })
  : null;
const recursos = new ResourceAuthorizer();
const limiteApi = new FixedWindowRateLimiter(
  securityConfig.rateLimitMax,
  securityConfig.rateLimitWindowMs,
);
const limiteAuth = new FixedWindowRateLimiter(
  securityConfig.authRateLimitMax,
  securityConfig.rateLimitWindowMs,
);
const buildCandidate =
  process.env.APP_BUILD_ID ??
  process.env.RENDER_GIT_COMMIT ??
  process.env.npm_package_version ??
  'unknown';
const BUILD_ID = /^[A-Za-z0-9._-]{1,80}$/.test(buildCandidate) ? buildCandidate : 'unknown';
const shutdownTimeoutCandidate = Number(process.env.APP_SHUTDOWN_TIMEOUT_MS ?? 10_000);
if (
  !Number.isSafeInteger(shutdownTimeoutCandidate) ||
  shutdownTimeoutCandidate < 250 ||
  shutdownTimeoutCandidate > 30_000
) {
  throw new Error('APP_SHUTDOWN_TIMEOUT_MS debe ser un entero entre 250 y 30000.');
}
const SHUTDOWN_TIMEOUT_MS = shutdownTimeoutCandidate;
const respuestasSse = new Set<ServerResponse>();
const sockets = new Set<Socket>();
let drenando = false;

const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res: ServerResponse, status: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(texto);
}

async function cuerpoJson<T>(req: IncomingMessage): Promise<T> {
  return readJsonBody<T>(req, securityConfig.bodyLimitBytes);
}

function exigirMetodo(actual: string, esperado: 'GET' | 'POST'): void {
  if (actual !== esperado) {
    throw new HttpRequestError(405, 'METHOD_NOT_ALLOWED', `Esta ruta requiere ${esperado}.`);
  }
}

function exigirRol(principal: Principal, roles: readonly Role[]): void {
  requireRole(principal, roles);
}

function exigirContextoDelServidor(cuerpo: unknown): void {
  try {
    rejectClientSuppliedContext(cuerpo);
  } catch (error) {
    if (error instanceof ClientSuppliedContextError) {
      throw new HttpRequestError(400, error.code, error.message);
    }
    throw error;
  }
}

function operationNonce(cuerpo: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(cuerpo, 'operationNonce')) return undefined;
  if (
    typeof cuerpo.operationNonce !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cuerpo.operationNonce)
  ) {
    throw new HttpRequestError(400, 'INVALID_OPERATION_NONCE', 'operationNonce debe ser un UUID v4.');
  }
  return cuerpo.operationNonce;
}

function exigirTextoCuerpo(cuerpo: Record<string, unknown>, campo: string): void {
  if (typeof cuerpo[campo] !== 'string' || cuerpo[campo].trim() === '') {
    throw new HttpRequestError(400, 'INVALID_REQUEST', `${campo} es obligatorio.`);
  }
}

function exigirBooleanoCuerpo(cuerpo: Record<string, unknown>, campo: string): void {
  if (typeof cuerpo[campo] !== 'boolean') {
    throw new HttpRequestError(400, 'INVALID_REQUEST', `${campo} debe confirmarse como true o false.`);
  }
}

function idDecodificado(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpRequestError(400, 'INVALID_RESOURCE_ID', 'El identificador del recurso no es valido.');
  }
}

function claveRed(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  return clientNetworkKey(
    req.socket.remoteAddress,
    typeof forwarded === 'string' ? forwarded : undefined,
    securityConfig.trustedProxies,
  );
}

async function exigirAccesoCaso(caseId: string, principal: Principal): Promise<void> {
  await recursos.requireCaseAccess(caseId, principal, async (id) => {
    // Un unico predicado evita distinguir "no existe" de "existe pero es ajeno".
    // Ambos producen totalSize=0 y terminan en el mismo AccessDeniedError.
    const result = await consultar<{ Id: string }>(
      `SELECT Id FROM Case WHERE Id='${id}' AND OwnerId='${config.caseQueueId}' LIMIT 1`,
      'security.case.queue-ownership',
    );
    return result.totalSize === 1;
  });
}

interface IdentidadSolicitud {
  readonly principal: Principal;
  readonly oidcSession?: AuthenticatedOidcSession;
}

function headerUnico(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function relanzarOidc(error: unknown): never {
  if (error instanceof OidcSecurityError) {
    throw new HttpRequestError(error.status, error.code, error.message);
  }
  throw error;
}

async function autenticar(req: IncomingMessage): Promise<IdentidadSolicitud> {
  const networkKey = claveRed(req);
  let identity: IdentidadSolicitud;
  try {
    if (oidcBff) {
      const session = oidcBff.authenticate(headerUnico(req.headers.cookie));
      identity = { principal: session.principal, oidcSession: session };
    } else {
      if (!authProvider) throw new Error('No hay proveedor de autenticacion inicializado.');
      identity = { principal: await authProvider.authenticate(req.headers.authorization) };
    }
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      (error instanceof OidcSecurityError && error.status === 401)
    ) {
      const authLimit = limiteAuth.consume(networkKey);
      if (!authLimit.allowed) throw new RateLimitError(authLimit.retryAfterSeconds);
    }
    if (error instanceof OidcSecurityError) relanzarOidc(error);
    throw error;
  }
  const apiLimit = limiteApi.consume(`${networkKey}:${identity.principal.id}`);
  if (!apiLimit.allowed) throw new RateLimitError(apiLimit.retryAfterSeconds);
  return identity;
}

function vistaSesion(
  provider: typeof securityConfig.authProvider,
  session?: AuthenticatedOidcSession,
  principal?: Principal,
): Record<string, unknown> {
  const selected = session?.principal ?? principal;
  return {
    provider,
    authenticated: Boolean(selected),
    principal: selected ? { id: selected.id, role: selected.role } : null,
    csrfToken: session?.csrfToken ?? null,
    expiresAt: session?.expiresAt ?? null,
    loginPath: provider === 'oidc' ? '/auth/salesforce/login' : null,
  };
}

function limiteFlujoAuth(req: IncomingMessage): void {
  const decision = limiteAuth.consume(`auth-flow:${claveRed(req)}`);
  if (!decision.allowed) throw new RateLimitError(decision.retryAfterSeconds);
}

async function rutasAutenticacion(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (path === '/auth/session') {
    exigirMetodo(method, 'GET');
    limiteFlujoAuth(req);
    if (oidcBff) {
      try {
        const session = oidcBff.authenticate(headerUnico(req.headers.cookie));
        json(res, 200, vistaSesion('oidc', session));
      } catch (error) {
        if (error instanceof OidcSecurityError && error.code === 'OIDC_SESSION_INVALID') {
          json(res, 200, vistaSesion('oidc'));
          return true;
        }
        relanzarOidc(error);
      }
      return true;
    }
    if (securityConfig.authProvider === 'disabled') {
      if (!authProvider) throw new Error('Proveedor local no inicializado.');
      const principal = await authProvider.authenticate(undefined);
      json(res, 200, vistaSesion('disabled', undefined, principal));
    } else {
      json(res, 200, vistaSesion('static'));
    }
    return true;
  }

  if (path === '/auth/salesforce/login') {
    exigirMetodo(method, 'GET');
    if (!oidcBff || !config.oidc) {
      throw new HttpRequestError(404, 'NOT_FOUND', 'El proveedor OIDC no esta habilitado.');
    }
    limiteFlujoAuth(req);
    try {
      const started = oidcBff.beginAuthorization({
        origin: config.oidc.externalOrigin,
        callbackUrl: config.oidc.callbackUrl,
        returnTo: url.searchParams.get('returnTo') ?? undefined,
      });
      res.writeHead(302, {
        Location: started.authorizationUrl,
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      });
      res.end();
      return true;
    } catch (error) {
      relanzarOidc(error);
    }
  }

  if (path === '/auth/salesforce/callback') {
    exigirMetodo(method, 'GET');
    if (!oidcBff || !config.oidc) {
      throw new HttpRequestError(404, 'NOT_FOUND', 'El proveedor OIDC no esta habilitado.');
    }
    limiteFlujoAuth(req);
    const callback = new URL(config.oidc.callbackUrl);
    callback.search = url.search;
    try {
      const completed = await oidcBff.completeAuthorization({
        callbackUrl: callback.href,
        origin: config.oidc.externalOrigin,
      });
      res.writeHead(303, {
        Location: completed.returnTo,
        'Set-Cookie': completed.setCookie,
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      });
      res.end();
      return true;
    } catch (error) {
      relanzarOidc(error);
    }
  }

  if (path === '/auth/logout') {
    exigirMetodo(method, 'POST');
    if (!oidcBff) throw new HttpRequestError(404, 'NOT_FOUND', 'El proveedor OIDC no esta habilitado.');
    limiteFlujoAuth(req);
    try {
      const result = oidcBff.logout({
        cookieHeader: headerUnico(req.headers.cookie),
        origin: headerUnico(req.headers.origin),
        csrfToken: headerUnico(req.headers['x-csrf-token']),
      });
      res.setHeader('Set-Cookie', result.setCookie);
      json(res, 200, { authenticated: false, provider: 'oidc' });
      return true;
    } catch (error) {
      relanzarOidc(error);
    }
  }

  if (path === '/auth/refresh') {
    exigirMetodo(method, 'POST');
    if (!oidcBff) throw new HttpRequestError(404, 'NOT_FOUND', 'El proveedor OIDC no esta habilitado.');
    limiteFlujoAuth(req);
    const cookie = headerUnico(req.headers.cookie);
    try {
      const current = oidcBff.authenticate(cookie);
      oidcBff.assertMutationAllowed({
        method,
        origin: headerUnico(req.headers.origin),
        csrfToken: headerUnico(req.headers['x-csrf-token']),
      }, current);
      await oidcBff.refreshSalesforceSession(cookie);
      const rotated = oidcBff.rotateSession(cookie);
      res.setHeader('Set-Cookie', rotated.setCookie);
      json(res, 200, {
        ...vistaSesion('oidc', oidcBff.authenticate(rotated.setCookie.split(';', 1)[0])),
      });
      return true;
    } catch (error) {
      relanzarOidc(error);
    }
  }

  return false;
}

// ── /salud ───────────────────────────────────────────────────────────────────
// Reporta lo que devuelve cada dependencia. Nunca contesta "ok" fijo: si algo
// está caído tiene que decirlo, con su causa y el paso que falta.

interface Dependencia {
  nombre: string;
  disponible: boolean;
  detalle: string;
  ms: number | null;
  pasoQueFalta?: string;
}

async function salud(): Promise<{ ok: boolean; config: unknown; dependencias: Dependencia[] }> {
  const deps: Dependencia[] = [];

  // 1. credencial
  const prov = proveedorDeToken();
  const faltan = prov.requisitosFaltantes();
  const t0 = Date.now();
  try {
    if (faltan.length) throw new Error(`faltan ${faltan.join(', ')}`);
    await prov.obtener();
    deps.push({
      nombre: `Credencial (${prov.nombre})`,
      disponible: true,
      detalle: `Token obtenido por el proveedor "${prov.nombre}".`,
      ms: Date.now() - t0,
    });
  } catch (e) {
    deps.push({
      nombre: `Credencial (${prov.nombre})`,
      disponible: false,
      detalle: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t0,
      pasoQueFalta: faltan.length ? `Definir ${faltan.join(' y ')} en .env (BLOQUEOS.md §1)` : undefined,
    });
  }

  // 2. REST de la org — una consulta de verdad
  const t1 = Date.now();
  try {
    const r = await consultar('SELECT COUNT() FROM Asset', 'salud.soql');
    deps.push({
      nombre: 'REST de Salesforce (SOQL)',
      disponible: true,
      detalle: `Consulta ejecutada: ${r.totalSize} unidades en Asset.`,
      ms: Date.now() - t1,
    });
  } catch (e) {
    const r = comoRespuestaHttp(e);
    deps.push({
      nombre: 'REST de Salesforce (SOQL)',
      disponible: false,
      detalle: (r.cuerpo as { mensaje?: string })?.mensaje ?? String(e),
      ms: Date.now() - t1,
    });
  }

  // 3. Agent API — sonda real, sin adornos
  const t2 = Date.now();
  try {
    const est = await agente.estadoAgentAPI();
    deps.push({
      nombre: 'Agentforce Agent API',
      disponible: est.disponible,
      detalle: est.disponible
        ? 'La puerta de enlace respondió y la sesión se puede abrir.'
        : (est.causa ?? 'No disponible'),
      ms: Date.now() - t2,
      pasoQueFalta: est.disponible ? undefined : (est.pasoQueFalta ?? 'Ver BLOQUEOS.md §1'),
    });
  } catch (e) {
    deps.push({
      nombre: 'Agentforce Agent API',
      disponible: false,
      detalle: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t2,
      pasoQueFalta: 'Ver BLOQUEOS.md §1',
    });
  }

  // 4. Cola de escalamiento
  const t3 = Date.now();
  try {
    const r = await consultar(
      `SELECT Id,Name FROM Group WHERE Id='${config.colaEscalamientoId}' AND Type='Queue'`,
      'salud.cola',
    );
    const existe = r.totalSize > 0;
    deps.push({
      nombre: 'Cola de escalamiento',
      disponible: existe,
      detalle: existe
        ? `Cola "${(r.records[0] as { Name?: string })?.Name}" localizada en la organización.`
        : `No existe una cola con Id ${config.colaEscalamientoId}.`,
      ms: Date.now() - t3,
      pasoQueFalta: existe ? undefined : 'Revisar SF_COLA_ESCALAMIENTO_ID en .env',
    });
  } catch (e) {
    deps.push({
      nombre: 'Cola de escalamiento',
      disponible: false,
      detalle: e instanceof Error ? e.message : String(e),
      ms: Date.now() - t3,
    });
  }

  return { ok: deps.every((d) => d.disponible), config: configSegura(), dependencias: deps };
}

// ── panorama ────────────────────────────────────────────────────────────────
async function panorama() {
  const objetos: Array<{ objeto: string; etiqueta: string; nota: string }> = [
    { objeto: 'Asset', etiqueta: 'Unidades', nota: 'Registros de Asset; el número de serie es el VIN.' },
    { objeto: 'Slot_Taller__c', etiqueta: 'Franjas de agenda', nota: 'Capacidad de taller cargada.' },
    { objeto: 'WorkOrder', etiqueta: 'Órdenes', nota: 'Citas concretas creadas.' },
    { objeto: 'Unidad_Varada__c', etiqueta: 'Varadas', nota: 'Reportes de asistencia en carretera.' },
    { objeto: 'Log_Agente__c', etiqueta: 'Registros de traza', nota: 'Un renglón por paso del agente.' },
    { objeto: 'Regla_Cobertura__c', etiqueta: 'Reglas de cobertura', nota: 'Umbrales por modelo y sistema.' },
    { objeto: 'Sucursal__c', etiqueta: 'Sucursales', nota: 'Talleres de la red.' },
    { objeto: 'Case', etiqueta: 'Casos', nota: 'Escalamientos y bloqueos de política.' },
  ];

  const metricas = await Promise.all(
    objetos.map(async (o) => {
      try {
        const r = await consultar(`SELECT COUNT() FROM ${o.objeto}`, `panorama.${o.objeto}`);
        return { etiqueta: o.etiqueta, valor: r.totalSize, nota: o.nota, objeto: o.objeto };
      } catch (e) {
        // No se disimula: la métrica viaja marcada como fallida.
        return {
          etiqueta: o.etiqueta,
          valor: null,
          nota: `No se pudo consultar: ${e instanceof Error ? e.message : String(e)}`,
          objeto: o.objeto,
          error: true,
        };
      }
    }),
  );

  return { metricas };
}

// ── rutas ────────────────────────────────────────────────────────────────────

async function api(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  principal: Principal,
): Promise<boolean> {
  const p = url.pathname;
  const m = req.method ?? 'GET';

  if (p === '/api/admin/salud') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['admin']);
    const s = await salud();
    json(res, 200, s);
    return true;
  }

  if (p === '/api/panorama') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['asesor', 'admin']);
    json(res, 200, await panorama());
    return true;
  }

  if (p === '/api/unidades') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const r = await datos.listarUnidades({
      sucursal: url.searchParams.get('sucursal') ?? undefined,
      estadoCobertura: url.searchParams.get('estado') ?? undefined,
    }, principal);
    json(res, 200, { unidades: r.registros, total: r.total });
    return true;
  }

  if (p === '/api/varadas') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const r = await datos.listarUnidadesVaradas(undefined, principal);
    json(res, 200, { varadas: r.registros, total: r.total });
    return true;
  }

  if (p === '/api/sucursales') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const r = await datos.listarSucursales();
    json(res, 200, { sucursales: r.registros, total: r.total });
    return true;
  }

  if (p === '/api/slots') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');
    if (!desde || !hasta) {
      throw new HttpRequestError(
        400,
        'INVALID_QUERY',
        'Faltan los parametros desde y hasta (formato YYYY-MM-DD).',
      );
    }
    const r = await datos.listarSlots({ desde, hasta }, url.searchParams.get('sucursal') ?? undefined, {
      soloDisponibles: url.searchParams.get('disponibles') === '1',
    });
    json(res, 200, { slots: r.registros, total: r.total });
    return true;
  }

  if (p === '/api/ordenes') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const r = await datos.listarOrdenes(undefined, principal);
    json(res, 200, { ordenes: r.registros, total: r.total });
    return true;
  }

  if (p.startsWith('/api/cobertura/')) {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const id = idDecodificado(p.slice('/api/cobertura/'.length));
    json(res, 200, await datos.evaluarCobertura(id, principal));
    return true;
  }

  if (p === '/api/politicas') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    json(res, 200, await datos.catalogoDePoliticas());
    return true;
  }

  if (p === '/api/folios') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['asesor', 'admin']);
    const r = await datos.foliosRecientes(30);
    json(res, 200, { folios: r.registros.map((f) => f.correlationId) });
    return true;
  }

  if (p.startsWith('/api/traza/')) {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['asesor', 'admin']);
    const folio = idDecodificado(p.slice('/api/traza/'.length));
    json(res, 200, await datos.traza(folio));
    return true;
  }

  if (p === '/api/arquitectura') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['admin']);
    // Generado por `npm run diagramas` desde la metadata de la organización.
    try {
      const bruto = await readFile(join(RAIZ_PUBLICA, 'datos', 'arquitectura.json'), 'utf8');
      json(res, 200, JSON.parse(bruto));
    } catch {
      throw new HttpRequestError(
        503,
        'ARCHITECTURE_UNAVAILABLE',
        'La arquitectura generada no esta disponible.',
      );
    }
    return true;
  }

  // ── escrituras ──
  if (p === '/api/agenda/reservar') {
    exigirMetodo(m, 'POST');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const b = await cuerpoJson<Record<string, unknown>>(req);
    exigirContextoDelServidor(b);
    exigirTextoCuerpo(b, 'vin');
    exigirTextoCuerpo(b, 'sintoma');
    const entrada = b as unknown as Omit<
      flows.EntradaCrearOrden,
      'correlationId' | 'sessionKey' | 'idempotencyKey' | 'sufijoIdempotencia'
    >;
    await datos.exigirAccesoAssetPorVin(principal, entrada.vin);
    const contexto = createOperationContext(principal, 'reservar', operationNonce(b));
    json(res, 200, await flows.crearOrdenServicio({ ...entrada, ...contexto }));
    return true;
  }

  if (p === '/api/agenda/reprogramar') {
    exigirMetodo(m, 'POST');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const b = await cuerpoJson<Record<string, unknown>>(req);
    exigirContextoDelServidor(b);
    exigirTextoCuerpo(b, 'folio');
    exigirTextoCuerpo(b, 'motivo');
    const entrada = b as unknown as Omit<
      flows.EntradaReprogramarOrden,
      'correlationId' | 'sessionKey'
    >;
    await datos.exigirAccesoWorkOrderPorFolio(principal, entrada.folio);
    const contexto = createOperationContext(principal, 'reprogramar', operationNonce(b));
    json(res, 200, await flows.reprogramarOrdenServicio({ ...entrada, ...contexto }));
    return true;
  }

  if (p === '/api/varadas/reportar') {
    exigirMetodo(m, 'POST');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const b = await cuerpoJson<Record<string, unknown>>(req);
    exigirContextoDelServidor(b);
    exigirTextoCuerpo(b, 'carretera');
    exigirTextoCuerpo(b, 'descripcionFalla');
    exigirBooleanoCuerpo(b, 'fueraDeCarril');
    exigirBooleanoCuerpo(b, 'intermitentes');
    const entrada = b as unknown as Omit<flows.EntradaCrearVarada, 'correlationId' | 'sessionKey'>;
    if (typeof entrada.vin === 'string' && entrada.vin.trim()) {
      await datos.exigirAccesoAssetPorVin(principal, entrada.vin);
    } else {
      await datos.exigirRelacionPrincipal(principal);
    }
    const contexto = createOperationContext(principal, 'varada', operationNonce(b));
    json(res, 200, await flows.crearReporteUnidadVarada({ ...entrada, ...contexto }));
    return true;
  }

  // ── escalamiento ──
  if (p === '/api/escalamiento/abrir') {
    exigirMetodo(m, 'POST');
    exigirRol(principal, ['cliente', 'admin']);
    const b = await cuerpoJson<Record<string, unknown>>(req);
    exigirContextoDelServidor(b);
    exigirTextoCuerpo(b, 'asunto');
    exigirTextoCuerpo(b, 'contexto');
    exigirTextoCuerpo(b, 'politicaAplicada');
    const entrada = b as unknown as Omit<escalamiento.EntradaEscalamiento, 'correlationId'>;
    if (entrada.assetId) await datos.exigirAccesoAssetPorId(principal, entrada.assetId);
    if (entrada.workOrderId) {
      await datos.exigirAccesoWorkOrderPorId(principal, entrada.workOrderId);
    }
    if (entrada.contactId) await datos.exigirAccesoContactPorId(principal, entrada.contactId);
    if (!entrada.assetId && !entrada.workOrderId && !entrada.contactId) {
      await datos.exigirRelacionPrincipal(principal);
    }
    const contexto = createOperationContext(principal, 'escalamiento', operationNonce(b));
    const contactId = entrada.contactId ??
      (principal.bindings.contactIds.length === 1 ? principal.bindings.contactIds[0] : undefined);
    const abierto = await escalamiento.abrirEscalamiento({
      ...entrada,
      correlationId: contexto.correlationId,
      contactId,
    });
    recursos.claim('case', abierto.caseId, principal);
    json(res, 200, abierto);
    return true;
  }

  if (p === '/api/escalamiento/bandeja') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['asesor', 'admin']);
    json(res, 200, { casos: await escalamiento.bandejaAsesor() });
    return true;
  }

  if (p === '/api/escalamiento/responder') {
    exigirMetodo(m, 'POST');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const b = await cuerpoJson<escalamiento.EntradaRespuesta>(req);
    await exigirAccesoCaso(b.caseId, principal);
    const autor: escalamiento.AutorMensaje = principal.role === 'cliente' ? 'cliente' : 'asesor';
    json(res, 200, { comentarios: await escalamiento.responder({ ...b, autor }) });
    return true;
  }

  if (p.startsWith('/api/escalamiento/') && p.endsWith('/stream')) {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const caseId = p.slice('/api/escalamiento/'.length, -'/stream'.length);
    const decoded = idDecodificado(caseId);
    await exigirAccesoCaso(decoded, principal);
    sseEscalamiento(res, decoded, principal);
    return true;
  }

  if (p.startsWith('/api/escalamiento/')) {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['cliente', 'asesor', 'admin']);
    const caseId = idDecodificado(p.slice('/api/escalamiento/'.length));
    await exigirAccesoCaso(caseId, principal);
    json(res, 200, await escalamiento.conversacion(caseId));
    return true;
  }

  // ── agente ──
  if (p === '/api/agente/estado') {
    exigirMetodo(m, 'GET');
    exigirRol(principal, ['asesor', 'admin']);
    json(res, 200, await agente.estadoAgentAPI());
    return true;
  }

  if (p === '/api/agente/sesion') {
    exigirMetodo(m, 'POST');
    exigirRol(principal, ['asesor', 'admin']);
    const b = await cuerpoJson<Record<string, unknown>>(req);
    exigirContextoDelServidor(b);
    // La clave externa aparece en event logs: nunca se acepta PII controlada por el navegador.
    const sesion = await agente.abrirSesion(randomUUID());
    recursos.claim('session', sesion.sessionId, principal);
    json(res, 200, sesion);
    return true;
  }

  if (p === '/api/agente/mensaje') {
    exigirMetodo(m, 'POST');
    exigirRol(principal, ['asesor', 'admin']);
    const b = await cuerpoJson<{ sessionId: string; texto: string }>(req);
    recursos.requireAccess('session', b.sessionId, principal);
    await sseAgente(res, b.sessionId, b.texto);
    return true;
  }

  if (p === '/api/agente/cerrar') {
    exigirMetodo(m, 'POST');
    exigirRol(principal, ['asesor', 'admin']);
    const b = await cuerpoJson<{ sessionId: string; motivo?: agente.MotivoFinDeSesion }>(req);
    recursos.requireAccess('session', b.sessionId, principal);
    const cerrada = await agente.cerrarSesion(b.sessionId, b.motivo ?? 'UserRequest');
    recursos.release('session', b.sessionId, principal);
    json(res, 200, cerrada);
    return true;
  }

  return false;
}

// ── SSE ──────────────────────────────────────────────────────────────────────

function abrirSse(res: ServerResponse): void {
  respuestasSse.add(res);
  const olvidar = (): void => {
    respuestasSse.delete(res);
  };
  res.once('close', olvidar);
  res.once('finish', olvidar);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function evento(res: ServerResponse, tipo: string, dato: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.write(`event: ${tipo}\ndata: ${JSON.stringify(dato)}\n\n`);
}

function sseEscalamiento(res: ServerResponse, caseId: string, principal: Principal): void {
  abrirSse(res);
  let cerrado = false;
  const cancelar = escalamiento.suscribirComentarios(caseId, (ev) => {
    evento(res, ev.tipo, ev);
  });
  const latido = setInterval(() => res.write(': latido\n\n'), 20_000);
  let verificando = false;
  const reautorizar = setInterval(() => {
    if (cerrado || verificando || principal.role !== 'asesor') return;
    verificando = true;
    void exigirAccesoCaso(caseId, principal)
      .catch(() => {
        if (cerrado) return;
        evento(res, 'Error', {
          error: true,
          codigo: 'ACCESS_REVOKED',
          mensaje: 'El acceso al caso ya no esta autorizado.',
        });
        res.end();
      })
      .finally(() => {
        verificando = false;
      });
  }, 30_000);
  const limpiar = (): void => {
    if (cerrado) return;
    cerrado = true;
    clearInterval(latido);
    clearInterval(reautorizar);
    cancelar();
  };
  res.on('close', limpiar);
}

async function sseAgente(res: ServerResponse, sessionId: string, texto: string): Promise<void> {
  abrirSse(res);
  let conexionCerrada = false;
  res.once('close', () => {
    conexionCerrada = true;
  });
  try {
    for await (const ev of agente.enviarMensajeStream(sessionId, texto)) {
      if (conexionCerrada || res.writableEnded) break;
      evento(res, ev.tipo, ev);
    }
    if (!conexionCerrada) evento(res, 'Fin', { tipo: 'Fin' });
  } catch (e) {
    // El fallo viaja por el propio canal: si se cerrara en silencio, la UI se
    // quedaría esperando para siempre y parecería que el agente "está pensando".
    const r = comoRespuestaHttp(e);
    evento(res, 'Error', r.cuerpo);
  } finally {
    if (!res.writableEnded) res.end();
  }
}

// ── estáticos ────────────────────────────────────────────────────────────────

async function estatico(res: ServerResponse, pathname: string): Promise<boolean> {
  // Los artefactos de datos se sirven exclusivamente por rutas API autorizadas.
  if (pathname === '/datos' || pathname.startsWith('/datos/')) return false;
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const destino = resolve(RAIZ_PUBLICA, normalize(rel));
  // Nada fuera de publico/.
  if (!isPathInside(RAIZ_PUBLICA, destino)) return false;

  try {
    const contenido = await readFile(destino);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(destino)] ?? 'application/octet-stream' });
    res.end(contenido);
    return true;
  } catch {
    return false;
  }
}

// ── arranque ─────────────────────────────────────────────────────────────────

const servidor = createServer((req, res) => {
  const requestId = randomUUID();
  res.setHeader('X-Request-Id', requestId);

  void (async () => {
    try {
      applySecureHeaders(res);
      if (drenando) {
        res.setHeader('Connection', 'close');
        json(res, 503, {
          error: true,
          codigo: 'SERVER_DRAINING',
          mensaje: 'El servidor se esta cerrando; intenta de nuevo en otra instancia.',
        });
        return;
      }
      const cors = applyCors(req, res, securityConfig);
      if (cors.preflight) {
        res.writeHead(204);
        res.end();
        return;
      }

      // El request-target llega del cliente y no siempre es una URL resoluble: `//`
      // se lee como URL protocolo-relativa sin host y `new URL` lanza. Parsear aquí
      // dentro convierte eso en un 400 con la misma traza que el resto; hacerlo fuera
      // del try dejaba la excepción sin dueño y cualquiera podía tumbar el proceso.
      let url: URL;
      try {
        url = new URL(req.url ?? '/', `http://localhost:${config.puerto}`);
      } catch {
        throw new HttpRequestError(400, 'INVALID_REQUEST_TARGET', 'La ruta solicitada no es valida.');
      }

      if (url.pathname === '/salud') {
        exigirMetodo(req.method ?? 'GET', 'GET');
        const publicLimit = limiteApi.consume(`salud:${claveRed(req)}`);
        if (!publicLimit.allowed) throw new RateLimitError(publicLimit.retryAfterSeconds);
        json(res, 200, { status: 'ok', build: BUILD_ID });
        return;
      }

      if (url.pathname.startsWith('/auth/')) {
        if (await rutasAutenticacion(req, res, url)) return;
        throw new HttpRequestError(404, 'NOT_FOUND', 'No existe la ruta solicitada.');
      }

      // Superficie de clientes: sin login, como cualquier sitio público. La identidad
      // es una sesión de visitante emitida por el servidor; el alcance de lo que puede
      // leer o escribir vive en esa sesión, no en lo que mande el navegador.
      if (url.pathname.startsWith('/publico/')) {
        const limitePublico = limiteApi.consume(`publico:${claveRed(req)}`);
        if (!limitePublico.allowed) throw new RateLimitError(limitePublico.retryAfterSeconds);
        const manejada = await rutasPublicas({
          req,
          res,
          url,
          cookies: headerUnico(req.headers.cookie),
          seguro: securityConfig.appEnv === 'production',
        });
        if (manejada) return;
        throw new HttpRequestError(404, 'NOT_FOUND', 'No existe la ruta solicitada.');
      }

      if (url.pathname.startsWith('/api/')) {
        const identity = await autenticar(req);
        if (identity.oidcSession && oidcBff) {
          try {
            oidcBff.assertMutationAllowed({
              method: req.method ?? 'GET',
              origin: headerUnico(req.headers.origin),
              csrfToken: headerUnico(req.headers['x-csrf-token']),
            }, identity.oidcSession);
          } catch (error) {
            relanzarOidc(error);
          }
        }
        if (await api(req, res, url, identity.principal)) return;
        throw new HttpRequestError(404, 'NOT_FOUND', 'No existe la ruta solicitada.');
      }
      if (await estatico(res, url.pathname)) return;
      throw new HttpRequestError(404, 'NOT_FOUND', 'No existe la ruta solicitada.');
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const r = comoRespuestaHttp(e);
      const errorBody = r.cuerpo as { errorId?: unknown; codigo?: unknown };
      console.error(JSON.stringify({
        event: r.status >= 400 ? 'http_error' : 'policy_block',
        requestId,
        errorId: typeof errorBody.errorId === 'string' ? errorBody.errorId : undefined,
        code: typeof errorBody.codigo === 'string' ? errorBody.codigo : 'UNMAPPED_ERROR',
        status: r.status,
        method: req.method ?? 'GET',
      }));
      if (r.status === 401 && securityConfig.authProvider === 'static') {
        res.setHeader('WWW-Authenticate', 'Bearer realm="torre-agentforce"');
      }
      if (e instanceof RateLimitError) res.setHeader('Retry-After', String(e.retryAfterSeconds));
      json(res, r.status, r.cuerpo);
    }
  })();
});

servidor.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});

// El orden entre los tres NO es cosmético. Node exige headersTimeout > keepAliveTimeout
// —si no, cierra conexiones sanas antes de tiempo— y requestTimeout tiene que cubrir a
// ambos. Con los 5 s que Node trae de fábrica en keepAliveTimeout, un cliente que
// reutiliza el socket justo cuando el servidor manda el FIN se lleva un ECONNRESET que
// parece un fallo de la aplicación y no lo es.
servidor.keepAliveTimeout = securityConfig.keepAliveTimeoutMs;
servidor.headersTimeout = servidor.keepAliveTimeout + 5_000;
servidor.requestTimeout = Math.max(securityConfig.requestTimeoutMs, servidor.headersTimeout + 5_000);
servidor.maxHeadersCount = 64;
servidor.maxRequestsPerSocket = 1_000;

export interface ResultadoDrenado {
  forced: boolean;
  socketsAlInicio: number;
}

let promesaDrenado: Promise<ResultadoDrenado> | null = null;

function drenarServidor(motivo: 'SIGTERM' | 'SIGINT' | 'TEST'): Promise<ResultadoDrenado> {
  if (promesaDrenado) return promesaDrenado;
  drenando = true;
  const socketsAlInicio = sockets.size;
  console.log(
    `[shutdown] ${motivo}: se detiene la admision; ` +
      `${respuestasSse.size} SSE y ${socketsAlInicio} sockets activos.`,
  );

  // SSE es un recurso local que si podemos terminar con verdad. No se intenta cerrar
  // sesiones Agent API: su registro/secuencia y ownership viven en memoria y no se
  // pueden enumerar/cerrar remotamente sin riesgo de inventar exito. Este runtime debe
  // desplegarse como replica unica mientras ese estado no sea compartido y durable.
  for (const response of respuestasSse) {
    evento(response, 'Error', {
      error: true,
      codigo: 'SERVER_SHUTDOWN',
      mensaje: 'El servidor esta reiniciando; vuelve a conectar.',
    });
    if (!response.writableEnded) response.end();
  }

  promesaDrenado = new Promise<ResultadoDrenado>((resolveDrain) => {
    let terminado = false;
    let timer: NodeJS.Timeout | null = null;
    const terminar = (forced: boolean): void => {
      if (terminado) return;
      terminado = true;
      if (timer) clearTimeout(timer);
      resolveDrain({ forced, socketsAlInicio });
    };

    servidor.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        console.error(`[shutdown] error al cerrar listener: ${error.message}`);
      }
      terminar(false);
    });
    servidor.closeIdleConnections();

    timer = setTimeout(() => {
      console.error(
        `[shutdown] timeout de ${SHUTDOWN_TIMEOUT_MS}ms; se abortan ${sockets.size} sockets locales.`,
      );
      servidor.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      terminar(true);
    }, SHUTDOWN_TIMEOUT_MS);
  });
  return promesaDrenado;
}

/** Punto de prueba: ejecuta el mismo drenado sin enviar señales al proceso padre. */
export function _drenarServidorParaPruebas(): Promise<ResultadoDrenado> {
  return drenarServidor('TEST');
}

function alRecibirSenal(signal: 'SIGTERM' | 'SIGINT'): void {
  void drenarServidor(signal)
    .then((resultado) => {
      console.log(`[shutdown] completado${resultado.forced ? ' con aborto por timeout' : ''}.`);
      process.exitCode = resultado.forced ? 1 : 0;
    })
    .catch((error: unknown) => {
      console.error(`[shutdown] fallo inesperado: ${error instanceof Error ? error.message : String(error)}`);
      servidor.closeAllConnections();
      process.exitCode = 1;
    });
}

process.once('SIGTERM', () => alRecibirSenal('SIGTERM'));
process.once('SIGINT', () => alRecibirSenal('SIGINT'));

// Se lanza sin esperar: resolver la clave desde la org es una comodidad, no un
// requisito de arranque. Esperarla retrasaba el listen y colgaba a quien importa
// este módulo en pruebas. Si aún no está lista cuando llegue la primera petición,
// el proveedor la resuelve entonces.
void prepararProveedorDeToken();

servidor.listen(config.puerto, () => {
  const c = configSegura();
  console.log(`Torre Agentforce en http://localhost:${config.puerto}`);
  console.log(`  organización     ${c.loginUrl}`);
  console.log(`  proveedor token  ${c.proveedorToken}${c.tieneCredenciales ? '' : ' (sin SF_CLIENT_ID/SECRET)'}`);
  console.log(`  agente           ${c.agentId}`);
  console.log(`  cola escalamiento ${c.colaEscalamientoId}`);
});
