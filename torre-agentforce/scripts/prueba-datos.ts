// Ejercita las 8 funciones de src/servidor/datos.ts contra la org REAL.
// Imprime conteos y un registro de muestra de cada una, y deja la salida cruda en
// evidencia/08-datos/.
//
// No hay fixtures ni mocks: si la org no responde, este script falla con la causa real.
//
// Correr:  node --experimental-strip-types scripts/prueba-datos.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configSegura } from '../src/servidor/config.ts';
import { proveedorDeToken } from '../src/servidor/auth.ts';
import {
  listarUnidades,
  listarUnidadesVaradas,
  listarSlots,
  listarOrdenes,
  listarSucursales,
  evaluarCobertura,
  traza,
  foliosRecientes,
  catalogoDePoliticas,
} from '../src/servidor/datos.ts';

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '08-datos');
mkdirSync(dir, { recursive: true });

const salida: Record<string, unknown> = { sello: ts, config: configSegura() };
let fallos = 0;

function guardar(nombre: string, valor: unknown) {
  writeFileSync(join(dir, `${nombre}.${ts}.json`), JSON.stringify(valor, null, 2), 'utf8');
}

function muestra(valor: unknown): string {
  return JSON.stringify(valor, null, 2).split('\n').slice(0, 40).join('\n');
}

async function paso<T>(nombre: string, fn: () => Promise<T>): Promise<T | null> {
  console.log(`\n${'='.repeat(78)}\n${nombre}\n${'='.repeat(78)}`);
  try {
    const r = await fn();
    salida[nombre] = r;
    guardar(nombre, r);
    return r;
  } catch (e) {
    fallos++;
    const detalle =
      e instanceof Error
        ? { mensaje: e.message, detalle: (e as { detalle?: unknown }).detalle ?? null }
        : { mensaje: String(e) };
    salida[nombre] = { ERROR: detalle };
    guardar(nombre, { ERROR: detalle });
    console.log(`FALLA ${nombre}: ${detalle.mensaje}`);
    if (detalle.detalle) console.log(JSON.stringify(detalle.detalle, null, 2).slice(0, 800));
    return null;
  }
}

console.log(`Proveedor de token: ${configSegura().proveedorToken}`);
const faltan = proveedorDeToken().requisitosFaltantes();
console.log(faltan.length ? `  faltan variables: ${faltan.join(', ')}` : '  sin requisitos pendientes');

// ── 1 · listarUnidades ───────────────────────────────────────────────────────
const unidades = await paso('1-listarUnidades', () => listarUnidades());
if (unidades) {
  console.log(`total = ${unidades.total}`);
  console.log(`nota  = ${unidades.nota ?? '(sin nota)'}`);
  console.log('muestra:\n' + muestra(unidades.registros[0]));
  const conHistorial = unidades.registros.filter((u) => u.historialOdometro.length > 0).length;
  console.log(`unidades con al menos una Lectura_Odometro__c: ${conHistorial} de ${unidades.total}`);
}

const unidadesFiltradas = await paso('1b-listarUnidades-filtrada', () =>
  listarUnidades({ estado: 'Installed', busqueda: '105' }),
);
if (unidadesFiltradas) {
  console.log(`total (estado=Installed, busqueda="105") = ${unidadesFiltradas.total}`);
  console.log(unidadesFiltradas.registros.map((u) => `${u.Name} · ${u.SerialNumber}`).join('\n'));
}

// ── 2 · listarUnidadesVaradas ────────────────────────────────────────────────
const varadas = await paso('2-listarUnidadesVaradas', () => listarUnidadesVaradas());
if (varadas) {
  console.log(`total = ${varadas.total}`);
  console.log('muestra:\n' + muestra(varadas.registros[0]));
  const porEstado = new Map<string, number>();
  for (const v of varadas.registros) {
    const k = v.Estado__c ?? '(null)';
    porEstado.set(k, (porEstado.get(k) ?? 0) + 1);
  }
  console.log('por estado: ' + [...porEstado].map(([k, v]) => `${k}=${v}`).join(' · '));
}

// ── 3 · listarSlots ──────────────────────────────────────────────────────────
const slots = await paso('3-listarSlots', () =>
  listarSlots({ desde: '2026-08-01', hasta: '2026-08-31' }),
);
if (slots) {
  console.log(`total (agosto 2026, todas las sucursales) = ${slots.total}`);
  console.log(`nota  = ${slots.nota}`);
  console.log('muestra:\n' + muestra(slots.registros[0]));
  const disponibles = slots.registros.filter((s) => s.Disponible__c).length;
  console.log(`disponibles = ${disponibles} · ocupados = ${slots.total - disponibles}`);
}

