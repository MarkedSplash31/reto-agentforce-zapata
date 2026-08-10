import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export const ROLES = ['cliente', 'asesor', 'admin'] as const;
export type Role = (typeof ROLES)[number];
export type AuthMode = 'required' | 'disabled';
export type AppAuthProvider = 'oidc' | 'static' | 'disabled';
export type ResourceKind = 'case' | 'session';

export interface ResourceBindings {
  readonly contactIds: readonly string[];
  readonly accountIds: readonly string[];
  readonly assetIds: readonly string[];
  readonly workOrderIds: readonly string[];
}

export interface Principal {
  id: string;
  role: Role;
  authProvider: string;
  bindings: ResourceBindings;
}

export interface StaticCredential {
  id: string;
  role: Role;
  token: string;
  bindings?: Partial<ResourceBindings>;
}

export type SalesforceResourceKind = 'contact' | 'account' | 'asset' | 'workOrder' | 'varada';

export interface OperationContext {
  correlationId: string;
  sessionKey: string;
}

export interface SecurityConfig {
  appEnv: string;
  authMode: AuthMode;
  authProvider: AppAuthProvider;
  credentials: StaticCredential[];
  corsOrigins: ReadonlySet<string>;
  trustedProxies: ReadonlySet<string>;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  authRateLimitMax: number;
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  keepAliveTimeoutMs: number;
  salesforceTimeoutMs: number;
  salesforceCliTimeoutMs: number;
  agentApiTimeoutMs: number;
}

export interface AuthProvider {
  readonly name: string;
  authenticate(authorization: string | string[] | undefined): Promise<Principal>;
}

export class AuthenticationError extends Error {
  readonly status = 401;
  readonly code = 'AUTHENTICATION_REQUIRED';

  constructor() {
    super('Se requiere una credencial valida.');
    this.name = 'AuthenticationError';
  }
}

export class AccessDeniedError extends Error {
  readonly status = 403;
  readonly code = 'ACCESS_DENIED';

  constructor() {
    super('No tienes permiso para realizar esta operacion.');
    this.name = 'AccessDeniedError';
  }
}

export class RateLimitError extends Error {
  readonly status = 429;
  readonly code = 'RATE_LIMITED';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Demasiadas solicitudes. Intenta de nuevo mas tarde.');
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  limits: { min: number; max: number },
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < limits.min || parsed > limits.max) {
    throw new Error(`${name} debe ser un entero entre ${limits.min} y ${limits.max}.`);
  }
  return parsed;
}

const SALESFORCE_ID_PATTERN = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const BINDING_FIELDS = ['contactIds', 'accountIds', 'assetIds', 'workOrderIds'] as const;

function emptyBindings(): ResourceBindings {
  return { contactIds: [], accountIds: [], assetIds: [], workOrderIds: [] };
}

function parseBindingIds(
  raw: unknown,
  field: (typeof BINDING_FIELDS)[number],
  prefix: string,
  index: number,
): readonly string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`APP_AUTH_CREDENTIALS_JSON[${index}].bindings.${field} debe ser un arreglo.`);
  }
  const unique = new Set<string>();
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : '';
    if (!SALESFORCE_ID_PATTERN.test(id) || !id.startsWith(prefix)) {
      const label = field === 'contactIds'
        ? 'Contact (003)'
        : field === 'accountIds'
          ? 'Account (001)'
          : field === 'assetIds'
            ? 'Asset (02i)'
            : 'WorkOrder (0WO)';
      throw new Error(
        `APP_AUTH_CREDENTIALS_JSON[${index}].bindings.${field} exige Ids de ${label}.`,
      );
    }
    if (unique.has(id)) {
      throw new Error(`APP_AUTH_CREDENTIALS_JSON[${index}].bindings.${field} contiene duplicados.`);
    }
    unique.add(id);
  }
  return [...unique];
}

