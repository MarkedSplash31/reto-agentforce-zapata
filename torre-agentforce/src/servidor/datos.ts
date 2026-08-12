// N4 · Cliente de datos de SÓLO LECTURA.
//
// Alimenta las vistas de Unidades, Varadas, Agenda, Órdenes, Sucursales, Cobertura
// y Traza. Nada aquí escribe en la org.
//
// Tres reglas que gobiernan este fichero:
//
//   1. Ningún nombre de campo se escribe de memoria. Todos salen de
//      `evidencia/05-esquema/resumen-esquema.20260805T202942Z.json`.
//   2. Un fallo se LANZA con su causa real. Nunca se devuelve [] ni null para
//      disimular un 403: un panel vacío y un permiso denegado se ven igual en
//      pantalla. Cuando la consulta sí corrió y no había filas, se dice con un
//      campo explícito (`existe`, `total`), no con silencio.
//   3. "No sé" nunca se convierte en "no tienes". `REQUIERE_DATO`,
//      `SIN_REGLA_PARA_EL_MODELO` y `NO_CUBIERTO` son tres estados distintos y
//      viajan distintos hasta la UI.
//
// Todo valor que venga del usuario pasa por `lit()` antes de tocar un SOQL.

import { consultar, consultarTodo, lit } from './sf.ts';
import { describirProveniencia, esSlotOperacional, type Proveniencia } from './provenance.ts';
import {
  AccessDeniedError,
  salesforceAccessPredicate,
  type Principal,
  type SalesforceResourceKind,
} from './security.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades internas
// ─────────────────────────────────────────────────────────────────────────────

/** Envoltura común de las vistas de lista. `nota` describe criterios no obvios. */
export interface Listado<T> {
  total: number;
  registros: T[];
  nota?: string;
}

/** Quita el `attributes` que Salesforce cuelga de cada registro y de sus lookups. */
function limpiar<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((v) => limpiar(v)) as unknown as T;
  if (valor !== null && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (k === 'attributes') continue;
      salida[k] = limpiar(v);
    }
    return salida as T;
  }
  return valor;
}

/**
 * Normaliza una fecha a literal de datetime SOQL (`2026-08-01T00:00:00Z`, sin comillas).
 * Acepta `YYYY-MM-DD` o ISO completo. Lanza si no reconoce el formato: una fecha
 * mal formada tiene que romper aquí, no producir un rango silenciosamente vacío.
 */