const slotsSucursal = await paso('3b-listarSlots-sucursal', async () => {
  const suc = await listarSucursales();
  const clave = suc.registros[0]?.Codigo_Sucursal__c;
  if (!clave) throw new Error('No hay sucursales activas con código para probar el filtro.');
  const r = await listarSlots({ desde: '2026-08-01', hasta: '2026-08-08' }, clave);
  return { claveUsada: clave, ...r };
});
if (slotsSucursal) {
  console.log(`total (1-8 ago, sucursal ${slotsSucursal.claveUsada}) = ${slotsSucursal.total}`);
}

// ── 4 · listarOrdenes ────────────────────────────────────────────────────────
const ordenes = await paso('4-listarOrdenes', () => listarOrdenes());
if (ordenes) {
  console.log(`total = ${ordenes.total}`);
  console.log('muestra:\n' + muestra(ordenes.registros[0]));
  const conFolio = ordenes.registros.filter((o) => o.Correlation_Id__c).length;
  console.log(`con Correlation_Id__c = ${conFolio} de ${ordenes.total}`);
}

// ── 5 · listarSucursales ─────────────────────────────────────────────────────
const sucursales = await paso('5-listarSucursales', () => listarSucursales());
if (sucursales) {
  console.log(`total activas = ${sucursales.total}`);
  console.log('muestra:\n' + muestra(sucursales.registros[0]));
  console.log(
    'códigos: ' + sucursales.registros.map((s) => s.Codigo_Sucursal__c ?? '(sin código)').join(', '),
  );
}

// ── 6 · evaluarCobertura — primera unidad de la org ──────────────────────────
// Las dos unidades que se comparan salen del padrón, no de un nombre escrito aquí:
// un literal ataba la prueba a una fila concreta de la semilla y la hacía fallar por
// un dato inexistente en cuanto alguien cargaba otra flota.
const u105 = await paso('6-evaluarCobertura-primera-unidad', async () => {
  const l = await listarUnidades({});
  const asset = l.registros[0];
  if (!asset) throw new Error('La org no tiene ninguna unidad registrada.');
  return evaluarCobertura(asset.Id);
});
if (u105) {
  console.log(`unidad          = ${u105.unidad.Name} · VIN ${u105.unidad.SerialNumber}`);
  console.log(
    `datos           = ${u105.unidad.Meses_Desde_Instalacion__c} meses · ${u105.unidad.Odometro__c} km`,
  );
  console.log(`modelo          = ${u105.modelo.Name} (${u105.modelo.Id}) · reglas activas: ${u105.modelo.reglasActivas}`);
  console.log(`porFormula      = ${u105.porFormula.veredicto} (Garantia_Vigente__c = ${u105.porFormula.garantiaVigente})`);
  console.log(`citabilidad     = ${u105.citabilidad.valor} · esCitable=${u105.citabilidad.esCitable}`);
  console.log(`sinReglasParaElModelo = ${u105.sinReglasParaElModelo}`);
  console.log(`hayConflicto    = ${u105.hayConflicto}  sistemas: [${u105.sistemasEnConflicto.join(', ')}]`);
  console.log('porSistema:');
  for (const s of u105.porSistema) {
    console.log(
      `  ${s.sistema.padEnd(26)} regla=${s.porRegla.veredicto.padEnd(24)} formula=${s.porFormula.veredicto.padEnd(13)} conflicto=${s.hayConflicto} (${s.tipoConflicto ?? '-'})`,
    );
  }
  console.log('advertencias:');
  for (const a of u105.advertencias) console.log('  - ' + a);
  console.log(
    `catálogo de políticas: ${u105.catalogoDePoliticas.totalReglasActivas} reglas activas · ` +
      `contradicción=${u105.catalogoDePoliticas.hayContradiccion} · ` +
      `sistemas que difieren de la base: [${u105.catalogoDePoliticas.sistemasQueDifieren.join(', ')}]`,
  );
}

// El catálogo de políticas por separado: es la contradicción a nivel política.
const catalogo = await paso('6b-catalogoDePoliticas', () => catalogoDePoliticas());
if (catalogo) {
  console.log(
    `parámetros base: ${catalogo.parametros?.Meses_Base__c} meses · ${catalogo.parametros?.Km_Base__c} km · margen ${catalogo.parametros?.Margen_Cerca_Limite_Pct__c}%`,
  );
  for (const e of catalogo.entradas) {
    console.log(
      `  ${e.sistema.padEnd(26)} ${String(e.mesesLimite).padStart(3)} meses · ${e.sinLimiteKm ? 'SIN LÍMITE KM' : String(e.kmLimite).padStart(9) + ' km'}` +
        `${e.esExtendida ? ' [extendida]' : ''}  difiere=${e.difiereDeLaBase}${e.detalleDiferencia ? ' (' + e.detalleDiferencia + ')' : ''}`,
    );
  }
}

