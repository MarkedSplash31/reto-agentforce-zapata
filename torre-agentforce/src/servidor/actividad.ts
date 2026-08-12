// Qué hizo realmente el agente durante un turno.
//
// Por qué existe este módulo: la Agent API **no** dice qué acciones ejecutó. El
// contrato (docs/CONTRATO-AGENT-API.md §5) es explícito: `message.result` llega
// vacío y la secuencia de acciones sólo se obtiene con Export Session Tracing Data
// o con el Testing API. La app llevaba dos lecturas construidas sobre ese arreglo
// —el apoyo visual y la detección de escalamiento— y ninguna podía dispararse:
// iteraban una lista que Salesforce siempre entrega vacía.
//
// Comprobado el 11-ago-2026 contra la org: una conversación creó WorkOrder
// 00000055 y Case 00001116, y el navegador no pintó ni una sola tarjeta ni cambió
// de interlocutor. El agente había hecho las dos cosas.
//
// La fuente autoritativa de lo que pasó ya existe y es la que audita el reto:
// `Log_Agente__c`, que cada Flow y cada acción Apex escriben con el mismo
// `Correlation_Id__c` de la conversación. Este módulo lo relee. No adivina desde el
// texto de la respuesta: si el agente dice que agendó y no hay registro, aquí no
// aparece nada, que es exactamente lo que debe verse.

import { consultar, lit } from './sf.ts';

/** Una acción que el agente ejecutó, releída de la org. */
export interface ActividadAgente {
  /** Nombre del Log_Agente__c (LOG-000000NN). Sirve de llave estable. */
  folio: string;
  subagente: string | null;
  accion: string | null;
  resultado: string | null;
  /** Id del registro que la acción creó o tocó, si lo hubo. */
  registroId: string | null;
  creadoEn: string;
  /** Datos legibles del registro relacionado, cuando se pudo resolver. */
  detalle: DetalleActividad | null;
}

export type DetalleActividad =
  | { clase: 'orden'; folio: string; estado: string | null; inicio: string | null; sucursal: string | null; vin: string | null }
  | {
      clase: 'varada';
      folio: string;
      carretera: string | null;
      kilometro: number | null;
      prioridad: string | null;
      /**
       * Las dos respuestas de seguridad, tal como quedaron registradas.
       *
       * Se enseñan porque el agente las pierde a veces: la misma conversación, dicha
       * igual, dejó `true/true` en una corrida y `false/false` en la siguiente. Quien
       * lee el reporte para mandar auxilio necesita saber si la unidad está fuera del
       * carril; que el dato se pierda en silencio es lo peligroso. Enseñárselo al
       * cliente es lo único que permite que lo corrija.
       */
      fueraDeCarril: boolean | null;
      intermitentes: boolean | null;
    }
  | { clase: 'caso'; folio: string; estado: string | null; asunto: string | null };

interface FilaLog {
  Name: string;
  Subagent__c: string | null;
  Action_Name__c: string | null;
  Outcome__c: string | null;
  Related_Record_Id__c: string | null;
  CreatedDate: string;
}

const LIMITE_ACTIVIDAD = 25;

/**
 * Lee las acciones registradas para una conversación. `desdeFolio` permite pedir
 * sólo lo nuevo: se comparan folios porque son monotónicos y no dependen del reloj
 * del servidor, que puede ir por detrás del de la org.
 */
export async function actividadDeCorrelacion(
  correlationId: string,
  yaVistos: ReadonlySet<string> = new Set(),
): Promise<ActividadAgente[]> {
  const op = 'actividad.porCorrelacion';
  if (!correlationId) return [];

  const r = await consultar<FilaLog>(
    `SELECT Name, Subagent__c, Action_Name__c, Outcome__c, Related_Record_Id__c, CreatedDate ` +
      `FROM Log_Agente__c WHERE Correlation_Id__c = '${lit(correlationId)}' ` +
      `ORDER BY CreatedDate ASC LIMIT ${LIMITE_ACTIVIDAD}`,
    op,
  );

  const nuevas = r.records.filter((f) => !yaVistos.has(f.Name));
  if (!nuevas.length) return [];

  const detalles = await resolverDetalles(nuevas.map((f) => f.Related_Record_Id__c).filter(Boolean) as string[]);

  return nuevas.map((f) => ({
    folio: f.Name,
    subagente: f.Subagent__c,
    accion: f.Action_Name__c,
    resultado: f.Outcome__c,
    registroId: f.Related_Record_Id__c,
    creadoEn: f.CreatedDate,
    detalle: f.Related_Record_Id__c ? (detalles.get(f.Related_Record_Id__c) ?? null) : null,
  }));
}