function parseBindings(raw: unknown, role: Role, index: number): ResourceBindings {
  if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error(`APP_AUTH_CREDENTIALS_JSON[${index}].bindings debe ser un objeto.`);
  }
  const candidate = (raw ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (!(BINDING_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`APP_AUTH_CREDENTIALS_JSON[${index}].bindings.${key} no es reconocido.`);
    }
  }
  const bindings: ResourceBindings = {
    contactIds: parseBindingIds(candidate.contactIds, 'contactIds', '003', index),
    accountIds: parseBindingIds(candidate.accountIds, 'accountIds', '001', index),
    assetIds: parseBindingIds(candidate.assetIds, 'assetIds', '02i', index),
    workOrderIds: parseBindingIds(candidate.workOrderIds, 'workOrderIds', '0WO', index),
  };
  if (role === 'cliente' && BINDING_FIELDS.every((field) => bindings[field].length === 0)) {
    throw new Error(
      `APP_AUTH_CREDENTIALS_JSON[${index}].bindings debe ligar al cliente con Contact, Account, Asset o WorkOrder.`,
    );
  }
  return bindings;
}

function parseCredentials(raw: string | undefined, required: boolean): StaticCredential[] {
  if (!raw) {
    if (required) throw new Error('Falta APP_AUTH_CREDENTIALS_JSON; autenticacion cerrada por defecto.');
    return [];
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('APP_AUTH_CREDENTIALS_JSON no contiene JSON valido.');
  }
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new Error('APP_AUTH_CREDENTIALS_JSON debe ser un arreglo no vacio.');
  }

  const ids = new Set<string>();
  const tokenHashes = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`APP_AUTH_CREDENTIALS_JSON[${index}] debe ser un objeto.`);
    }
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const role = candidate.role;
    const token = candidate.token;
    if (!/^[A-Za-z0-9._:@-]{1,128}$/.test(id)) {
      throw new Error(`APP_AUTH_CREDENTIALS_JSON[${index}].id no es valido.`);
    }
    if (!ROLES.includes(role as Role)) {
      throw new Error(`APP_AUTH_CREDENTIALS_JSON[${index}].role no es valido.`);
    }
    if (typeof token !== 'string' || Buffer.byteLength(token, 'utf8') < 32) {
      throw new Error(`APP_AUTH_CREDENTIALS_JSON[${index}].token debe tener al menos 32 bytes.`);
    }
    if (Buffer.byteLength(token, 'utf8') > 512) {
      throw new Error(`APP_AUTH_CREDENTIALS_JSON[${index}].token excede 512 bytes.`);
    }
    const tokenHash = hashToken(token).toString('hex');
    if (ids.has(id) || tokenHashes.has(tokenHash)) {
      throw new Error('APP_AUTH_CREDENTIALS_JSON contiene ids o tokens duplicados.');
    }
    ids.add(id);
    tokenHashes.add(tokenHash);
    return { id, role: role as Role, token, bindings: parseBindings(candidate.bindings, role as Role, index) };
  });
}

function parseOrigins(raw: string | undefined, production: boolean): ReadonlySet<string> {
  const result = new Set<string>();
  for (const item of (raw ?? '').split(',')) {
    const candidate = item.trim();
    if (!candidate) continue;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error(`APP_CORS_ORIGINS contiene un origen invalido: ${candidate}`);
    }
    if (url.origin !== candidate || url.username || url.password || (production && url.protocol !== 'https:')) {
      throw new Error(
        production
          ? `APP_CORS_ORIGINS solo admite origins HTTPS exactos en produccion: ${candidate}`
          : `APP_CORS_ORIGINS solo admite origins exactos: ${candidate}`,
      );
    }
    result.add(candidate);
  }
  return result;
}

function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('::ffff:')) {
    const ipv4 = trimmed.slice('::ffff:'.length);
    if (isIP(ipv4) === 4) return ipv4;
  }
  return isIP(trimmed) ? trimmed : null;
}

function parseTrustedProxies(raw: string | undefined): ReadonlySet<string> {
  const result = new Set<string>();
  for (const entry of (raw ?? '').split(',')) {
    if (!entry.trim()) continue;
    const normalized = normalizeIp(entry);
    if (!normalized) {
      throw new Error(`APP_TRUST_PROXY contiene una IP invalida: ${entry.trim()}`);
    }
    result.add(normalized);
  }
  return result;
}

