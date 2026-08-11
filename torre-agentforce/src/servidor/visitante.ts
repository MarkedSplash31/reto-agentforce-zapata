// Superficie PÚBLICA del sitio de clientes de Zapata.
//
// El resto de la app exige identidad (`/api/*`). Aquí no: un cliente que entra a
// zapata.com.mx no tiene usuario, igual que no lo tiene para usar un chat de soporte.
// Lo que sí tiene es una SESIÓN DE VISITANTE emitida por el servidor.
//
// Reglas que sostienen que esto sea seguro sin login:
//   · el id de visitante lo genera el servidor y viaja en cookie HttpOnly; el
//     navegador nunca lo elige ni lo puede leer por JavaScript
//   · el `caseId` de su escalamiento vive en la sesión del SERVIDOR, no en el cuerpo
//     de la petición: un visitante no puede pedir el caso de otro aunque adivine el Id
//   · sin sesión no hay lectura ni escritura: fail-closed
//   · el visitante siempre escribe como `cliente`; nunca puede hablar como asesor

import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { HttpRequestError } from './errores.ts';

/** Ventana de vida de la sesión de un visitante. */
const TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESIONES = 20_000;

export type RolWeb = 'visitante' | 'admin';

export interface SesionWeb {
  id: string;
  rol: RolWeb;
  creadaEn: number;
  expiraEn: number;
  /** Único caso que esta sesión puede leer y responder. Lo fija el servidor. */
  caseId: string | null;
  /** Correlación de la conversación con el agente, para amarrar traza en Salesforce. */
  correlationId: string | null;
  /** Sesión de Agent API abierta por este visitante, si la hay. */
  agentSessionId: string | null;
  secuenciaAgente: number;
  /**
   * Folios de `Log_Agente__c` ya enviados al navegador. La actividad del agente se
   * relee de Salesforce en cada turno (ver `actividad.ts`), así que sin esta memoria
   * el panel repetiría la misma tarjeta en cada mensaje.
   */
  actividadVista: Set<string>;
  /**
   * Si ya se le mostró el saludo de apertura. Cuando Salesforce entrega una sesión
   * inservible se descarta y se abre otra, y la nueva vuelve a traer su bienvenida:
   * sin esta bandera el cliente veía el mismo saludo dos veces seguidas antes de
   * cualquier respuesta.
   */
  saludado: boolean;
}

const sesiones = new Map<string, SesionWeb>();

function purgar(): void {
  const ahora = Date.now();
  for (const [id, s] of sesiones) if (s.expiraEn <= ahora) sesiones.delete(id);
  // Tope duro: si alguien intenta inflar memoria, se tira lo más viejo.
  if (sesiones.size > MAX_SESIONES) {
    const orden = [...sesiones.entries()].sort((a, b) => a[1].creadaEn - b[1].creadaEn);
    for (const [id] of orden.slice(0, sesiones.size - MAX_SESIONES)) sesiones.delete(id);
  }
}

export function crearSesion(rol: RolWeb): SesionWeb {
  purgar();
  const ahora = Date.now();
  const sesion: SesionWeb = {
    id: randomUUID(),
    rol,
    creadaEn: ahora,
    expiraEn: ahora + TTL_MS,
    caseId: null,
    correlationId: null,
    agentSessionId: null,
    secuenciaAgente: 0,
    actividadVista: new Set<string>(),
    saludado: false,
  };
  sesiones.set(sesion.id, sesion);
  return sesion;
}

export function leerSesion(cookieHeader: string | undefined, rol?: RolWeb): SesionWeb | null {
  const id = cookieDe(cookieHeader, NOMBRE_COOKIE);
  if (!id) return null;
  const s = sesiones.get(id);
  if (!s) return null;
  if (s.expiraEn <= Date.now()) {
    sesiones.delete(id);
    return null;
  }
  if (rol && s.rol !== rol) return null;
  return s;
}

/** Igual que `leerSesion`, pero cierra la puerta en vez de devolver null. */
export function exigirSesion(cookieHeader: string | undefined, rol?: RolWeb): SesionWeb {
  const s = leerSesion(cookieHeader, rol);
  if (!s) {
    throw new HttpRequestError(
      401,
      'SESION_REQUERIDA',
      rol === 'admin'
        ? 'Inicia sesión para entrar al panel de asesor.'
        : 'Tu sesión de visitante expiró. Recarga la página para empezar de nuevo.',
    );
  }
  return s;
}

export function cerrarSesion(cookieHeader: string | undefined): void {
  const id = cookieDe(cookieHeader, NOMBRE_COOKIE);
  if (id) sesiones.delete(id);
}

export const NOMBRE_COOKIE = 'zapata_sesion';

export function cabeceraCookie(sesion: SesionWeb, seguro: boolean): string {
  const partes = [
    `${NOMBRE_COOKIE}=${sesion.id}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

export function cookieBorrada(seguro: boolean): string {
  const partes = [`${NOMBRE_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

function cookieDe(cabecera: string | undefined, nombre: string): string | null {
  if (!cabecera) return null;
  for (const trozo of cabecera.split(';')) {
    const [k, ...v] = trozo.trim().split('=');
    if (k === nombre) return v.join('=') || null;
  }
  return null;
}

// ── Acceso de administrador para la demo ────────────────────────────────────
//
// Un solo usuario, definido por variable de entorno. No se hornea ninguna
// contraseña en el código ni en el repositorio; sin la variable, el acceso queda
// cerrado y lo dice, en vez de abrirse con un valor por omisión.

export function accesoAdminConfigurado(): boolean {
  return Boolean(process.env.APP_ADMIN_PASS && process.env.APP_ADMIN_PASS.length >= 8);
}

export function verificarClaveAdmin(clave: unknown): boolean {
  const esperada = process.env.APP_ADMIN_PASS;
  if (!esperada || esperada.length < 8) return false;
  if (typeof clave !== 'string' || clave.length === 0) return false;
  // Comparación en tiempo constante sobre digest, para que la longitud tampoco filtre.
  const a = createHash('sha256').update(clave, 'utf8').digest();
  const b = createHash('sha256').update(esperada, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function usuarioAdmin(): string {
  return process.env.APP_ADMIN_USER || 'asesor';
}

/** Sólo para pruebas. */
export function _limpiarSesiones(): void {
  sesiones.clear();
}

export function _totalSesiones(): number {
  return sesiones.size;
}
