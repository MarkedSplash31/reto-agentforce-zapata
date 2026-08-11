// N2 · Custodia del token OAuth.
//
// Reglas duras:
//   · el token JAMÁS sale hacia el navegador
//   · el token JAMÁS se escribe en un log, ni truncado
//   · el token JAMÁS se persiste en disco
//   · si no se puede obtener, se lanza con la causa REAL; no hay degradación silenciosa
//
// Dos proveedores detrás de una sola interfaz. No son "modo real" y "modo demo":
// los dos hablan con la MISMA org y devuelven los MISMOS datos. Cambia la credencial,
// no la verdad.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { config } from './config.ts';
import { ErrorSalesforce } from './errores.ts';
import { redactSensitive } from './security.ts';

const ejecutar = promisify(execFile);

interface SalidaCli {
  status?: number;
  result?: { accessToken?: string };
}

function quitarAnsi(texto: string): string {
  return texto
    // OSC: titulo de terminal y secuencias similares, terminadas por BEL o ST.
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    // CSI: colores, movimiento de cursor y formato SGR.
    .replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/^\uFEFF/, '')
    .trim();
}

/** Export minimo para probar el borde del proceso hijo sin ejecutar ni revelar el CLI. */
export function _parsearSalidaCliParaPruebas(salida: string): SalidaCli {
  return JSON.parse(quitarAnsi(salida)) as SalidaCli;
}

export interface Token {
  valor: string;
  instanceUrl: string;
  /** epoch ms en que deja de considerarse fresco */
  expiraEn: number;
  origen: 'client_credentials' | 'cli';
}

export interface ProveedorDeToken {
  readonly nombre: 'client_credentials' | 'cli';
  /** Devuelve un token utilizable. Puede servirlo de caché. */
  obtener(): Promise<Token>;
  /** Invalida la caché y pide uno nuevo. Se llama tras un 401. */
  renovar(): Promise<Token>;
  /** Qué le falta a este proveedor para funcionar. Vacío = listo. */
  requisitosFaltantes(): string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Producción: External Client App con client credentials.
// La ECA existe; falta custodiar su par consumidor fuera del repositorio/chat.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lee el `consumerKey` de la External Client App directamente de la org.
 *
 * La clave de consumidor NO es un secreto: es el identificador público del cliente
 * OAuth, y Salesforce sí la exporta en la metadata. El secreto no, y por eso sigue
 * teniendo que ponerlo una persona.
 *
 * Esto existe porque transcribir la clave a mano ya provocó un fallo real: se cargó
 * la de otra aplicación —57 de sus 85 caracteres eran distintos— y el diagnóstico
 * costó una sesión entera. Si el CLI puede leerla de la org, que la lea.
 */
async function claveDesdeLaOrg(): Promise<string | null> {
  // Sólo tiene sentido si de verdad hace falta: con la clave en el entorno, o con
  // otro proveedor de token, no se toca el CLI.
  if (config.clientId || config.proveedorToken !== 'client_credentials') return null;
  const app = process.env.APP_ECA_NAME ?? 'Torre_Agentforce_Zapata';
  const alias = config.cliOrgAlias;
  const tmp = join(tmpdir(), `eca-${process.pid}`);
  try {
    mkdirSync(join(tmp, 'force-app'), { recursive: true });
    writeFileSync(
      join(tmp, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], namespace: '', sourceApiVersion: '67.0' }),
    );
    await ejecutar(
      'sf',
      ['project', 'retrieve', 'start', '-o', alias, '-m', `"ExtlClntAppGlobalOauthSettings:${app}_glbloauth"`, '--json'],
      // Tope duro: leer la clave es una comodidad de arranque. Si el CLI tarda o se
      // queda colgado, se abandona y cada llamada dirá qué falta. Nunca debe demorar
      // el arranque del servidor ni bloquear una suite de pruebas.
      { cwd: tmp, shell: true, maxBuffer: 16 * 1024 * 1024, timeout: 20_000 },
    );
    const buscar = (dir: string): string | null => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          const r = buscar(p);
          if (r) return r;
        } else if (e.name.endsWith('.ecaGlblOauth-meta.xml')) return p;
      }
      return null;
    };
    const ruta = buscar(tmp);
    if (!ruta) return null;
    return (readFileSync(ruta, 'utf8').match(/<consumerKey>([^<]*)<\/consumerKey>/) ?? [])[1] ?? null;
  } catch {
    // Si el CLI no está autenticado o la app no existe, se sigue con lo que haya en
    // el entorno. No se interrumpe el arranque por una comodidad.
    return null;
  } finally {
    // En Windows el CLI puede conservar un descriptor abierto y rmSync lanza EBUSY.
    // Limpiar es cortesía, no parte del contrato: que falle no debe tumbar el arranque.
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      /* el temporal queda para que lo recoja el sistema */
    }
  }
}

