// Configuración. Todo se consume desde process.env y nada sensible tiene un valor
// por defecto. `npm start` puede poblar process.env desde un `.env` local; este
// módulo no lee archivos ni conoce credenciales.
// están CONFIRMADOS por SOQL contra la org y que sirven de valor por defecto.

import { loadSecurityConfig } from './security.ts';

function req(nombre: string, porDefecto?: string): string {
  const v = process.env[nombre] ?? porDefecto;
  if (v === undefined || v === '') {
    throw new Error(`Falta la variable de entorno ${nombre}. Definela en el runtime o gestor de secretos.`);
  }
  return v;
}

export const securityConfig = loadSecurityConfig(process.env);

/**
 * La organización del reto y sus identificadores.
 *
 * Están aquí a propósito: quien clone el repositorio levanta el sitio contra ella sin
 * configurar nada, y eso es lo que el reto necesita. Ninguno es un secreto —son Ids
 * públicos dentro de esa org—.
 *
 * Lo que NO puede pasar es que alguien apunte el sitio a OTRA organización y se quede
 * con estos Ids: estaría hablando con su org usando los identificadores de ésta, y el
 * fallo aparecería dentro de una conversación con un error de Salesforce que no dice
 * nada. Por eso se lleva la cuenta de cuáles vinieron por omisión y
 * `exigirOrgCoherente` corta esa mezcla al arrancar.
 */
const ORG_DEL_RETO = {
  SF_LOGIN_URL: 'https://orgfarm-1c6625ec2e-dev-ed.develop.my.salesforce.com',
  // BotDefinition.Id de Agente_Postventa_Zapata — confirmado por SOQL 5-ago-2026.
  SF_AGENT_ID: '0XxgK0000022RhJSAU',
  // Cola Escalamiento_Postventa — confirmada por SOQL sobre Group.
  SF_COLA_ESCALAMIENTO_ID: '00GgK00000BMTaVUAX',
  SF_CASE_QUEUE_ID: '00GgK00000BMTaVUAX',
  SF_CLI_ORG_ALIAS: 'zapata',
} as const;

/** Las variables de identidad de org que nadie definió y se tomaron del reto. */
const identidadPorOmision: string[] = [];

function delReto(nombre: keyof typeof ORG_DEL_RETO): string {
  const definida = process.env[nombre];
  if (definida && definida.trim()) return definida.trim();
  identidadPorOmision.push(nombre);
  return ORG_DEL_RETO[nombre];
}

function originSeguro(nombre: string, porDefecto?: string): string {
  const raw = req(nombre, porDefecto);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${nombre} no es una URL valida.`);
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (
    url.origin !== raw ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(securityConfig.appEnv !== 'production' && loopback))
  ) {
    throw new Error(`${nombre} debe ser un origin HTTPS exacto sin credenciales, path, query ni fragmento.`);
  }
  return raw;
}

function salesforceId(nombre: string, porDefecto: string): string {
  const value = req(nombre, porDefecto);
  if (!/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(value)) {
    throw new Error(`${nombre} no parece un Id de Salesforce de 15 o 18 caracteres.`);
  }
  return value;
}

function queueId(nombre: string, porDefecto: string): string {
  const value = salesforceId(nombre, porDefecto);
  if (!value.startsWith('00G')) {
    throw new Error(`${nombre} debe ser un Id de Group/Queue de Salesforce (prefijo 00G).`);
  }
  return value;
}

function puerto(): number {
  const value = Number(process.env.PORT ?? 3000);
  if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  return value;
}

function enteroConfig(
  nombre: string,
  porDefecto: number,
  minimo: number,
  maximo: number,
): number {
  const value = Number(process.env[nombre] ?? porDefecto);
  if (!Number.isSafeInteger(value) || value < minimo || value > maximo) {
    throw new Error(`${nombre} debe ser un entero entre ${minimo} y ${maximo}.`);
  }
  return value;
}

function listaCsv(nombre: string, porDefecto = ''): string[] {
  const valores = (process.env[nombre] ?? porDefecto)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (new Set(valores).size !== valores.length) throw new Error(`${nombre} contiene duplicados.`);
  return valores;
}

function urlCallback(nombre: string, production: boolean): string {
  const raw = req(nombre);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${nombre} no es una URL valida.`);
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' && (production || !loopback))
  ) {
    throw new Error(`${nombre} debe ser una URL HTTPS exacta sin credenciales, query ni fragmento.`);
  }
  return url.href;
}