// Cobertura de otra unidad, para ver que el veredicto por fórmula sí varía.
const u101 = await paso('6c-evaluarCobertura-otra-unidad', async () => {
  const l = await listarUnidades({});
  const asset = l.registros.find((r) => r.Id !== u105?.unidad.Id) ?? l.registros[1];
  if (!asset) throw new Error('La org sólo tiene una unidad: no hay con qué comparar.');
  return evaluarCobertura(asset.Id);
});
if (u101) {
  console.log(
    `${u101.unidad.Name}: ${u101.unidad.Meses_Desde_Instalacion__c} meses · ${u101.unidad.Odometro__c} km ` +
      `→ formula=${u101.porFormula.veredicto} · citable=${u101.citabilidad.valor} · hayConflicto=${u101.hayConflicto}`,
  );
}

// ── 8 · foliosRecientes (antes que traza, porque la alimenta) ────────────────
const folios = await paso('8-foliosRecientes', () => foliosRecientes(10));
if (folios) {
  console.log(`total = ${folios.total}`);
  for (const f of folios.registros) {
    console.log(`  ${f.correlationId.padEnd(40)} logs=${String(f.totalLogs).padStart(3)}  último=${f.ultimoTimestamp}`);
  }
}

// ── 7 · traza ────────────────────────────────────────────────────────────────
const folioElegido =
  folios?.registros.find((f) => f.totalLogs > 1)?.correlationId ??
  folios?.registros[0]?.correlationId ??
  null;

const t = await paso('7-traza', async () => {
  if (!folioElegido) throw new Error('No hay folios en Log_Agente__c para trazar.');
  return traza(folioElegido);
});
if (t) {
  console.log(`folio           = ${t.correlationId}`);
  console.log(`existe          = ${t.existe}`);
  console.log(`logs            = ${t.resumen.totalLogs}`);
  console.log(`subagentes      = [${t.resumen.subagentes.join(', ')}]`);
  console.log(`acciones        = [${t.resumen.acciones.join(', ')}]`);
  console.log(
    `outcomes        = SUCCESS ${t.resumen.exitos} · BLOCKED ${t.resumen.bloqueos} · ERROR ${t.resumen.errores} · NOT_FOUND ${t.resumen.noEncontrados}`,
  );
  console.log(`guardrails      = [${t.resumen.guardrailsDisparados.join(', ')}]`);
  console.log(
    `relacionados    = ordenes ${t.relacionados.ordenes.length} · casos ${t.relacionados.casos.length} · varadas ${t.relacionados.varadas.length}`,
  );
  console.log('primer log:\n' + muestra(t.logs[0]));
}

// Un folio inexistente: la consulta corre y devuelve existe=false. No es un fallo.
const tVacia = await paso('7b-traza-folio-inexistente', () =>
  traza('FOLIO-QUE-NO-EXISTE-20260805'),
);
if (tVacia) {
  console.log(
    `folio inexistente → existe=${tVacia.existe} · logs=${tVacia.resumen.totalLogs} ` +
      `(consulta OK, cero filas: se distingue de un fallo)`,
  );
}

// ── Resumen ──────────────────────────────────────────────────────────────────
guardar('00-resumen', salida);
console.log(`\n${'='.repeat(78)}`);
console.log('CONTEOS');
console.log(`  unidades (Asset)              ${unidades?.total ?? 'FALLA'}`);
console.log(`  varadas (Unidad_Varada__c)    ${varadas?.total ?? 'FALLA'}`);
console.log(`  slots agosto (Slot_Taller__c) ${slots?.total ?? 'FALLA'}`);
console.log(`  órdenes (WorkOrder)           ${ordenes?.total ?? 'FALLA'}`);
console.log(`  sucursales activas            ${sucursales?.total ?? 'FALLA'}`);
console.log(`  reglas activas del catálogo   ${catalogo?.totalReglasActivas ?? 'FALLA'}`);
console.log(`  folios distintos (top 10)     ${folios?.total ?? 'FALLA'}`);
console.log(`  logs del folio trazado        ${t?.resumen.totalLogs ?? 'FALLA'}`);
console.log(`\nEvidencia en ${dir}`);
console.log(fallos ? `\n${fallos} paso(s) fallaron.` : '\nTodos los pasos corrieron.');
process.exit(fallos ? 1 : 0);