export function loadSecurityConfig(env: NodeJS.ProcessEnv): SecurityConfig {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? 'production').trim().toLowerCase();
  const production = appEnv === 'production';
  const modeRaw = (env.APP_AUTH_MODE ?? 'required').trim().toLowerCase();
  if (modeRaw !== 'required' && modeRaw !== 'disabled') {
    throw new Error('APP_AUTH_MODE debe ser required o disabled.');
  }
  if (production && modeRaw === 'disabled') {
    throw new Error('La autenticacion no puede desactivarse en produccion.');
  }
  const providerCandidate = env.APP_AUTH_PROVIDER?.trim().toLowerCase();
  if (production && !providerCandidate) {
    throw new Error('Produccion exige APP_AUTH_PROVIDER explicito: oidc o static de QA.');
  }
  const authProvider = (providerCandidate ?? (modeRaw === 'disabled' ? 'disabled' : 'static')) as AppAuthProvider;
  if (!['oidc', 'static', 'disabled'].includes(authProvider)) {
    throw new Error('APP_AUTH_PROVIDER debe ser oidc, static o disabled.');
  }
  const providerMode: AuthMode = authProvider === 'disabled' ? 'disabled' : 'required';
  if (env.APP_AUTH_MODE !== undefined && modeRaw !== providerMode) {
    throw new Error('APP_AUTH_MODE contradice APP_AUTH_PROVIDER. Elimina APP_AUTH_MODE o usa un valor consistente.');
  }
  if (production && authProvider === 'disabled') {
    throw new Error('APP_AUTH_PROVIDER=disabled no esta permitido en produccion.');
  }
  if (production && authProvider === 'static' && env.APP_STATIC_QA_ENABLED !== 'true') {
    throw new Error('APP_AUTH_PROVIDER=static en produccion exige APP_STATIC_QA_ENABLED=true y se reserva para QA.');
  }
  if (authProvider === 'oidc' && env.APP_AUTH_CREDENTIALS_JSON?.trim()) {
    throw new Error('APP_AUTH_CREDENTIALS_JSON no se admite con APP_AUTH_PROVIDER=oidc; no hay fallback Bearer.');
  }

  return {
    appEnv,
    authMode: providerMode,
    authProvider,
    credentials: authProvider === 'static'
      ? parseCredentials(env.APP_AUTH_CREDENTIALS_JSON, true)
      : [],
    corsOrigins: parseOrigins(env.APP_CORS_ORIGINS, production),
    trustedProxies: parseTrustedProxies(env.APP_TRUST_PROXY),
    rateLimitWindowMs: positiveInteger(env, 'APP_RATE_LIMIT_WINDOW_MS', 60_000, { min: 1_000, max: 3_600_000 }),
    rateLimitMax: positiveInteger(env, 'APP_RATE_LIMIT_MAX', 120, { min: 1, max: 100_000 }),
    authRateLimitMax: positiveInteger(env, 'APP_AUTH_RATE_LIMIT_MAX', 20, { min: 1, max: 10_000 }),
    bodyLimitBytes: positiveInteger(env, 'APP_BODY_LIMIT_BYTES', 65_536, { min: 1_024, max: 1_048_576 }),
    requestTimeoutMs: positiveInteger(env, 'APP_REQUEST_TIMEOUT_MS', 30_000, { min: 1_000, max: 300_000 }),
    // Node trae 5 s por omisión y eso provoca una carrera real: el cliente reutiliza
    // el socket en el mismo instante en que el servidor manda el FIN, y la petición
    // muere con ECONNRESET / «fetch failed» sin que nada haya fallado de verdad. Se
    // vio en una corrida e2e entre dos llamadas separadas por consultas SOQL largas.
    // 65 s deja al servidor por encima de la ventana de reutilización de cualquier
    // cliente y de los balanceadores habituales (60 s).
    keepAliveTimeoutMs: positiveInteger(env, 'APP_KEEPALIVE_TIMEOUT_MS', 65_000, { min: 1_000, max: 300_000 }),
    salesforceTimeoutMs: positiveInteger(env, 'SF_REQUEST_TIMEOUT_MS', 20_000, { min: 1_000, max: 120_000 }),
    salesforceCliTimeoutMs: positiveInteger(env, 'SF_CLI_TIMEOUT_MS', 30_000, { min: 5_000, max: 120_000 }),
    agentApiTimeoutMs: positiveInteger(env, 'AGENT_API_TIMEOUT_MS', 30_000, { min: 1_000, max: 300_000 }),
  };
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function bearerToken(authorization: string | string[] | undefined): string | null {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer ([^\s]{1,512})$/.exec(authorization);
  return match?.[1] ?? null;
}

