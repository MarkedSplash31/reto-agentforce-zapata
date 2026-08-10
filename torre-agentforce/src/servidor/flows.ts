// N5 · Escritura contra la org a través de los cuatro Flows autolaunched.
//
// Este módulo es la ÚNICA vía de escritura de negocio de la Torre. No hace DML
// directo: los Flows son los que llevan las reglas (idempotencia, gates, guardrails,
// validation rules) y los que dejan la traza en Log_Agente__c. Saltárselos con un
// POST a /sobjects/ escribiría el registro y perdería la política y el log.
//
// ─────────────────────────────────────────────────────────────────────────────
// Las cinco decisiones que gobiernan este fichero
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. `varMotivoBloqueo` poblado NO es un fallo. Es un guardrail funcionando y se
//    lanza como `BloqueoDePolitica`, jamás como `ErrorSalesforce`. La UI los pinta
//    distinto porque son cosas distintas: uno es la app rota, el otro es la app
//    haciendo su trabajo. Confundirlos hace que una política correcta parezca un bug.
//
// 2. Toda escritura se VERIFICA RELEYENDO el registro. Lo que devuelve cada función
//    incluye el registro tal como quedó en la org, no sólo lo que el Flow dijo.
//    "Dijo que sí" no es evidencia. Si el Flow reporta un folio y la relectura no lo
//    encuentra, eso se lanza como `ErrorSalesforce`: es exactamente el fallo que un
//    módulo complaciente escondería.
//
// 3. Idempotencia (ver `claveIdempotencia`): `WorkOrder.Idempotency_Key__c` es
//    unique + externalId. La clave se deriva de forma determinista del hilo de la
//    conversación, así que un doble clic manda la MISMA clave, el Flow la encuentra
//    y devuelve el folio existente en vez de abrir una segunda orden.
//
// 4. Fechas. Los inputs Date de los Flows viajan como 'YYYY-MM-DD' — sin hora, a
//    propósito, porque el esquema de acción de Agentforce no admite fecha y hora.
//    Los DateTime que Salesforce devuelve vienen en UTC y los Flows ya aplican un
//    hardcode de +6h para la medianoche de México. Este módulo NO vuelve a
//    compensar: expone los DateTime crudos tal como la org los entregó. Compensar
//    aquí produciría un desfase doble de 12 horas.
//
// 5. La validation rule `Error_Requiere_Codigo` de `Log_Agente__c` rechaza cualquier
//    log con Outcome ERROR o BLOCKED que no traiga Error_Code__c o
//    Guardrail_Triggered__c. `registrarLogAgente` rellena un código por defecto en
//    ese caso: si lo dejáramos al llamador, la validación rebotaría y se perdería
//    justo el log del momento en que algo salió mal.
//
// Nombres de campo y de variable: verificados contra la org, no recordados.
//   · contrato de los 4 Flows → evidencia/09-flows/describe-4-flows.*.json
//   · esquema de los objetos  → evidencia/05-esquema/resumen-esquema.*.json

import { consultar, invocarFlow, lit } from './sf.ts';
import { BloqueoDePolitica, ErrorSalesforce } from './errores.ts';
import { describirProveniencia, exigirSlotOperacional, type Proveniencia } from './provenance.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Picklists reales. Objetos const, no `enum`: Node sólo despoja tipos.
// ─────────────────────────────────────────────────────────────────────────────

/** Log_Agente__c.Subagent__c — los cinco valores que acepta la picklist. */
export const SUBAGENTES = ['Garantia', 'Diagnostico', 'Agenda', 'Compensacion', 'Varada'] as const;
export type Subagente = (typeof SUBAGENTES)[number];

/** Log_Agente__c.Outcome__c */
export const RESULTADOS_LOG = ['SUCCESS', 'BLOCKED', 'NOT_FOUND', 'ERROR'] as const;
export type ResultadoLog = (typeof RESULTADOS_LOG)[number];

/** Log_Agente__c.Odometer_Source__c */
export const FUENTES_ODOMETRO = ['Declarado', 'Verificado', 'Seed'] as const;
export type FuenteOdometro = (typeof FUENTES_ODOMETRO)[number];

/** Slot_Taller__c.Tipo_Servicio__c y WorkOrder.Tipo_Cita__c comparten valores. */
export const TIPOS_SERVICIO = [
  'Diagnostico',
  'Mantenimiento',
  'Garantia',
  'Reparacion mayor',
] as const;
export type TipoServicio = (typeof TIPOS_SERVICIO)[number];

/** Unidad_Varada__c.Sentido__c */
export const SENTIDOS = ['Norte', 'Sur', 'Oriente', 'Poniente', 'No especifica'] as const;
export type Sentido = (typeof SENTIDOS)[number];

/** Unidad_Varada__c.Carga__c */
export const CARGAS = ['Cargada', 'Vacia', 'No especifica'] as const;
export type Carga = (typeof CARGAS)[number];

// Límites reales de los campos de texto implicados. Salidos del describe.
const LARGO_CORRELATION_ID = 64; // WorkOrder / Unidad_Varada__c / Log_Agente__c
const LARGO_IDEMPOTENCY_KEY = 64; // WorkOrder.Idempotency_Key__c (unique + externalId)

