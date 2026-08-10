// Verificación del nodo N2 + N4 contra la org REAL.
// Compara contra los conteos que ya conocemos. Un conteo distinto es un fallo,
// no una sorpresa: significa que la consulta no está mirando lo que cree.
//
// Deja la salida cruda en evidencia/07-verificacion/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { consultar } from '../src/servidor/sf.ts';
import { proveedorDeToken } from '../src/servidor/auth.ts';
import { configSegura } from '../src/servidor/config.ts';

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '07-verificacion');
mkdirSync(dir, { recursive: true });

// Catálogo: no cambia con la operación. Se exige el número EXACTO — si baja o sube,
// alguien tocó datos que la demo da por estables.
const CATALOGO: Record<string, number> = {
  Asset: 15,
  Slot_Taller__c: 729,
  Sucursal__c: 9,
  Modelo_Sucursal__c: 180,
  Regla_Cobertura__c: 36,
};

// Operación: crece cada vez que el agente o la Torre actúan. Se exige un MÍNIMO.
// Exigir el número exacto aquí sería una prueba que se rompe sola en cuanto la app
// funciona — y una prueba así se arregla, no se ignora.
const OPERACION: Record<string, number> = {
  Unidad_Varada__c: 27,
  WorkOrder: 29,
  Log_Agente__c: 99,
};

const resultados: Record<string, unknown> = {};
let fallos = 0;

console.log(`Proveedor de token: ${configSegura().proveedorToken}`);
const faltan = proveedorDeToken().requisitosFaltantes();
if (faltan.length) {
  console.log(`  faltan variables: ${faltan.join(', ')}`);
}

async function contar(objeto: string, esperado: number, modo: 'exacto' | 'minimo') {
  try {
    const r = await consultar(`SELECT COUNT() FROM ${objeto}`, `verificar.${objeto}`);
    const ok = modo === 'exacto' ? r.totalSize === esperado : r.totalSize >= esperado;
    if (!ok) fallos++;
    resultados[objeto] = { modo, esperado, obtenido: r.totalSize, ok };
    const cmp = modo === 'exacto' ? `= ${esperado}` : `>= ${esperado}`;
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${objeto.padEnd(22)} ${cmp.padEnd(8)} obtenido ${r.totalSize}`);
  } catch (e) {
    fallos++;
    const msg = e instanceof Error ? e.message : String(e);
    resultados[objeto] = { modo, esperado, error: msg };
    console.log(`FALLA ${objeto.padEnd(22)} ${msg}`);
  }
}

console.log('\nCatálogo (exacto):');
for (const [objeto, esperado] of Object.entries(CATALOGO)) await contar(objeto, esperado, 'exacto');

console.log('\nOperación (mínimo, crece con la demo):');
for (const [objeto, esperado] of Object.entries(OPERACION)) await contar(objeto, esperado, 'minimo');

writeFileSync(
  join(dir, `verificar-datos.${ts}.json`),
  JSON.stringify({ ts, config: configSegura(), resultados, fallos }, null, 1),
);

console.log(`\n${fallos === 0 ? 'VERDE' : 'ROJO'} — evidencia en evidencia/07-verificacion/verificar-datos.${ts}.json`);
process.exit(fallos === 0 ? 0 : 1);