/**
 * Resuelve los registros que las acciones crearon, agrupando por prefijo de Id.
 * Un fallo al resolver un detalle no invalida la actividad: se prefiere mostrar
 * «el agente ejecutó Crear_Orden_Servicio con resultado SUCCESS» sin folio antes
 * que ocultar que la acción ocurrió.
 */
async function resolverDetalles(ids: readonly string[]): Promise<Map<string, DetalleActividad>> {
  const mapa = new Map<string, DetalleActividad>();
  if (!ids.length) return mapa;

  const porPrefijo = (p: string) => ids.filter((id) => id.startsWith(p));
  const enLista = (lista: readonly string[]) => lista.map((id) => `'${lit(id)}'`).join(',');

  const ordenes = porPrefijo('0WO');
  const casos = porPrefijo('500');
  const varadas = ids.filter((id) => !id.startsWith('0WO') && !id.startsWith('500'));

  await Promise.all([
    ordenes.length
      ? consultar<{
          Id: string;
          WorkOrderNumber: string;
          Status: string | null;
          StartDate: string | null;
          Sucursal__r: { Codigo_Sucursal__c: string } | null;
          Asset: { SerialNumber: string } | null;
        }>(
          `SELECT Id, WorkOrderNumber, Status, StartDate, Sucursal__r.Codigo_Sucursal__c, Asset.SerialNumber ` +
            `FROM WorkOrder WHERE Id IN (${enLista(ordenes)})`,
          'actividad.ordenes',
        )
          .then((r) => {
            for (const o of r.records) {
              mapa.set(o.Id, {
                clase: 'orden',
                folio: o.WorkOrderNumber,
                estado: o.Status,
                inicio: o.StartDate,
                sucursal: o.Sucursal__r?.Codigo_Sucursal__c ?? null,
                vin: o.Asset?.SerialNumber ?? null,
              });
            }
          })
          .catch(() => undefined)
      : undefined,

    casos.length
      ? consultar<{ Id: string; CaseNumber: string; Status: string | null; Subject: string | null }>(
          `SELECT Id, CaseNumber, Status, Subject FROM Case WHERE Id IN (${enLista(casos)})`,
          'actividad.casos',
        )
          .then((r) => {
            for (const c of r.records) {
              mapa.set(c.Id, { clase: 'caso', folio: c.CaseNumber, estado: c.Status, asunto: c.Subject });
            }
          })
          .catch(() => undefined)
      : undefined,

    varadas.length
      ? consultar<{
          Id: string;
          Name: string;
          Carretera__c: string | null;
          Kilometro__c: number | null;
          Prioridad__c: string | null;
          Fuera_De_Carril__c: boolean | null;
          Intermitentes_Encendidas__c: boolean | null;
        }>(
          `SELECT Id, Name, Carretera__c, Kilometro__c, Prioridad__c, ` +
            `Fuera_De_Carril__c, Intermitentes_Encendidas__c ` +
            `FROM Unidad_Varada__c WHERE Id IN (${enLista(varadas)})`,
          'actividad.varadas',
        )
          .then((r) => {
            for (const v of r.records) {
              mapa.set(v.Id, {
                clase: 'varada',
                folio: v.Name,
                carretera: v.Carretera__c,
                kilometro: v.Kilometro__c,
                prioridad: v.Prioridad__c,
                fueraDeCarril: v.Fuera_De_Carril__c,
                intermitentes: v.Intermitentes_Encendidas__c,
              });
            }
          })
          .catch(() => undefined)
      : undefined,
  ]);

  return mapa;
}
