// N6 · Canal de escalamiento a humano.
//
// La apertura se delega a la accion Apex transaccional EscalarAsesorHumano. Esa
// accion crea Case + resumen/transcripcion internos + Log_Agente__c con
// idempotencia por correlationId. El contexto completo llega a Salesforce, pero
// nunca se publica: Apex inserta todos los comentarios iniciales con IsPublished=false.
//
// La regla que gobierna este fichero: **el sistema de registro es Salesforce**.
// Este módulo NO guarda mensajes en memoria para reenviarlos al otro navegador. Cada
// mensaje se escribe en `CaseComment`, se RELEE de la org y sólo entonces viaja con su
// Id real. La memoria de proceso que existe aquí (el `Set` de ids ya emitidos en el
// sondeo) sirve para deduplicar, jamás como fuente de verdad: si el proceso muere, la
// conversación sigue completa en la org.
//
// Limites del esquema, medidos contra la org — no recordados:
//   Case.Correlation_Id__c    64   ← NO se recorta: es la llave de idempotencia
//   CaseComment.CommentBody 4000   ← por eso se trocean las respuestas en vivo
//
// Nota de runtime: node --experimental-strip-types sólo despoja tipos. Sin enum, sin
// propiedades-parámetro, sin namespaces. Los imports locales llevan extensión .ts.

import { config } from './config.ts';
import { seguroParaLog } from './auth.ts';
import { ErrorSalesforce } from './errores.ts';
import { consultar, consultarTodo, crear, actualizar, lit, peticion } from './sf.ts';
// N5 escribe este módulo. Aquí se consume su firma tal cual, no se reimplementa:
// duplicar la invocación del Flow sería tener dos verdades sobre el mismo contrato.
import { registrarLogAgente } from './flows.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes del contrato
// ─────────────────────────────────────────────────────────────────────────────

const LIMITE_COMENTARIO = 4000;
const LIMITE_CORRELATION = 64;
const LIMITE_MOTIVO_APEX = 3500;
const LIMITE_ASUNTO = 255;
const LIMITE_POLITICA = 40;
// 40 deja margen bajo el limite transaccional de 10,000 filas aun con un lote
// invocable de 200 solicitudes (gate + Case + 42 comentarios + update = 9,000 filas).
const LIMITE_TURNOS = 40;
const LIMITE_AUTOR_TURNO = 80;
const LIMITE_TEXTO_TURNO = 3500;
const LIMITE_FECHA_TURNO = 64;
const LIMITE_CONTEXTO_TORRE_JSON = 50_000;

/** Margen reservado para la marca «[parte i/n]» al trocear. */
const MARGEN_MARCA = 24;

/** Sondeo del contrato §4. Salesforce no ofrece push sobre CaseComment en esta org. */
export const INTERVALO_SONDEO_MS = 2000;

const SUBAGENTE = 'Compensacion';
const ACCION_CIERRE = 'Cierre_Escalamiento';

