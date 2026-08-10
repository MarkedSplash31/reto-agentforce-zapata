// Salesforce OAuth/OIDC BFF para identidad corporativa individual.
//
// Este modulo es deliberadamente autocontenido: no registra secretos, no expone
// tokens de Salesforce al navegador y no depende del proveedor Bearer estatico.
// La integracion HTTP puede montarlo gradualmente mediante la interfaz publica al
// final del archivo.

import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type JsonWebKey,
} from 'node:crypto';

import type { Principal, ResourceBindings } from './security.ts';

const SALESFORCE_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const USER_ID = /^005[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const CONTACT_ID = /^003[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const ACCOUNT_ID = /^001[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const SAFE_COOKIE_NAME = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_PERMISSION_SET = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SESSION_HANDLE = Symbol('oidc-session-handle');

export class OidcSecurityError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status = 400, message = 'No se pudo validar la identidad corporativa.') {
    super(message);
    this.name = 'OidcSecurityError';
    this.status = status;
    this.code = code;
  }
}

export interface SalesforceRoleMappings {
  readonly adminPermissionSets: readonly string[];
  readonly advisorPermissionSets: readonly string[];
}

export interface SalesforceNamedUser {
  readonly id: string;
  readonly active: boolean;
  readonly contactId?: string;
  readonly accountId?: string;
}

export interface SalesforceOidcBffConfig {
  readonly clientId: string;
  /** Se conserva solo en memoria del servidor y solo se envia al token endpoint. */
  readonly clientSecret?: string;
  readonly loginOrigin: string;
  readonly callbackUrls: readonly string[];
  readonly allowedOrigins: readonly string[];
  /** Hostnames exactos; no se aceptan comodines ni sufijos implicitos. */
  readonly allowedSalesforceHosts: readonly string[];
  readonly expectedIssuers: readonly string[];
  readonly apiVersion: string;
  readonly production: boolean;
  readonly roleMappings: SalesforceRoleMappings;
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly jwksUri?: string;
  readonly scopes?: readonly string[];
  readonly cookieName?: string;
  readonly developmentCookieSecure?: boolean;
  readonly authAttemptTtlMs?: number;
  readonly sessionTtlMs?: number;
  readonly jwksTtlMs?: number;
  readonly clockSkewSeconds?: number;
  readonly requestTimeoutMs?: number;
  readonly maxAuthAttempts?: number;
  readonly maxSessions?: number;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
  readonly random?: (bytes: number) => Buffer;
}

export interface BeginAuthorizationInput {
  readonly origin: string;
  readonly callbackUrl: string;
  readonly returnTo?: string;
}

export interface BeginAuthorizationResult {
  readonly authorizationUrl: string;
  readonly state: string;
  readonly nonce: string;
}

export interface CompleteAuthorizationInput {
  /** URL absoluta recibida por el servidor, incluyendo code/state. */
  readonly callbackUrl: string;
  readonly origin: string;
}

export interface SalesforceSessionCredential {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly instanceUrl: string;
}

export interface AuthenticatedOidcSession {
  readonly principal: Principal;
  readonly csrfToken: string;
  readonly expiresAt: number;
  /** Solo para codigo server-side; nunca serializar esta estructura al cliente. */
  readonly salesforce: SalesforceSessionCredential;
  readonly [SESSION_HANDLE]: string;
}

export interface OidcLoginResult {
  readonly principal: Principal;
  readonly csrfToken: string;
  readonly expiresAt: number;
  readonly setCookie: string;
  readonly returnTo: string;
}

export interface MutationGuardInput {
  readonly method: string;
  readonly origin?: string;
  readonly csrfToken?: string;
}

export interface LogoutInput {
  readonly cookieHeader?: string;
  readonly origin?: string;
  readonly csrfToken?: string;
}

export interface GarbageCollectionResult {
  readonly authAttemptsRemoved: number;
  readonly sessionsRemoved: number;
}

export interface SalesforceOidcBff {
  readonly cookieName: string;
  beginAuthorization(input: BeginAuthorizationInput): BeginAuthorizationResult;
  completeAuthorization(input: CompleteAuthorizationInput): Promise<OidcLoginResult>;
  authenticate(cookieHeader: string | undefined): AuthenticatedOidcSession;
  /** Renueva el access token con single-flight, sin cambiar la cookie opaca. */
  refreshSalesforceSession(cookieHeader: string | undefined): Promise<AuthenticatedOidcSession>;
  rotateSession(cookieHeader: string | undefined): OidcLoginResult;
  assertMutationAllowed(input: MutationGuardInput, session: AuthenticatedOidcSession): void;
  logout(input: LogoutInput): { setCookie: string };
  clearCookie(): string;
  garbageCollect(): GarbageCollectionResult;
}

interface AuthAttempt {
  readonly callbackUrl: string;
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly origin: string;
  readonly returnTo: string;
  readonly expiresAt: number;
}

interface StoredSession {
  readonly principal: Principal;
  readonly csrfToken: string;
  readonly salesforce: SalesforceSessionCredential;
  readonly expiresAt: number;
}

interface IdTokenClaims {
  readonly iss: string;
  readonly aud: string | string[];
  readonly sub: string;
  readonly nonce: string;
  readonly exp: number;
  readonly iat?: number;
  readonly nbf?: number;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly instance_url?: unknown;
  readonly id_token?: unknown;
}

interface JwksResponse {
  readonly keys?: unknown;
}

interface UserInfoResponse {
  readonly user_id?: unknown;
  readonly sub?: unknown;
}

interface QueryResponse<T> {
  readonly totalSize?: unknown;
  readonly done?: unknown;
  readonly records?: unknown;
}

interface UserRecord {
  readonly Id?: unknown;
  readonly IsActive?: unknown;
  readonly ContactId?: unknown;
  readonly Contact?: { readonly AccountId?: unknown } | null;
}

interface PermissionSetAssignmentRecord {
  readonly PermissionSet?: { readonly Name?: unknown } | null;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function constantTimeEqual(left: string, right: string): boolean {
  return timingSafeEqual(sha256(left), sha256(right));
}

function opaqueToken(random: (bytes: number) => Buffer, bytes = 32): string {
  const value = random(bytes);
  if (!Buffer.isBuffer(value) || value.byteLength !== bytes) {
    throw new Error('El generador aleatorio OIDC no devolvio la longitud solicitada.');
  }
  return value.toString('base64url');
}

function exactOrigin(value: string, production: boolean, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} debe ser un origin absoluto.`);
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (
    url.origin !== value ||
    url.username !== '' ||
    url.password !== '' ||
    (url.protocol !== 'https:' && (production || !loopback))
  ) {
    throw new Error(`${label} debe ser un origin HTTPS exacto (HTTP solo en loopback de desarrollo).`);
  }
  return value;
}

function exactCallback(value: string, production: boolean, allowedOrigins: ReadonlySet<string>): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Cada callback OIDC debe ser una URL absoluta.');
  }
  exactOrigin(url.origin, production, 'El origin del callback OIDC');
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !allowedOrigins.has(url.origin)
  ) {
    throw new Error('Cada callback OIDC debe pertenecer a un origin permitido y no llevar query ni fragmento.');
  }
  return url.href;
}

function validPositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
  min: number,
  max: number,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < min || selected > max) {
    throw new Error(`${label} debe ser un entero entre ${min} y ${max}.`);
  }
  return selected;
}

function safeReturnTo(value: string | undefined): string {
  if (value === undefined) return '/';
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('\r') ||
    value.includes('\n') ||
    value.includes('#')
  ) {
    throw new OidcSecurityError('OIDC_RETURN_TO_INVALID');
  }
  return value;
}

function assertAllowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): string {
  if (typeof origin !== 'string' || !allowed.has(origin)) {
    throw new OidcSecurityError('OIDC_ORIGIN_DENIED', 403, 'Origin no permitido.');
  }
  return origin;
}

function assertAllowedCallback(callback: string, allowed: ReadonlySet<string>): URL {
  let parsed: URL;
  try {
    parsed = new URL(callback);
  } catch {
    throw new OidcSecurityError('OIDC_CALLBACK_DENIED');
  }
  const base = `${parsed.origin}${parsed.pathname}`;
  if (!allowed.has(base) || parsed.hash) {
    throw new OidcSecurityError('OIDC_CALLBACK_DENIED');
  }
  return parsed;
}

function assertSalesforceHost(url: URL, hosts: ReadonlySet<string>, production: boolean): void {
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (
    !hosts.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && (production || !loopback))
  ) {
    throw new OidcSecurityError('OIDC_SALESFORCE_HOST_DENIED', 502);
  }
}

function salesforceOrigin(
  value: unknown,
  hosts: ReadonlySet<string>,
  production: boolean,
): string {
  if (typeof value !== 'string') throw new OidcSecurityError('OIDC_TOKEN_RESPONSE_INVALID', 502);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcSecurityError('OIDC_TOKEN_RESPONSE_INVALID', 502);
  }
  assertSalesforceHost(url, hosts, production);
  if (url.origin !== value) throw new OidcSecurityError('OIDC_SALESFORCE_HOST_DENIED', 502);
  return value;
}

function endpointUrl(
  value: string,
  hosts: ReadonlySet<string>,
  production: boolean,
  label: string,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} debe ser una URL absoluta.`);
  }
  try {
    assertSalesforceHost(url, hosts, production);
  } catch {
    throw new Error(`${label} debe usar un host Salesforce permitido.`);
  }
  if (url.search || url.hash) throw new Error(`${label} no debe llevar query ni fragmento.`);
  return url.href;
}

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader.length > 8_192) return null;
  const matches: string[] = [];
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index < 1) continue;
    if (pair.slice(0, index).trim() === name) matches.push(pair.slice(index + 1).trim());
  }
  if (matches.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(matches[0] ?? '')) return null;
  return matches[0] ?? null;
}