export interface OidcRuntimeConfig {
  readonly externalOrigin: string;
  readonly callbackUrl: string;
  readonly allowedSalesforceHosts: readonly string[];
  readonly expectedIssuers: readonly string[];
  readonly adminPermissionSets: readonly string[];
  readonly advisorPermissionSets: readonly string[];
  readonly scopes: readonly string[];
  readonly sessionTtlMs: number;
  readonly authAttemptTtlMs: number;
  readonly maxSessions: number;
  readonly maxAuthAttempts: number;
}

function oidcConfig(
  loginUrl: string,
  clientId: string,
  clientSecret: string,
): OidcRuntimeConfig | null {
  if (securityConfig.authProvider !== 'oidc') return null;
  if (!clientId || !clientSecret) {
    throw new Error('APP_AUTH_PROVIDER=oidc exige SF_CLIENT_ID y SF_CLIENT_SECRET en el gestor de secretos.');
  }
  const production = securityConfig.appEnv === 'production';
  const externalOrigin = originSeguro(
    'APP_EXTERNAL_ORIGIN',
    production ? undefined : 'http://localhost:3000',
  );
  const callbackUrl = urlCallback('APP_OIDC_CALLBACK_URL', production);
  if (new URL(callbackUrl).pathname !== '/auth/salesforce/callback') {
    throw new Error('APP_OIDC_CALLBACK_URL debe terminar exactamente en /auth/salesforce/callback.');
  }
  if (new URL(callbackUrl).origin !== externalOrigin) {
    throw new Error('APP_OIDC_CALLBACK_URL debe pertenecer exactamente a APP_EXTERNAL_ORIGIN.');
  }
  const loginHost = new URL(loginUrl).hostname;
  const allowedSalesforceHosts = listaCsv('SF_OIDC_ALLOWED_HOSTS', loginHost);
  if (!allowedSalesforceHosts.includes(loginHost)) {
    throw new Error('SF_OIDC_ALLOWED_HOSTS debe incluir el host exacto de SF_LOGIN_URL.');
  }
  const expectedIssuers = listaCsv('SF_OIDC_EXPECTED_ISSUERS', loginUrl);
  if (expectedIssuers.length === 0) throw new Error('SF_OIDC_EXPECTED_ISSUERS no puede quedar vacio.');
  const adminPermissionSets = listaCsv('APP_OIDC_ADMIN_PERMISSION_SETS');
  const advisorPermissionSets = listaCsv('APP_OIDC_ADVISOR_PERMISSION_SETS');
  if (production && (adminPermissionSets.length === 0 || advisorPermissionSets.length === 0)) {
    throw new Error(
      'OIDC en produccion exige APP_OIDC_ADMIN_PERMISSION_SETS y APP_OIDC_ADVISOR_PERMISSION_SETS con API names reales.',
    );
  }
  if (production && !process.env.SF_OIDC_SCOPES?.trim()) {
    throw new Error(
      'OIDC en produccion exige SF_OIDC_SCOPES explicito; configura openid en la External Client App antes de arrancar.',
    );
  }
  const scopes = listaCsv('SF_OIDC_SCOPES', 'openid,api,refresh_token,chatbot_api,sfap_api');
  if (!scopes.includes('openid')) {
    throw new Error('SF_OIDC_SCOPES debe incluir openid; sin ese scope no existe identidad OIDC verificable.');
  }
  return {
    externalOrigin,
    callbackUrl,
    allowedSalesforceHosts,
    expectedIssuers,
    adminPermissionSets,
    advisorPermissionSets,
    scopes,
    sessionTtlMs: enteroConfig('APP_OIDC_SESSION_TTL_MS', 8 * 60 * 60_000, 60_000, 24 * 60 * 60_000),
    authAttemptTtlMs: enteroConfig('APP_OIDC_AUTH_TTL_MS', 5 * 60_000, 30_000, 15 * 60_000),
    maxSessions: enteroConfig('APP_OIDC_MAX_SESSIONS', 10_000, 1, 1_000_000),
    maxAuthAttempts: enteroConfig('APP_OIDC_MAX_AUTH_ATTEMPTS', 2_000, 1, 100_000),
  };
}

function proveedorToken(): 'client_credentials' | 'cli' {
  const value = process.env.SF_TOKEN_PROVIDER ??
    (securityConfig.appEnv === 'production' ? 'client_credentials' : 'cli');
  if (value !== 'client_credentials' && value !== 'cli') {
    throw new Error('SF_TOKEN_PROVIDER debe ser client_credentials o cli.');
  }
  if (securityConfig.appEnv === 'production' && value === 'cli') {
    throw new Error('SF_TOKEN_PROVIDER=cli no esta permitido en produccion.');
  }
  return value;
}