/**
 * Baseline para acceso de servicio/evaluacion. El seam AuthProvider permite
 * sustituirlo por OIDC/JWT con identidad individual sin cambiar RBAC ni ownership.
 */
export class StaticTokenAuthProvider implements AuthProvider {
  readonly name = 'static-token';
  readonly #credentials: Array<{ principal: Principal; hash: Buffer }>;

  constructor(credentials: StaticCredential[]) {
    this.#credentials = credentials.map(({ id, role, token, bindings }) => ({
      principal: {
        id,
        role,
        authProvider: this.name,
        bindings: {
          contactIds: [...(bindings?.contactIds ?? [])],
          accountIds: [...(bindings?.accountIds ?? [])],
          assetIds: [...(bindings?.assetIds ?? [])],
          workOrderIds: [...(bindings?.workOrderIds ?? [])],
        },
      },
      hash: hashToken(token),
    }));
  }

  async authenticate(authorization: string | string[] | undefined): Promise<Principal> {
    const token = bearerToken(authorization);
    const candidateHash = hashToken(token ?? 'credencial-ausente');
    let found: Principal | null = null;
    for (const credential of this.#credentials) {
      if (timingSafeEqual(candidateHash, credential.hash)) found = credential.principal;
    }
    if (!token || !found) throw new AuthenticationError();
    return {
      ...found,
      bindings: {
        contactIds: [...found.bindings.contactIds],
        accountIds: [...found.bindings.accountIds],
        assetIds: [...found.bindings.assetIds],
        workOrderIds: [...found.bindings.workOrderIds],
      },
    };
  }
}

export class DevelopmentAuthProvider implements AuthProvider {
  readonly name = 'development-disabled';

  async authenticate(): Promise<Principal> {
    return {
      id: 'development-local',
      role: 'admin',
      authProvider: this.name,
      bindings: emptyBindings(),
    };
  }
}

export function requireRole(principal: Principal, allowed: readonly Role[]): void {
  if (!allowed.includes(principal.role)) throw new AccessDeniedError();
}

function quotedIds(ids: readonly string[]): string {
  if (ids.some((id) => !SALESFORCE_ID_PATTERN.test(id))) throw new AccessDeniedError();
  return ids.map((id) => `'${id}'`).join(',');
}

/**
 * Predicado de pertenencia listo para combinar con otros filtros SOQL. Sólo usa
 * Ids validados al cargar el proceso; ningún valor del request entra aquí.
 */
