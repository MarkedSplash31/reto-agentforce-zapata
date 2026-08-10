// Verificación del nodo N5 — src/servidor/flows.ts contra la org REAL.
//
// No hay mocks. Cada paso invoca un Flow de verdad, vuelve a leer de la org lo que
// quedó escrito y guarda la salida cruda en evidencia/09-flows/. Si un paso falla, se
// imprime la causa real y el script termina en rojo.
//
// Lo que prueba, en orden:
//   0. hay un Slot_Taller__c real disponible  (precondición para tocar la agenda)
//   1. crearReporteUnidadVarada escribe de verdad
//   2. la relectura independiente por SOQL encuentra el reporte y su log
//   3. registrarLogAgente sobrevive a la validation rule Error_Requiere_Codigo
//   4. crearOrdenServicio es idempotente: dos llamadas iguales, una sola orden
//   5. varMotivoBloqueo sale como BloqueoDePolitica, no como error
//
// Uso:  node --experimental-strip-types scripts/prueba-flows.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { consultar } from '../src/servidor/sf.ts';
import { configSegura } from '../src/servidor/config.ts';
import { BloqueoDePolitica, ErrorSalesforce } from '../src/servidor/errores.ts';
import {
  claveIdempotencia,
  crearOrdenServicio,
  crearReporteUnidadVarada,
  leerLogsDeCorrelation,
  registrarLogAgente,
} from '../src/servidor/flows.ts';

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '09-flows');
mkdirSync(dir, { recursive: true });

const CORRELATION_VARADA = `TORRE-N5-${ts}`;
const CORRELATION_ORDEN = `TORRE-N5-${ts}-ORD`;
const CORRELATION_LOG = `TORRE-N5-${ts}-LOG`;
const CORRELATION_BLOQUEO = `TORRE-N5-${ts}-BLQ`;

// VIN real de Unidad 101 (Asset.SerialNumber, confirmado por SOQL).
const VIN_REAL = '3HAMMAAR8LL123456';
// 17 caracteres válidos que no existen en ningún Asset: sirve para provocar el guardrail.
const VIN_INEXISTENTE = 'XXXXXXXXXXXXXXXXX';

const evidencia: Record<string, unknown> = { ts, config: configSegura() };
const pasos: { paso: string; ok: boolean; detalle: string }[] = [];
let fallos = 0;

