// Cliente REST de Salesforce. Es la única puerta por la que la app habla con la org.
// Todo lo demás (datos, flows, escalamiento) se construye encima de esto.
//
// Garantía que da este módulo: si algo falla, LANZA con la causa real. Nunca
// devuelve una lista vacía para disimular un 403. Un panel vacío y un permiso
// denegado se ven igual en pantalla, y esa confusión es lo que arruina una demo.

import { config } from './config.ts';
import { ErrorSalesforce } from './errores.ts';
import { proveedorDeToken, seguroParaLog } from './auth.ts';

interface OpcionesPeticion {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
  operacion: string;
  /** cabeceras extra; nunca incluyas Authorization aquí */
  cabeceras?: Record<string, string>;
}

/** Ruta relativa a /services/data/{version}. Ej: "/query?q=..." */
export async function peticion<T = unknown>(ruta: string, op: OpcionesPeticion): Promise<T> {
  const prov = proveedorDeToken();
  let token = await prov.obtener();

  const lanzar = async (res: Response, url: string): Promise<never> => {
    const texto = await res.text();
    let codigo: string | undefined;
    let cuerpo: unknown = seguroParaLog(texto);
    try {
      const j = JSON.parse(texto);
      const primero = Array.isArray(j) ? j[0] : j;
      codigo = primero?.errorCode;
      cuerpo = j;
    } catch {
      /* el cuerpo no era JSON; se conserva el texto redactado */
    }
    throw new ErrorSalesforce(
      `${op.operacion} respondió ${res.status}${codigo ? ` (${codigo})` : ''}`,
      { operacion: op.operacion, status: res.status, codigoSalesforce: codigo, cuerpo, url },
    );
  };

  const hacer = async (t: string): Promise<Response> => {
    const url = `${t === token.valor ? token.instanceUrl : config.loginUrl}/services/data/${config.apiVersion}${ruta}`;
    try {
      return await fetch(url, {
        method: op.metodo ?? 'GET',
        headers: {
          Authorization: `Bearer ${t}`,
          ...(op.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...op.cabeceras,
        },
        ...(op.cuerpo !== undefined ? { body: JSON.stringify(op.cuerpo) } : {}),
        signal: AbortSignal.timeout(config.security.salesforceTimeoutMs),
      });
    } catch (e) {
      throw new ErrorSalesforce(
        `No se pudo contactar la org en ${op.operacion}: ${e instanceof Error ? e.message : String(e)}`,
        { operacion: op.operacion, url },
      );
    }
  };

  const url = `${token.instanceUrl}/services/data/${config.apiVersion}${ruta}`;
  let res = await hacer(token.valor);

  // 401 → renovar una vez y reintentar una vez. Ni más, ni en silencio.
  if (res.status === 401) {
    token = await prov.renovar();
    res = await hacer(token.valor);
  }

  if (!res.ok) await lanzar(res, url);

  if (res.status === 204) return undefined as T;
  const texto = await res.text();
  if (!texto) return undefined as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ErrorSalesforce(`${op.operacion} no devolvió JSON`, {
      operacion: op.operacion,
      status: res.status,
      cuerpo: seguroParaLog(texto).slice(0, 500),
      url,
    });
  }
}

export interface RespuestaConsulta<T> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

/** SOQL de sólo lectura. */
export async function consultar<T = Record<string, unknown>>(
  soql: string,
  operacion: string,
): Promise<RespuestaConsulta<T>> {
  return peticion<RespuestaConsulta<T>>(`/query?q=${encodeURIComponent(soql)}`, { operacion });
}

/** SOQL que puede paginar. Trae todo antes de devolver. */
export async function consultarTodo<T = Record<string, unknown>>(
  soql: string,
  operacion: string,
): Promise<T[]> {
  let r = await consultar<T>(soql, operacion);
  const acumulado = [...r.records];
  while (!r.done && r.nextRecordsUrl) {
    const sufijo = r.nextRecordsUrl.replace(`/services/data/${config.apiVersion}`, '');
    r = await peticion<RespuestaConsulta<T>>(sufijo, { operacion: `${operacion} (página)` });
    acumulado.push(...r.records);
  }
  return acumulado;
}

export interface ResultadoFlow {
  actionName: string;
  isSuccess: boolean;
  errors: unknown;
  outputValues: Record<string, unknown>;
}

/**
 * Invoca un Flow autolaunched por REST.
 * Devuelve el resultado crudo: interpretarlo (incluido `varMotivoBloqueo`) es
 * responsabilidad de quien conoce el contrato de cada Flow.
 */
export async function invocarFlow(
  nombreFlow: string,
  entradas: Record<string, unknown>,
): Promise<ResultadoFlow> {
  const r = await peticion<ResultadoFlow[]>(`/actions/custom/flow/${nombreFlow}`, {
    metodo: 'POST',
    cuerpo: { inputs: [entradas] },
    operacion: `flow.${nombreFlow}`,
  });

  const primero = r?.[0];
  if (!primero) {
    throw new ErrorSalesforce(`El Flow ${nombreFlow} no devolvió resultado`, {
      operacion: `flow.${nombreFlow}`,
    });
  }
  if (!primero.isSuccess) {
    throw new ErrorSalesforce(`El Flow ${nombreFlow} falló`, {
      operacion: `flow.${nombreFlow}`,
      cuerpo: primero.errors,
    });
  }
  return primero;
}

/** Alta de un sObject. Devuelve el id creado. */
export async function crear(
  objeto: string,
  campos: Record<string, unknown>,
): Promise<{ id: string; success: boolean }> {
  return peticion<{ id: string; success: boolean }>(`/sobjects/${objeto}`, {
    metodo: 'POST',
    cuerpo: campos,
    operacion: `crear.${objeto}`,
  });
}

/** Actualización de un sObject. */
export async function actualizar(
  objeto: string,
  id: string,
  campos: Record<string, unknown>,
): Promise<void> {
  await peticion<void>(`/sobjects/${objeto}/${id}`, {
    metodo: 'PATCH',
    cuerpo: campos,
    operacion: `actualizar.${objeto}`,
  });
}

/** Escapa una literal para meterla en SOQL sin romper la consulta. */
export function lit(valor: string): string {
  return valor.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Búsqueda de texto (SOSL).
 *
 * Existe porque hay campos que SOQL no puede filtrar: `Knowledge__kav.Contenido__c`
 * es un área de texto larga y meterla en un `WHERE ... LIKE` devuelve
 * `INVALID_FIELD: field 'Contenido__c' can not be filtered in a query call`. Es
 * exactamente lo que hace el Apex del agente, que busca por SOSL y sólo cae a SOQL
 * por título y resumen si aquello no devuelve nada.
 */
export async function buscar<T = Record<string, unknown>>(sosl: string, operacion: string): Promise<T[]> {
  const r = await peticion<{ searchRecords?: T[] }>(`/search?q=${encodeURIComponent(sosl)}`, { operacion });
  return r?.searchRecords ?? [];
}

/**
 * Escapa una literal para el bloque `FIND {...}` de SOSL.
 *
 * Los caracteres reservados de SOSL no son los de SOQL: sin escaparlos, un cliente
 * que busque «frenos?» o «AdBlue+» recibe un 400 en vez de resultados.
 */
export function litSosl(valor: string): string {
  return valor.replace(/[\\?&|!{}[\]()^~*:"'+-]/g, (c) => `\\${c}`);
}
