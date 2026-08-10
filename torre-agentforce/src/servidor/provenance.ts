// Contrato único de procedencia para la Torre.
//
// Estos valores describen lo que sí sabemos. No convierten seed, horarios
// derivados ni transacciones del reto en datos de clientes confirmados.

import { BloqueoDePolitica } from './errores.ts';
import { consultar, lit } from './sf.ts';

export const PROCEDENCIA = Object.freeze({
  ASSET_SEED: 'SEED_SINTETICO_NO_VERIFICADO',
  SLOT_SITIO_CAPACIDAD_ASUMIDA: 'SITIO_WEB_CAPACIDAD_ASUMIDA',
  SLOT_OPERACIONAL: 'OPERACIONAL_VERIFICADO',
  TRANSACCION_PRUEBA: 'PRUEBA_TRANSACCIONAL_SIN_FUENTE_CONFIRMADA',
  TRANSACCION_FLUJO: 'TRANSACCIONAL_CAPTURADO_EN_FLUJO',
  SIN_CLASIFICAR: 'SIN_CLASIFICAR_NO_VERIFICADO',
} as const);

export interface Proveniencia {
  estado: string;
  verificada: boolean;
  aptaParaOperacion: boolean;
  advertencia: string | null;
}

type DominioProcedencia = 'unidad' | 'slot' | 'transaccion';

export function describirProveniencia(
  valor: string | null | undefined,
  dominio: DominioProcedencia,
): Proveniencia {
  const estado = String(valor ?? '').trim() || PROCEDENCIA.SIN_CLASIFICAR;
  const slotOperacional = dominio === 'slot' && estado === PROCEDENCIA.SLOT_OPERACIONAL;
  const verificada = slotOperacional;

  let advertencia: string | null;
  if (slotOperacional) {
    advertencia = null;
  } else if (dominio === 'slot') {
    advertencia =
      'Horario no agendable: su capacidad no tiene verificacion operacional.';
  } else if (dominio === 'unidad') {
    advertencia =
      'Unidad sintetica no verificada; no representa una unidad de cliente confirmada.';
  } else {
    advertencia =
      'Registro transaccional o de prueba; no acredita la existencia de un cliente confirmado.';
  }

  return Object.freeze({
    estado,
    verificada,
    aptaParaOperacion: slotOperacional,
    advertencia,
  });
}

export function esSlotOperacional(valor: string | null | undefined): boolean {
  return valor === PROCEDENCIA.SLOT_OPERACIONAL;
}

interface SlotProvenanceRecord {
  Id: string;
  Procedencia__c: string | null;
}

/**
 * Guardrail previo al Flow. Así una franja derivada se bloquea antes de cualquier
 * mutación, incluso si el VIN o el resto del payload también fueran inválidos.
 */
export async function exigirSlotOperacional(
  slotId: string | null,
  accion: string,
  correlationId: string,
): Promise<void> {
  if (!slotId) {
    throw new BloqueoDePolitica('SLOT_VERIFICADO_REQUERIDO', {
      accion,
      correlationId,
      mensajeAgente:
        'Selecciona una franja concreta con procedencia OPERACIONAL_VERIFICADO; no reservaré por fecha aproximada.',
    });
  }

  const respuesta = await consultar<SlotProvenanceRecord>(
    `SELECT Id, Procedencia__c FROM Slot_Taller__c WHERE Id = '${lit(slotId)}' LIMIT 1`,
    `${accion}.verificarProcedenciaSlot`,
  );
  const slot = respuesta.records[0];
  if (!slot) {
    throw new BloqueoDePolitica('SLOT_NO_ENCONTRADO', {
      accion,
      correlationId,
      mensajeAgente: 'La franja indicada no existe; vuelve a consultar la agenda.',
    });
  }
  if (!esSlotOperacional(slot.Procedencia__c)) {
    throw new BloqueoDePolitica('SLOT_NO_VERIFICADO', {
      accion,
      correlationId,
      mensajeAgente:
        `La franja tiene procedencia ${slot.Procedencia__c ?? PROCEDENCIA.SIN_CLASIFICAR}; ` +
        'su capacidad no está verificada operacionalmente y no puede reservarse.',
    });
  }
}