function marcar(paso: string, ok: boolean, detalle: string) {
  pasos.push({ paso, ok, detalle });
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${paso.padEnd(34)} ${detalle}`);
}

/** Describe cualquier fallo sin perder la causa. Nunca se traga nada. */
function describir(e: unknown): string {
  if (e instanceof BloqueoDePolitica) return `BLOQUEO ${e.motivo}`;
  if (e instanceof ErrorSalesforce) return `${e.message} :: ${JSON.stringify(e.detalle.cuerpo)}`;
  return e instanceof Error ? e.message : String(e);
}

function volcar(nombre: string, datos: unknown) {
  evidencia[nombre] = datos;
  writeFileSync(join(dir, `${nombre}.${ts}.json`), JSON.stringify(datos, null, 1));
}

async function contar(objeto: string): Promise<number> {
  const r = await consultar(`SELECT COUNT() FROM ${objeto}`, `prueba.contar.${objeto}`);
  return r.totalSize;
}

console.log(`Torre Agentforce · N5 flows — ${ts}`);
console.log(`Proveedor de token: ${configSegura().proveedorToken}`);
console.log(`Correlation de varada: ${CORRELATION_VARADA}\n`);

// ─────────────────────────────────────────────────────────────────────────────
// Paso 0 · Slots reales y agendables. No basta con Disponible__c: las 9 sucursales
//          exigen Anticipacion_Minima_Horas__c = 24, y una franja de mañana rebota
//          con ANTICIPACION_INSUFICIENTE. La primera versión de esta prueba pedía la
//          franja más próxima y el guardrail la rechazó, con razón. El umbral se
//          calcula aquí a partir del dato real, no de un número inventado.
// ─────────────────────────────────────────────────────────────────────────────

interface SlotReal {
  Id: string;
  Name: string;
  Inicio__c: string;
  Fin__c: string;
  Tipo_Servicio__c: string;
  Cupos_Libres__c: number;
  Disponible__c: boolean;
  Sucursal__r: { Name: string; Codigo_Sucursal__c: string; Anticipacion_Minima_Horas__c: number };
}

/** Margen sobre la anticipación mínima. Cubre el +6h que los Flows llevan dentro. */
const MARGEN_HORAS = 24;

let slot: SlotReal | undefined;
let slotAlterno: SlotReal | undefined;
try {
  const anticipacion = await consultar<{ Codigo_Sucursal__c: string; Anticipacion_Minima_Horas__c: number }>(
    `SELECT Codigo_Sucursal__c, Anticipacion_Minima_Horas__c FROM Sucursal__c WHERE Activa__c = true`,
    'prueba.anticipacion-sucursal',
  );
  const maxHoras = anticipacion.records.reduce(
    (m, s) => Math.max(m, s.Anticipacion_Minima_Horas__c ?? 0),
    0,
  );
  const umbral = new Date(Date.now() + (maxHoras + MARGEN_HORAS) * 3600 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');

  const r = await consultar<SlotReal>(
    `SELECT Id, Name, Inicio__c, Fin__c, Tipo_Servicio__c, Cupos_Libres__c, Disponible__c,
            Sucursal__r.Name, Sucursal__r.Codigo_Sucursal__c, Sucursal__r.Anticipacion_Minima_Horas__c
     FROM Slot_Taller__c
     WHERE Disponible__c = true AND Inicio__c > ${umbral}
     ORDER BY Inicio__c LIMIT 25`,
    'prueba.slot-agendable',
  );
  slot = r.records[0];
  // Franja de la MISMA sucursal en otro día: destino para probar la reprogramación.
  slotAlterno = r.records.find(
    (s) =>
      slot !== undefined &&
      s.Id !== slot.Id &&
      s.Sucursal__r?.Codigo_Sucursal__c === slot.Sucursal__r?.Codigo_Sucursal__c,
  );

  volcar('00-slot-agendable', { maxHoras, margenHoras: MARGEN_HORAS, umbral, consulta: r });

  if (!slot) {
    marcar(
      '0 slot agendable',
      false,
      `no hay franja libre más allá de ${maxHoras + MARGEN_HORAS} h: no se puede agendar`,
    );
  } else {
    marcar(
      '0 slot agendable',
      true,
      `${slot.Name} · ${slot.Tipo_Servicio__c} · ${slot.Sucursal__r?.Codigo_Sucursal__c} · ` +
        `cupos ${slot.Cupos_Libres__c} · inicio ${slot.Inicio__c} (UTC crudo, sin compensar) · ` +
        `anticipación mínima ${maxHoras} h`,
    );
  }
} catch (e) {
  marcar('0 slot agendable', false, describir(e));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 · crearReporteUnidadVarada — la escritura que pide el nodo
// ─────────────────────────────────────────────────────────────────────────────

let folioVarada: string | null = null;
let idVarada: string | null = null;

try {
  const varadasAntes = await contar('Unidad_Varada__c');
  const r = await crearReporteUnidadVarada({
    vin: VIN_REAL,
    carretera: 'Mexico-Queretaro 57D',
    kilometro: 128,
    sentido: 'Norte',
    referencia: 'Caseta Palmillas, acotamiento derecho',
    descripcionFalla:
      'Perdida de potencia y humo blanco por el escape. La unidad no levanta presion de aire.',
    codigosTablero: 'SPN 3251 FMI 2, luz ambar de motor',
    carga: 'Cargada',
    fueraDeCarril: true,
    intermitentes: true,
    sucursalClave: 'FL-QRO',
    correlationId: CORRELATION_VARADA,
    sessionKey: CORRELATION_VARADA,
  });
  const varadasDespues = await contar('Unidad_Varada__c');

  folioVarada = r.folio;
  idVarada = r.varada.Id;
  volcar('01-crear-varada', { ...r, varadasAntes, varadasDespues });

  marcar(
    '1 crearReporteUnidadVarada',
    r.reportada && varadasDespues === varadasAntes + 1,
    `folio ${r.folio} · id ${r.varada.Id} · Estado=${r.varada.Estado__c} · ` +
      `Prioridad=${r.varada.Prioridad__c} · unidad=${r.varada.Asset__r?.Name ?? 'sin empatar'} · ` +
      `Unidad_Varada__c ${varadasAntes} → ${varadasDespues}`,
  );

  marcar(
    '1b relectura dentro del alta',
    r.varada.Correlation_Id__c === CORRELATION_VARADA &&
      r.varada.Carretera__c === 'Mexico-Queretaro 57D' &&
      r.varada.Kilometro__c === 128 &&
      r.varada.Fuera_De_Carril__c === true &&
      r.varada.Intermitentes_Encendidas__c === true,
    `el registro releído trae los datos que se mandaron (km=${r.varada.Kilometro__c}, ` +
      `fueraDeCarril=${r.varada.Fuera_De_Carril__c}, intermitentes=${r.varada.Intermitentes_Encendidas__c})`,
  );

  marcar(
    '1c log escrito por el Flow',
    r.logs.length > 0 && r.logs.every((l) => l.Correlation_Id__c === CORRELATION_VARADA),
    r.logs.map((l) => `${l.Name}/${l.Subagent__c}/${l.Outcome__c}`).join(' ') || 'sin logs',
  );
} catch (e) {
  volcar('01-crear-varada-ERROR', { mensaje: describir(e) });
  marcar('1 crearReporteUnidadVarada', false, describir(e));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 · Relectura INDEPENDIENTE por SOQL. La del paso 1 la hizo el módulo;
//          ésta la hace el script, para que la evidencia no dependa de él.
// ─────────────────────────────────────────────────────────────────────────────

if (folioVarada) {
  try {
    const varada = await consultar(
      `SELECT Id, Name, Estado__c, Prioridad__c, Carretera__c, Kilometro__c, Sentido__c,
              Referencia_Ubicacion__c, Descripcion_Falla__c, Codigos_Falla_Tablero__c, Carga__c,
              Fuera_De_Carril__c, Intermitentes_Encendidas__c, VIN_Reportado__c, Asset__c,
              Asset__r.Name, Sucursal_Apoyo__r.Codigo_Sucursal__c, Correlation_Id__c,
              Fecha_Reporte__c, CreatedDate
       FROM Unidad_Varada__c WHERE Correlation_Id__c = '${CORRELATION_VARADA}'`,
      'prueba.releer.varada',
    );
    const logs = await consultar(
      `SELECT Id, Name, Action_Name__c, Actor__c, Subagent__c, Outcome__c, Error_Code__c,
              Guardrail_Triggered__c, Correlation_Id__c, Session_Key__c, Unidad_Varada__c,
              Unit_Verified__c, Timestamp__c
       FROM Log_Agente__c WHERE Correlation_Id__c = '${CORRELATION_VARADA}' ORDER BY CreatedDate`,
      'prueba.releer.log',
    );
    volcar('02-relectura-independiente', { varada, logs });

    const v = varada.records[0] as Record<string, unknown> | undefined;
    const l = logs.records[0] as Record<string, unknown> | undefined;
    marcar(
      '2 relectura SOQL independiente',
      varada.totalSize === 1 && logs.totalSize >= 1 && l?.Unidad_Varada__c === idVarada,
      `Unidad_Varada__c=${v?.Name} · Log_Agente__c=${l?.Name} · ` +
        `el log apunta al reporte: ${l?.Unidad_Varada__c === idVarada}`,
    );
  } catch (e) {
    marcar('2 relectura SOQL independiente', false, describir(e));
  }
} else {
  marcar('2 relectura SOQL independiente', false, 'sin folio del paso 1, no hay qué releer');
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 · Error_Requiere_Codigo. Se manda BLOCKED sin código a propósito: si el
//          módulo no supliera el guardrail, la validation rule rebotaría y el log
//          se perdería justo cuando más falta hace.
// ─────────────────────────────────────────────────────────────────────────────

try {
  const r = await registrarLogAgente({
    accion: 'Prueba_N5_Validation_Rule',
    correlationId: CORRELATION_LOG,
    subagente: 'Varada',
    outcome: 'BLOCKED',
    sessionKey: CORRELATION_LOG,
    relatedRecordId: idVarada,
  });
  volcar('03-log-blocked-sin-codigo', r);
  marcar(
    '3 Error_Requiere_Codigo',
    r.log.Outcome__c === 'BLOCKED' &&
      (r.log.Guardrail_Triggered__c !== null || r.log.Error_Code__c !== null),
    `${r.log.Name} · Outcome=${r.log.Outcome__c} · Guardrail=${r.log.Guardrail_Triggered__c} · ` +
      `código suplido por el módulo: ${r.codigoSuplido}`,
  );
} catch (e) {
  volcar('03-log-blocked-sin-codigo-ERROR', { mensaje: describir(e) });
  marcar('3 Error_Requiere_Codigo', false, describir(e));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 · Idempotencia. Dos llamadas idénticas sobre un slot REAL leído en el
//          paso 0. La segunda no debe crear una segunda orden.
// ─────────────────────────────────────────────────────────────────────────────

if (slot) {
  try {
    const clave = claveIdempotencia(CORRELATION_ORDEN);
    const ordenesAntes = await contar('WorkOrder');

    const entrada = {
      vin: VIN_REAL,
      slotId: slot.Id,
      sintoma: 'Ruido metalico en frenada y vibracion en el volante a mas de 80 km/h.',
      correlationId: CORRELATION_ORDEN,
      sessionKey: CORRELATION_ORDEN,
    };

    const primera = await crearOrdenServicio(entrada);
    const tras1 = await contar('WorkOrder');
    // Doble clic: misma entrada, misma clave derivada.
    const segunda = await crearOrdenServicio(entrada);
    const tras2 = await contar('WorkOrder');

    volcar('04-orden-idempotencia', {
      slot,
      claveEsperada: clave,
      primera,
      segunda,
      conteos: { ordenesAntes, tras1, tras2 },
    });

    marcar(
      '4 crearOrdenServicio',
      primera.creada && primera.orden.WorkOrderNumber === primera.folio,
      `folio ${primera.folio} · StartDate ${primera.orden.StartDate} (UTC crudo) · ` +
        `slot ${primera.orden.Slot_Taller__r?.Name} · ` +
        `sucursal ${primera.orden.Sucursal__r?.Codigo_Sucursal__c} · cita "${primera.citaTexto}"`,
    );

    marcar(
      '4b clave determinista',
      primera.idempotencyKey === clave && primera.idempotenciaConfirmada,
      `Idempotency_Key__c = ${primera.orden.Idempotency_Key__c} (esperada ${clave})`,
    );

    marcar(
      '4c doble clic no duplica',
      segunda.folio === primera.folio && tras2 === tras1,
      `segunda llamada devolvió ${segunda.folio} · WorkOrder ${ordenesAntes} → ${tras1} → ${tras2}`,
    );
  } catch (e) {
    volcar('04-orden-idempotencia-ERROR', { mensaje: describir(e) });
    marcar('4 crearOrdenServicio', false, describir(e));
  }
} else {
  marcar('4 crearOrdenServicio', false, 'sin slot real disponible no se prueba la agenda');
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 · Guardrail. Un VIN que no existe debe salir como BloqueoDePolitica,
//          no como ErrorSalesforce. Es la diferencia entre la app rota y la app
//          haciendo su trabajo.
// ─────────────────────────────────────────────────────────────────────────────

try {
  const r = await crearOrdenServicio({
    vin: VIN_INEXISTENTE,
    sucursalClave: 'FL-QRO',
    sintoma: 'Prueba de guardrail del nodo N5: VIN inexistente.',
    correlationId: CORRELATION_BLOQUEO,
    sessionKey: CORRELATION_BLOQUEO,
  });
  volcar('05-guardrail-vin-inexistente', { inesperado: true, resultado: r });
  marcar(
    '5 guardrail VIN inexistente',
    false,
    `se esperaba un bloqueo y el Flow creó la orden ${r.folio}`,
  );
} catch (e) {
  if (e instanceof BloqueoDePolitica) {
    const logs = await leerLogsDeCorrelation(CORRELATION_BLOQUEO);
    volcar('05-guardrail-vin-inexistente', { bloqueo: e.aJSON(), logs });
    marcar(
      '5 guardrail VIN inexistente',
      true,
      `BloqueoDePolitica motivo=${e.motivo} · logs del hilo: ` +
        (logs.map((l) => `${l.Name}/${l.Outcome__c}/${l.Guardrail_Triggered__c}`).join(' ') ||
          'ninguno'),
    );
  } else {
    volcar('05-guardrail-vin-inexistente-ERROR', { mensaje: describir(e) });
    marcar(
      '5 guardrail VIN inexistente',
      false,
      `salió como ${e instanceof Error ? e.name : typeof e} en vez de BloqueoDePolitica: ${describir(e)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────

evidencia.pasos = pasos;
evidencia.fallos = fallos;
evidencia.folioVarada = folioVarada;
writeFileSync(join(dir, `prueba-flows.${ts}.json`), JSON.stringify(evidencia, null, 1));

console.log(`\nFolio de varada creado: ${folioVarada ?? 'ninguno'}`);
console.log(`${fallos === 0 ? 'VERDE' : 'ROJO'} — ${pasos.length - fallos}/${pasos.length} pasos`);
console.log(`Evidencia cruda en evidencia/09-flows/prueba-flows.${ts}.json`);
process.exit(fallos === 0 ? 0 : 1);