// ─────────────────────────────────────────────────────────────────────────────
// Registros releídos. Los nombres son los del esquema real, sin renombrar: quien
// lea esto en la UI puede ir al describe y encontrar el mismo campo.
// ─────────────────────────────────────────────────────────────────────────────

export interface OrdenServicio {
  Id: string;
  WorkOrderNumber: string;
  Status: string | null;
  /** UTC crudo de la org. No se le resta el +6h de los Flows (ver decisión 4). */
  StartDate: string | null;
  EndDate: string | null;
  Subject: string | null;
  Sintoma_Reportado__c: string | null;
  Correlation_Id__c: string | null;
  Idempotency_Key__c: string | null;
  Origen_Atencion__c: string | null;
  Tipo_Cita__c: string | null;
  Slot_Taller__c: string | null;
  Slot_Taller__r: { Name: string; Inicio__c: string | null; Fin__c: string | null } | null;
  Sucursal__c: string | null;
  Sucursal__r: { Name: string; Codigo_Sucursal__c: string | null } | null;
  AssetId: string | null;
  Asset: { Name: string; SerialNumber: string | null } | null;
  Procedencia__c: string | null;
  proveniencia: Proveniencia;
  CreatedDate: string;
  LastModifiedDate: string;
}

export interface ReporteVarada {
  Id: string;
  Name: string;
  Estado__c: string | null;
  Prioridad__c: string | null;
  Carretera__c: string | null;
  Kilometro__c: number | null;
  Sentido__c: string | null;
  Referencia_Ubicacion__c: string | null;
  Descripcion_Falla__c: string | null;
  Codigos_Falla_Tablero__c: string | null;
  Carga__c: string | null;
  Fuera_De_Carril__c: boolean | null;
  Intermitentes_Encendidas__c: boolean | null;
  VIN_Reportado__c: string | null;
  Asset__c: string | null;
  Asset__r: { Name: string; SerialNumber: string | null } | null;
  Sucursal_Apoyo__c: string | null;
  Sucursal_Apoyo__r: { Name: string; Codigo_Sucursal__c: string | null } | null;
  Case__c: string | null;
  WorkOrder__c: string | null;
  Correlation_Id__c: string | null;
  Fecha_Reporte__c: string | null;
  Horas_Detenida__c: number | null;
  Procedencia__c: string | null;
  proveniencia: Proveniencia;
  CreatedDate: string;
}

export interface LogAgente {
  Id: string;
  Name: string;
  Action_Name__c: string | null;
  Actor__c: string | null;
  Subagent__c: string | null;
  Outcome__c: string | null;
  Error_Code__c: string | null;
  Guardrail_Triggered__c: string | null;
  Policy_Version__c: string | null;
  Correlation_Id__c: string | null;
  Session_Key__c: string | null;
  Related_Record_Id__c: string | null;
  Knowledge_Article_Version_Id__c: string | null;
  Odometer_Source__c: string | null;
  Odometer_Used__c: number | null;
  Unit_Verified__c: boolean;
  Asset__c: string | null;
  Case__c: string | null;
  WorkOrder__c: string | null;
  Unidad_Varada__c: string | null;
  Timestamp__c: string | null;
  CreatedDate: string;
}

const CAMPOS_ORDEN = `Id, WorkOrderNumber, Status, StartDate, EndDate, Subject,
  Sintoma_Reportado__c, Correlation_Id__c, Idempotency_Key__c, Origen_Atencion__c,
  Tipo_Cita__c, Slot_Taller__c, Slot_Taller__r.Name, Slot_Taller__r.Inicio__c,
  Slot_Taller__r.Fin__c, Sucursal__c, Sucursal__r.Name, Sucursal__r.Codigo_Sucursal__c,
  AssetId, Asset.Name, Asset.SerialNumber, Procedencia__c, CreatedDate, LastModifiedDate`;

const CAMPOS_VARADA = `Id, Name, Estado__c, Prioridad__c, Carretera__c, Kilometro__c,
  Sentido__c, Referencia_Ubicacion__c, Descripcion_Falla__c, Codigos_Falla_Tablero__c,
  Carga__c, Fuera_De_Carril__c, Intermitentes_Encendidas__c, VIN_Reportado__c,
  Asset__c, Asset__r.Name, Asset__r.SerialNumber, Sucursal_Apoyo__c,
  Sucursal_Apoyo__r.Name, Sucursal_Apoyo__r.Codigo_Sucursal__c, Case__c, WorkOrder__c,
  Correlation_Id__c, Fecha_Reporte__c, Horas_Detenida__c, Procedencia__c, CreatedDate`;

const CAMPOS_LOG = `Id, Name, Action_Name__c, Actor__c, Subagent__c, Outcome__c,
  Error_Code__c, Guardrail_Triggered__c, Policy_Version__c, Correlation_Id__c,
  Session_Key__c, Related_Record_Id__c, Knowledge_Article_Version_Id__c,
  Odometer_Source__c, Odometer_Used__c, Unit_Verified__c, Asset__c, Case__c,
  WorkOrder__c, Unidad_Varada__c, Timestamp__c, CreatedDate`;

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades de coerción. Los Flows devuelven null para lo vacío y booleanos
// reales para lo booleano; aun así nada se da por hecho.
// ─────────────────────────────────────────────────────────────────────────────

