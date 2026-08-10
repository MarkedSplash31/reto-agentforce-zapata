#!/usr/bin/env node
/**
 * El Metadata API exige que los hijos de <Flow> vengan agrupados por tipo y en el
 * orden del WSDL (que es alfabetico salvo apiVersion). Escribir el XML en orden
 * logico de lectura y reordenarlo aqui es mas facil de revisar en diff que
 * mantener a mano tres archivos de 900 lineas ya ordenados.
 *
 * Uso: node scripts/order-flow.js <archivo.flow-meta.xml> [...]
 */
'use strict';

const fs = require('fs');

// Orden del WSDL de Flow. Lo que no aparezca aqui va al final, en orden estable.
const ORDEN = [
  'apiVersion',
  'areMetricsLoggedToDataCloud',
  'actionCalls',
  'apexPluginCalls',
  'assignments',
  'choices',
  'collectionProcessors',
  'constants',
  'customErrors',
  'decisions',
  'description',
  'dynamicChoiceSets',
  'environments',
  'formulas',
  'interviewLabel',
  'isAdditionalPermissionRequiredToRun',
  'isTemplate',
  'label',
  'loops',
  'processMetadataValues',
  'processType',
  'recordCreates',
  'recordDeletes',
  'recordLookups',
  'recordRollbacks',
  'recordUpdates',
  'runInMode',
  'screens',
  'sourceTemplate',
  'stageSteps',
  'stages',
  'start',
  'status',
  'steps',
  'subflows',
  'textTemplates',
  'transforms',
  'triggerOrder',
  'variables',
  'waits',
];

/** Parte el cuerpo de <Flow> en bloques de primer nivel {tag, xml}. */
function partirEnBloques(cuerpo) {
  const lineas = cuerpo.split(/\r?\n/);
  const bloques = [];
  let actual = null;

  for (const linea of lineas) {
    if (actual) {
      actual.lineas.push(linea);
      if (new RegExp('^\\s*</' + actual.tag + '>\\s*$').test(linea)) {
        bloques.push({ tag: actual.tag, xml: actual.lineas.join('\n') });
        actual = null;
      }
      continue;
    }

    if (!linea.trim()) continue;

    const unaLinea = linea.match(/^\s*<([A-Za-z0-9_]+)>.*<\/\1>\s*$/);
    if (unaLinea) {
      bloques.push({ tag: unaLinea[1], xml: linea });
      continue;
    }

    const apertura = linea.match(/^\s*<([A-Za-z0-9_]+)>\s*$/);
    if (apertura) {
      actual = { tag: apertura[1], lineas: [linea] };
      continue;
    }

    throw new Error('Linea de primer nivel que no se pudo interpretar: ' + linea);
  }

  if (actual) throw new Error('Bloque <' + actual.tag + '> sin cerrar');
  return bloques;
}

function ordenar(ruta) {
  const original = fs.readFileSync(ruta, 'utf8');
  const m = original.match(/^([\s\S]*?<Flow[^>]*>\r?\n)([\s\S]*?)(<\/Flow>\s*)$/);
  if (!m) throw new Error('No parece un .flow-meta.xml: ' + ruta);

  const [, encabezado, cuerpo, cierre] = m;
  const bloques = partirEnBloques(cuerpo);

  const indice = (t) => {
    const i = ORDEN.indexOf(t);
    return i === -1 ? ORDEN.length : i;
  };
  // sort estable en Node >=11, asi que los bloques del mismo tipo conservan su orden.
  bloques.sort((a, b) => indice(a.tag) - indice(b.tag));

  const salida = encabezado + bloques.map((b) => b.xml).join('\n') + '\n' + cierre;
  if (salida !== original) {
    fs.writeFileSync(ruta, salida);
    console.log('ordenado  ' + ruta + '  (' + bloques.length + ' bloques)');
  } else {
    console.log('sin cambios ' + ruta);
  }
}

const archivos = process.argv.slice(2);
if (!archivos.length) {
  console.error('Uso: node scripts/order-flow.js <archivo.flow-meta.xml> [...]');
  process.exit(1);
}
archivos.forEach(ordenar);