function clonePrincipal(principal: Principal): Principal {
  return {
    ...principal,
    bindings: {
      contactIds: [...principal.bindings.contactIds],
      accountIds: [...principal.bindings.accountIds],
      assetIds: [...principal.bindings.assetIds],
      workOrderIds: [...principal.bindings.workOrderIds],
    },
  };
}

function namedUserId(value: unknown, prefix: RegExp): string | undefined {
  return typeof value === 'string' && prefix.test(value) ? value : undefined;
}

function validatePermissionMappings(mappings: SalesforceRoleMappings): SalesforceRoleMappings {
  const admin = [...new Set(mappings.adminPermissionSets)];
  const advisor = [...new Set(mappings.advisorPermissionSets)];
  if (
    admin.some((name) => !SAFE_PERMISSION_SET.test(name)) ||
    advisor.some((name) => !SAFE_PERMISSION_SET.test(name))
  ) {
    throw new Error('Los Permission Sets OIDC deben usar API names exactos y validos.');
  }
  if (admin.some((name) => advisor.includes(name))) {
    throw new Error('Un Permission Set OIDC no puede mapear simultaneamente admin y asesor.');
  }
  return { adminPermissionSets: admin, advisorPermissionSets: advisor };
}

/**
 * Convierte atributos ya leidos por el servidor desde Salesforce en el Principal
 * consumido por el RBAC existente. El navegador no participa en esta decision.
 */