const ETIQUETA_AUTOR = {
  cliente: 'CLIENTE',
  asesor: 'ASESOR',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type AutorMensaje = 'cliente' | 'asesor';

/** Un turno de la conversación previa al escalamiento. */
export interface TurnoTranscripcion {
  /** Quién habló: 'cliente', 'agente', el nombre del subagente… se escribe tal cual. */
  autor: string;
  texto: string;
  /** ISO 8601. Opcional: si no viene, no se inventa una. */
  fecha?: string;
}

export interface EntradaEscalamiento {
  correlationId: string;
  asunto: string;
  contexto: string;
  politicaAplicada: string;
  assetId?: string;
  workOrderId?: string;
  /** Contacto vinculado a la sesión; nunca se obtiene de texto libre. */
  contactId?: string;
  /** Verdadero sólo cuando el caller ya determinó un riesgo explícito. */
  riesgoSeguridad?: boolean;
  /** La apertura la conserva completa como CaseComment internos, nunca públicos. */
  transcripcion: string | TurnoTranscripcion[];
}

export interface EscalamientoAbierto {
  caseId: string;
  caseNumber: string;
  correlationId: string;
  /** Ids reales de los CaseComment con los que se sembró el hilo. */
  comentariosSembrados: string[];
}

export interface ComentarioCaso {
  id: string;
  caseId: string;
  cuerpo: string;
  creadoEn: string;
  creadoPor: string;
  publicado: boolean;
}

export interface CasoBandeja {
  id: string;
  caseNumber: string;
  asunto: string | null;
  estado: string | null;
  prioridad: string | null;
  origen: string | null;
  creadoEn: string;
  correlationId: string | null;
  politicaAplicada: string | null;
  duenio: string | null;
  comentarios: number;
}

export interface CasoDetalle {
  id: string;
  caseNumber: string;
  asunto: string | null;
  estado: string | null;
  prioridad: string | null;
  origen: string | null;
  descripcion: string | null;
  creadoEn: string;
  cerrado: boolean;
  correlationId: string | null;
  politicaAplicada: string | null;
  assetId: string | null;
  workOrderId: string | null;
  duenio: string | null;
}

export interface Conversacion {
  caso: CasoDetalle;
  comentarios: ComentarioCaso[];
}

/**
 * Lo que emite el sondeo. El error es un evento de primera clase: quedarse callado
 * cuando la red falla es exactamente lo que este contrato prohíbe.
 */
export type EventoComentarios =
  | { tipo: 'comentario'; comentario: ComentarioCaso }
  | { tipo: 'error'; mensaje: string; detalle: unknown; fallosSeguidos: number }
  | { tipo: 'restablecido'; fallosPrevios: number };

export interface OpcionesSuscripcion {
  intervaloMs?: number;
  /**
   * true (por defecto): la primera ronda emite el hilo que ya existe, para que un
   * navegador que se conecta tarde reciba el contexto completo. La deduplicación es
   * por Id, así que el consumidor puede reconectarse sin duplicar nada.
   */
  incluirExistentes?: boolean;
}

export interface CierreEscalamiento {
  caseId: string;
  caseNumber: string;
  correlationId: string | null;
  estado: string;
  comentariosCierre: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades internas
// ─────────────────────────────────────────────────────────────────────────────

/** Error de uso del módulo. Lleva status 400 para que la UI no lo pinte como caída. */
function invalido(mensaje: string, operacion: string, cuerpo?: unknown): ErrorSalesforce {
  return new ErrorSalesforce(mensaje, { operacion, status: 400, cuerpo });
}

function exigirTexto(valor: unknown, campo: string, operacion: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw invalido(`${campo} es obligatorio y llegó vacío`, operacion, { campo, valor });
  }
  return valor;
}

function exigirId(valor: unknown, campo: string, operacion: string): string {
  const v = exigirTexto(valor, campo, operacion);
  if (v.length !== 15 && v.length !== 18) {
    throw invalido(
      `${campo} no parece un Id de Salesforce (15 o 18 caracteres); llegó "${v}" de ${v.length}`,
      operacion,
      { campo, valor: v },
    );
  }
  return v;
}

/**
 * Parte un texto para que quepa en CommentBody (4000). Respeta saltos de línea cuando
 * puede y marca cada pieza, para que el humano sepa que está leyendo una parte.
 */
function trocear(texto: string, limite: number = LIMITE_COMENTARIO): string[] {
  if (texto.length <= limite) return [texto];

  const util = limite - MARGEN_MARCA;
  const piezas: string[] = [];
  let actual = '';

  for (const linea of texto.split('\n')) {
    if (linea.length > util) {
      if (actual !== '') {
        piezas.push(actual);
        actual = '';
      }
      for (let i = 0; i < linea.length; i += util) piezas.push(linea.slice(i, i + util));
      continue;
    }
    const candidato = actual === '' ? linea : `${actual}\n${linea}`;
    if (candidato.length > util) {
      piezas.push(actual);
      actual = linea;
    } else {
      actual = candidato;
    }
  }
  if (actual !== '') piezas.push(actual);

  return piezas.map((p, i) => `[parte ${i + 1}/${piezas.length}]\n${p}`);
}

interface FilaComentario {
  Id: string;
  ParentId: string;
  CommentBody: string | null;
  CreatedDate: string;
  IsPublished: boolean;
  CreatedBy?: { Name?: string } | null;
}

const CAMPOS_COMENTARIO =
  'Id, ParentId, CommentBody, CreatedDate, IsPublished, CreatedBy.Name';

function aComentario(f: FilaComentario): ComentarioCaso {
  return {
    id: f.Id,
    caseId: f.ParentId,
    cuerpo: f.CommentBody ?? '',
    creadoEn: f.CreatedDate,
    creadoPor: f.CreatedBy?.Name ?? 'desconocido',
    publicado: Boolean(f.IsPublished),
  };
}

/**
 * Escribe un cuerpo como uno o más CaseComment y devuelve los ids REALES de Salesforce,
 * en el orden en que se crearon. Secuencial a propósito: el orden del hilo importa.
 */
async function escribirComentarios(caseId: string, cuerpo: string, publicado = true): Promise<string[]> {
  const ids: string[] = [];
  for (const pieza of trocear(cuerpo)) {
    const alta = await crear('CaseComment', {
      ParentId: caseId,
      CommentBody: pieza,
      IsPublished: publicado,
    });
    ids.push(alta.id);
  }
  return ids;
}

/**
 * Deja en el expediente la conversación previa de una visita cuyo caso YA existe.
 *
 * Hace falta porque las dos formas de escalar no dejan lo mismo. Cuando lo pide el
 * cliente, la app manda la transcripción y Apex la siembra: el asesor abre el caso y
 * lee lo que pasó. Cuando escala el AGENTE por su cuenta, el expediente se queda con
 * el sobre de escalamiento y nada más —comprobado en el caso 00001137: dos
 * comentarios, uno con la huella y otro con la respuesta del propio asesor—. La
 * persona que atiende empieza de cero preguntando lo que el cliente ya contó.
 *
 * Se escribe como contexto INTERNO, no publicado, con la misma forma que el panel ya
 * sabe leer: `[turno n/m]` y `Autor:`. No cruza a la superficie del cliente.
 */
export async function sembrarContextoDeVisita(
  caseId: string,
  turnos: ReadonlyArray<{ autor: string; texto: string }>,
): Promise<number> {
  const op = 'escalamiento.sembrarContextoDeVisita';
  const id = exigirId(caseId, 'caseId', op);
  const utiles = turnos
    .filter((t) => t && typeof t.texto === 'string' && t.texto.trim())
    .slice(-40);
  if (!utiles.length) return 0;

  const cuerpo = [
    '[contexto-torre] Conversación previa de la visita, sembrada por la aplicación',
    'porque el escalamiento lo abrió el agente y el expediente se quedó sin ella.',
    '',
    ...utiles.map(
      (t, i) =>
        `[turno ${i + 1}/${utiles.length}]\nAutor: ${t.autor === 'agente' ? 'agente' : 'cliente'}\n${t.texto.slice(0, 3000)}`,
    ),
  ].join('\n');

  const ids = await escribirComentarios(id, cuerpo, false);
  return ids.length;
}

/** Relee de la org los comentarios recién creados. Sin relectura no hay Id real. */
async function releerComentarios(ids: string[], operacion: string): Promise<ComentarioCaso[]> {
  if (ids.length === 0) return [];
  const lista = ids.map((i) => `'${lit(i)}'`).join(',');
  const filas = await consultarTodo<FilaComentario>(
    `SELECT ${CAMPOS_COMENTARIO} FROM CaseComment WHERE Id IN (${lista}) ORDER BY CreatedDate ASC, Id ASC`,
    operacion,
  );
  if (filas.length !== ids.length) {
    throw new ErrorSalesforce(
      `Se crearon ${ids.length} CaseComment pero la relectura devolvió ${filas.length}. ` +
        `No se devuelve un hilo incompleto haciéndolo pasar por completo.`,
      { operacion, cuerpo: { pedidos: ids, devueltos: filas.map((f) => f.Id) } },
    );
  }
  return filas.map(aComentario);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Abrir el escalamiento
// ─────────────────────────────────────────────────────────────────────────────

interface ResultadoAccionApex {
  actionName: string;
  isSuccess: boolean;
  errors: unknown;
  outputValues: {
    escalamientoCreado?: boolean;
    reintento?: boolean;
    caseId?: string;
    caseNumber?: string;
    mensaje?: string;
    codigoError?: string | null;
    comentariosSembrados?: unknown;
  } | null;
}

interface ContextoTorreApex {
  version: 1;
  asunto: string;
  politicaAplicada: string;
  assetId?: string;
  workOrderId?: string;
  turnos: TurnoTranscripcion[];
}

function textoLimitado(
  valor: unknown,
  campo: string,
  limite: number,
  operacion: string,
): string {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw invalido(`${campo} es obligatorio y llego vacio`, operacion, { campo });
  }
  if (valor.length > limite) {
    throw invalido(`${campo} admite ${limite} caracteres; llegaron ${valor.length}`, operacion, {
      campo,
      longitud: valor.length,
    });
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(valor)) {
    throw invalido(`${campo} contiene caracteres de control no permitidos`, operacion, { campo });
  }
  return valor;
}

function prepararTurnos(transcripcion: unknown, operacion: string): TurnoTranscripcion[] {
  if (typeof transcripcion === 'string') {
    return [
      {
        autor: 'contexto',
        texto: textoLimitado(
          transcripcion,
          'transcripcion',
          LIMITE_TEXTO_TURNO,
          operacion,
        ),
      },
    ];
  }
  if (!Array.isArray(transcripcion)) {
    throw invalido('transcripcion debe ser texto o una lista de turnos', operacion, {
      campo: 'transcripcion',
    });
  }
  if (transcripcion.length > LIMITE_TURNOS) {
    throw invalido(`transcripcion admite maximo ${LIMITE_TURNOS} turnos`, operacion, {
      campo: 'transcripcion',
      cantidad: transcripcion.length,
    });
  }

  return transcripcion.map((valor, indice) => {
    const numero = indice + 1;
    if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
      throw invalido(`turno ${numero} debe ser un objeto`, operacion, {
        campo: 'transcripcion',
        turno: numero,
      });
    }
    const turno = valor as Record<string, unknown>;
    const desconocidos = Object.keys(turno).filter(
      (campo) => campo !== 'autor' && campo !== 'texto' && campo !== 'fecha',
    );
    if (desconocidos.length > 0) {
      throw invalido(`turno ${numero} contiene campos no permitidos`, operacion, {
        campo: 'transcripcion',
        turno: numero,
        campos: desconocidos,
      });
    }

    const normalizado: TurnoTranscripcion = {
      autor: textoLimitado(
        turno.autor,
        `autor del turno ${numero}`,
        LIMITE_AUTOR_TURNO,
        operacion,
      ),
      texto: textoLimitado(
        turno.texto,
        `texto del turno ${numero}`,
        LIMITE_TEXTO_TURNO,
        operacion,
      ),
    };
    if (turno.fecha !== undefined) {
      const fecha = textoLimitado(
        turno.fecha,
        `fecha del turno ${numero}`,
        LIMITE_FECHA_TURNO,
        operacion,
      );
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(fecha)) {
        throw invalido(`fecha del turno ${numero} debe usar ISO 8601`, operacion, {
          campo: 'transcripcion',
          turno: numero,
        });
      }
      normalizado.fecha = fecha;
    }
    return normalizado;
  });
}

