// Errores internos y su traduccion a una respuesta publica. Los detalles tecnicos
// se conservan en memoria para diagnostico, pero no cruzan la frontera HTTP.
//
// Nota: sin propiedades-parámetro en constructores — Node sólo despoja tipos,
// no los transforma, y `readonly x` en la firma es sintaxis que exige transformación.

export interface DetalleSalesforce {
  operacion: string;
  status?: number;
  codigoSalesforce?: string;
  cuerpo?: unknown;
  url?: string;
}

export class ErrorSalesforce extends Error {
  detalle: DetalleSalesforce;

  constructor(message: string, detalle: DetalleSalesforce) {
    super(message);
    this.name = 'ErrorSalesforce';
    this.detalle = detalle;
  }

  /** Forma que viaja al navegador. Sin token, sin secretos. */
  aJSON() {
    return {
      error: true,
      mensaje: redactSensitive(this.message),
      operacion: this.detalle.operacion,
      status: this.detalle.status ?? null,
      codigoSalesforce: this.detalle.codigoSalesforce ?? null,
      url: null,
      cuerpo: redactSensitive(this.detalle.cuerpo ?? null),
    };
  }
}

export interface DetalleBloqueo {
  accion: string;
  correlationId: string;
  mensajeAgente?: string;
}

/**
 * Bloqueo de política — NO es un error. Es un guardrail funcionando.
 * Los Flows lo devuelven en `varMotivoBloqueo`. La UI lo pinta distinto de un fallo
 * técnico: confundirlos haría que un guardrail correcto parezca una app rota.
 */
export class BloqueoDePolitica extends Error {
  motivo: string;
  detalle: DetalleBloqueo;

  constructor(motivo: string, detalle: DetalleBloqueo) {
    super(`Bloqueado por política: ${motivo}`);
    this.name = 'BloqueoDePolitica';
    this.motivo = motivo;
    this.detalle = detalle;
  }

  aJSON() {
    return {
      bloqueado: true,
      motivo: redactSensitive(this.motivo),
      accion: this.detalle.accion,
      correlationId: this.detalle.correlationId,
      mensaje: redactSensitive(this.detalle.mensajeAgente ?? null),
    };
  }
}

export class HttpRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = status;
    this.code = code;
  }
}

/** Traduce cualquier fallo a una respuesta publica sin filtrar evidencia interna. */
export function comoRespuestaHttp(e: unknown): { status: number; cuerpo: unknown } {
  if (e instanceof BloqueoDePolitica) return { status: 200, cuerpo: e.aJSON() };
  const errorId = randomUUID();
  if (e instanceof AuthenticationError) {
    return {
      status: 401,
      cuerpo: { error: true, codigo: e.code, mensaje: e.message, errorId },
    };
  }
  if (e instanceof AccessDeniedError) {
    return {
      status: 403,
      cuerpo: { error: true, codigo: e.code, mensaje: e.message, errorId },
    };
  }
  if (e instanceof RateLimitError) {
    return {
      status: 429,
      cuerpo: {
        error: true,
        codigo: e.code,
        mensaje: e.message,
        retryAfterSeconds: e.retryAfterSeconds,
        errorId,
      },
    };
  }
  if (e instanceof HttpRequestError) {
    return {
      status: e.status,
      cuerpo: { error: true, codigo: e.code, mensaje: e.message, errorId },
    };
  }
  if (e instanceof ErrorSalesforce) {
    const s = e.detalle.status;
    const operacion = e.detalle.operacion ?? '';

    // La org agoto su cuota diaria de llamadas a la API. No es una caida del
    // servicio ni un defecto de la aplicacion, y confundirlo con uno cuesta horas
    // de busqueda: hasta ahora salia como 502 «no fue posible completar la
    // operacion con el servicio externo» y, si el tope llegaba mientras se pedia
    // el token, como 503 «credencial no valida» —que ademas es falso y manda a
    // revisar secretos que estan bien—. Va ANTES que la rama de `auth.` por eso.
    if (e.detalle.codigoSalesforce === 'REQUEST_LIMIT_EXCEEDED') {
      return {
        status: 503,
        cuerpo: {
          error: true,
          codigo: 'CUOTA_API_AGOTADA',
          mensaje:
            'La organizacion de Salesforce agoto su cuota diaria de llamadas a la API. No es un fallo de esta aplicacion ni de tu peticion: se libera sola conforme avanza la ventana de 24 horas.',
          errorId,
        },
      };
    }

    // Un fallo de la capa de autenticación NUNCA es culpa de quien llama: la
    // aplicación no pudo identificarse ante Salesforce. Antes se devolvía 400
    // INVALID_REQUEST porque el endpoint de token responde 400 cuando la credencial
    // no sirve, y eso culpaba al cliente de un problema de configuración del
    // servidor —además de volver imposible diagnosticarlo desde fuera—.
    if (operacion.startsWith('auth.')) {
      return {
        status: 503,
        cuerpo: {
          error: true,
          codigo: 'CREDENCIAL_NO_VALIDA',
          mensaje:
            'La aplicacion no pudo autenticarse con Salesforce. Es un problema de configuracion del servidor, no de tu peticion.',
          errorId,
        },
      };
    }

    // Un choque de idempotencia no es una falla del servicio externo: la operacion
    // ya se hizo con otro contenido bajo la misma llave. Devolverlo como 502
    // UPSTREAM_FAILURE culpaba a Salesforce de un guardrail que funciono bien y
    // dejaba a quien llama sin forma de distinguirlo de una caida real.
    if (s === 409) {
      return {
        status: 409,
        cuerpo: {
          error: true,
          codigo: 'CONFLICTO_DE_IDEMPOTENCIA',
          mensaje:
            'Esa conversacion ya tiene un registro con contenido distinto. No se duplica: hay que continuar sobre el que ya existe.',
          errorId,
        },
      };
    }

    const invalidRequest = s === 400;
    return {
      status: invalidRequest ? 400 : 502,
      cuerpo: {
        error: true,
        codigo: invalidRequest ? 'INVALID_REQUEST' : 'UPSTREAM_FAILURE',
        mensaje: invalidRequest
          ? 'La peticion no cumple el contrato esperado.'
          : 'No fue posible completar la operacion con el servicio externo.',
        errorId,
      },
    };
  }
  return {
    status: 500,
    cuerpo: {
      error: true,
      codigo: 'INTERNAL_ERROR',
      mensaje: 'Ocurrio un error interno.',
      errorId,
    },
  };
}
import { randomUUID } from 'node:crypto';

import {
  AccessDeniedError,
  AuthenticationError,
  RateLimitError,
  redactSensitive,
} from './security.ts';