function aliasCli(): string {
  const value = delReto('SF_CLI_ORG_ALIAS');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(value)) throw new Error('SF_CLI_ORG_ALIAS no es valido.');
  return value;
}

const apiVersion = req('SF_API_VERSION', 'v67.0');
if (!/^v\d{1,3}\.\d$/.test(apiVersion)) throw new Error('SF_API_VERSION no es valida.');
const loginUrl = originSeguro('SF_LOGIN_URL', delReto('SF_LOGIN_URL'));
const clientId = process.env.SF_CLIENT_ID ?? '';
const clientSecret = process.env.SF_CLIENT_SECRET ?? '';

export const config = {
  loginUrl,
  apiVersion,

  // La ECA ya existe; los secretos permanecen vacíos hasta que un humano los
  // custodie fuera del repositorio y del chat (BLOQUEOS.md §1).
  clientId,
  clientSecret,
  appAuthProvider: securityConfig.authProvider,
  oidc: oidcConfig(loginUrl, clientId, clientSecret),

  agentId: salesforceId('SF_AGENT_ID', delReto('SF_AGENT_ID')),
  agentApiHost: originSeguro('SF_AGENT_API_HOST', 'https://api.salesforce.com'),

  colaEscalamientoId: queueId('SF_COLA_ESCALAMIENTO_ID', delReto('SF_COLA_ESCALAMIENTO_ID')),
  // Frontera de autorizacion para asesores. Separada de la configuracion funcional
  // para que cambiar una cola no amplie acceso de forma implicita.
  caseQueueId: queueId('SF_CASE_QUEUE_ID', delReto('SF_CASE_QUEUE_ID')),

  puerto: puerto(),

  // 'client_credentials' | 'cli'
  proveedorToken: proveedorToken(),
  cliOrgAlias: aliasCli(),
  security: securityConfig,
  /** Qué identificadores de org se tomaron del reto porque nadie los definió. */
  identidadPorOmision: Object.freeze([...identidadPorOmision]),
} as const;

/**
 * Apuntar a otra organización y conservar los identificadores de ésta es la mezcla
 * que nadie detecta a tiempo: el sitio arranca, la pantalla se pinta, y el fallo sale
 * dentro de una conversación como un error de Salesforce que no dice qué pasó. Si
 * alguien se molestó en definir su propio `SF_LOGIN_URL`, los Ids tienen que ser
 * suyos también.
 *
 * El alias del CLI queda fuera: nombra una sesión local, no un registro de la org, y
 * exigirlo obligaría a renombrar la sesión de cualquiera que ya la tenga abierta.
 */
function exigirOrgCoherente(): void {
  if (config.loginUrl === ORG_DEL_RETO.SF_LOGIN_URL) return;
  const prestados = identidadPorOmision.filter((n) => n !== 'SF_LOGIN_URL' && n !== 'SF_CLI_ORG_ALIAS');
  if (!prestados.length) return;
  throw new Error(
    `SF_LOGIN_URL apunta a ${config.loginUrl}, pero ${prestados.join(', ')} conserva(n) ` +
      'los identificadores de la organización del reto. Esos Ids no existen en tu ' +
      'organización: define esas variables con los tuyos, o quita SF_LOGIN_URL para ' +
      'trabajar contra la del reto.',
  );
}

exigirOrgCoherente();

/** Nunca imprimas `config` directo: lleva el secreto. Usa esto. */
export function configSegura() {
  return {
    loginUrl: config.loginUrl,
    apiVersion: config.apiVersion,
    agentId: config.agentId,
    agentApiHost: config.agentApiHost,
    colaEscalamientoId: config.colaEscalamientoId,
    caseQueueId: config.caseQueueId,
    proveedorToken: config.proveedorToken,
    tieneCredenciales: Boolean(config.clientId && config.clientSecret),
    identidadPorOmision: config.identidadPorOmision,
    seguridad: {
      entorno: config.security.appEnv,
      autenticacion: config.security.authMode,
      proveedor: config.appAuthProvider,
      principalsConfigurados: config.security.credentials.length,
      corsOriginsConfigurados: config.security.corsOrigins.size,
      oidcConfigurado: config.oidc !== null,
    },
  };
}