/**
 * El Case que ya exista bajo esta correlacion, sin abrir ninguno nuevo.
 *
 * Sirve para un caso muy concreto y muy real: durante la conversacion el propio
 * agente puede escalar por su cuenta, y entonces la correlacion YA pertenece a un
 * Case. Si la Torre insistiera en abrir otro con un motivo distinto, Apex responderia
 * IDEMPOTENCY_CONFLICT — que es la idempotencia funcionando bien, no un fallo. Lo
 * correcto es reconocer el escalamiento que ya existe y seguir sobre el.
 */
export async function escalamientoDeCorrelacion(
  correlationId: string,
): Promise<{ caseId: string; caseNumber: string } | null> {
  const op = 'escalamiento.porCorrelacion';
  const llave = exigirTexto(correlationId, 'correlationId', op);

  interface FilaCaso {
    Id: string;
    CaseNumber: string;
  }
  const r = await consultar<FilaCaso>(
    `SELECT Id, CaseNumber FROM Case WHERE Correlation_Id__c = '${lit(llave)}' ` +
      `ORDER BY CreatedDate ASC LIMIT 1`,
    op,
  );
  const c = r.records[0];
  return c ? { caseId: c.Id, caseNumber: c.CaseNumber } : null;
}

/**
 * Invoca la unica transaccion autorizada para abrir el escalamiento. Apex crea el
 * Case, el resumen, todos los turnos internos y el Log_Agente__c; la llave
 * `correlationId` evita que un retry duplique cualquiera de esos registros.
 */