export function deriveSalesforcePrincipal(
  user: SalesforceNamedUser,
  permissionSets: readonly string[],
  mappings: SalesforceRoleMappings,
): Principal {
  if (!USER_ID.test(user.id)) throw new OidcSecurityError('OIDC_USER_INVALID', 403);
  if (!user.active) throw new OidcSecurityError('OIDC_USER_INACTIVE', 403);
  const safeMappings = validatePermissionMappings(mappings);
  const assigned = new Set(permissionSets.filter((name) => SAFE_PERMISSION_SET.test(name)));
  const bindings: ResourceBindings = {
    contactIds: user.contactId && CONTACT_ID.test(user.contactId) ? [user.contactId] : [],
    accountIds: user.accountId && ACCOUNT_ID.test(user.accountId) ? [user.accountId] : [],
    assetIds: [],
    workOrderIds: [],
  };

  let role: Principal['role'] | undefined;
  if (safeMappings.adminPermissionSets.some((name) => assigned.has(name))) role = 'admin';
  else if (safeMappings.advisorPermissionSets.some((name) => assigned.has(name))) role = 'asesor';
  else if (bindings.contactIds.length > 0 || bindings.accountIds.length > 0) role = 'cliente';
  if (!role) throw new OidcSecurityError('OIDC_ROLE_DENIED', 403);

  return { id: user.id, role, authProvider: 'salesforce-oidc', bindings };
}

function parseJwtPart<T>(part: string): T {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    throw new OidcSecurityError('OIDC_ID_TOKEN_INVALID', 401);
  }
}

function stringArrayAudience(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  return [];
}

function assertJsonResponse(response: Response): void {
  const type = response.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new OidcSecurityError('OIDC_UPSTREAM_INVALID', 502);
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new OidcSecurityError('OIDC_UPSTREAM_REJECTED', 502);
  assertJsonResponse(response);
  try {
    return await response.json() as T;
  } catch {
    throw new OidcSecurityError('OIDC_UPSTREAM_INVALID', 502);
  }
}

