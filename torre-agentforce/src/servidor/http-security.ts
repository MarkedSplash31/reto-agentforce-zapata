import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, relative, sep } from 'node:path';

import { HttpRequestError } from './errores.ts';
import { AccessDeniedError, type SecurityConfig } from './security.ts';

type BodySource = AsyncIterable<Buffer | string> & { headers: IncomingHttpHeaders | Record<string, string> };

export type CorsDecision = 'no-origin' | 'same-origin' | 'allowed' | 'denied';

/**
 * Render termina TLS antes de entregar HTTP al contenedor, por lo que
 * `req.socket.encrypted` es falso incluso para un navegador same-origin HTTPS.
 * `RENDER_EXTERNAL_URL` es configuración de runtime inyectada por la plataforma,
 * no un header controlado por el cliente. Sólo se acepta cuando Render confirma el
 * runtime y el valor es un origin HTTPS exacto.
 */
export function renderExternalOrigin(
  env: Readonly<{ RENDER?: string; RENDER_EXTERNAL_URL?: string }>,
): string | undefined {
  if (env.RENDER !== 'true' || env.RENDER_EXTERNAL_URL === undefined || env.RENDER_EXTERNAL_URL === '') {
    return undefined;
  }
  const raw = env.RENDER_EXTERNAL_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('RENDER_EXTERNAL_URL no es una URL valida.');
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== raw ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('RENDER_EXTERNAL_URL debe ser un origin HTTPS exacto sin credenciales, path, query ni fragmento.');
  }
  return raw;
}

// Se calcula al importar para fallar al arrancar si el host inyecta una
// configuración inválida, en vez de convertir cada petición en un 500 opaco.
const RUNTIME_RENDER_EXTERNAL_ORIGIN = renderExternalOrigin(process.env);

export function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function corsDecision(
  origin: string | undefined,
  host: string | undefined,
  encrypted: boolean,
  allowedOrigins: ReadonlySet<string>,
  trustedExternalOrigin?: string,
): CorsDecision {
  if (!origin) return 'no-origin';
  const scheme = encrypted ? 'https' : 'http';
  if (host && origin === `${scheme}://${host}`) return 'same-origin';
  if (trustedExternalOrigin) {
    const external = new URL(trustedExternalOrigin);
    // El Host también debe coincidir. Esto evita que un Host falsificado convierta
    // el origin de Render en permiso para otro virtual host.
    if (origin === trustedExternalOrigin && host === external.host) return 'same-origin';
  }
  return allowedOrigins.has(origin) ? 'allowed' : 'denied';
}

export function applySecureHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self'; style-src-attr 'none'; " +
      "img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
      "frame-ancestors 'none'; form-action 'self'; manifest-src 'self'; media-src 'self'; worker-src 'self'",
  );
}

export function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  config: SecurityConfig,
): { preflight: boolean } {
  const originHeader = req.headers.origin;
  const origin = typeof originHeader === 'string' ? originHeader : undefined;
  const decision = corsDecision(
    origin,
    req.headers.host,
    Boolean((req.socket as { encrypted?: boolean }).encrypted),
    config.corsOrigins,
    RUNTIME_RENDER_EXTERNAL_ORIGIN,
  );
  res.setHeader('Vary', 'Origin');
  if (decision === 'denied') throw new AccessDeniedError();
  if (decision === 'allowed') {
    res.setHeader('Access-Control-Allow-Origin', origin!);
  }

  if (req.method !== 'OPTIONS') return { preflight: false };
  if (!origin) throw new AccessDeniedError();
  const requestedMethod = req.headers['access-control-request-method'];
  if (requestedMethod !== 'GET' && requestedMethod !== 'POST') throw new AccessDeniedError();
  const requestedHeaders = String(req.headers['access-control-request-headers'] ?? '')
    .split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => header !== 'authorization' && header !== 'content-type')) {
    throw new AccessDeniedError();
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return { preflight: true };
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function readJsonBody<T>(req: BodySource, maxBytes: number): Promise<T> {
  const contentEncoding = singleHeader(req.headers['content-encoding']);
  if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
    throw new HttpRequestError(415, 'UNSUPPORTED_CONTENT_ENCODING', 'La compresion del cuerpo no esta permitida.');
  }
  const contentType = singleHeader(req.headers['content-type']);
  if (!contentType || !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El cuerpo debe usar application/json.');
  }
  const charset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1]?.toLowerCase();
  if (charset && charset !== 'utf-8' && charset !== 'utf8') {
    throw new HttpRequestError(415, 'UNSUPPORTED_CHARSET', 'El JSON debe estar codificado como UTF-8.');
  }
  const declaredLength = singleHeader(req.headers['content-length']);
  if (declaredLength !== undefined) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new HttpRequestError(400, 'INVALID_CONTENT_LENGTH', 'Content-Length no es valido.');
    }
    if (Number(declaredLength) > maxBytes) {
      throw new HttpRequestError(413, 'BODY_TOO_LARGE', 'El cuerpo de la peticion excede el limite permitido.');
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new HttpRequestError(413, 'BODY_TOO_LARGE', 'El cuerpo de la peticion excede el limite permitido.');
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks, total).toString('utf8');
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpRequestError(400, 'INVALID_JSON', 'El cuerpo no contiene JSON valido.');
  }
}