function literalFecha(valor: string, finDelDia: boolean, campo: string): string {
  const v = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T${finDelDia ? '23:59:59' : '00:00:00'}Z`;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `El parámetro ${campo} no es una fecha válida: "${valor}". ` +
        `Usa YYYY-MM-DD o un ISO 8601 completo.`,
    );
  }
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Acota un límite a un entero razonable. */
function limiteSeguro(valor: number | undefined, porDefecto: number, maximo: number): number {
  const n = Number(valor ?? porDefecto);
  if (!Number.isFinite(n) || n <= 0) return porDefecto;
  return Math.min(Math.floor(n), maximo);
}

function aplicarAcceso(
  donde: string[],
  principal: Principal | undefined,
  recurso: SalesforceResourceKind,
): void {
  if (!principal) return;
  const predicado = salesforceAccessPredicate(principal, recurso);
  if (predicado) donde.push(predicado);
}

async function existeConAcceso<T>(
  objeto: string,
  condicion: string,
  principal: Principal,
  recurso: SalesforceResourceKind,
  operacion: string,
): Promise<T> {
  const predicado = salesforceAccessPredicate(principal, recurso);
  const donde = [condicion, ...(predicado ? [predicado] : [])].join(' AND ');
  const resultado = await consultar<T>(`SELECT Id FROM ${objeto} WHERE ${donde} LIMIT 1`, operacion);
  const registro = resultado.records[0];
  if (!registro) throw new AccessDeniedError();
  return registro;
}

/** Confirma la pertenencia por VIN sin convertir “conozco el VIN” en autorización. */
export async function exigirAccesoAssetPorVin(principal: Principal, vin: string): Promise<void> {
  const value = typeof vin === 'string' ? vin.trim() : '';
  if (!value) throw new AccessDeniedError();
  await existeConAcceso<{ Id: string }>(
    'Asset',
    `SerialNumber = '${lit(value)}'`,
    principal,
    'asset',
    'security.asset.vin-ownership',
  );
}

export async function exigirAccesoAssetPorId(principal: Principal, assetId: string): Promise<void> {
  const value = typeof assetId === 'string' ? assetId.trim() : '';
  if (!value) throw new AccessDeniedError();
  await existeConAcceso<{ Id: string }>(
    'Asset',
    `Id = '${lit(value)}'`,
    principal,
    'asset',
    'security.asset.id-ownership',
  );
}

export async function exigirAccesoWorkOrderPorFolio(
  principal: Principal,
  folio: string,
): Promise<void> {
  const value = typeof folio === 'string' ? folio.trim() : '';
  if (!value) throw new AccessDeniedError();
  await existeConAcceso<{ Id: string }>(
    'WorkOrder',
    `WorkOrderNumber = '${lit(value)}'`,
    principal,
    'workOrder',
    'security.work-order.folio-ownership',
  );
}

export async function exigirAccesoWorkOrderPorId(
  principal: Principal,
  workOrderId: string,
): Promise<void> {
  const value = typeof workOrderId === 'string' ? workOrderId.trim() : '';
  if (!value) throw new AccessDeniedError();
  await existeConAcceso<{ Id: string }>(
    'WorkOrder',
    `Id = '${lit(value)}'`,
    principal,
    'workOrder',
    'security.work-order.id-ownership',
  );
}

export async function exigirAccesoContactPorId(principal: Principal, contactId: string): Promise<void> {
  const value = typeof contactId === 'string' ? contactId.trim() : '';
  if (!value) throw new AccessDeniedError();
  await existeConAcceso<{ Id: string }>(
    'Contact',
    `Id = '${lit(value)}'`,
    principal,
    'contact',
    'security.contact.id-ownership',
  );
}

/**
 * Para una emergencia sin VIN confirma que al menos un binding configurado existe
 * realmente en la org. No inventa una unidad ni obliga a omitir la varada urgente.
 */
export async function exigirRelacionPrincipal(principal: Principal): Promise<void> {
  if (principal.role !== 'cliente') return;
  const checks: Array<{ object: string; resource: SalesforceResourceKind; ids: readonly string[] }> = [
    { object: 'Contact', resource: 'contact', ids: principal.bindings.contactIds },
    { object: 'Account', resource: 'account', ids: principal.bindings.accountIds },
    { object: 'Asset', resource: 'asset', ids: principal.bindings.assetIds },
    { object: 'WorkOrder', resource: 'workOrder', ids: principal.bindings.workOrderIds },
  ];
  for (const check of checks) {
    if (check.ids.length === 0) continue;
    const predicado = salesforceAccessPredicate(principal, check.resource);
    if (!predicado) continue;
    const resultado = await consultar<{ Id: string }>(
      `SELECT Id FROM ${check.object} WHERE ${predicado} LIMIT 1`,
      `security.principal.${check.resource}-binding`,
    );
    if (resultado.totalSize > 0) return;
  }
  throw new AccessDeniedError();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · Unidades (Asset)
// ─────────────────────────────────────────────────────────────────────────────

export interface LecturaOdometro {
  Id: string;
  Name: string;
  Asset__c: string | null;
  Fecha_Lectura__c: string | null;
  Kilometraje__c: number | null;
  Fuente__c: string | null;
  Verificada__c: boolean;
  Correlation_Id__c: string | null;
}

export interface Unidad {
  Id: string;
  Name: string;
  /** El VIN vive en el campo estándar SerialNumber. */
  SerialNumber: string | null;
  Status: string | null;
  Product2Id: string | null;
  Product2: { Name: string | null; ProductCode: string | null } | null;
  Account: { Name: string | null } | null;
  Odometro__c: number | null;
  Ultimo_Odometro_Verificado__c: number | null;
  Fecha_Odometro_Verificado__c: string | null;
  Dato_Odometro_Vigente__c: boolean;
  Estado_Cobertura__c: string | null;
  Cobertura_Citable__c: string | null;
  Garantia_Vigente__c: boolean;
  Meses_Desde_Instalacion__c: number | null;
  Tipo_Unidad__c: string | null;
  Placa__c: string | null;
  Unidad_Verificada__c: boolean;
  Procedencia__c: string | null;
  proveniencia: Proveniencia;
  InstallDate: string | null;
  /**
   * Serie histórica de odómetro. En la org de hoy `Lectura_Odometro__c` tiene un
   * único registro semilla, así que esto viene casi siempre vacío. Vacío significa
   * "no existe la serie", NO "la consulta falló": mira `historialOdometroDisponible`
   * en la nota del listado. La UI debe decirlo, no dibujar una línea inventada.
   */
  historialOdometro: LecturaOdometro[];
}

/** Lo que devuelve el SOQL de Asset: igual que `Unidad` pero sin el historial adjunto. */
type UnidadCruda = Omit<Unidad, 'historialOdometro' | 'proveniencia'>;

/** Campos extra que sólo pide `evaluarCobertura`. */
interface UnidadCrudaCobertura extends UnidadCruda {
  Evaluacion_Vigente__c: boolean;
  Garantia_Extendida__c: boolean;
  Extendida_Aplicable__c: boolean;
  Estado_Garantia_Basica__c: string | null;
}

export interface FiltrosUnidades {
  /**
   * Código de sucursal (`Sucursal__c.Codigo_Sucursal__c`).
   * OJO — `Asset` NO tiene campo de sucursal en esta org (verificado en el describe).
   * El único vínculo real unidad↔sucursal son sus órdenes de servicio, así que este
   * filtro significa: "unidades con al menos una WorkOrder en esa sucursal".
   * Se declara aquí y se repite en `nota` para que nadie lo lea como otra cosa.
   */
  sucursal?: string;
  /** `Asset.Status`: Shipped | Installed | Registered | Obsolete | Purchased */
  estado?: string;
  /** `Asset.Estado_Cobertura__c`: CUBIERTO | NO_CUBIERTO | REQUIERE_DATO */
  estadoCobertura?: string;
  /** Coincidencia parcial sobre Name, SerialNumber (VIN) o Placa__c. */
  busqueda?: string;
  limite?: number;
}

const CAMPOS_UNIDAD = `Id, Name, SerialNumber, Status, Product2Id, Product2.Name, Product2.ProductCode,
   Account.Name, Odometro__c, Ultimo_Odometro_Verificado__c, Fecha_Odometro_Verificado__c,
   Dato_Odometro_Vigente__c, Estado_Cobertura__c, Cobertura_Citable__c, Garantia_Vigente__c,
   Meses_Desde_Instalacion__c, Tipo_Unidad__c, Placa__c, Unidad_Verificada__c, Procedencia__c,
   InstallDate`;

export async function listarUnidades(
  filtros?: FiltrosUnidades,
  principal?: Principal,
): Promise<Listado<Unidad>> {
  const donde: string[] = [];
  const notas: string[] = [];

  if (filtros?.sucursal) {
    donde.push(
      `Id IN (SELECT AssetId FROM WorkOrder WHERE Sucursal__r.Codigo_Sucursal__c = '${lit(filtros.sucursal)}')`,
    );
    notas.push(
      `Asset no tiene campo de sucursal en esta org; el filtro sucursal="${filtros.sucursal}" ` +
        `se resolvió por las WorkOrder de cada unidad.`,
    );
  }
  if (filtros?.estado) donde.push(`Status = '${lit(filtros.estado)}'`);
  if (filtros?.estadoCobertura) {
    donde.push(`Estado_Cobertura__c = '${lit(filtros.estadoCobertura)}'`);
  }
  if (filtros?.busqueda) {
    const b = lit(filtros.busqueda);
    donde.push(`(Name LIKE '%${b}%' OR SerialNumber LIKE '%${b}%' OR Placa__c LIKE '%${b}%')`);
  }
  aplicarAcceso(donde, principal, 'asset');

  const limite = limiteSeguro(filtros?.limite, 200, 2000);
  const soql =
    `SELECT ${CAMPOS_UNIDAD} FROM Asset` +
    (donde.length ? ` WHERE ${donde.join(' AND ')}` : '') +
    ` ORDER BY Name LIMIT ${limite}`;

  const crudas = await consultarTodo<UnidadCruda>(soql, 'datos.listarUnidades');
  const unidades: Unidad[] = limpiar(crudas).map((u) => ({
    ...u,
    proveniencia: describirProveniencia(u.Procedencia__c, 'unidad'),
    historialOdometro: [],
  }));

  // Historial de odómetro: se trae el que EXISTA. Hoy la org tiene 1 registro semilla.
  if (unidades.length) {
    const ids = unidades.map((u) => `'${lit(u.Id)}'`).join(',');
    const lecturas = limpiar(
      await consultarTodo<LecturaOdometro>(
        `SELECT Id, Name, Asset__c, Fecha_Lectura__c, Kilometraje__c, Fuente__c, Verificada__c,
                Correlation_Id__c
         FROM Lectura_Odometro__c WHERE Asset__c IN (${ids})
         ORDER BY Fecha_Lectura__c DESC NULLS LAST`,
        'datos.listarUnidades.historialOdometro',
      ),
    );
    const porAsset = new Map<string, LecturaOdometro[]>();
    for (const l of lecturas) {
      if (!l.Asset__c) continue;
      const acc = porAsset.get(l.Asset__c) ?? [];
      acc.push(l);
      porAsset.set(l.Asset__c, acc);
    }
    for (const u of unidades) u.historialOdometro = porAsset.get(u.Id) ?? [];

    const conSerie = unidades.filter((u) => u.historialOdometro.length > 1).length;
    notas.push(
      conSerie === 0
        ? 'Sin serie histórica de odómetro: Lectura_Odometro__c no tiene más de una lectura por ' +
          'unidad en esta org. historialOdometro vacío significa "no existe la serie", no un fallo.'
        : `${conSerie} unidad(es) con serie de odómetro (más de una lectura).`,
    );
  }

  return { total: unidades.length, registros: unidades, nota: notas.join(' ') || undefined };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Unidades varadas (Unidad_Varada__c)
// ─────────────────────────────────────────────────────────────────────────────

export interface UnidadVarada {
  Id: string;
  Name: string;
  Estado__c: string | null;
  Prioridad__c: string | null;
  Carretera__c: string | null;
  Kilometro__c: number | null;
  Sentido__c: string | null;
  Referencia_Ubicacion__c: string | null;
  VIN_Reportado__c: string | null;
  Asset__c: string | null;
  Asset__r: { Name: string | null; SerialNumber: string | null } | null;
  Correlation_Id__c: string | null;
  Fecha_Reporte__c: string | null;
  Fecha_Resolucion__c: string | null;
  Horas_Detenida__c: number | null;
  Descripcion_Falla__c: string | null;
  Codigos_Falla_Tablero__c: string | null;
  Carga__c: string | null;
  Fuera_De_Carril__c: boolean | null;
  Intermitentes_Encendidas__c: boolean | null;
  Sucursal_Apoyo__r: { Name: string | null; Codigo_Sucursal__c: string | null } | null;
  WorkOrder__r: { WorkOrderNumber: string | null } | null;
  Case__r: { CaseNumber: string | null } | null;
  Procedencia__c: string | null;
  proveniencia: Proveniencia;
}

export interface FiltrosVaradas {
  /** `Unidad_Varada__c.Estado__c` */
  estado?: string;
  /** `Unidad_Varada__c.Prioridad__c` */
  prioridad?: string;
  correlationId?: string;
  limite?: number;
}

export async function listarUnidadesVaradas(
  filtros?: FiltrosVaradas,
  principal?: Principal,
): Promise<Listado<UnidadVarada>> {
  const donde: string[] = [];
  if (filtros?.estado) donde.push(`Estado__c = '${lit(filtros.estado)}'`);
  if (filtros?.prioridad) donde.push(`Prioridad__c = '${lit(filtros.prioridad)}'`);
  if (filtros?.correlationId) donde.push(`Correlation_Id__c = '${lit(filtros.correlationId)}'`);
  aplicarAcceso(donde, principal, 'varada');

  const limite = limiteSeguro(filtros?.limite, 200, 2000);
  const soql =
    `SELECT Id, Name, Estado__c, Prioridad__c, Carretera__c, Kilometro__c, Sentido__c,
            Referencia_Ubicacion__c, VIN_Reportado__c, Asset__c, Asset__r.Name, Asset__r.SerialNumber,
            Correlation_Id__c, Fecha_Reporte__c, Fecha_Resolucion__c, Horas_Detenida__c,
            Descripcion_Falla__c, Codigos_Falla_Tablero__c, Carga__c, Fuera_De_Carril__c,
            Intermitentes_Encendidas__c, Sucursal_Apoyo__r.Name, Sucursal_Apoyo__r.Codigo_Sucursal__c,
            WorkOrder__r.WorkOrderNumber, Case__r.CaseNumber, Procedencia__c
     FROM Unidad_Varada__c` +
    (donde.length ? ` WHERE ${donde.join(' AND ')}` : '') +
    ` ORDER BY Fecha_Reporte__c DESC NULLS LAST LIMIT ${limite}`;

  const crudos = limpiar(
    await consultarTodo<Omit<UnidadVarada, 'proveniencia'>>(soql, 'datos.listarUnidadesVaradas'),
  );
  const registros = crudos.map((registro) => ({
    ...registro,
    proveniencia: describirProveniencia(registro.Procedencia__c, 'transaccion'),
  }));
  return {
    total: registros.length,
    registros,
    nota: 'Registros transaccionales o de prueba; no acreditan clientes confirmados.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · Agenda (Slot_Taller__c)
// ─────────────────────────────────────────────────────────────────────────────

export interface Slot {
  Id: string;
  Name: string;
  Inicio__c: string | null;
  Fin__c: string | null;
  Tipo_Servicio__c: string | null;
  Capacidad_Total__c: number | null;
  Capacidad_Usada__c: number | null;
  Cupos_Libres__c: number | null;
  Disponible__c: boolean;
  /** Disponible por capacidad y además verificado operacionalmente. */
  agendable: boolean;
  Sucursal__c: string | null;
  Sucursal__r: { Name: string | null; Codigo_Sucursal__c: string | null } | null;
  Procedencia__c: string | null;
  proveniencia: Proveniencia;
}

export interface RangoFechas {
  /** `YYYY-MM-DD` o ISO completo. Inclusivo. */
  desde: string;
  /** `YYYY-MM-DD` (se toma el final del día) o ISO completo. Inclusivo. */
  hasta: string;
}

export interface OpcionesSlots {
  tipoServicio?: string;
  /** Sólo devuelve capacidad disponible con procedencia OPERACIONAL_VERIFICADO. */
  soloDisponibles?: boolean;
  limite?: number;
}

/**
 * Son 729 slots en la org: el rango de fechas es OBLIGATORIO a propósito.
 * Pagina con `consultarTodo` porque un rango ancho supera el tope de una página.
 */
export async function listarSlots(
  rango: RangoFechas,
  sucursalClave?: string,
  opciones?: OpcionesSlots,
): Promise<Listado<Slot>> {
  if (!rango || !rango.desde || !rango.hasta) {
    throw new Error(
      'listarSlots exige un rango {desde, hasta}. Sin rango la consulta traería los 729 slots ' +
        'de la org y la vista de agenda dejaría de ser legible.',
    );
  }
  const desde = literalFecha(rango.desde, false, 'rango.desde');
  const hasta = literalFecha(rango.hasta, true, 'rango.hasta');
  if (desde > hasta) {
    throw new Error(`El rango está invertido: desde=${desde} es posterior a hasta=${hasta}.`);
  }

  const donde = [`Inicio__c >= ${desde}`, `Inicio__c <= ${hasta}`];
  if (sucursalClave) donde.push(`Sucursal__r.Codigo_Sucursal__c = '${lit(sucursalClave)}'`);
  if (opciones?.tipoServicio) donde.push(`Tipo_Servicio__c = '${lit(opciones.tipoServicio)}'`);
  if (opciones?.soloDisponibles) {
    donde.push(`Disponible__c = true`);
    donde.push(`Procedencia__c = 'OPERACIONAL_VERIFICADO'`);
  }

  const limite = limiteSeguro(opciones?.limite, 1000, 2000);
  const soql =
    `SELECT Id, Name, Inicio__c, Fin__c, Tipo_Servicio__c, Capacidad_Total__c, Capacidad_Usada__c,
            Cupos_Libres__c, Disponible__c, Procedencia__c, Sucursal__c, Sucursal__r.Name,
            Sucursal__r.Codigo_Sucursal__c
     FROM Slot_Taller__c WHERE ${donde.join(' AND ')}
     ORDER BY Inicio__c ASC, Sucursal__r.Codigo_Sucursal__c ASC LIMIT ${limite}`;

  const crudos = limpiar(
    await consultarTodo<Omit<Slot, 'proveniencia' | 'agendable'>>(soql, 'datos.listarSlots'),
  );
  const registros = crudos.map((registro) => ({
    ...registro,
    agendable: registro.Disponible__c && esSlotOperacional(registro.Procedencia__c),
    proveniencia: describirProveniencia(registro.Procedencia__c, 'slot'),
  }));
  return {
    total: registros.length,
    registros,
    nota:
      `Rango aplicado sobre Inicio__c: ${desde} .. ${hasta}${sucursalClave ? ` · sucursal ${sucursalClave}` : ''}. ` +
      'Una franja sólo es agendable con Procedencia__c=OPERACIONAL_VERIFICADO.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Órdenes de servicio (WorkOrder)
// ─────────────────────────────────────────────────────────────────────────────

export interface Orden {
  Id: string;
  WorkOrderNumber: string | null;
  Status: string | null;
  StartDate: string | null;
  EndDate: string | null;
  Subject: string | null;
  Priority: string | null;
  AssetId: string | null;
  Asset: { Name: string | null; SerialNumber: string | null } | null;
  Account: { Name: string | null } | null;
  Sucursal__c: string | null;
  Sucursal__r: { Name: string | null; Codigo_Sucursal__c: string | null } | null;
  Tipo_Cita__c: string | null;
  Origen_Atencion__c: string | null;
  Correlation_Id__c: string | null;
  Sintoma_Reportado__c: string | null;
  Slot_Taller__r: { Name: string | null; Inicio__c: string | null; Fin__c: string | null } | null;
  Placa__c: string | null;
  Procedencia__c: string | null;
  proveniencia: Proveniencia;
}

export interface FiltrosOrdenes {
  /** `WorkOrder.Status` */
  estado?: string;
  /** Código de sucursal (`Sucursal__r.Codigo_Sucursal__c`) */
  sucursalClave?: string;
  assetId?: string;
  /** VIN — se busca contra `Asset.SerialNumber` */
  vin?: string;
  correlationId?: string;
  tipoCita?: string;
  origenAtencion?: string;
  /** Filtra `StartDate`. `YYYY-MM-DD` o ISO. */
  desde?: string;
  hasta?: string;
  limite?: number;
}

export async function listarOrdenes(
  filtros?: FiltrosOrdenes,
  principal?: Principal,
): Promise<Listado<Orden>> {
  const donde: string[] = [];
  if (filtros?.estado) donde.push(`Status = '${lit(filtros.estado)}'`);
  if (filtros?.sucursalClave) {
    donde.push(`Sucursal__r.Codigo_Sucursal__c = '${lit(filtros.sucursalClave)}'`);
  }
  if (filtros?.assetId) donde.push(`AssetId = '${lit(filtros.assetId)}'`);
  if (filtros?.vin) donde.push(`Asset.SerialNumber = '${lit(filtros.vin)}'`);
  if (filtros?.correlationId) donde.push(`Correlation_Id__c = '${lit(filtros.correlationId)}'`);
  if (filtros?.tipoCita) donde.push(`Tipo_Cita__c = '${lit(filtros.tipoCita)}'`);
  if (filtros?.origenAtencion) donde.push(`Origen_Atencion__c = '${lit(filtros.origenAtencion)}'`);
  if (filtros?.desde) donde.push(`StartDate >= ${literalFecha(filtros.desde, false, 'desde')}`);
  if (filtros?.hasta) donde.push(`StartDate <= ${literalFecha(filtros.hasta, true, 'hasta')}`);
  aplicarAcceso(donde, principal, 'workOrder');

  const limite = limiteSeguro(filtros?.limite, 200, 2000);
  const soql =
    `SELECT Id, WorkOrderNumber, Status, StartDate, EndDate, Subject, Priority, AssetId,
            Asset.Name, Asset.SerialNumber, Account.Name, Sucursal__c, Sucursal__r.Name,
            Sucursal__r.Codigo_Sucursal__c, Tipo_Cita__c, Origen_Atencion__c, Correlation_Id__c,
            Sintoma_Reportado__c, Slot_Taller__r.Name, Slot_Taller__r.Inicio__c,
            Slot_Taller__r.Fin__c, Placa__c, Procedencia__c
     FROM WorkOrder` +
    (donde.length ? ` WHERE ${donde.join(' AND ')}` : '') +
    ` ORDER BY StartDate DESC NULLS LAST LIMIT ${limite}`;

  const crudos = limpiar(
    await consultarTodo<Omit<Orden, 'proveniencia'>>(soql, 'datos.listarOrdenes'),
  );
  const registros = crudos.map((registro) => ({
    ...registro,
    proveniencia: describirProveniencia(registro.Procedencia__c, 'transaccion'),
  }));
  return {
    total: registros.length,
    registros,
    nota: 'Registros transaccionales o de prueba; no acreditan clientes confirmados.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Sucursales (Sucursal__c)
// ─────────────────────────────────────────────────────────────────────────────

export interface Sucursal {
  Id: string;
  Name: string;
  Codigo_Sucursal__c: string | null;
  Ciudad__c: string | null;
  Direccion__c: string | null;
  Telefono__c: string | null;
  Horario_Atencion__c: string | null;
  Horario_Sabado__c: string | null;
  Abre_Domingo__c: boolean;
  Anticipacion_Minima_Horas__c: number | null;
  Zona_Horaria__c: string | null;
  Marca_Principal__c: string | null;
  Activa__c: boolean;
}

/** Sólo las activas. `incluirInactivas` existe para auditoría, no para la vista. */
export async function listarSucursales(incluirInactivas = false): Promise<Listado<Sucursal>> {
  const soql =
    `SELECT Id, Name, Codigo_Sucursal__c, Ciudad__c, Direccion__c, Telefono__c,
            Horario_Atencion__c, Horario_Sabado__c, Abre_Domingo__c, Anticipacion_Minima_Horas__c,
            Zona_Horaria__c, Marca_Principal__c, Activa__c
     FROM Sucursal__c` +
    (incluirInactivas ? '' : ' WHERE Activa__c = true') +
    ' ORDER BY Codigo_Sucursal__c ASC NULLS LAST';

  const registros = limpiar(await consultarTodo<Sucursal>(soql, 'datos.listarSucursales'));
  return { total: registros.length, registros };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5b · Material de apoyo (Knowledge__kav)
// ─────────────────────────────────────────────────────────────────────────────

export interface ArticuloConocimiento {
  Id: string;
  Title: string;
  Summary: string | null;
  Contenido__c: string | null;
  Version_Politica__c: string | null;
}

export interface ArticuloPublicado {
  id: string;
  titulo: string;
  resumen: string | null;
  contenido: string | null;
  version: string | null;
  /** false mientras el artículo no declare una versión de política operacional. */
  verificado: boolean;
}

/**
 * Los artículos que el agente consulta, legibles también sin conversación.
 *
 * Hasta ahora este material sólo salía por boca del agente: `BuscarConocimientoPostventa`
 * lo busca, lo recorta y lo devuelve dentro de una respuesta. Un cliente que quiere
 * leer qué dice el material sobre su modelo —sin cita, sin número de serie y sin
 * negociarlo por chat— no tenía por dónde.
 *
 * El mismo filtro que usa el Apex: `PublishStatus = 'Online'` e `IsLatestVersion`.
 *
 * `verificado` NO es decoración. El Apex antepone a cada respuesta un aviso de
 * fuente sintética no verificada, y esa marca tiene que viajar con el artículo:
 * presentarlo como manual oficial de Zapata sería exactamente la clase de mentira
 * que el aviso existe para impedir.
 */
export async function listarConocimiento(busqueda?: string): Promise<Listado<ArticuloPublicado>> {
  const donde = ["PublishStatus = 'Online'", 'IsLatestVersion = true'];
  const termino = (busqueda ?? '').trim();
  if (termino.length >= 2) {
    const patron = `%${lit(termino)}%`;
    donde.push(`(Title LIKE '${patron}' OR Summary LIKE '${patron}' OR Contenido__c LIKE '${patron}')`);
  }

  const crudos = limpiar(
    await consultarTodo<ArticuloConocimiento>(
      `SELECT Id, Title, Summary, Contenido__c, Version_Politica__c
       FROM Knowledge__kav WHERE ${donde.join(' AND ')} ORDER BY Title ASC LIMIT 50`,
      'datos.listarConocimiento',
    ),
  );

  const registros = crudos.map((a) => ({
    id: a.Id,
    titulo: a.Title,
    resumen: a.Summary,
    contenido: a.Contenido__c,
    version: a.Version_Politica__c,
    verificado: Boolean(a.Version_Politica__c && a.Version_Politica__c.trim()),
  }));
  return { total: registros.length, registros };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · Cobertura — la contradicción, sin resolverla
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuatro estados, y son cuatro por una razón:
 *   CUBIERTO / NO_CUBIERTO   veredicto con dato suficiente
 *   REQUIERE_DATO            falta el dato para decidir — "no sé", NO "no tienes"
 *   SIN_REGLA_PARA_EL_MODELO no existe regla aplicable al modelo de esta unidad
 */
export type Veredicto = 'CUBIERTO' | 'NO_CUBIERTO' | 'REQUIERE_DATO' | 'SIN_REGLA_PARA_EL_MODELO';

export interface ReglaCobertura {
  Id: string;
  Name: string;
  Sistema__c: string | null;
  Meses_Limite__c: number | null;
  Km_Limite__c: number | null;
  Sin_Limite_Km__c: boolean;
  Es_Extendida__c: boolean;
  Knowledge_Article_Id__c: string | null;
  Deducible__c: number | null;
  Version__c: string | null;
  Vigencia_Odometro_Dias__c: number | null;
  Clave_Unica__c: string | null;
  Activa__c: boolean;
  Modelo__c: string | null;
  Modelo__r: { Name: string | null; ProductCode: string | null } | null;
}

export interface ParametrosGarantia {
  Id: string;
  Name: string;
  Meses_Base__c: number | null;
  Km_Base__c: number | null;
  Margen_Cerca_Limite_Pct__c: number | null;
  Vigencia_Odometro_Dias__c: number | null;
  Vigencia_Evaluacion_Dias__c: number | null;
}

/** De dónde sale un veredicto, con nombre de campo y artículo citable. */
export interface FuenteCitable {
  origen: 'Regla_Cobertura__c' | 'Asset.Garantia_Vigente__c';
  campos: string[];
  registro: string | null;
  articuloConocimiento: string | null;
  descripcion: string;
}

export interface VeredictoPorRegla {
  veredicto: Veredicto;
  motivo: string;
  regla: ReglaCobertura | null;
  reglasDelSistema: ReglaCobertura[];
  fuente: FuenteCitable;
}

export interface VeredictoPorFormula {
  /** Valor crudo de la fórmula `Asset.Garantia_Vigente__c`. */
  garantiaVigente: boolean;
  veredicto: Veredicto;
  motivo: string;
  /**
   * Réplica local de la aritmética de la fórmula con los parámetros reales.
   * Sirve para EXPLICAR el veredicto; la autoridad sigue siendo el campo fórmula.
   */
  calculoReplicado: {
    mesesDesdeInstalacion: number | null;
    mesesBase: number | null;
    odometro: number | null;
    kmBase: number | null;
    dentroDeMeses: boolean | null;
    dentroDeKm: boolean | null;
    cercaDelLimite: boolean | null;
    margenPct: number | null;
    coincideConLaFormula: boolean | null;
  };
  fuente: FuenteCitable;
}

export interface EvaluacionSistema {
  sistema: string;
  porRegla: VeredictoPorRegla;
  porFormula: VeredictoPorFormula;
  /** true cuando los dos veredictos NO son el mismo. Aquí no se resuelve el empate. */
  hayConflicto: boolean;
  tipoConflicto: 'veredictos-opuestos' | 'dato-faltante' | 'sin-regla' | null;
}

export interface EntradaCatalogo {
  sistema: string;
  esExtendida: boolean;
  mesesLimite: number | null;
  kmLimite: number | null;
  sinLimiteKm: boolean;
  articuloConocimiento: string | null;
  modelos: string[];
  difiereDeLaBase: boolean;
  detalleDiferencia: string | null;
}

export interface CatalogoDePoliticas {
  /**
   * Ojo: esto es el catálogo de políticas COMPLETO de la org, no lo que aplica a una
   * unidad concreta. Se expone porque la contradicción de cobertura vive en la capa
   * de política, no en un registro suelto.
   */
  totalReglasActivas: number;
  parametros: ParametrosGarantia | null;
  entradas: EntradaCatalogo[];
  sistemasQueDifieren: string[];
  hayContradiccion: boolean;
}

export interface EvaluacionCobertura {
  unidad: Unidad;
  modelo: {
    Id: string | null;
    Name: string | null;
    ProductCode: string | null;
    reglasActivas: number;
  };
  parametros: ParametrosGarantia | null;
  /** Una entrada por sistema con regla activa PARA EL MODELO DE ESTA UNIDAD. */
  porSistema: EvaluacionSistema[];
  sinReglasParaElModelo: boolean;
  /** Veredicto global de la fórmula: la fórmula no distingue sistema. */
  porFormula: VeredictoPorFormula;
  /** Valor crudo de `Asset.Cobertura_Citable__c`. Se reporta tal cual. */
  citabilidad: {
    valor: string | null;
    esCitable: boolean;
    datoOdometroVigente: boolean;
    evaluacionVigente: boolean | null;
    explicacion: string;
  };
  /** true si algún sistema evaluado da veredictos distintos entre las dos fuentes. */
  hayConflicto: boolean;
  sistemasEnConflicto: string[];
  /** La contradicción a nivel política, independiente de esta unidad. */
  catalogoDePoliticas: CatalogoDePoliticas;
  advertencias: string[];
}

const CAMPOS_REGLA = `Id, Name, Sistema__c, Meses_Limite__c, Km_Limite__c, Sin_Limite_Km__c,
   Es_Extendida__c, Knowledge_Article_Id__c, Deducible__c, Version__c, Vigencia_Odometro_Dias__c,
   Clave_Unica__c, Activa__c, Modelo__c, Modelo__r.Name, Modelo__r.ProductCode`;

async function leerParametros(): Promise<ParametrosGarantia | null> {
  const r = await consultarTodo<ParametrosGarantia>(
    `SELECT Id, Name, Meses_Base__c, Km_Base__c, Margen_Cerca_Limite_Pct__c,
            Vigencia_Odometro_Dias__c, Vigencia_Evaluacion_Dias__c
     FROM Parametros_Garantia__c ORDER BY CreatedDate DESC`,
    'datos.parametrosGarantia',
  );
  return limpiar(r)[0] ?? null;
}

/**
 * El catálogo de políticas activo, comparado contra los parámetros base.
 * Aquí es donde se ve, con datos reales, que `Regla_Cobertura__c` dice 36 meses sin
 * límite de km para Cabina y Chasis mientras la fórmula aplica 24 meses / 250,000 km
 * a todo por igual.
 */
export async function catalogoDePoliticas(): Promise<CatalogoDePoliticas> {
  const [reglas, parametros] = await Promise.all([
    consultarTodo<ReglaCobertura>(
      `SELECT ${CAMPOS_REGLA} FROM Regla_Cobertura__c WHERE Activa__c = true
       ORDER BY Sistema__c, Es_Extendida__c, Modelo__r.Name`,
      'datos.catalogoDePoliticas',
    ).then((r) => limpiar(r)),
    leerParametros(),
  ]);

  const mesesBase = parametros?.Meses_Base__c ?? null;
  const kmBase = parametros?.Km_Base__c ?? null;

  const agrupadas = new Map<string, EntradaCatalogo>();
  for (const r of reglas) {
    const sistema = r.Sistema__c ?? '(sin sistema)';
    const clave = `${sistema}|${r.Es_Extendida__c}|${r.Meses_Limite__c}|${r.Km_Limite__c}|${r.Sin_Limite_Km__c}`;
    const modelo = r.Modelo__r?.Name ?? r.Modelo__c ?? '(sin modelo)';
    const existente = agrupadas.get(clave);
    if (existente) {
      if (!existente.modelos.includes(modelo)) existente.modelos.push(modelo);
      continue;
    }
    const difMeses = mesesBase !== null && r.Meses_Limite__c !== null && r.Meses_Limite__c !== mesesBase;
    const difKm =
      kmBase !== null && (r.Sin_Limite_Km__c || (r.Km_Limite__c !== null && r.Km_Limite__c !== kmBase));
    const partes: string[] = [];
    if (difMeses) partes.push(`meses ${r.Meses_Limite__c} vs base ${mesesBase}`);
    if (difKm) {
      partes.push(
        r.Sin_Limite_Km__c ? `sin límite de km vs base ${kmBase}` : `km ${r.Km_Limite__c} vs base ${kmBase}`,
      );
    }
    agrupadas.set(clave, {
      sistema,
      esExtendida: r.Es_Extendida__c,
      mesesLimite: r.Meses_Limite__c,
      kmLimite: r.Km_Limite__c,
      sinLimiteKm: r.Sin_Limite_Km__c,
      articuloConocimiento: r.Knowledge_Article_Id__c,
      modelos: [modelo],
      difiereDeLaBase: difMeses || difKm,
      detalleDiferencia: partes.length ? partes.join(' · ') : null,
    });
  }

  const entradas = [...agrupadas.values()].sort(
    (a, b) => a.sistema.localeCompare(b.sistema) || Number(a.esExtendida) - Number(b.esExtendida),
  );
  const sistemasQueDifieren = [
    ...new Set(entradas.filter((e) => e.difiereDeLaBase).map((e) => e.sistema)),
  ];

  return {
    totalReglasActivas: reglas.length,
    parametros,
    entradas,
    sistemasQueDifieren,
    hayContradiccion: sistemasQueDifieren.length > 0,
  };
}

function evaluarRegla(
  regla: ReglaCobertura,
  meses: number | null,
  km: number | null,
): { veredicto: Veredicto; motivo: string } {
  const faltantes: string[] = [];
  if (meses === null || meses === undefined) faltantes.push('Meses_Desde_Instalacion__c');
  if (!regla.Sin_Limite_Km__c && (km === null || km === undefined)) faltantes.push('Odometro__c');
  if (faltantes.length) {
    return {
      veredicto: 'REQUIERE_DATO',
      motivo: `Falta ${faltantes.join(' y ')} para decidir con la regla ${regla.Name}. No sé; no es lo mismo que "no tienes".`,
    };
  }

  const limiteMeses = regla.Meses_Limite__c;
  const dentroMeses = limiteMeses === null ? true : (meses as number) <= limiteMeses;
  const dentroKm = regla.Sin_Limite_Km__c
    ? true
    : regla.Km_Limite__c === null
      ? true
      : (km as number) <= regla.Km_Limite__c;

  const detalleKm = regla.Sin_Limite_Km__c
    ? 'sin límite de km (Sin_Limite_Km__c = true)'
    : `km ${km} vs límite ${regla.Km_Limite__c}`;
  const detalle = `meses ${meses} vs límite ${limiteMeses} · ${detalleKm}`;

  return dentroMeses && dentroKm
    ? { veredicto: 'CUBIERTO', motivo: `${regla.Name}: dentro de límites — ${detalle}.` }
    : {
        veredicto: 'NO_CUBIERTO',
        motivo: `${regla.Name}: fuera de límites — ${detalle} (${!dentroMeses ? 'excede meses' : ''}${!dentroMeses && !dentroKm ? ' y ' : ''}${!dentroKm ? 'excede km' : ''}).`,
      };
}

function construirVeredictoFormula(
  unidad: Unidad,
  parametros: ParametrosGarantia | null,
): VeredictoPorFormula {
  const meses = unidad.Meses_Desde_Instalacion__c;
  const km = unidad.Odometro__c;
  const mesesBase = parametros?.Meses_Base__c ?? null;
  const kmBase = parametros?.Km_Base__c ?? null;
  const margen = parametros?.Margen_Cerca_Limite_Pct__c ?? null;

  const dentroDeMeses = meses !== null && mesesBase !== null ? meses <= mesesBase : null;
  const dentroDeKm = km !== null && kmBase !== null ? km <= kmBase : null;
  const replicado = dentroDeMeses === null || dentroDeKm === null ? null : dentroDeMeses && dentroDeKm;

  let cerca: boolean | null = null;
  if (margen !== null && dentroDeMeses !== null && dentroDeKm !== null && replicado) {
    const umbralMeses = (mesesBase as number) * (1 - margen / 100);
    const umbralKm = (kmBase as number) * (1 - margen / 100);
    cerca = (meses as number) >= umbralMeses || (km as number) >= umbralKm;
  }

  return {
    garantiaVigente: unidad.Garantia_Vigente__c,
    veredicto: unidad.Garantia_Vigente__c ? 'CUBIERTO' : 'NO_CUBIERTO',
    motivo:
      `Asset.Garantia_Vigente__c = ${unidad.Garantia_Vigente__c}. La fórmula aplica ` +
      `${mesesBase ?? '?'} meses y ${kmBase ?? '?'} km a TODOS los sistemas por igual; ` +
      `no mira Sistema__c. Unidad: ${meses ?? '?'} meses, ${km ?? '?'} km.`,
    calculoReplicado: {
      mesesDesdeInstalacion: meses,
      mesesBase,
      odometro: km,
      kmBase,
      dentroDeMeses,
      dentroDeKm,
      cercaDelLimite: cerca,
      margenPct: margen,
      coincideConLaFormula: replicado === null ? null : replicado === unidad.Garantia_Vigente__c,
    },
    fuente: {
      origen: 'Asset.Garantia_Vigente__c',
      campos: [
        'Asset.Garantia_Vigente__c (fórmula)',
        'Parametros_Garantia__c.Meses_Base__c',
        'Parametros_Garantia__c.Km_Base__c',
        'Parametros_Garantia__c.Margen_Cerca_Limite_Pct__c',
      ],
      registro: parametros?.Id ?? null,
      articuloConocimiento: null,
      descripcion:
        'Campo fórmula del Asset. No hay artículo de conocimiento asociado: la regla vive en la fórmula.',
    },
  };
}

/**
 * Las DOS evaluaciones en paralelo, sin resolver el conflicto.
 *
 * Lo que este código NO hace, a propósito: elegir un ganador. Cuando la regla y la
 * fórmula difieren, `hayConflicto` queda en true y las dos fuentes viajan citadas.
 * La decisión es de negocio, no de la UI.
 */
export async function evaluarCobertura(
  assetId: string,
  principal?: Principal,
): Promise<EvaluacionCobertura> {
  if (!assetId || typeof assetId !== 'string') {
    throw new Error('evaluarCobertura exige un Id de Asset.');
  }

  const dondeAsset = [`Id = '${lit(assetId)}'`];
  aplicarAcceso(dondeAsset, principal, 'asset');
  const unidades = limpiar(
    await consultarTodo<UnidadCrudaCobertura>(
      `SELECT ${CAMPOS_UNIDAD}, Evaluacion_Vigente__c, Garantia_Extendida__c, Extendida_Aplicable__c,
              Estado_Garantia_Basica__c
       FROM Asset WHERE ${dondeAsset.join(' AND ')}`,
      'datos.evaluarCobertura.asset',
    ),
  );
  const cruda = unidades[0];
  if (!cruda) {
    if (principal?.role === 'cliente') throw new AccessDeniedError();
    // La consulta corrió y la org no tiene ese Asset. Es un hecho, no un fallo oculto.
    throw new Error(`No existe un Asset con Id "${assetId}" en la org.`);
  }
  const unidad: Unidad = {
    ...cruda,
    proveniencia: describirProveniencia(cruda.Procedencia__c, 'unidad'),
    historialOdometro: [],
  };

  const [reglas, parametros, catalogo] = await Promise.all([
    unidad.Product2Id
      ? consultarTodo<ReglaCobertura>(
          `SELECT ${CAMPOS_REGLA} FROM Regla_Cobertura__c
           WHERE Activa__c = true AND Modelo__c = '${lit(unidad.Product2Id)}'
           ORDER BY Sistema__c, Es_Extendida__c`,
          'datos.evaluarCobertura.reglas',
        ).then((r) => limpiar(r))
      : Promise.resolve([] as ReglaCobertura[]),
    leerParametros(),
    catalogoDePoliticas(),
  ]);

  const porFormula = construirVeredictoFormula(unidad, parametros);
  const advertencias: string[] = [];

  // ── Reglas agrupadas por sistema. Si la unidad tiene extendida aplicable se
  //    prefiere la regla extendida; si no, la básica. Ambas viajan en reglasDelSistema.
  const extendidaAplicable = Boolean(cruda.Extendida_Aplicable__c);
  const porSistemaMapa = new Map<string, ReglaCobertura[]>();
  for (const r of reglas) {
    const s = r.Sistema__c ?? '(sin sistema)';
    const acc = porSistemaMapa.get(s) ?? [];
    acc.push(r);
    porSistemaMapa.set(s, acc);
  }

  const porSistema: EvaluacionSistema[] = [];
  for (const [sistema, delSistema] of [...porSistemaMapa.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const elegida =
      delSistema.find((r) => r.Es_Extendida__c === extendidaAplicable) ?? delSistema[0] ?? null;

    const evaluada = elegida
      ? evaluarRegla(elegida, unidad.Meses_Desde_Instalacion__c, unidad.Odometro__c)
      : {
          veredicto: 'SIN_REGLA_PARA_EL_MODELO' as Veredicto,
          motivo: `No hay regla activa para el sistema ${sistema} en este modelo.`,
        };

    const porRegla: VeredictoPorRegla = {
      veredicto: evaluada.veredicto,
      motivo: evaluada.motivo,
      regla: elegida,
      reglasDelSistema: delSistema,
      fuente: {
        origen: 'Regla_Cobertura__c',
        campos: [
          'Regla_Cobertura__c.Meses_Limite__c',
          'Regla_Cobertura__c.Km_Limite__c',
          'Regla_Cobertura__c.Sin_Limite_Km__c',
          'Regla_Cobertura__c.Es_Extendida__c',
          'Regla_Cobertura__c.Knowledge_Article_Id__c',
        ],
        registro: elegida?.Name ?? null,
        articuloConocimiento: elegida?.Knowledge_Article_Id__c ?? null,
        descripcion: elegida
          ? `Regla ${elegida.Name} (${elegida.Es_Extendida__c ? 'extendida' : 'básica'}) para ${elegida.Modelo__r?.Name ?? 'modelo sin nombre'}.`
          : 'Sin regla aplicable.',
      },
    };

    const hayConflicto = porRegla.veredicto !== porFormula.veredicto;
    let tipoConflicto: EvaluacionSistema['tipoConflicto'] = null;
    if (hayConflicto) {
      if (porRegla.veredicto === 'SIN_REGLA_PARA_EL_MODELO') tipoConflicto = 'sin-regla';
      else if (porRegla.veredicto === 'REQUIERE_DATO') tipoConflicto = 'dato-faltante';
      else tipoConflicto = 'veredictos-opuestos';
    }

    porSistema.push({ sistema, porRegla, porFormula, hayConflicto, tipoConflicto });
  }

  const sinReglasParaElModelo = reglas.length === 0;
  if (sinReglasParaElModelo) {
    advertencias.push(
      `El modelo de esta unidad (Product2 ${unidad.Product2Id} · ${unidad.Product2?.Name ?? 'sin nombre'}) ` +
        `no tiene NINGUNA Regla_Cobertura__c activa. Las ${catalogo.totalReglasActivas} reglas activas de la org ` +
        `apuntan a otros modelos. Esto NO significa "sin cobertura": significa que el catálogo de reglas ` +
        `no cubre este modelo y no se puede emitir el veredicto por regla.`,
    );
  }

  const citable = unidad.Cobertura_Citable__c;
  if (citable === 'REQUIERE_DATO') {
    advertencias.push(
      'Asset.Cobertura_Citable__c = REQUIERE_DATO. El modelo dice que aún no hay dato suficiente ' +
        'para citar una cobertura. Se reporta tal cual: no es "no tienes cobertura".',
    );
  }
  if (!unidad.Dato_Odometro_Vigente__c) {
    advertencias.push(
      'Asset.Dato_Odometro_Vigente__c = false: el odómetro registrado está fuera de vigencia. ' +
        'Cualquier veredicto que dependa de km se apoya en un dato caduco.',
    );
  }
  if (!parametros) {
    advertencias.push('No hay registro en Parametros_Garantia__c: la base 24 meses/250,000 km no es verificable.');
  }

  const sistemasEnConflicto = porSistema.filter((s) => s.hayConflicto).map((s) => s.sistema);

  return {
    unidad,
    modelo: {
      Id: unidad.Product2Id,
      Name: unidad.Product2?.Name ?? null,
      ProductCode: unidad.Product2?.ProductCode ?? null,
      reglasActivas: reglas.length,
    },
    parametros,
    porSistema,
    sinReglasParaElModelo,
    porFormula,
    citabilidad: {
      valor: citable,
      esCitable: citable !== null && citable !== 'REQUIERE_DATO',
      datoOdometroVigente: unidad.Dato_Odometro_Vigente__c,
      evaluacionVigente: cruda.Evaluacion_Vigente__c ?? null,
      explicacion:
        citable === 'REQUIERE_DATO'
          ? 'REQUIERE_DATO — el modelo declara que falta dato para citar cobertura.'
          : `Cobertura_Citable__c = ${citable ?? 'null'}.`,
    },
    hayConflicto: sistemasEnConflicto.length > 0,
    sistemasEnConflicto,
    catalogoDePoliticas: catalogo,
    advertencias,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 · Traza por Correlation_Id__c
// ─────────────────────────────────────────────────────────────────────────────

export interface LogAgente {
  Id: string;
  Name: string;
  Correlation_Id__c: string | null;
  Timestamp__c: string | null;
  CreatedDate: string | null;
  Subagent__c: string | null;
  Action_Name__c: string | null;
  Outcome__c: string | null;
  Error_Code__c: string | null;
  Guardrail_Triggered__c: string | null;
  Related_Record_Id__c: string | null;
  Session_Key__c: string | null;
  Actor__c: string | null;
  Policy_Version__c: string | null;
  Odometer_Used__c: number | null;
  Odometer_Source__c: string | null;
  Unit_Verified__c: boolean;
  Knowledge_Article_Version_Id__c: string | null;
  WorkOrder__c: string | null;
  WorkOrder__r: { WorkOrderNumber: string | null; Status: string | null } | null;
  Case__c: string | null;
  Case__r: { CaseNumber: string | null; Status: string | null; Subject: string | null } | null;
  Unidad_Varada__c: string | null;
  Unidad_Varada__r: { Name: string | null; Estado__c: string | null } | null;
  Asset__c: string | null;
  Asset__r: { Name: string | null; SerialNumber: string | null } | null;
}

export interface CasoEscalado {
  Id: string;
  CaseNumber: string | null;
  Status: string | null;
  Origin: string | null;
  Subject: string | null;
  Priority: string | null;
  Correlation_Id__c: string | null;
  Politica_Aplicada__c: string | null;
  CreatedDate: string | null;
  Owner: { Name: string | null } | null;
  Asset__c: string | null;
  WorkOrder__c: string | null;
}

export interface Traza {
  correlationId: string;
  /** false = la consulta corrió y no hay nada con ese folio. No es un fallo. */
  existe: boolean;
  logs: LogAgente[];
  relacionados: {
    ordenes: Orden[];
    casos: CasoEscalado[];
    varadas: UnidadVarada[];
  };
  resumen: {
    totalLogs: number;
    subagentes: string[];
    acciones: string[];
    exitos: number;
    bloqueos: number;
    errores: number;
    noEncontrados: number;
    guardrailsDisparados: string[];
    primerTimestamp: string | null;
    ultimoTimestamp: string | null;
  };
}

export async function traza(correlationId: string): Promise<Traza> {
  if (!correlationId || typeof correlationId !== 'string') {
    throw new Error('traza exige un Correlation_Id__c.');
  }
  const cid = lit(correlationId);

  const [logs, ordenes, casos, varadas] = await Promise.all([
    consultarTodo<LogAgente>(
      `SELECT Id, Name, Correlation_Id__c, Timestamp__c, CreatedDate, Subagent__c, Action_Name__c,
              Outcome__c, Error_Code__c, Guardrail_Triggered__c, Related_Record_Id__c, Session_Key__c,
              Actor__c, Policy_Version__c, Odometer_Used__c, Odometer_Source__c, Unit_Verified__c,
              Knowledge_Article_Version_Id__c, WorkOrder__c, WorkOrder__r.WorkOrderNumber,
              WorkOrder__r.Status, Case__c, Case__r.CaseNumber, Case__r.Status, Case__r.Subject,
              Unidad_Varada__c, Unidad_Varada__r.Name, Unidad_Varada__r.Estado__c,
              Asset__c, Asset__r.Name, Asset__r.SerialNumber
       FROM Log_Agente__c WHERE Correlation_Id__c = '${cid}'
       ORDER BY Timestamp__c ASC NULLS LAST, CreatedDate ASC`,
      'datos.traza.logs',
    ).then((r) => limpiar(r)),
    listarOrdenes({ correlationId }).then((l) => l.registros),
    consultarTodo<CasoEscalado>(
      `SELECT Id, CaseNumber, Status, Origin, Subject, Priority, Correlation_Id__c,
              Politica_Aplicada__c, CreatedDate, Owner.Name, Asset__c, WorkOrder__c
       FROM Case WHERE Correlation_Id__c = '${cid}' ORDER BY CreatedDate ASC`,
      'datos.traza.casos',
    ).then((r) => limpiar(r)),
    listarUnidadesVaradas({ correlationId }).then((l) => l.registros),
  ]);

  const cuenta = (o: string) => logs.filter((l) => l.Outcome__c === o).length;
  const conValor = (vs: (string | null)[]) => [...new Set(vs.filter((v): v is string => Boolean(v)))];
  const marcas = logs.map((l) => l.Timestamp__c ?? l.CreatedDate).filter((t): t is string => Boolean(t));

  return {
    correlationId,
    existe: logs.length > 0 || ordenes.length > 0 || casos.length > 0 || varadas.length > 0,
    logs,
    relacionados: { ordenes, casos, varadas },
    resumen: {
      totalLogs: logs.length,
      subagentes: conValor(logs.map((l) => l.Subagent__c)),
      acciones: conValor(logs.map((l) => l.Action_Name__c)),
      exitos: cuenta('SUCCESS'),
      bloqueos: cuenta('BLOCKED'),
      errores: cuenta('ERROR'),
      noEncontrados: cuenta('NOT_FOUND'),
      guardrailsDisparados: conValor(logs.map((l) => l.Guardrail_Triggered__c)),
      primerTimestamp: marcas[0] ?? null,
      ultimoTimestamp: marcas[marcas.length - 1] ?? null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 · Folios recientes — puebla el selector de la vista de traza
// ─────────────────────────────────────────────────────────────────────────────

export interface FolioReciente {
  correlationId: string;
  ultimoTimestamp: string | null;
  primerTimestamp: string | null;
  totalLogs: number;
}

interface FilaAgregada {
  cid: string | null;
  ultimo: string | null;
  primero: string | null;
  total: number;
}

export async function foliosRecientes(limite = 20): Promise<Listado<FolioReciente>> {
  const n = limiteSeguro(limite, 20, 200);
  const filas = limpiar(
    await consultarTodo<FilaAgregada>(
      `SELECT Correlation_Id__c cid, MAX(Timestamp__c) ultimo, MIN(Timestamp__c) primero,
              COUNT(Id) total
       FROM Log_Agente__c WHERE Correlation_Id__c != null
       GROUP BY Correlation_Id__c
       ORDER BY MAX(Timestamp__c) DESC NULLS LAST
       LIMIT ${n}`,
      'datos.foliosRecientes',
    ),
  );

  const registros: FolioReciente[] = filas
    .filter((f) => Boolean(f.cid))
    .map((f) => ({
      correlationId: f.cid as string,
      ultimoTimestamp: f.ultimo,
      primerTimestamp: f.primero,
      totalLogs: Number(f.total ?? 0),
    }));

  return { total: registros.length, registros };
}