export function salesforceAccessPredicate(
  principal: Principal,
  resource: SalesforceResourceKind,
): string | null {
  if (principal.role !== 'cliente') return null;
  const { contactIds, accountIds, assetIds, workOrderIds } = principal.bindings;
  const terms: string[] = [];
  if (resource === 'contact') {
    if (contactIds.length) terms.push(`Id IN (${quotedIds(contactIds)})`);
    if (accountIds.length) terms.push(`AccountId IN (${quotedIds(accountIds)})`);
  }
  if (resource === 'account' && accountIds.length) terms.push(`Id IN (${quotedIds(accountIds)})`);
  if (resource === 'asset') {
    if (assetIds.length) terms.push(`Id IN (${quotedIds(assetIds)})`);
    if (accountIds.length) terms.push(`AccountId IN (${quotedIds(accountIds)})`);
    if (contactIds.length) terms.push(`ContactId IN (${quotedIds(contactIds)})`);
  }
  if (resource === 'workOrder') {
    if (workOrderIds.length) terms.push(`Id IN (${quotedIds(workOrderIds)})`);
    if (assetIds.length) terms.push(`AssetId IN (${quotedIds(assetIds)})`);
    if (accountIds.length) terms.push(`AccountId IN (${quotedIds(accountIds)})`);
    if (contactIds.length) terms.push(`ContactId IN (${quotedIds(contactIds)})`);
  }
  if (resource === 'varada') {
    if (workOrderIds.length) terms.push(`WorkOrder__c IN (${quotedIds(workOrderIds)})`);
    if (assetIds.length) terms.push(`Asset__c IN (${quotedIds(assetIds)})`);
    if (accountIds.length) terms.push(`Asset__r.AccountId IN (${quotedIds(accountIds)})`);
    if (contactIds.length) terms.push(`Asset__r.ContactId IN (${quotedIds(contactIds)})`);
    if (accountIds.length) terms.push(`WorkOrder__r.AccountId IN (${quotedIds(accountIds)})`);
    if (contactIds.length) terms.push(`WorkOrder__r.ContactId IN (${quotedIds(contactIds)})`);
  }
  if (terms.length === 0) throw new AccessDeniedError();
  return `(${terms.join(' OR ')})`;
}

const OPERATION_CODES: Readonly<Record<string, string>> = {
  reservar: 'rsv',
  reprogramar: 'rpg',
  varada: 'vrd',
  escalamiento: 'esc',
  agente: 'agt',
};

/** Contexto opaco generado únicamente por el servidor y ligado al principal. */
export function createOperationContext(
  principal: Principal,
  operation: string,
  operationNonce?: string,
): OperationContext {
  const principalKey = createHash('sha256').update(principal.id, 'utf8').digest('hex').slice(0, 12);
  if (operationNonce !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationNonce)) {
    throw new ClientSuppliedContextError('operationNonce debe ser un UUID v4.');
  }
  const nonce = operationNonce?.toLowerCase() ?? randomUUID();
  const operationCode = OPERATION_CODES[operation] ?? 'op';
  return {
    correlationId: `${operationCode}-${principalKey}-${nonce}`,
    sessionKey: `${principalKey}-${nonce}`,
  };
}

export class ClientSuppliedContextError extends Error {
  readonly code = 'UNTRUSTED_CONTEXT_FIELD';

  constructor(message = 'El contexto de operacion debe ser generado por el servidor.') {
    super(message);
    this.name = 'ClientSuppliedContextError';
  }
}

const SERVER_CONTEXT_FIELDS = new Set([
  'correlationid',
  'sessionkey',
  'idempotencykey',
  'sufijoidempotencia',
  'actor',
  'externalSessionKey'.toLowerCase(),
  'varcorrelationid',
  'varsessionkey',
]);

export function rejectClientSuppliedContext(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  if (Object.keys(value).some((key) => SERVER_CONTEXT_FIELDS.has(key.toLowerCase()))) {
    throw new ClientSuppliedContextError();
  }
}

export function clientNetworkKey(
  remoteAddress: string | undefined,
  forwardedFor: string | undefined,
  trustedProxies: ReadonlySet<string>,
): string {
  const remote = normalizeIp(remoteAddress) ?? 'direccion-desconocida';
  if (!trustedProxies.has(remote) || !forwardedFor) return remote;
  const rawChain = forwardedFor.split(',');
  if (rawChain.length === 0 || rawChain.length > 32) return remote;
  const chain = rawChain.map((entry) => normalizeIp(entry));
  if (chain.some((entry) => entry === null)) return remote;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]!;
    if (!trustedProxies.has(candidate)) return candidate;
  }
  return remote;
}

export function isAllowedUpstreamUrl(candidate: string, base: string, pathPrefix: string): boolean {
  try {
    const baseUrl = new URL(base);
    const target = new URL(candidate, baseUrl);
    return (
      target.origin === baseUrl.origin &&
      !target.username &&
      !target.password &&
      target.pathname.startsWith(pathPrefix)
    );
  } catch {
    return false;
  }
}