/** Texto útil o null. Cadena vacía y espacios cuentan como vacío. */
function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function booleano(v: unknown): boolean | null {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return null;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Quita las claves vacías: un input STRING vacío confunde a los Flows. */
function sinVacios(entradas: Record<string, unknown>): Record<string, unknown> {
  const limpio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entradas)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    limpio[k] = typeof v === 'string' ? v.trim() : v;
  }
  return limpio;
}

/** Error de contrato de nuestro propio lado. 400, no 502: no falló la org. */
function errorDeContrato(mensaje: string, operacion: string, cuerpo?: unknown): ErrorSalesforce {
  return new ErrorSalesforce(mensaje, { operacion, status: 400, cuerpo });
}

function exigirTexto(valor: string | null | undefined, campo: string, operacion: string): string {
  const v = texto(valor);
  if (!v) throw errorDeContrato(`${campo} es obligatorio y llegó vacío`, operacion);
  return v;
}

function exigirBooleano(valor: unknown, campo: string, operacion: string): boolean {
  if (typeof valor !== 'boolean') {
    throw errorDeContrato(`${campo} debe confirmarse explícitamente como true o false`, operacion);
  }
  return valor;
}

function exigirCorrelationId(valor: string | null | undefined, operacion: string): string {
  const v = exigirTexto(valor, 'correlationId', operacion);
  if (v.length > LARGO_CORRELATION_ID) {
    throw errorDeContrato(
      `correlationId mide ${v.length} caracteres y Correlation_Id__c admite ${LARGO_CORRELATION_ID}. ` +
        `Truncarlo aquí rompería el hilo de la traza, así que se rechaza.`,
      operacion,
    );
  }
  return v;
}

function exigirDeLista<T extends string>(
  valor: string | null | undefined,
  permitidos: readonly T[],
  campo: string,
  operacion: string,
): T {
  const v = exigirTexto(valor, campo, operacion);
  if (!(permitidos as readonly string[]).includes(v)) {
    throw errorDeContrato(
      `${campo} = "${v}" no está en la picklist. Valores reales: ${permitidos.join(', ')}.`,
      operacion,
    );
  }
  return v as T;
}

function opcionalDeLista<T extends string>(
  valor: string | null | undefined,
  permitidos: readonly T[],
  campo: string,
  operacion: string,
): T | null {
  if (texto(valor) === null) return null;
  return exigirDeLista(valor, permitidos, campo, operacion);
}

/**
 * Normaliza a 'YYYY-MM-DD', el formato que exigen los inputs Date de los Flows.
 *
 * De un `Date` se toman las componentes UTC. No se aplica ningún desplazamiento de
 * zona horaria: los Flows ya llevan dentro el hardcode de +6h para la medianoche de
 * México, y compensar aquí también dejaría la cita un día corrido (decisión 4).
 */
export function aFechaSalesforce(valor: string | Date, operacion = 'flows.fecha'): string {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) {
      throw errorDeContrato('La fecha recibida es un Date inválido', operacion);
    }
    return valor.toISOString().slice(0, 10);
  }
  const s = valor.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw errorDeContrato(
      `La fecha "${s}" no tiene formato YYYY-MM-DD, que es lo que aceptan los inputs Date de los Flows`,
      operacion,
    );
  }
  // Rechaza 2026-02-31 y similares: JS los normalizaría en silencio a otro día.
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw errorDeContrato(`La fecha "${s}" no existe en el calendario`, operacion);
  }
  return s;
}

/**
 * Clave de idempotencia determinista para `WorkOrder.Idempotency_Key__c`
 * (Text 64, unique, externalId).
 *
 * Formato: `{correlationId}-{sufijo}`, sufijo `WO` por defecto — el mismo que ya usan
 * las órdenes que hay en la org (`CONV-…-657b` → `CONV-…-657b-WO`).
 *
 * Cómo evita la orden duplicada: la clave sale sólo del hilo de la conversación, sin
 * reloj ni azar. Dos clics sobre el mismo botón mandan la misma clave; el Flow la
 * busca antes de crear, la encuentra y devuelve el folio que ya existe. La segunda
 * orden no llega a nacer, y el usuario ve el mismo folio en vez de dos citas.
 *
 * Cuando una misma conversación necesita una SEGUNDA orden legítima, el llamador pasa
 * un sufijo distinto (`WO2`, `WO3`…). Es explícito a propósito: abrir dos órdenes
 * tiene que ser una decisión, no un efecto colateral de un doble clic.
 *
 * No se trunca. Si la clave no cupiera en 64 caracteres se lanza, porque recortarla
 * podría colisionar con la de otra conversación y devolver la orden equivocada.
 */
export function claveIdempotencia(correlationId: string, sufijo = 'WO'): string {
  const op = 'flows.claveIdempotencia';
  const base = exigirTexto(correlationId, 'correlationId', op);
  const suf = exigirTexto(sufijo, 'sufijo', op);
  const clave = `${base}-${suf}`;
  if (clave.length > LARGO_IDEMPOTENCY_KEY) {
    throw errorDeContrato(
      `La clave de idempotencia "${clave}" mide ${clave.length} y el campo admite ` +
        `${LARGO_IDEMPOTENCY_KEY}. No se trunca: una clave recortada podría chocar con ` +
        `otra conversación y devolver una orden ajena. Pasa idempotencyKey explícito.`,
      op,
    );
  }
  return clave;
}