export function createSalesforceOidcBff(input: SalesforceOidcBffConfig): SalesforceOidcBff {
  if (!/^[\x21-\x7E]{1,512}$/.test(input.clientId)) throw new Error('OIDC clientId no es valido.');
  if (input.clientSecret !== undefined && !/^[\x21-\x7E]{16,2048}$/.test(input.clientSecret)) {
    throw new Error('OIDC clientSecret no es valido.');
  }
  if (!/^v\d{1,3}\.\d$/.test(input.apiVersion)) throw new Error('OIDC apiVersion no es valida.');

  const allowedOrigins = new Set(
    input.allowedOrigins.map((origin) => exactOrigin(origin, input.production, 'Cada origin permitido')),
  );
  if (allowedOrigins.size === 0) throw new Error('OIDC requiere al menos un origin permitido.');
  const callbacks = new Set(
    input.callbackUrls.map((value) => exactCallback(value, input.production, allowedOrigins)),
  );
  if (callbacks.size === 0) throw new Error('OIDC requiere al menos un callback permitido.');

  const salesforceHosts = new Set(input.allowedSalesforceHosts.map((host) => host.toLowerCase()));
  if (
    salesforceHosts.size === 0 ||
    [...salesforceHosts].some((host) => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(host))
  ) {
    throw new Error('OIDC allowedSalesforceHosts debe contener hostnames exactos validos.');
  }
  const loginOrigin = exactOrigin(input.loginOrigin, input.production, 'OIDC loginOrigin');
  const loginUrl = new URL(loginOrigin);
  if (!salesforceHosts.has(loginUrl.hostname.toLowerCase())) {
    throw new Error('OIDC loginOrigin no esta en allowedSalesforceHosts.');
  }

  const expectedIssuers = new Set(
    input.expectedIssuers.map((issuer) => exactOrigin(issuer, input.production, 'Cada issuer OIDC')),
  );
  if (expectedIssuers.size === 0) throw new Error('OIDC requiere al menos un issuer esperado.');
  for (const issuer of expectedIssuers) {
    if (!salesforceHosts.has(new URL(issuer).hostname.toLowerCase())) {
      throw new Error('Cada issuer OIDC debe usar un host Salesforce permitido.');
    }
  }

  const authorizationEndpoint = endpointUrl(
    input.authorizationEndpoint ?? `${loginOrigin}/services/oauth2/authorize`,
    salesforceHosts,
    input.production,
    'OIDC authorizationEndpoint',
  );
  const tokenEndpoint = endpointUrl(
    input.tokenEndpoint ?? `${loginOrigin}/services/oauth2/token`,
    salesforceHosts,
    input.production,
    'OIDC tokenEndpoint',
  );
  const jwksUri = endpointUrl(
    input.jwksUri ?? `${loginOrigin}/id/keys`,
    salesforceHosts,
    input.production,
    'OIDC jwksUri',
  );
  const scopes = [...new Set(input.scopes ?? ['openid', 'api', 'refresh_token'])];
  if (!scopes.includes('openid') || scopes.some((scope) => !/^[A-Za-z0-9_:-]{1,80}$/.test(scope))) {
    throw new Error('OIDC scopes debe incluir openid y contener scopes validos.');
  }
  const roleMappings = validatePermissionMappings(input.roleMappings);

  const cookieName = input.cookieName ?? (input.production ? '__Host-torre_session' : 'torre_session');
  if (!SAFE_COOKIE_NAME.test(cookieName) || (input.production && !cookieName.startsWith('__Host-'))) {
    throw new Error('La cookie OIDC de produccion debe usar el prefijo __Host-.');
  }
  const cookieSecure = input.production || input.developmentCookieSecure === true;
  const authAttemptTtlMs = validPositiveInteger(
    input.authAttemptTtlMs,
    5 * 60_000,
    'OIDC authAttemptTtlMs',
    30_000,
    15 * 60_000,
  );
  const sessionTtlMs = validPositiveInteger(
    input.sessionTtlMs,
    8 * 60 * 60_000,
    'OIDC sessionTtlMs',
    60_000,
    24 * 60 * 60_000,
  );
  const jwksTtlMs = validPositiveInteger(
    input.jwksTtlMs,
    5 * 60_000,
    'OIDC jwksTtlMs',
    10_000,
    60 * 60_000,
  );
  const clockSkewSeconds = validPositiveInteger(
    input.clockSkewSeconds,
    60,
    'OIDC clockSkewSeconds',
    0,
    300,
  );
  const requestTimeoutMs = validPositiveInteger(
    input.requestTimeoutMs,
    10_000,
    'OIDC requestTimeoutMs',
    1_000,
    60_000,
  );
  const maxAuthAttempts = validPositiveInteger(
    input.maxAuthAttempts,
    2_000,
    'OIDC maxAuthAttempts',
    1,
    100_000,
  );
  const maxSessions = validPositiveInteger(input.maxSessions, 10_000, 'OIDC maxSessions', 1, 1_000_000);
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? Date.now;
  const random = input.random ?? randomBytes;

  const authAttempts = new Map<string, AuthAttempt>();
  const sessions = new Map<string, StoredSession>();
  const refreshFlights = new Map<string, Promise<AuthenticatedOidcSession>>();
  let jwksCache: { keys: JsonWebKey[]; expiresAt: number } | null = null;
  let jwksFlight: Promise<JsonWebKey[]> | null = null;

  const collect = (): GarbageCollectionResult => {
    const current = now();
    let authAttemptsRemoved = 0;
    let sessionsRemoved = 0;
    for (const [key, attempt] of authAttempts) {
      if (attempt.expiresAt <= current) {
        authAttempts.delete(key);
        authAttemptsRemoved += 1;
      }
    }
    for (const [key, session] of sessions) {
      if (session.expiresAt <= current) {
        sessions.delete(key);
        sessionsRemoved += 1;
      }
    }
    return { authAttemptsRemoved, sessionsRemoved };
  };

  const request = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetcher(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch {
      throw new OidcSecurityError('OIDC_UPSTREAM_UNAVAILABLE', 502);
    }
  };

  const getJwks = async (force = false): Promise<JsonWebKey[]> => {
    if (!force && jwksCache && jwksCache.expiresAt > now()) return jwksCache.keys;
    if (jwksFlight) return jwksFlight;
    jwksFlight = (async () => {
      const response = await request(jwksUri, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
      });
      const body = await responseJson<JwksResponse>(response);
      if (!Array.isArray(body.keys)) throw new OidcSecurityError('OIDC_JWKS_INVALID', 502);
      const keys = body.keys.filter(
        (candidate): candidate is JsonWebKey =>
          typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate),
      );
      if (keys.length === 0 || keys.length > 100) {
        throw new OidcSecurityError('OIDC_JWKS_INVALID', 502);
      }
      jwksCache = { keys, expiresAt: now() + jwksTtlMs };
      return keys;
    })();
    try {
      return await jwksFlight;
    } finally {
      jwksFlight = null;
    }
  };

  const validateIdToken = async (token: string, expectedNonce: string): Promise<IdTokenClaims> => {
    if (token.length > 32_768) throw new OidcSecurityError('OIDC_ID_TOKEN_INVALID', 401);
    const parts = token.split('.');
    if (parts.length !== 3) throw new OidcSecurityError('OIDC_ID_TOKEN_INVALID', 401);
    const [encodedHeader = '', encodedPayload = '', encodedSignature = ''] = parts;
    const header = parseJwtPart<{ alg?: unknown; kid?: unknown; typ?: unknown }>(encodedHeader);
    if (
      header.alg !== 'RS256' ||
      typeof header.kid !== 'string' ||
      !/^[A-Za-z0-9._-]{1,200}$/.test(header.kid)
    ) {
      throw new OidcSecurityError('OIDC_ID_TOKEN_INVALID', 401);
    }

    let keys = await getJwks();
    let jwk = keys.find((key) => key.kid === header.kid && (!key.alg || key.alg === 'RS256'));
    if (!jwk) {
      jwksCache = null;
      keys = await getJwks(true);
      jwk = keys.find((key) => key.kid === header.kid && (!key.alg || key.alg === 'RS256'));
    }
    if (!jwk || jwk.kty !== 'RSA') throw new OidcSecurityError('OIDC_ID_TOKEN_INVALID', 401);

    let signature: Buffer;
    let publicKey;
    try {
      signature = Buffer.from(encodedSignature, 'base64url');
      publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      throw new OidcSecurityError('OIDC_ID_TOKEN_INVALID', 401);
    }
    if (!verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, signature)) {
      throw new OidcSecurityError('OIDC_ID_TOKEN_INVALID', 401);
    }

    const raw = parseJwtPart<Record<string, unknown>>(encodedPayload);
    if (typeof raw.iss !== 'string' || !expectedIssuers.has(raw.iss)) {
      throw new OidcSecurityError('OIDC_ISSUER_INVALID', 401);
    }
    const audiences = stringArrayAudience(raw.aud);
    if (!audiences.includes(input.clientId)) {
      throw new OidcSecurityError('OIDC_AUDIENCE_INVALID', 401);
    }
    if (typeof raw.nonce !== 'string' || !constantTimeEqual(raw.nonce, expectedNonce)) {
      throw new OidcSecurityError('OIDC_NONCE_INVALID', 401);
    }
    const seconds = Math.floor(now() / 1_000);
    if (
      typeof raw.exp !== 'number' ||
      !Number.isSafeInteger(raw.exp) ||
      raw.exp <= seconds - clockSkewSeconds ||
      (raw.iat !== undefined && (typeof raw.iat !== 'number' || raw.iat > seconds + clockSkewSeconds)) ||
      (raw.nbf !== undefined && (typeof raw.nbf !== 'number' || raw.nbf > seconds + clockSkewSeconds)) ||
      typeof raw.sub !== 'string' ||
      raw.sub.length > 2_048
    ) {
      throw new OidcSecurityError('OIDC_ID_TOKEN_INVALID', 401);
    }
    return raw as unknown as IdTokenClaims;
  };

  const query = async <T>(
    instanceUrl: string,
    accessToken: string,
    soql: string,
  ): Promise<T[]> => {
    const url = new URL(`/services/data/${input.apiVersion}/query`, instanceUrl);
    url.searchParams.set('q', soql);
    const response = await request(url.href, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
    });
    const body = await responseJson<QueryResponse<T>>(response);
    if (!Array.isArray(body.records)) throw new OidcSecurityError('OIDC_SALESFORCE_RESPONSE_INVALID', 502);
    return body.records as T[];
  };

  const resolveNamedUser = async (
    claims: IdTokenClaims,
    accessToken: string,
    instanceUrl: string,
  ): Promise<Principal> => {
    const userInfoUrl = new URL('/services/oauth2/userinfo', instanceUrl);
    const userInfoResponse = await request(userInfoUrl.href, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
    });
    const userInfo = await responseJson<UserInfoResponse>(userInfoResponse);
    const userId = namedUserId(userInfo.user_id, USER_ID);
    if (!userId) throw new OidcSecurityError('OIDC_USER_INVALID', 403);
    if (typeof userInfo.sub === 'string' && !constantTimeEqual(userInfo.sub, claims.sub)) {
      throw new OidcSecurityError('OIDC_SUBJECT_INVALID', 401);
    }
    const subjectUserId = claims.sub.split('/').at(-1);
    if (subjectUserId && SALESFORCE_ID.test(subjectUserId) && !constantTimeEqual(subjectUserId, userId)) {
      throw new OidcSecurityError('OIDC_SUBJECT_INVALID', 401);
    }

    // userId tiene formato Salesforce estricto; ningun texto del navegador llega a SOQL.
    const users = await query<UserRecord>(
      instanceUrl,
      accessToken,
      `SELECT Id, IsActive, ContactId, Contact.AccountId FROM User WHERE Id='${userId}' LIMIT 1`,
    );
    if (users.length !== 1) throw new OidcSecurityError('OIDC_USER_INVALID', 403);
    const user = users[0];
    if (!user || user.Id !== userId || typeof user.IsActive !== 'boolean') {
      throw new OidcSecurityError('OIDC_USER_INVALID', 403);
    }
    const namedUser: SalesforceNamedUser = {
      id: userId,
      active: user.IsActive,
      contactId: namedUserId(user.ContactId, CONTACT_ID),
      accountId: namedUserId(user.Contact?.AccountId, ACCOUNT_ID),
    };
    const relevantPermissionSets = [
      ...new Set([
        ...roleMappings.adminPermissionSets,
        ...roleMappings.advisorPermissionSets,
      ]),
    ];
    const assignments = relevantPermissionSets.length === 0
      ? []
      : await query<PermissionSetAssignmentRecord>(
        instanceUrl,
        accessToken,
        `SELECT PermissionSet.Name FROM PermissionSetAssignment WHERE AssigneeId='${userId}' ` +
          `AND PermissionSet.Name IN (${relevantPermissionSets.map((name) => `'${name}'`).join(',')})`,
      );
    const permissionSets = assignments.flatMap((assignment) => {
      const name = assignment.PermissionSet?.Name;
      return typeof name === 'string' && SAFE_PERMISSION_SET.test(name) ? [name] : [];
    });
    return deriveSalesforcePrincipal(namedUser, permissionSets, roleMappings);
  };

  const setCookie = (token: string, expiresAt: number): string => {
    const maxAge = Math.max(0, Math.floor((expiresAt - now()) / 1_000));
    return `${cookieName}=${token}; Path=/; HttpOnly;${cookieSecure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAge}`;
  };

  const clearCookie = (): string =>
    `${cookieName}=; Path=/; HttpOnly;${cookieSecure ? ' Secure;' : ''} SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

  const sessionView = (key: string, session: StoredSession): AuthenticatedOidcSession => {
    const view = {
      principal: clonePrincipal(session.principal),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      salesforce: { ...session.salesforce },
    } as AuthenticatedOidcSession;
    Object.defineProperty(view, SESSION_HANDLE, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: key,
    });
    return Object.freeze(view);
  };

  const storedSession = (cookieHeader: string | undefined): { key: string; session: StoredSession } => {
    const token = parseCookie(cookieHeader, cookieName);
    const key = token ? sha256(token).toString('base64url') : '';
    const session = key ? sessions.get(key) : undefined;
    if (!session || session.expiresAt <= now()) {
      if (key) sessions.delete(key);
      throw new OidcSecurityError('OIDC_SESSION_INVALID', 401, 'Se requiere una sesion valida.');
    }
    return { key, session };
  };

  const insertSession = (
    principal: Principal,
    salesforce: SalesforceSessionCredential,
  ): { token: string; key: string; session: StoredSession } => {
    collect();
    if (sessions.size >= maxSessions) {
      throw new OidcSecurityError('OIDC_CAPACITY_EXCEEDED', 503, 'Capacidad temporal agotada.');
    }
    let token = '';
    let key = '';
    do {
      token = opaqueToken(random);
      key = sha256(token).toString('base64url');
    } while (sessions.has(key));
    const session: StoredSession = {
      principal: clonePrincipal(principal),
      csrfToken: opaqueToken(random),
      salesforce: { ...salesforce },
      expiresAt: now() + sessionTtlMs,
    };
    sessions.set(key, session);
    return { token, key, session };
  };

  const beginAuthorization = (begin: BeginAuthorizationInput): BeginAuthorizationResult => {
    assertAllowedOrigin(begin.origin, allowedOrigins);
    if (!callbacks.has(begin.callbackUrl)) throw new OidcSecurityError('OIDC_CALLBACK_DENIED');
    collect();
    if (authAttempts.size >= maxAuthAttempts) {
      throw new OidcSecurityError('OIDC_CAPACITY_EXCEEDED', 503, 'Capacidad temporal agotada.');
    }
    const state = opaqueToken(random);
    const nonce = opaqueToken(random);
    const codeVerifier = opaqueToken(random, 64);
    const challenge = sha256(codeVerifier).toString('base64url');
    authAttempts.set(sha256(state).toString('base64url'), {
      callbackUrl: begin.callbackUrl,
      codeVerifier,
      nonce,
      origin: begin.origin,
      returnTo: safeReturnTo(begin.returnTo),
      expiresAt: now() + authAttemptTtlMs,
    });
    const url = new URL(authorizationEndpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: input.clientId,
      redirect_uri: begin.callbackUrl,
      scope: scopes.join(' '),
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return { authorizationUrl: url.href, state, nonce };
  };

  const completeAuthorization = async (
    complete: CompleteAuthorizationInput,
  ): Promise<OidcLoginResult> => {
    assertAllowedOrigin(complete.origin, allowedOrigins);
    const callback = assertAllowedCallback(complete.callbackUrl, callbacks);
    if (callback.searchParams.has('error')) {
      throw new OidcSecurityError('OIDC_AUTHORIZATION_FAILED', 401);
    }
    const states = callback.searchParams.getAll('state');
    const codes = callback.searchParams.getAll('code');
    if (states.length !== 1 || codes.length !== 1 || !states[0] || !codes[0]) {
      throw new OidcSecurityError('OIDC_CALLBACK_INVALID');
    }
    if (states[0].length > 512 || codes[0].length > 4_096) {
      throw new OidcSecurityError('OIDC_CALLBACK_INVALID');
    }
    const stateKey = sha256(states[0]).toString('base64url');
    const attempt = authAttempts.get(stateKey);
    // Se consume antes de cualquier I/O: error, timeout y carrera no permiten replay.
    authAttempts.delete(stateKey);
    if (
      !attempt ||
      attempt.expiresAt <= now() ||
      !constantTimeEqual(attempt.origin, complete.origin) ||
      `${callback.origin}${callback.pathname}` !== attempt.callbackUrl
    ) {
      throw new OidcSecurityError('OIDC_STATE_INVALID', 401);
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: input.clientId,
      code: codes[0],
      redirect_uri: attempt.callbackUrl,
      code_verifier: attempt.codeVerifier,
    });
    if (input.clientSecret) body.set('client_secret', input.clientSecret);
    const tokenResponse = await request(tokenEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      redirect: 'error',
    });
    const tokens = await responseJson<TokenResponse>(tokenResponse);
    if (
      typeof tokens.access_token !== 'string' ||
      tokens.access_token.length < 16 ||
      typeof tokens.id_token !== 'string'
    ) {
      throw new OidcSecurityError('OIDC_TOKEN_RESPONSE_INVALID', 502);
    }
    const claims = await validateIdToken(tokens.id_token, attempt.nonce);
    const instanceUrl = salesforceOrigin(tokens.instance_url, salesforceHosts, input.production);
    const principal = await resolveNamedUser(claims, tokens.access_token, instanceUrl);
    const salesforce: SalesforceSessionCredential = {
      accessToken: tokens.access_token,
      refreshToken: typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined,
      instanceUrl,
    };
    const created = insertSession(principal, salesforce);
    return {
      principal: clonePrincipal(principal),
      csrfToken: created.session.csrfToken,
      expiresAt: created.session.expiresAt,
      setCookie: setCookie(created.token, created.session.expiresAt),
      returnTo: attempt.returnTo,
    };
  };

  const authenticate = (cookieHeader: string | undefined): AuthenticatedOidcSession => {
    const { key, session } = storedSession(cookieHeader);
    return sessionView(key, session);
  };

  const refreshSalesforceSession = async (
    cookieHeader: string | undefined,
  ): Promise<AuthenticatedOidcSession> => {
    const current = storedSession(cookieHeader);
    const existing = refreshFlights.get(current.key);
    if (existing) return existing;
    if (!current.session.salesforce.refreshToken) {
      throw new OidcSecurityError('OIDC_REFRESH_UNAVAILABLE', 401, 'La sesion no se puede renovar.');
    }
    const flight = (async (): Promise<AuthenticatedOidcSession> => {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: input.clientId,
        refresh_token: current.session.salesforce.refreshToken ?? '',
      });
      if (input.clientSecret) body.set('client_secret', input.clientSecret);
      const response = await request(tokenEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        redirect: 'error',
      });
      const tokens = await responseJson<TokenResponse>(response);
      if (typeof tokens.access_token !== 'string' || tokens.access_token.length < 16) {
        throw new OidcSecurityError('OIDC_TOKEN_RESPONSE_INVALID', 502);
      }
      const instanceUrl = tokens.instance_url === undefined
        ? current.session.salesforce.instanceUrl
        : salesforceOrigin(tokens.instance_url, salesforceHosts, input.production);
      // No resucita una sesion cerrada/rotada mientras el refresh estaba en vuelo.
      if (sessions.get(current.key) !== current.session) {
        throw new OidcSecurityError('OIDC_SESSION_INVALID', 401, 'Se requiere una sesion valida.');
      }
      const refreshed: StoredSession = {
        ...current.session,
        salesforce: {
          accessToken: tokens.access_token,
          refreshToken: typeof tokens.refresh_token === 'string'
            ? tokens.refresh_token
            : current.session.salesforce.refreshToken,
          instanceUrl,
        },
      };
      sessions.set(current.key, refreshed);
      return sessionView(current.key, refreshed);
    })();
    refreshFlights.set(current.key, flight);
    try {
      return await flight;
    } finally {
      if (refreshFlights.get(current.key) === flight) refreshFlights.delete(current.key);
    }
  };

  const rotateSession = (cookieHeader: string | undefined): OidcLoginResult => {
    const current = storedSession(cookieHeader);
    sessions.delete(current.key);
    let created: ReturnType<typeof insertSession>;
    try {
      created = insertSession(current.session.principal, current.session.salesforce);
    } catch (error) {
      // Conserva disponibilidad si falla el generador/cuota durante una rotacion.
      sessions.set(current.key, current.session);
      throw error;
    }
    return {
      principal: clonePrincipal(created.session.principal),
      csrfToken: created.session.csrfToken,
      expiresAt: created.session.expiresAt,
      setCookie: setCookie(created.token, created.session.expiresAt),
      returnTo: '/',
    };
  };

  const assertMutationAllowed = (
    mutation: MutationGuardInput,
    session: AuthenticatedOidcSession,
  ): void => {
    const method = mutation.method.toUpperCase();
    if (!MUTATING_METHODS.has(method)) return;
    assertAllowedOrigin(mutation.origin, allowedOrigins);
    const key = session[SESSION_HANDLE];
    const stored = typeof key === 'string' ? sessions.get(key) : undefined;
    if (!stored || stored.expiresAt <= now()) {
      throw new OidcSecurityError('OIDC_SESSION_INVALID', 401, 'Se requiere una sesion valida.');
    }
    if (
      typeof mutation.csrfToken !== 'string' ||
      mutation.csrfToken.length > 512 ||
      !constantTimeEqual(mutation.csrfToken, stored.csrfToken)
    ) {
      throw new OidcSecurityError('OIDC_CSRF_INVALID', 403, 'Token CSRF invalido.');
    }
  };

  const logout = (logoutInput: LogoutInput): { setCookie: string } => {
    const current = storedSession(logoutInput.cookieHeader);
    const view = sessionView(current.key, current.session);
    assertMutationAllowed({
      method: 'POST',
      origin: logoutInput.origin,
      csrfToken: logoutInput.csrfToken,
    }, view);
    sessions.delete(current.key);
    return { setCookie: clearCookie() };
  };

  return Object.freeze({
    cookieName,
    beginAuthorization,
    completeAuthorization,
    authenticate,
    refreshSalesforceSession,
    rotateSession,
    assertMutationAllowed,
    logout,
    clearCookie,
    garbageCollect: collect,
  });
}