class ProveedorClientCredentials implements ProveedorDeToken {
  readonly nombre = 'client_credentials' as const;
  #cache: Token | null = null;
  #claveResuelta: string | null = null;

  /** Resuelve la clave por adelantado para que el diagnóstico sea exacto. */
  async preparar(): Promise<void> {
    await this.#clave();
  }

  /** La clave del entorno gana; si no hay, se intenta leer de la org. */
  async #clave(): Promise<string> {
    if (config.clientId) return config.clientId;
    if (this.#claveResuelta) return this.#claveResuelta;
    this.#claveResuelta = await claveDesdeLaOrg();
    return this.#claveResuelta ?? '';
  }

  requisitosFaltantes(): string[] {
    const faltan: string[] = [];
    // La clave sólo se reporta como faltante si tampoco se pudo leer de la org.
    if (!config.clientId && !this.#claveResuelta) faltan.push('SF_CLIENT_ID');
    if (!config.clientSecret) faltan.push('SF_CLIENT_SECRET');
    return faltan;
  }

  async obtener(): Promise<Token> {
    if (this.#cache && Date.now() < this.#cache.expiraEn) return this.#cache;
    return this.renovar();
  }

  async renovar(): Promise<Token> {
    const clave = await this.#clave();
    const faltan = clave ? this.requisitosFaltantes().filter((f) => f !== 'SF_CLIENT_ID') : this.requisitosFaltantes();
    if (faltan.length) {
      throw new ErrorSalesforce(
        `No hay credenciales de la External Client App: falta ${faltan.join(' y ')}. ` +
          `Un humano debe revelarlas tras reautenticarse y guardarlas directamente en ` +
          `el almacén de secretos (BLOQUEOS.md §1).`,
        { operacion: 'auth.client_credentials' },
      );
    }

    const url = `${config.loginUrl}/services/oauth2/token`;
    const cuerpo = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clave,
      client_secret: config.clientSecret,
    });

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: cuerpo,
        signal: AbortSignal.timeout(config.security.salesforceTimeoutMs),
      });
    } catch (e) {
      throw new ErrorSalesforce(
        `No se pudo contactar el endpoint de token: ${e instanceof Error ? e.message : String(e)}`,
        { operacion: 'auth.client_credentials', url },
      );
    }

    const texto = await res.text();
    if (!res.ok) {
      // El cuerpo de error de OAuth no lleva secretos: trae error y error_description.
      throw new ErrorSalesforce(`El endpoint de token respondió ${res.status}`, {
        operacion: 'auth.client_credentials',
        status: res.status,
        cuerpo: seguroParaLog(texto),
        url,
      });
    }

    let datos: { access_token?: string; instance_url?: string; issued_at?: string };
    try {
      datos = JSON.parse(texto);
    } catch {
      throw new ErrorSalesforce('El endpoint de token no devolvió JSON', {
        operacion: 'auth.client_credentials',
        status: res.status,
        url,
      });
    }

    if (!datos.access_token) {
      throw new ErrorSalesforce('La respuesta de token no trae access_token', {
        operacion: 'auth.client_credentials',
        status: res.status,
        url,
      });
    }

    this.#cache = {
      valor: datos.access_token,
      instanceUrl: datos.instance_url ?? config.loginUrl,
      // client_credentials no informa expiración. Se asume conservador: 30 min.
      // El 401 con reintento único es la red de seguridad real.
      expiraEn: Date.now() + 30 * 60 * 1000,
      origen: 'client_credentials',
    };
    return this.#cache;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Desarrollo local: el token que ya custodia el `sf` CLI.