// ─────────────────────────────────────────────────────────────────────────────
// Invocación con interpretación del contrato común
// ─────────────────────────────────────────────────────────────────────────────

interface Ejecucion {
  salidas: Record<string, unknown>;
  guid: string | null;
}

/**
 * Invoca el Flow, comprueba que la entrevista terminó y traduce `varMotivoBloqueo`
 * a `BloqueoDePolitica`. `invocarFlow` ya lanza `ErrorSalesforce` si el POST falla o
 * si `isSuccess` es false, así que aquí sólo queda lo específico del contrato.
 */
async function ejecutarFlow(
  nombreFlow: string,
  accion: string,
  correlationId: string,
  entradas: Record<string, unknown>,
  textoExtraDeBloqueo?: (salidas: Record<string, unknown>) => string | null,
): Promise<Ejecucion> {
  const r = await invocarFlow(nombreFlow, entradas);
  const salidas = r.outputValues ?? {};

  const estado = texto(salidas.Flow__InterviewStatus);
  if (estado !== null && estado !== 'Finished') {
    throw new ErrorSalesforce(
      `El Flow ${nombreFlow} terminó la entrevista en estado "${estado}" en vez de Finished`,
      { operacion: `flow.${nombreFlow}`, cuerpo: salidas },
    );
  }

  const motivo = texto(salidas.varMotivoBloqueo);
  if (motivo !== null) {
    // Guardrail funcionando. NO es ErrorSalesforce: la UI lo pinta distinto.
    const partes = [texto(salidas.varMensaje), texto(salidas.varAvisoSeguridad)];
    if (textoExtraDeBloqueo) partes.push(textoExtraDeBloqueo(salidas));
    const mensaje = partes.filter((p): p is string => p !== null).join(' · ');
    throw new BloqueoDePolitica(motivo, {
      accion,
      correlationId,
      mensajeAgente: mensaje === '' ? undefined : mensaje,
    });
  }

  return { salidas, guid: texto(salidas.Flow__InterviewGuid) };
}

/**
 * El Flow no reportó éxito y tampoco dio un motivo de bloqueo. No se puede llamar
 * guardrail a algo que no trae código de guardrail —eso sería inventar la política—
 * así que sale como fallo real con las salidas crudas dentro.
 */
