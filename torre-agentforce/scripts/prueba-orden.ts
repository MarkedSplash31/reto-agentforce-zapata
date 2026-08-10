// Prueba del camino crítico: reservar una cita que cree un WorkOrder REAL.
// El intento previo chocó con el guardrail de anticipación mínima (24 h), que es
// correcto: aquí se elige un slot suficientemente adelantado para que proceda.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { consultarTodo } from '../src/servidor/sf.ts';
import { crearOrdenServicio, leerOrdenPorFolio } from '../src/servidor/flows.ts';
import { BloqueoDePolitica } from '../src/servidor/errores.ts';

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '13-orden');
mkdirSync(dir, { recursive: true });
const cid = `TORRE-ORDEN-${ts}`;

// Slot con hueco, al menos 3 días adelante para superar la anticipación mínima.
const desde = new Date(Date.now() + 3 * 864e5).toISOString();
const slots = await consultarTodo<{
  Id: string; Name: string; Inicio__c: string; Tipo_Servicio__c: string;
  Cupos_Libres__c: number; Capacidad_Usada__c: number;
  Sucursal__r: { Codigo_Sucursal__c: string } | null;
}>(
  `SELECT Id,Name,Inicio__c,Tipo_Servicio__c,Cupos_Libres__c,Capacidad_Usada__c,Sucursal__r.Codigo_Sucursal__c
   FROM Slot_Taller__c WHERE Disponible__c = true AND Inicio__c > ${desde}
   ORDER BY Inicio__c LIMIT 5`,
  'prueba.slots',
);
const slot = slots[0];
if (!slot) throw new Error('No hay slots disponibles a más de 3 días. Sin slot no hay reserva que probar.');
console.log(`Slot elegido: ${slot.Name} · ${slot.Inicio__c} · ${slot.Sucursal__r?.Codigo_Sucursal__c} · libres ${slot.Cupos_Libres__c} · usada ${slot.Capacidad_Usada__c}`);

const unidad = (await consultarTodo<{ SerialNumber: string }>(
  `SELECT SerialNumber FROM Asset WHERE SerialNumber != null ORDER BY Name LIMIT 1`, 'prueba.asset'))[0];
console.log(`VIN: ${unidad!.SerialNumber}`);

let resultado: unknown;
try {
  const r = await crearOrdenServicio({
    vin: unidad!.SerialNumber,
    slotId: slot.Id,
    sucursalClave: slot.Sucursal__r?.Codigo_Sucursal__c ?? '',
    fechaDeseada: slot.Inicio__c.slice(0, 10),
    tipoServicio: slot.Tipo_Servicio__c as never,
    sintoma: 'Verificacion de camino critico desde la Torre Agentforce',
    correlationId: cid,
    sessionKey: cid,
  });
  resultado = r;
  console.log(`\nCREADA: folio ${r.folio}`);
  console.log(`  mensaje: ${r.mensaje}`);

  // Relectura independiente: no basta con que el Flow diga que sí.
  const rel = await leerOrdenPorFolio(r.folio!);
  console.log(`  relectura: ${rel.WorkOrderNumber} · ${rel.Status} · asset ${rel.AssetId}`);

  const slotDespues = (await consultarTodo<{ Capacidad_Usada__c: number; Cupos_Libres__c: number }>(
    `SELECT Capacidad_Usada__c,Cupos_Libres__c FROM Slot_Taller__c WHERE Id='${slot.Id}'`, 'prueba.slot2'))[0];
  console.log(`  slot despues: usada ${slotDespues!.Capacidad_Usada__c} (antes ${slot.Capacidad_Usada__c}) · libres ${slotDespues!.Cupos_Libres__c}`);

  writeFileSync(join(dir, `orden-creada.${ts}.json`), JSON.stringify({ cid, slot, resultado: r, relectura: rel, slotDespues }, null, 1));
  console.log('\nVERDE — evidencia en evidencia/13-orden/');
} catch (e) {
  if (e instanceof BloqueoDePolitica) {
    console.log(`\nBLOQUEO DE POLITICA: ${e.motivo}`);
    console.log(`  ${e.detalle.mensajeAgente ?? ''}`);
    writeFileSync(join(dir, `orden-bloqueada.${ts}.json`), JSON.stringify(e.aJSON(), null, 1));
    process.exit(2);
  }
  throw e;
}