export class ResourceAuthorizer {
  readonly #owners = new Map<string, string>();

  claim(kind: ResourceKind, resourceId: string, principal: Principal): void {
    const key = this.key(kind, resourceId);
    const existing = this.#owners.get(key);
    if (existing !== undefined && existing !== principal.id && principal.role !== 'admin') {
      throw new AccessDeniedError();
    }
    this.#owners.set(key, principal.id);
  }

  release(kind: ResourceKind, resourceId: string, principal: Principal): void {
    this.requireAccess(kind, resourceId, principal);
    this.#owners.delete(this.key(kind, resourceId));
  }

  requireAccess(kind: ResourceKind, resourceId: string, principal: Principal): void {
    if (principal.role === 'admin') return;
    const key = this.key(kind, resourceId);
    if (kind === 'case' && principal.role === 'asesor' && this.#owners.has(key)) return;
    const owner = this.#owners.get(key);
    if (!owner || owner !== principal.id) throw new AccessDeniedError();
  }

  async requireCaseAccess(
    resourceId: string,
    principal: Principal,
    isOwnedByConfiguredQueue: (caseId: string) => Promise<boolean>,
  ): Promise<void> {
    if (principal.role === 'admin') return;
    if (principal.role === 'cliente') {
      this.requireAccess('case', resourceId, principal);
      return;
    }
    const key = this.key('case', resourceId);
    if (this.#owners.has(key)) return;
    if (!(await isOwnedByConfiguredQueue(resourceId))) throw new AccessDeniedError();
    // No se cachea: un Case puede salir de la cola entre solicitudes. Solo `claim`
    // crea un binding durable de proceso porque corresponde a un alta hecha por Torre.
  }

  private key(kind: ResourceKind, resourceId: string): string {
    const id = resourceId.trim();
    if (!id || id.length > 256) throw new AccessDeniedError();
    if (kind === 'case' && !/^500[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(id)) {
      throw new AccessDeniedError();
    }
    return `${kind}:${id}`;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class FixedWindowRateLimiter {
  readonly #entries = new Map<string, { count: number; startsAt: number }>();
  readonly #maxEntries: number;
  #operations = 0;
  readonly max: number;
  readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
    // La configuración pública conserva su contrato; la cota interna impide que
    // un barrido de identidades o IPs mantenga una clave distinta para siempre.
    this.#maxEntries = Math.max(256, Math.min(50_000, max * 100));
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    this.#operations += 1;
    if (this.#operations % 256 === 0) this.#pruneExpired(now);

    const current = this.#entries.get(key);
    if (!current || now - current.startsAt >= this.windowMs) {
      if (current) this.#entries.delete(key);
      if (!current && this.#entries.size >= this.#maxEntries) {
        this.#pruneExpired(now);
        while (this.#entries.size >= this.#maxEntries) {
          const oldest = this.#entries.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          this.#entries.delete(oldest);
        }
      }
      this.#entries.set(key, { count: 1, startsAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    current.count += 1;
    if (current.count <= this.max) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.startsAt + this.windowMs - now) / 1000)),
    };
  }

  #pruneExpired(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (now - entry.startsAt >= this.windowMs) this.#entries.delete(key);
    }
  }
}

const SENSITIVE_KEY = /authorization|token|secret|password|cookie|email|correo|phone|telefono|celular|vin|serialnumber/i;

function redactString(value: string): string {
  return value
    .replace(
      /("(?:access_token|refresh_token|client_secret|authorization|password)"\s*:\s*")[^"]*(")/gi,
      '$1[REDACTED]$2',
    )
    .replace(/([?&](?:access_token|refresh_token|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/00D[A-Za-z0-9]{5,}![A-Za-z0-9._-]+/g, '[REDACTED_TOKEN]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, '[REDACTED_VIN]')
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g, '[REDACTED_PHONE]');
}

export function redactSensitive(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value).slice(0, 4_000);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactSensitive(item, depth + 1, seen));

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, depth + 1, seen);
  }
  return result;
}