function fallaSinMotivo(nombreFlow: string, salidas: Record<string, unknown>): ErrorSalesforce {
  return new ErrorSalesforce(
    `El Flow ${nombreFlow} no reportó éxito y tampoco devolvió varMotivoBloqueo. ` +
      `Sin motivo no se puede presentar como guardrail, así que se reporta como fallo.`,
    { operacion: `flow.${nombreFlow}`, cuerpo: salidas },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Relectura. Ninguna función devuelve "creado" sin haber vuelto a la org por él.
// ─────────────────────────────────────────────────────────────────────────────

async function releerUnico<T>(
  soql: string,
  operacion: string,
  descripcion: string,
): Promise<T> {
  const r = await consultar<T>(soql, operacion);
  const registro = r.records[0];
  if (!registro) {
    throw new ErrorSalesforce(
      `Verificación fallida: ${descripcion}. El Flow reportó el alta pero la relectura ` +
        `no devolvió el registro. Un "dijo que sí" sin registro no es evidencia.`,
      { operacion, cuerpo: { soql, totalSize: r.totalSize } },
    );
  }
  if (r.totalSize > 1) {
    throw new ErrorSalesforce(
      `Verificación ambigua: ${descripcion} devolvió ${r.totalSize} registros y debía ` +
        `devolver uno. No se elige el primero al azar.`,
      { operacion, cuerpo: { soql, totalSize: r.totalSize } },
    );
  }
  return registro;
}

/** Relee la orden por su folio (`WorkOrderNumber`). */
export async function leerOrdenPorFolio(folio: string): Promise<OrdenServicio> {
  const orden = await releerUnico<OrdenServicio>(
    `SELECT ${CAMPOS_ORDEN} FROM WorkOrder WHERE WorkOrderNumber = '${lit(folio)}'`,
    'flows.releer.WorkOrder',
    `WorkOrder con folio ${folio}`,
  );
  return {
    ...orden,
    proveniencia: describirProveniencia(orden.Procedencia__c, 'transaccion'),
  };
}

/** Relee el reporte de varada por su folio (`Name`, VAR-000000). */
export async function leerVaradaPorFolio(folio: string): Promise<ReporteVarada> {
  const reporte = await releerUnico<ReporteVarada>(
    `SELECT ${CAMPOS_VARADA} FROM Unidad_Varada__c WHERE Name = '${lit(folio)}'`,
    'flows.releer.Unidad_Varada__c',
    `Unidad_Varada__c con folio ${folio}`,
  );
  return {
    ...reporte,
    proveniencia: describirProveniencia(reporte.Procedencia__c, 'transaccion'),
  };
}

/** Relee un log por su Id — el que devuelve `varLogId`. */
export async function leerLogPorId(id: string): Promise<LogAgente> {
  return releerUnico<LogAgente>(
    `SELECT ${CAMPOS_LOG} FROM Log_Agente__c WHERE Id = '${lit(id)}'`,
    'flows.releer.Log_Agente__c',
    `Log_Agente__c ${id}`,
  );
}

/**
 * Toda la traza de un hilo. `Correlation_Id__c` es el único hilo que amarra orden,
 * caso, reporte de varada y logs: filtrando por él sale la historia completa.
 */
export async function leerLogsDeCorrelation(correlationId: string): Promise<LogAgente[]> {
  const r = await consultar<LogAgente>(
    `SELECT ${CAMPOS_LOG} FROM Log_Agente__c WHERE Correlation_Id__c = '${lit(correlationId)}' ` +
      `ORDER BY CreatedDate, Name`,
    'flows.releer.logs',
  );
  return r.records;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Crear_Orden_Servicio
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaCrearOrden {
  /** VIN de 17 caracteres. Se busca en Asset.SerialNumber. */
  vin: string;
  /** Lo que dijo el operador, con sus palabras. */
  sintoma: string;
  correlationId: string;
  /** Franja concreta. Si falta, el Flow la resuelve con sucursal + fecha. */
  slotId?: string | null;
  /** Código o nombre del taller, p. ej. FL-QRO. Obligatorio si no hay slotId. */
  sucursalClave?: string | null;
  fechaDeseada?: string | Date | null;
  tipoServicio?: TipoServicio | string | null;
  sessionKey?: string | null;
  /** Clave explícita. Si falta se deriva con `claveIdempotencia`. */
  idempotencyKey?: string | null;
  /** Sufijo para derivar la clave cuando el hilo necesita una segunda orden. */
  sufijoIdempotencia?: string;
}

export interface ResultadoCrearOrden {
  creada: boolean;
  folio: string;
  citaTexto: string | null;
  mensaje: string | null;
  correlationId: string;
  idempotencyKey: string;
  /**
   * La clave que quedó grabada coincide con la que mandamos. Si es false, el Flow
   * devolvió un folio que no lleva nuestra clave: se expone en vez de esconderse,
   * porque significa que la protección contra el doble clic no está cubriendo
   * esa orden.
   */
  idempotenciaConfirmada: boolean;
  orden: OrdenServicio;
  logs: LogAgente[];
}

/**
 * Agenda una orden de servicio. El Flow resuelve el VIN a unidad, valida el gate
 * `Unidad_Verificada`, elige la franja, crea el `WorkOrder` y reserva el cupo.
 *
 * Reintentar con la misma `idempotencyKey` NO crea una segunda orden: devuelve la
 * existente, con `creada = true` y el mismo folio.
 */
export async function crearOrdenServicio(
  entrada: EntradaCrearOrden,
): Promise<ResultadoCrearOrden> {
  const op = 'flows.crearOrdenServicio';
  const correlationId = exigirCorrelationId(entrada.correlationId, op);
  const slotId = texto(entrada.slotId);
  await exigirSlotOperacional(slotId, op, correlationId);

  const vin = exigirTexto(entrada.vin, 'vin', op);
  const sintoma = exigirTexto(entrada.sintoma, 'sintoma', op);
  const sucursalClave = texto(entrada.sucursalClave);
  if (!slotId && !sucursalClave) {
    throw errorDeContrato(
      'Hace falta slotId o sucursalClave: sin uno de los dos el Flow no puede resolver la franja',
      op,
    );
  }

  const idempotencyKey =
    texto(entrada.idempotencyKey) ??
    claveIdempotencia(correlationId, entrada.sufijoIdempotencia ?? 'WO');
  if (idempotencyKey.length > LARGO_IDEMPOTENCY_KEY) {
    throw errorDeContrato(
      `idempotencyKey mide ${idempotencyKey.length} y el campo admite ${LARGO_IDEMPOTENCY_KEY}`,
      op,
    );
  }

  const entradas = sinVacios({
    varVIN: vin,
    varSlotId: slotId,
    varSucursalClave: sucursalClave,
    varFechaDeseada: entrada.fechaDeseada ? aFechaSalesforce(entrada.fechaDeseada, op) : null,
    varTipoServicio: opcionalDeLista(
      typeof entrada.tipoServicio === 'string' ? entrada.tipoServicio : null,
      TIPOS_SERVICIO,
      'tipoServicio',
      op,
    ),
    varSintoma: sintoma,
    varCorrelationId: correlationId,
    varSessionKey: texto(entrada.sessionKey),
    varIdempotencyKey: idempotencyKey,
  });

  const { salidas } = await ejecutarFlow('Crear_Orden_Servicio', op, correlationId, entradas);

  const creada = booleano(salidas.varCreada);
  const folio = texto(salidas.varFolio);
  if (!creada || !folio) throw fallaSinMotivo('Crear_Orden_Servicio', salidas);

  const orden = await leerOrdenPorFolio(folio);
  const logs = await leerLogsDeCorrelation(correlationId);

  return {
    creada,
    folio,
    citaTexto: texto(salidas.varCitaTexto),
    mensaje: texto(salidas.varMensaje),
    correlationId,
    idempotencyKey,
    idempotenciaConfirmada: orden.Idempotency_Key__c === idempotencyKey,
    orden,
    logs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Reprogramar_Orden_Servicio
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaReprogramarOrden {
  /** Folio que dictó el operador, p. ej. 00000008. */
  folio: string;
  /** Por qué se mueve la cita, en palabras del operador. */
  motivo: string;
  correlationId: string;
  nuevoSlotId?: string | null;
  nuevaFecha?: string | Date | null;
  /** Sólo si se cambia de taller. Vacío mantiene el actual. */
  sucursalClave?: string | null;
  sessionKey?: string | null;
}

export interface ResultadoReprogramarOrden {
  reprogramada: boolean;
  /** Idéntico al folio de entrada. El Flow nunca crea una orden nueva. */
  folio: string;
  folioSalida: string | null;
  antes: string | null;
  despues: string | null;
  /** Caso levantado cuando la ventana restringida impidió mover la cita. */
  casoCreado: string | null;
  mensaje: string | null;
  correlationId: string;
  orden: OrdenServicio;
  logs: LogAgente[];
}

/**
 * Mueve la fecha de una orden existente. Invariante del contrato: SIEMPRE actualiza
 * el mismo `WorkOrder` y el folio de salida es idéntico al de entrada. Si cambia,
 * hubo un alta nueva — eso es un defecto y aquí se lanza, no se tolera.
 *
 * Si la cita cayó dentro de la ventana restringida del taller, el Flow no toca las
 * fechas, levanta un `Case` y devuelve el motivo de bloqueo: sale como
 * `BloqueoDePolitica` con el número de caso en el mensaje.
 */
export async function reprogramarOrdenServicio(
  entrada: EntradaReprogramarOrden,
): Promise<ResultadoReprogramarOrden> {
  const op = 'flows.reprogramarOrdenServicio';
  const correlationId = exigirCorrelationId(entrada.correlationId, op);
  const nuevoSlotId = texto(entrada.nuevoSlotId);
  await exigirSlotOperacional(nuevoSlotId, op, correlationId);

  const folio = exigirTexto(entrada.folio, 'folio', op);
  const motivo = exigirTexto(entrada.motivo, 'motivo', op);

  const nuevaFecha = entrada.nuevaFecha ? aFechaSalesforce(entrada.nuevaFecha, op) : null;
  if (!nuevoSlotId && !nuevaFecha) {
    throw errorDeContrato(
      'Hace falta nuevoSlotId o nuevaFecha: sin uno de los dos no hay a dónde mover la cita',
      op,
    );
  }

  const entradas = sinVacios({
    varFolio: folio,
    varNuevoSlotId: nuevoSlotId,
    varNuevaFecha: nuevaFecha,
    varSucursalClave: texto(entrada.sucursalClave),
    varMotivo: motivo,
    varCorrelationId: correlationId,
    varSessionKey: texto(entrada.sessionKey),
  });

  const { salidas } = await ejecutarFlow(
    'Reprogramar_Orden_Servicio',
    op,
    correlationId,
    entradas,
    (s) => {
      const caso = texto(s.varCasoCreado);
      return caso === null ? null : `Caso levantado: ${caso}`;
    },
  );

  const reprogramada = booleano(salidas.varReprogramada);
  if (!reprogramada) throw fallaSinMotivo('Reprogramar_Orden_Servicio', salidas);

  const folioSalida = texto(salidas.varFolioSalida);
  if (folioSalida !== null && folioSalida !== folio) {
    throw new ErrorSalesforce(
      `Invariante rota: se pidió reprogramar ${folio} y el Flow devolvió ${folioSalida}. ` +
        `Un folio distinto significa que se creó una orden nueva en vez de mover la existente.`,
      { operacion: op, cuerpo: salidas },
    );
  }

  const orden = await leerOrdenPorFolio(folio);
  const logs = await leerLogsDeCorrelation(correlationId);

  return {
    reprogramada,
    folio,
    folioSalida,
    antes: texto(salidas.varAntes),
    despues: texto(salidas.varDespues),
    casoCreado: texto(salidas.varCasoCreado),
    mensaje: texto(salidas.varMensaje),
    correlationId,
    orden,
    logs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · Crear_Reporte_Unidad_Varada
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaCrearVarada {
  /** Nombre o número de carretera. Sin esto no se levanta el reporte. */
  carretera: string;
  /** La falla en palabras del operador. */
  descripcionFalla: string;
  correlationId: string;
  /**
   * Confirmado por el operador, no supuesto. Los dos son obligatorios en el
   * contrato del Flow y por eso van siempre, incluso en false: un checkbox no
   * admite nulo y el Flow revienta si se le pasa vacío.
   */
  fueraDeCarril: boolean;
  intermitentes: boolean;
  /** Opcional a propósito: en carretera puede no tenerlo a la mano. */
  vin?: string | null;
  kilometro?: number | null;
  sentido?: Sentido | string | null;
  referencia?: string | null;
  codigosTablero?: string | null;
  carga?: Carga | string | null;
  sucursalClave?: string | null;
  sessionKey?: string | null;
}

export interface ResultadoCrearVarada {
  reportada: boolean;
  folio: string;
  /** True si el VIN empató con una unidad registrada. Si es false el reporte existe igual. */
  unidadIdentificada: boolean | null;
  /**
   * Aviso de seguridad, poblado sólo si la seguridad no venía confirmada. NO es un
   * bloqueo: el reporte quedó registrado. Se lee ANTES del folio.
   */
  avisoSeguridad: string | null;
  mensaje: string | null;
  correlationId: string;
  varada: ReporteVarada;
  logs: LogAgente[];
}

/**
 * Levanta el reporte de una unidad varada en carretera.
 *
 * El Flow no bloquea por falta de VIN ni de kilómetro: una unidad inmovilizada se
 * registra igual. El estado siempre nace en `Reportada` porque la validation rule
 * `Seguridad_Antes_De_Avanzar` impide avanzar sin seguridad confirmada.
 */
export async function crearReporteUnidadVarada(
  entrada: EntradaCrearVarada,
): Promise<ResultadoCrearVarada> {
  const op = 'flows.crearReporteUnidadVarada';
  const correlationId = exigirCorrelationId(entrada.correlationId, op);
  const carretera = exigirTexto(entrada.carretera, 'carretera', op);
  const descripcionFalla = exigirTexto(entrada.descripcionFalla, 'descripcionFalla', op);
  const fueraDeCarril = exigirBooleano(entrada.fueraDeCarril, 'fueraDeCarril', op);
  const intermitentes = exigirBooleano(entrada.intermitentes, 'intermitentes', op);

  const entradas = sinVacios({
    varVIN: texto(entrada.vin),
    varCarretera: carretera,
    varKilometro: numero(entrada.kilometro),
    varSentido: opcionalDeLista(
      typeof entrada.sentido === 'string' ? entrada.sentido : null,
      SENTIDOS,
      'sentido',
      op,
    ),
    varReferencia: texto(entrada.referencia),
    varDescripcionFalla: descripcionFalla,
    varCodigosTablero: texto(entrada.codigosTablero),
    varCarga: opcionalDeLista(
      typeof entrada.carga === 'string' ? entrada.carga : null,
      CARGAS,
      'carga',
      op,
    ),
    varSucursalClave: texto(entrada.sucursalClave),
    varCorrelationId: correlationId,
    varSessionKey: texto(entrada.sessionKey),
  });

  // Los booleanos van después de sinVacios: `false` es un valor, no un vacío, y el
  // Flow revienta si le llega un checkbox nulo.
  entradas.varFueraDeCarril = fueraDeCarril;
  entradas.varIntermitentes = intermitentes;

  const { salidas } = await ejecutarFlow(
    'Crear_Reporte_Unidad_Varada',
    op,
    correlationId,
    entradas,
  );

  const reportada = booleano(salidas.varReportada);
  const folio = texto(salidas.varFolio);
  if (!reportada || !folio) throw fallaSinMotivo('Crear_Reporte_Unidad_Varada', salidas);

  const varada = await leerVaradaPorFolio(folio);
  const logs = await leerLogsDeCorrelation(correlationId);

  return {
    reportada,
    folio,
    unidadIdentificada: booleano(salidas.varUnidadIdentificada),
    avisoSeguridad: texto(salidas.varAvisoSeguridad),
    mensaje: texto(salidas.varMensaje),
    correlationId,
    varada,
    logs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Registrar_Log_Agente
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaRegistrarLog {
  /** Nombre de la acción del catálogo P0, p. ej. Evaluar_Cobertura_Garantia. */
  accion: string;
  correlationId: string;
  subagente: Subagente;
  /** Vacío ⇒ el Flow asume SUCCESS. */
  outcome?: ResultadoLog | null;
  /** Identidad que ejecutó. Vacío ⇒ el usuario en curso. */
  actor?: string | null;
  errorCode?: string | null;
  guardrail?: string | null;
  articuloId?: string | null;
  assetId?: string | null;
  caseId?: string | null;
  workOrderId?: string | null;
  unidadVaradaId?: string | null;
  relatedRecordId?: string | null;
  odometroFuente?: FuenteOdometro | string | null;
  odometroUsado?: number | null;
  policyVersion?: string | null;
  sessionKey?: string | null;
  /** Gate de seguridad al momento del evento. Siempre viaja como booleano. */
  unidadVerificada?: boolean;
}

/**
 * La misma entrada, escrita con los nombres de variable del Flow.
 *
 * Existe porque quien tiene delante el describe del Flow escribe `varCorrelationId`,
 * no `correlationId`, y obligarle a traducir sólo añade una oportunidad de
 * equivocarse. Las dos formas producen exactamente la misma llamada; no hay una
 * "buena" y otra "de compatibilidad".
 */
export interface EntradaRegistrarLogFlow {
  varAccion: string;
  varCorrelationId: string;
  varSubagent: Subagente;
  varOutcome?: ResultadoLog | null;
  varActor?: string | null;
  varErrorCode?: string | null;
  varGuardrail?: string | null;
  varArticuloId?: string | null;
  varAssetId?: string | null;
  varCaseId?: string | null;
  varWorkOrderId?: string | null;
  varUnidadVaradaId?: string | null;
  varRelatedRecordId?: string | null;
  varOdometroFuente?: FuenteOdometro | string | null;
  varOdometroUsado?: number | null;
  varPolicyVersion?: string | null;
  varSessionKey?: string | null;
  varUnidadVerificada?: boolean;
}

export interface ResultadoRegistrarLog {
  logId: string;
  correlationId: string;
  /**
   * Código que este módulo puso para cumplir `Error_Requiere_Codigo` cuando el
   * llamador mandó ERROR o BLOCKED sin código propio. Null si no hizo falta.
   */
  codigoSuplido: string | null;
  log: LogAgente;
}

/** Cumple la validation rule Error_Requiere_Codigo (Log_Agente__c). */
const CODIGO_ERROR_POR_DEFECTO = 'ERROR_SIN_CODIGO';
const GUARDRAIL_POR_DEFECTO = 'BLOQUEO_SIN_CODIGO';

/** Lleva las dos formas de entrada a una sola. Sin defaults ocultos: sólo renombra. */
function normalizarEntradaLog(
  e: EntradaRegistrarLog | EntradaRegistrarLogFlow,
): EntradaRegistrarLog {
  if (!('varCorrelationId' in e || 'varAccion' in e || 'varSubagent' in e)) return e;
  const f = e as EntradaRegistrarLogFlow;
  return {
    accion: f.varAccion,
    correlationId: f.varCorrelationId,
    subagente: f.varSubagent,
    outcome: f.varOutcome ?? null,
    actor: f.varActor ?? null,
    errorCode: f.varErrorCode ?? null,
    guardrail: f.varGuardrail ?? null,
    articuloId: f.varArticuloId ?? null,
    assetId: f.varAssetId ?? null,
    caseId: f.varCaseId ?? null,
    workOrderId: f.varWorkOrderId ?? null,
    unidadVaradaId: f.varUnidadVaradaId ?? null,
    relatedRecordId: f.varRelatedRecordId ?? null,
    odometroFuente: f.varOdometroFuente ?? null,
    odometroUsado: f.varOdometroUsado ?? null,
    policyVersion: f.varPolicyVersion ?? null,
    sessionKey: f.varSessionKey ?? null,
    unidadVerificada: f.varUnidadVerificada === true,
  };
}

/**
 * Escribe un `Log_Agente__c` y lo relee.
 *
 * Los otros tres Flows ya invocan este como subflow en cada una de sus ramas; el
 * servidor lo llama directo sólo para lo que no pasa por ellos — el escalamiento a
 * humano, sobre todo.
 *
 * La validation rule `Error_Requiere_Codigo` rechaza el log si el Outcome es ERROR o
 * BLOCKED y no viene `Error_Code__c` ni `Guardrail_Triggered__c`. Aquí se rellena un
 * código por defecto en vez de dejárselo al llamador: si la validación rebota, el log
 * que se pierde es justo el del momento en que algo salió mal, que es el que más
 * falta hace al reconstruir la traza.
 */
export async function registrarLogAgente(
  entradaCruda: EntradaRegistrarLog | EntradaRegistrarLogFlow,
): Promise<ResultadoRegistrarLog> {
  const op = 'flows.registrarLogAgente';
  const entrada = normalizarEntradaLog(entradaCruda);
  const correlationId = exigirCorrelationId(entrada.correlationId, op);
  const accion = exigirTexto(entrada.accion, 'accion', op);
  const subagente = exigirDeLista(entrada.subagente, SUBAGENTES, 'subagente', op);
  const outcome = opcionalDeLista(entrada.outcome, RESULTADOS_LOG, 'outcome', op);

  let errorCode = texto(entrada.errorCode);
  let guardrail = texto(entrada.guardrail);
  let codigoSuplido: string | null = null;

  if ((outcome === 'ERROR' || outcome === 'BLOCKED') && !errorCode && !guardrail) {
    if (outcome === 'ERROR') {
      errorCode = CODIGO_ERROR_POR_DEFECTO;
      codigoSuplido = CODIGO_ERROR_POR_DEFECTO;
    } else {
      guardrail = GUARDRAIL_POR_DEFECTO;
      codigoSuplido = GUARDRAIL_POR_DEFECTO;
    }
  }

  const entradas = sinVacios({
    varAccion: accion,
    varActor: texto(entrada.actor),
    varArticuloId: texto(entrada.articuloId),
    varAssetId: texto(entrada.assetId),
    varCaseId: texto(entrada.caseId),
    varCorrelationId: correlationId,
    varErrorCode: errorCode,
    varGuardrail: guardrail,
    varOdometroFuente: opcionalDeLista(
      typeof entrada.odometroFuente === 'string' ? entrada.odometroFuente : null,
      FUENTES_ODOMETRO,
      'odometroFuente',
      op,
    ),
    varOdometroUsado: numero(entrada.odometroUsado),
    varOutcome: outcome,
    varPolicyVersion: texto(entrada.policyVersion),
    varRelatedRecordId: texto(entrada.relatedRecordId),
    varSessionKey: texto(entrada.sessionKey),
    varSubagent: subagente,
    varUnidadVaradaId: texto(entrada.unidadVaradaId),
    varWorkOrderId: texto(entrada.workOrderId),
  });

  // Checkbox: nunca nulo. El propio contrato del Flow lo advierte.
  entradas.varUnidadVerificada = entrada.unidadVerificada === true;

  const { salidas } = await ejecutarFlow('Registrar_Log_Agente', op, correlationId, entradas);

  const logId = texto(salidas.varLogId);
  if (!logId) {
    throw new ErrorSalesforce(
      `El Flow Registrar_Log_Agente terminó sin devolver varLogId: el log no quedó escrito ` +
        `y la traza de esta acción se habría perdido en silencio.`,
      { operacion: op, cuerpo: salidas },
    );
  }

  const log = await leerLogPorId(logId);

  return { logId, correlationId, codigoSuplido, log };
}
