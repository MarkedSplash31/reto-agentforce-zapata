// Corrige una contradicción INTERNA de la semilla sintética, no inventa datos.
//
// El problema, medido contra la org el 6-ago-2026:
//   · los 15 Asset apuntaban al producto «Tractocamion Clase 8 - Serie T680» (Kenworth)
//   · los 9 talleres sólo declaran cobertura de cuatro familias Freightliner
//   · resultado: la intersección era vacía y NINGUNA unidad podía agendar en ningún
//     taller. La compuerta MODELO_NO_ATENDIDO se disparaba siempre, así que no
//     demostraba nada.
//
// Seis de esos VIN son Freightliner por su propio WMI: `1FUJ…` y `3AKJ…`. O sea, la
// semilla se contradice a sí misma: el VIN dice Freightliner y el producto dice
// Kenworth. Este script hace ganar al dato más específico —el VIN— y reapunta esas
// seis unidades al modelo que su propio número de serie indica.
//
// Lo que este script NO hace, a propósito:
//   · no toca las otras nueve unidades (WMI Hino, Kenworth y Volvo). Que un taller
//     Freightliner no las atienda es una respuesta correcta, y conviene poder
//     demostrarla.
//   · no crea cobertura de taller que nadie confirmó.
//   · no toca `Regla_Cobertura__c`: la póliza es una decisión de negocio/legal.
//   · no cambia `Procedencia__c`. Siguen siendo SEED_SINTETICO_NO_VERIFICADO: esto
//     vuelve la semilla coherente, no la vuelve real.
//
// Uso:  node scripts/corregir-semilla-modelos.mjs            (sólo reporta)
//       CONFIRMAR=1 node scripts/corregir-semilla-modelos.mjs (escribe en la org)

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALIAS = process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
const ESCRIBIR = process.env.CONFIRMAR === '1';
const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** WMI Freightliner → el modelo del catálogo que le corresponde. */
const POR_WMI = [
  { prefijo: '1FUJ', productCode: 'FL-CASCADIA', razon: 'WMI 1FU = Freightliner; patrón JGLDR de Cascadia' },
  { prefijo: '3AKJ', productCode: 'FL-CASCADIA', razon: 'WMI 3AK = Freightliner (planta Saltillo); patrón JHHDR de Cascadia' },
];

function sf(args) {
  const entorno = { ...process.env };
  delete entorno.SF_API_VERSION;
  delete entorno.SF_ORG_API_VERSION;
  const salida = execFileSync('sf', args, {
    encoding: 'utf8',
    shell: true,
    env: entorno,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(salida.slice(salida.indexOf('{')));
}

function soql(consulta) {
  return sf(['data', 'query', '-o', ALIAS, '--json', '--api-version', '67.0', '-q', `"${consulta}"`]).result;
}

const productos = soql('SELECT Id, ProductCode FROM Product2 WHERE IsActive = true');
const idPorCodigo = new Map(productos.records.map((p) => [p.ProductCode, p.Id]));

const unidades = soql(
  'SELECT Id, Name, SerialNumber, Procedencia__c, Product2.ProductCode ' +
    'FROM Asset ORDER BY Name',
);

const cambios = [];
const intactas = [];
for (const a of unidades.records) {
  const vin = String(a.SerialNumber ?? '');
  const regla = POR_WMI.find((r) => vin.startsWith(r.prefijo));
  const actual = a.Product2?.ProductCode ?? null;
  if (!regla) {
    intactas.push({ unidad: a.Name, vin, modelo: actual, motivo: 'WMI no Freightliner; se deja como está' });
    continue;
  }
  if (actual === regla.productCode) {
    intactas.push({ unidad: a.Name, vin, modelo: actual, motivo: 'ya coincide con su VIN' });
    continue;
  }
  const destino = idPorCodigo.get(regla.productCode);
  if (!destino) {
    throw new Error(`El catálogo no tiene el producto ${regla.productCode}; no se inventa.`);
  }
  cambios.push({ id: a.Id, unidad: a.Name, vin, de: actual, a: regla.productCode, productoId: destino, razon: regla.razon });
}

console.log(`\nUnidades que se reapuntan: ${cambios.length}`);
for (const c of cambios) console.log(`  ${c.unidad}  ${c.vin}  ${c.de} → ${c.a}   (${c.razon})`);
console.log(`\nUnidades que NO se tocan: ${intactas.length}`);
for (const i of intactas) console.log(`  ${i.unidad}  ${i.vin}  ${i.modelo}   (${i.motivo})`);

if (!ESCRIBIR) {
  console.log('\nSimulación. Para escribir en la org: CONFIRMAR=1 node scripts/corregir-semilla-modelos.mjs');
  process.exit(0);
}

const aplicados = [];
for (const c of cambios) {
  sf([
    'data', 'update', 'record', '-o', ALIAS, '--json',
    '-s', 'Asset', '-i', c.id, '-v', `"Product2Id=${c.productoId}"`,
  ]);
  aplicados.push(c);
  console.log(`  actualizado ${c.unidad}`);
}

// Se relee de la org: lo que cuenta no es lo que respondió el update.
const releido = soql(
  'SELECT Name, SerialNumber, Procedencia__c, Product2.ProductCode FROM Asset ORDER BY Name',
);

const dir = join(process.cwd(), 'evidencia', '20-semilla-modelos');
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, `correccion.${ts}.json`),
  JSON.stringify(
    {
      ts,
      motivo: 'La semilla se contradecía: VIN Freightliner con producto Kenworth T680.',
      regla: POR_WMI,
      aplicados: aplicados.map(({ productoId, ...r }) => r),
      intactas,
      releidoDeLaOrg: releido.records.map((a) => ({
        unidad: a.Name,
        vin: a.SerialNumber,
        modelo: a.Product2?.ProductCode ?? null,
        procedencia: a.Procedencia__c,
      })),
      nota: 'Siguen siendo SEED_SINTETICO_NO_VERIFICADO. Esto vuelve la semilla coherente, no la vuelve real.',
    },
    null,
    1,
  ),
);
console.log(`\nEvidencia en evidencia/20-semilla-modelos/correccion.${ts}.json`);