// Habilita SOQL y Flows contra la org REAL. NO habilita la Agent API — su token
// no porta los scopes sfap_api/chatbot_api que exige la puerta de enlace.
// ─────────────────────────────────────────────────────────────────────────────

class ProveedorCli implements ProveedorDeToken {
  readonly nombre = 'cli' as const;
  #cache: Token | null = null;

  requisitosFaltantes(): string[] {
    return [];
  }

  async obtener(): Promise<Token> {
    if (this.#cache && Date.now() < this.#cache.expiraEn) return this.#cache;
    return this.renovar();
  }

  async renovar(): Promise<Token> {
    let salida: string;
    try {
      const r = await ejecutar(
        'sf',
        ['org', 'auth', 'show-access-token', '-o', config.cliOrgAlias, '--json'],
        {
          // En Windows el CLI se instala como sf.cmd. El unico argumento variable
          // (alias) ya esta restringido a [A-Za-z0-9._-] en config.ts.
          shell: process.platform === 'win32',
          maxBuffer: 1024 * 1024,
          timeout: config.security.salesforceCliTimeoutMs,
          windowsHide: true,
          env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        },
      );
      salida = r.stdout;
    } catch (e) {
      throw new ErrorSalesforce(
        `El CLI de Salesforce no entregó un token para el alias "${config.cliOrgAlias}". ` +
          `Corre: sf org login web --alias ${config.cliOrgAlias}`,
        { operacion: 'auth.cli', cuerpo: e instanceof Error ? e.message : String(e) },
      );
    }

    let datos: SalidaCli;
    try {
      datos = _parsearSalidaCliParaPruebas(salida);
    } catch {
      throw new ErrorSalesforce('El CLI no devolvió JSON al pedir el token', {
        operacion: 'auth.cli',
      });
    }

    const valor = datos.result?.accessToken;
    if (!valor) {
      throw new ErrorSalesforce('El CLI devolvió JSON sin accessToken', { operacion: 'auth.cli' });
    }

    this.#cache = {
      valor,
      instanceUrl: config.loginUrl,
      expiraEn: Date.now() + 30 * 60 * 1000,
      origen: 'cli',
    };
    return this.#cache;
  }
}

/** Quita cualquier cosa con pinta de token antes de que toque un log. */
export function seguroParaLog(texto: string): string {
  return String(redactSensitive(texto));
}

let proveedor: ProveedorDeToken | null = null;

export function proveedorDeToken(): ProveedorDeToken {
  if (!proveedor) {
    proveedor =
      config.proveedorToken === 'client_credentials'
        ? new ProveedorClientCredentials()
        : new ProveedorCli();
  }
  return proveedor;
}

/**
 * Deja lista la credencial antes de atender peticiones. Con client credentials
 * intenta leer de la org la clave pública de la app, de modo que sólo haga falta
 * cargar el secreto a mano. Nunca lanza: si no se puede, cada llamada lo dirá.
 */
export async function prepararProveedorDeToken(): Promise<void> {
  try {
    const p = proveedorDeToken();
    if (p instanceof ProveedorClientCredentials) await p.preparar();
  } catch {
    // Es una comodidad de arranque. Si no se puede resolver la clave, cada llamada
    // dirá exactamente qué falta; el servidor tiene que levantar igual.
  }
}