export async function abrirEscalamiento(entrada: EntradaEscalamiento): Promise<EscalamientoAbierto> {
  const op = 'escalamiento.abrir';

  const correlationId = exigirTexto(entrada?.correlationId, 'correlationId', op);
  const asunto = textoLimitado(entrada?.asunto, 'asunto', LIMITE_ASUNTO, op);
  const contexto = exigirTexto(entrada?.contexto, 'contexto', op);
  const politicaAplicada = textoLimitado(
    entrada?.politicaAplicada,
    'politicaAplicada',
    LIMITE_POLITICA,
    op,
  );

  // El correlationId NO se recorta. Es la llave que amarra Case, CaseComment y
  // Log_Agente__c: recortarlo en silencio rompería la traza sin que nadie lo notara.
  if (correlationId.length > LIMITE_CORRELATION) {
    throw invalido(
      `Correlation_Id__c admite ${LIMITE_CORRELATION} caracteres y llegó uno de ${correlationId.length}. ` +
        `No se recorta: es la llave de la traza y recortarla la rompería en silencio.`,
      op,
      { correlationId },
    );
  }

  if (contexto.length > LIMITE_MOTIVO_APEX) {
    throw invalido(
      `contexto admite ${LIMITE_MOTIVO_APEX} caracteres porque se usa como resumen interno; ` +
        `llegaron ${contexto.length}. No se recorta en silencio.`,
      op,
      { campo: 'contexto', longitud: contexto.length },
    );
  }

  if (entrada.riesgoSeguridad !== undefined && typeof entrada.riesgoSeguridad !== 'boolean') {
    throw invalido('riesgoSeguridad debe ser boolean cuando se envia', op, {
      campo: 'riesgoSeguridad',
    });
  }

  const contextoTorre: ContextoTorreApex = {
    version: 1,
    asunto,
    politicaAplicada,
    turnos: prepararTurnos(entrada?.transcripcion, op),
  };
  if (entrada.assetId !== undefined && entrada.assetId !== '') {
    contextoTorre.assetId = exigirId(entrada.assetId, 'assetId', op);
  }
  if (entrada.workOrderId !== undefined && entrada.workOrderId !== '') {
    contextoTorre.workOrderId = exigirId(entrada.workOrderId, 'workOrderId', op);
  }
  const contextoTorreJson = JSON.stringify(contextoTorre);
  if (contextoTorreJson.length > LIMITE_CONTEXTO_TORRE_JSON) {
    throw invalido(
      `contexto estructurado admite ${LIMITE_CONTEXTO_TORRE_JSON} caracteres; ` +
        `llegaron ${contextoTorreJson.length}`,
      op,
      { campo: 'contextoTorreJson', longitud: contextoTorreJson.length },
    );
  }

  const inputApex: Record<string, unknown> = {
    motivo: contexto,
    correlationId,
    riesgoSeguridad: entrada.riesgoSeguridad === true,
    contextoTorreJson,
  };
  if (entrada.contactId !== undefined && entrada.contactId !== '') {
    inputApex.contactId = exigirId(entrada.contactId, 'contactId', op);
  }

  const resultados = await peticion<ResultadoAccionApex[]>(
    '/actions/custom/apex/EscalarAsesorHumano',
    {
      metodo: 'POST',
      cuerpo: { inputs: [inputApex] },
      operacion: `${op}.apex`,
    },
  );
  const resultado = resultados?.[0];
  if (!resultado) {
    throw new ErrorSalesforce('EscalarAsesorHumano no devolvio resultado', {
      operacion: `${op}.apex`,
    });
  }
  if (resultado.actionName !== 'EscalarAsesorHumano') {
    throw new ErrorSalesforce('Salesforce devolvio el resultado de una accion inesperada', {
      operacion: `${op}.apex`,
      status: 502,
    });
  }
  if (!resultado.isSuccess) {
    throw new ErrorSalesforce('EscalarAsesorHumano fallo antes de completar la transaccion', {
      operacion: `${op}.apex`,
      cuerpo: resultado.errors,
    });
  }

  const salida = resultado.outputValues;
  if (salida?.escalamientoCreado !== true) {
    if (salida?.codigoError === 'IDEMPOTENCY_CONFLICT') {
      throw new ErrorSalesforce(
        'La correlacion ya pertenece a un escalamiento con contenido diferente',
        {
          operacion: `${op}.apex`,
          status: 409,
          cuerpo: { codigoError: 'IDEMPOTENCY_CONFLICT' },
        },
      );
    }
    throw new ErrorSalesforce(
      'EscalarAsesorHumano no confirmo un escalamiento durable; no se publicara un exito parcial',
      {
        operacion: `${op}.apex`,
        status: 502,
        cuerpo: {
          codigoError: salida?.codigoError ?? 'UPSTREAM_FAILURE',
        },
      },
    );
  }

  const caseId = salida.caseId;
  const caseNumber = salida.caseNumber;
  if (typeof caseId !== 'string' || !/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(caseId)) {
    throw new ErrorSalesforce('EscalarAsesorHumano devolvio un Case Id invalido', {
      operacion: `${op}.apex`,
      status: 502,
    });
  }
  if (typeof caseNumber !== 'string' || caseNumber.trim() === '') {
    throw new ErrorSalesforce('EscalarAsesorHumano no devolvio CaseNumber', {
      operacion: `${op}.apex`,
      status: 502,
      cuerpo: { caseId },
    });
  }

  // Apex devuelve exactamente los ids de la semilla transaccional. Reconsultar todos
  // los internos del Case mezclaría notas manuales agregadas entre dos reintentos.
  const comentariosSembrados = salida.comentariosSembrados;
  if (
    !Array.isArray(comentariosSembrados) ||
    comentariosSembrados.length === 0 ||
    comentariosSembrados.some(
      (id) => typeof id !== 'string' || !/^00a[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(id),
    )
  ) {
    throw new ErrorSalesforce(
      `El Case ${caseNumber} existe pero Apex no devolvio sus comentarios internos`,
      { operacion: `${op}.apex`, status: 502, cuerpo: { caseId } },
    );
  }

  return {
    caseId,
    caseNumber,
    correlationId,
    comentariosSembrados: comentariosSembrados as string[],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Bandeja del asesor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los Case abiertos de la cola de escalamiento, con el conteo real de comentarios.
 * Una lista vacía aquí significa «la cola no tiene casos abiertos», no «algo falló»:
 * cualquier fallo de la consulta se lanza.
 */
export async function bandejaAsesor(): Promise<CasoBandeja[]> {
  const op = 'escalamiento.bandeja';

  interface FilaCaso {
    Id: string;
    CaseNumber: string;
    Subject: string | null;
    Status: string | null;
    Priority: string | null;
    Origin: string | null;
    CreatedDate: string;
    Correlation_Id__c: string | null;
    Politica_Aplicada__c: string | null;
    Owner?: { Name?: string } | null;
  }

  const casos = await consultarTodo<FilaCaso>(
    `SELECT Id, CaseNumber, Subject, Status, Priority, Origin, CreatedDate, ` +
      `Correlation_Id__c, Politica_Aplicada__c, Owner.Name ` +
      `FROM Case WHERE OwnerId = '${lit(config.colaEscalamientoId)}' AND Status != 'Closed' ` +
      `ORDER BY CreatedDate DESC`,
    op,
  );

  if (casos.length === 0) return [];

  const lista = casos.map((c) => `'${lit(c.Id)}'`).join(',');
  const conteos = await consultarTodo<{ ParentId: string; total: number }>(
    `SELECT ParentId, COUNT(Id) total FROM CaseComment WHERE ParentId IN (${lista}) GROUP BY ParentId`,
    `${op}.conteo`,
  );
  const porCaso = new Map<string, number>();
  for (const c of conteos) porCaso.set(c.ParentId, Number(c.total));

  return casos.map((c) => ({
    id: c.Id,
    caseNumber: c.CaseNumber,
    asunto: c.Subject,
    estado: c.Status,
    prioridad: c.Priority,
    origen: c.Origin,
    creadoEn: c.CreatedDate,
    correlationId: c.Correlation_Id__c,
    politicaAplicada: c.Politica_Aplicada__c,
    duenio: c.Owner?.Name ?? null,
    comentarios: porCaso.get(c.Id) ?? 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · Conversación completa de un Case
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El Case y TODOS sus CaseComment en orden cronológico. Si no existe, se lanza.
 *
 * El orden es `CreatedDate ASC, Id ASC`. `CreatedDate` tiene granularidad de segundo:
 * dos comentarios del mismo segundo empatan y desempata `Id`, que no es monótono. Por
 * eso los turnos de la transcripción llevan su ordinal impreso en el cuerpo — ver
 * `renderTurno`. No se reordena por ese marcador: parsear nuestro propio formato para
 * decidir el orden sería fabricar una verdad que la org no dio.
 */
export interface OpcionesConversacion {
  /**
   * Devuelve SÓLO los comentarios publicados y omite los identificadores internos
   * del Case. Es lo que corresponde a la vista del cliente: Apex inserta el resumen
   * para el asesor, el contexto estructurado y la transcripción con
   * `IsPublished = false` justamente porque son notas internas, y traen huellas e Ids
   * de Salesforce (Asset, WorkOrder) que un visitante no autenticado no debe ver.
   */
  soloPublicados?: boolean;
}

/**
 * El estado real de un caso, sin traerse el expediente entero.
 *
 * Hace falta porque la sesión del visitante guarda su `caseId` y nunca volvía a
 * preguntar por él: un cliente cuyo caso ya cerró el asesor seguía escribiendo en un
 * expediente que había desaparecido de la bandeja —`bandejaAsesor` filtra
 * `Status != 'Closed'`—, es decir, mandando mensajes que nadie iba a leer.
 */
export async function estadoDeCaso(
  caseId: string,
): Promise<{ caseNumber: string; estado: string | null; cerrado: boolean } | null> {
  const op = 'escalamiento.estadoDeCaso';
  const id = exigirId(caseId, 'caseId', op);
  const r = await consultar<{ CaseNumber: string; Status: string | null; IsClosed: boolean }>(
    `SELECT CaseNumber, Status, IsClosed FROM Case WHERE Id = '${lit(id)}'`,
    op,
  );
  const c = r.records[0];
  if (!c) return null;
  return { caseNumber: c.CaseNumber, estado: c.Status, cerrado: Boolean(c.IsClosed) };
}

export async function conversacion(
  caseId: string,
  opciones: OpcionesConversacion = {},
): Promise<Conversacion> {
  const op = 'escalamiento.conversacion';
  const id = exigirId(caseId, 'caseId', op);
  const soloPublicados = opciones.soloPublicados === true;

  interface FilaCasoDetalle {
    Id: string;
    CaseNumber: string;
    Subject: string | null;
    Status: string | null;
    Priority: string | null;
    Origin: string | null;
    Description: string | null;
    CreatedDate: string;
    IsClosed: boolean;
    Correlation_Id__c: string | null;
    Politica_Aplicada__c: string | null;
    Asset__c: string | null;
    WorkOrder__c: string | null;
    Owner?: { Name?: string } | null;
  }

  const r = await consultar<FilaCasoDetalle>(
    `SELECT Id, CaseNumber, Subject, Status, Priority, Origin, Description, CreatedDate, ` +
      `IsClosed, Correlation_Id__c, Politica_Aplicada__c, Asset__c, WorkOrder__c, Owner.Name ` +
      `FROM Case WHERE Id = '${lit(id)}'`,
    op,
  );

  const c = r.records[0];
  if (!c) {
    throw new ErrorSalesforce(`No existe el Case ${id} en la org`, {
      operacion: op,
      status: 404,
      cuerpo: { caseId: id },
    });
  }

  // El filtro va en el SOQL, no en memoria: lo que no debe salir tampoco hace falta
  // traerlo, y así ningún cambio posterior en el mapeo puede dejarlo escapar.
  const comentarios = await consultarTodo<FilaComentario>(
    `SELECT ${CAMPOS_COMENTARIO} FROM CaseComment WHERE ParentId = '${lit(id)}' ` +
      (soloPublicados ? `AND IsPublished = true ` : '') +
      `ORDER BY CreatedDate ASC, Id ASC`,
    `${op}.comentarios`,
  );

  return {
    caso: {
      id: c.Id,
      caseNumber: c.CaseNumber,
      asunto: c.Subject,
      estado: c.Status,
      prioridad: c.Priority,
      origen: c.Origin,
      // La descripción es el resumen que se le escribió al asesor, no un texto para
      // el cliente. Se omite en la vista pública junto con los enlaces internos.
      descripcion: soloPublicados ? null : c.Description,
      creadoEn: c.CreatedDate,
      cerrado: Boolean(c.IsClosed),
      correlationId: c.Correlation_Id__c,
      politicaAplicada: soloPublicados ? null : c.Politica_Aplicada__c,
      assetId: soloPublicados ? null : c.Asset__c,
      workOrderId: soloPublicados ? null : c.WorkOrder__c,
      duenio: c.Owner?.Name ?? null,
    },
    comentarios: comentarios.map(aComentario),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Responder en el hilo
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaRespuesta {
  caseId: string;
  cuerpo: string;
  autor: AutorMensaje;
}

/**
 * Escribe el mensaje en Salesforce y lo RELEE antes de devolverlo. El Id que sale de
 * aquí es el `CaseComment.Id` real de la org.
 *
 * Devuelve una lista porque un cuerpo de más de 4000 caracteres se trocea en varios
 * CaseComment; en el caso normal trae exactamente uno. Nunca devuelve un id inventado
 * ni un eco de memoria: si la relectura no cuadra con lo escrito, se lanza.
 */
export async function responder(entrada: EntradaRespuesta): Promise<ComentarioCaso[]> {
  const op = 'escalamiento.responder';
  const id = exigirId(entrada?.caseId, 'caseId', op);
  const cuerpo = exigirTexto(entrada?.cuerpo, 'cuerpo', op);
  const autor = entrada?.autor;

  if (autor !== 'cliente' && autor !== 'asesor') {
    throw invalido(`autor debe ser 'cliente' o 'asesor'; llegó ${JSON.stringify(autor)}`, op, {
      autor,
    });
  }

  const texto = `${ETIQUETA_AUTOR[autor]}: ${cuerpo}`;
  const ids = await escribirComentarios(id, texto);
  return releerComentarios(ids, `${op}.releer`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Sondeo en vivo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sondea los CaseComment de un Case cada 2 s y emite SÓLO los nuevos, deduplicando por
 * `Id` — no por índice ni por longitud, que es lo que se rompe cuando dos mensajes
 * caen en el mismo segundo o cuando alguien borra uno.
 *
 * Un fallo de red no mata la suscripción ni la deja muda: emite `{tipo:'error'}` y
 * sigue intentando. Cuando vuelve a responder, emite `{tipo:'restablecido'}` para que
 * la UI pueda quitar el aviso.
 *
 * Devuelve la función de cancelación.
 */
export function suscribirComentarios(
  caseId: string,
  alEmitir: (evento: EventoComentarios) => void,
  opciones?: OpcionesSuscripcion,
): () => void {
  const op = 'escalamiento.sondeo';
  const id = exigirId(caseId, 'caseId', op);
  if (typeof alEmitir !== 'function') {
    throw invalido('alEmitir debe ser una función', op);
  }

  const intervalo = opciones?.intervaloMs ?? INTERVALO_SONDEO_MS;
  const incluirExistentes = opciones?.incluirExistentes ?? true;

  const vistos = new Set<string>();
  let cancelado = false;
  let primeraRonda = true;
  let fallosSeguidos = 0;
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const cancelar = (): void => {
    cancelado = true;
    if (temporizador !== null) {
      clearTimeout(temporizador);
      temporizador = null;
    }
  };

  // Si el consumidor revienta (p. ej. una conexión SSE ya cerrada) no se traga el
  // fallo: se corta el sondeo y queda constancia en stderr, que es el único canal que
  // sobrevive cuando el propio canal de salida es el que falla.
  const emitir = (evento: EventoComentarios): boolean => {
    try {
      alEmitir(evento);
      return true;
    } catch (e) {
      console.error(
        `[escalamiento] el consumidor del Case ${id} lanzó al recibir "${evento.tipo}"; ` +
          `se cancela el sondeo: ${seguroParaLog(e instanceof Error ? e.message : String(e))}`,
      );
      cancelar();
      return false;
    }
  };

  const soql =
    `SELECT ${CAMPOS_COMENTARIO} FROM CaseComment WHERE ParentId = '${lit(id)}' ` +
    `ORDER BY CreatedDate ASC, Id ASC`;

  const programar = (): void => {
    if (cancelado) return;
    temporizador = setTimeout(() => {
      void ronda();
    }, intervalo);
  };

  const ronda = async (): Promise<void> => {
    if (cancelado) return;

    let filas: FilaComentario[];
    try {
      filas = await consultarTodo<FilaComentario>(soql, op);
    } catch (e) {
      if (cancelado) return;
      fallosSeguidos += 1;
      const seguir = emitir({
        tipo: 'error',
        mensaje: 'No fue posible consultar nuevos mensajes.',
        detalle: { codigo: 'UPSTREAM_FAILURE' },
        fallosSeguidos,
      });
      if (seguir) programar();
      return;
    }

    if (cancelado) return;

    if (fallosSeguidos > 0) {
      const previos = fallosSeguidos;
      fallosSeguidos = 0;
      if (!emitir({ tipo: 'restablecido', fallosPrevios: previos })) return;
    }

    const emitirEstos = !primeraRonda || incluirExistentes;
    for (const f of filas) {
      if (vistos.has(f.Id)) continue;
      vistos.add(f.Id);
      if (!emitirEstos) continue;
      if (!emitir({ tipo: 'comentario', comentario: aComentario(f) })) return;
    }
    primeraRonda = false;

    programar();
  };

  void ronda();

  return cancelar;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · Cierre
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cierra el Case, deja el comentario de resolución y registra la traza. El comentario
 * se escribe ANTES del cierre para no depender de que la org permita comentar un Case
 * ya cerrado.
 */
export async function cerrarEscalamiento(
  caseId: string,
  resolucion: string,
): Promise<CierreEscalamiento> {
  const op = 'escalamiento.cerrar';
  const id = exigirId(caseId, 'caseId', op);
  const texto = exigirTexto(resolucion, 'resolucion', op);

  const r = await consultar<{
    Id: string;
    CaseNumber: string;
    Status: string | null;
    Correlation_Id__c: string | null;
  }>(
    `SELECT Id, CaseNumber, Status, Correlation_Id__c FROM Case WHERE Id = '${lit(id)}'`,
    `${op}.leer`,
  );
  const caso = r.records[0];
  if (!caso) {
    throw new ErrorSalesforce(`No existe el Case ${id} en la org; no se puede cerrar`, {
      operacion: op,
      status: 404,
      cuerpo: { caseId: id },
    });
  }

  const comentariosCierre = await escribirComentarios(
    id,
    `CIERRE DEL ESCALAMIENTO\n${texto}`,
  );

  await actualizar('Case', id, { Status: 'Closed' });

  try {
    await registrarLogAgente({
      varCorrelationId: caso.Correlation_Id__c ?? '',
      varSubagent: SUBAGENTE,
      varAccion: ACCION_CIERRE,
      varOutcome: 'SUCCESS',
      varCaseId: id,
    });
  } catch (e) {
    throw new ErrorSalesforce(
      `El Case ${caso.CaseNumber} (${id}) SÍ quedó cerrado con su comentario de resolución, ` +
        `pero Registrar_Log_Agente falló: ${e instanceof Error ? e.message : String(e)}.`,
      {
        operacion: `${op}.log`,
        cuerpo: {
          caseId: id,
          caseNumber: caso.CaseNumber,
          correlationId: caso.Correlation_Id__c,
          comentariosCierre,
          causa: e instanceof ErrorSalesforce ? e.aJSON() : String(e),
        },
      },
    );
  }

  return {
    caseId: id,
    caseNumber: caso.CaseNumber,
    correlationId: caso.Correlation_Id__c,
    estado: 'Closed',
    comentariosCierre,
  };
}