/** Sólo para pruebas. */
export function _reiniciarProveedor(): void {
  proveedor = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token para la Agentforce Agent API.
//
// Hay DOS caminos y la diferencia importa, porque durante días se creyó que sólo
// existía el segundo:
//
// 1. `client_credentials` — el camino documentado y el de producción. El token que
//    emite la External Client App con los scopes `sfap_api` y `chatbot_api` se manda
//    tal cual en `Authorization: Bearer`. Comprobado el 6-ago-2026 contra
//    api.salesforce.com: HTTP 200 y sessionId real. El 404 histórico no era del
//    método, era de una clave de consumidor que no pertenecía a esta app.
//
// 2. `cli` — sólo desarrollo. El token del CLI es una sesión de la org, y la Agent
//    API no la enruta; hay que cambiarla por el JWT que emite
//    `/agentforce/bootstrap/nameduser`, que es lo que hace `sf agent preview` por
//    dentro (`useNamedUserJwt` en @salesforce/agents). El intercambio es peculiar y
//    conviene no "corregirlo": va como GET, el token viaja en la cookie `sid` y
//    mandar además Authorization lo hace fallar.
//
// Mandar el token de client_credentials por el camino 2 devuelve una página HTML de
// login —no JSON—, y eso es exactamente lo que rompía la conversación con la
// credencial buena. La imagen de producción no lleva el Salesforce CLI: el camino 1
// es el único que puede sostenerla.
// ─────────────────────────────────────────────────────────────────────────────

let jwtEnCache: { valor: string; expiraEn: number } | null = null;

/**
 * El token del proveedor, tal cual, para la Agent API.
 *
 * Vale para los DOS proveedores. Que sirva con `client_credentials` ya estaba
 * documentado; que sirva también con el token del CLI se midió el 11-ago-2026: 45
 * turnos seguidos contra la Agent API mandando este token directo, sin un solo fallo.
 *
 * Importa porque el rodeo por `/agentforce/bootstrap/nameduser` —que era el camino por
 * omisión con el proveedor `cli`— resultó ser el origen de los 400 intermitentes: con
 * él, ~1 de cada 7 turnos moría con un rechazo de la puerta en ~370 ms, cuando un turno
 * bueno tarda entre 2 y 5 s. O sea, la puerta descartaba la petición sin procesarla.
 */
export async function tokenDirectoAgentAPI(forzar = false): Promise<string> {
  const prov = proveedorDeToken();
  const token = forzar ? await prov.renovar() : await prov.obtener();
  return token.valor;
}

/**
 * El JWT de `/agentforce/bootstrap/nameduser`. Se conserva como RESPALDO: sólo se
 * intenta cuando la puerta rechaza el token directo por credencial (401/403). No es el
 * camino por omisión desde que se midió su intermitencia.
 */
export async function tokenParaAgentAPI(forzar = false): Promise<string> {
  const prov = proveedorDeToken();
  // Con client_credentials no hay nada que canjear: el propio proveedor custodia su
  // token y su expiración.
  if (prov.nombre === 'client_credentials') {
    const token = forzar ? await prov.renovar() : await prov.obtener();
    return token.valor;
  }

  const base = await prov.obtener();
  if (!forzar && jwtEnCache && Date.now() < jwtEnCache.expiraEn) return jwtEnCache.valor;

  const url = `${base.instanceUrl}/agentforce/bootstrap/nameduser`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Cookie: `sid=${base.valor}` },
    });
  } catch (e) {
    throw new ErrorSalesforce(
      `No se pudo contactar el emisor de token de Agentforce: ${e instanceof Error ? e.message : String(e)}`,
      { operacion: 'auth.agentforce.jwt', url },
    );
  }

  const texto = await res.text();
  if (!res.ok) {
    throw new ErrorSalesforce(
      `El emisor de token de Agentforce respondió ${res.status}. ` +
        `La credencial necesita los scopes chatbot_api, sfap_api y web.`,
      { operacion: 'auth.agentforce.jwt', status: res.status, cuerpo: seguroParaLog(texto).slice(0, 400), url },
    );
  }

  let datos: { access_token?: string };
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new ErrorSalesforce('El emisor de token de Agentforce no devolvió JSON', {
      operacion: 'auth.agentforce.jwt',
      status: res.status,
      url,
    });
  }

  const jwt = datos.access_token;
  if (!jwt || jwt.split('.').length !== 3) {
    throw new ErrorSalesforce(
      'El emisor de Agentforce no devolvió un JWT con las tres partes esperadas',
      { operacion: 'auth.agentforce.jwt', status: res.status, url },
    );
  }

  // Se cachea de forma conservadora; un 401 fuerza la renovación.
  jwtEnCache = { valor: jwt, expiraEn: Date.now() + 20 * 60 * 1000 };
  return jwt;
}

export function _olvidarJwtAgente(): void {
  jwtEnCache = null;
}
