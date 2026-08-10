// N9 · Diagramas de arquitectura GENERADOS desde la metadata real de la org.
//
// Nada aquí está dibujado a mano. Se recupera el bundle del planner activo y los
// Flows desde la org, se decodifica el grafo del agente y se derivan los nodos y
// aristas. Un diagrama que se desincroniza de la realidad es peor que no tenerlo:
// si la org cambia, este script cambia el diagrama.
//
// Uso: npm run diagramas

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ALIAS = process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
const RAIZ = process.cwd();
const TMP = join(RAIZ, '.metadata-org');
const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function sf(args: string[], cwd?: string): string {
  return execFileSync('sf', args, {
    encoding: 'utf8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
    ...(cwd ? { cwd } : {}),
  });
}

// ── 1. Qué versión del agente está activa, según la org ──────────────────────
interface FilaBotVersion {
  VersionNumber: number;
  Status: string;
}
const bv = JSON.parse(
  sf([
    'data', 'query', '-o', ALIAS, '--json', '-q',
    `"SELECT VersionNumber,Status FROM BotVersion WHERE BotDefinition.DeveloperName='Agente_Postventa_Zapata' ORDER BY VersionNumber"`,
  ]),
) as { result: { records: FilaBotVersion[] } };

const activa = bv.result.records.find((r) => r.Status === 'Active');
if (!activa) throw new Error('Ninguna versión del agente está activa en la org. El diagrama sería mentira.');
const versionActiva = `v${activa.VersionNumber}`;
console.log(`Versión activa según la org: ${versionActiva}`);

// ── 2. Traer el bundle y los flows desde la org ──────────────────────────────
// `sf project retrieve` exige estar dentro de un proyecto DX. La Torre no lo es
// (es una app web), así que se arma uno mínimo y desechable dentro de .metadata-org.
mkdirSync(join(TMP, 'force-app'), { recursive: true });
writeFileSync(
  join(TMP, 'sfdx-project.json'),
  JSON.stringify(
    {
      packageDirectories: [{ path: 'force-app', default: true }],
      namespace: '',
      sourceApiVersion: '67.0',
    },
    null,
    2,
  ),
);

const bundle = `Agente_Postventa_Zapata_${versionActiva}`;
console.log(`Recuperando ${bundle} y los Flows…`);
sf([
  'project', 'retrieve', 'start', '-o', ALIAS,
  '-m', `"GenAiPlannerBundle:${bundle}"`,
  '-m', '"Flow:Crear_Orden_Servicio"',
  '-m', '"Flow:Crear_Reporte_Unidad_Varada"',
  '-m', '"Flow:Reprogramar_Orden_Servicio"',
  '-m', '"Flow:Registrar_Log_Agente"',
  '--json',
], TMP);

// ── 3. Decodificar el grafo del agente ───────────────────────────────────────
function buscar(dir: string, coincide: (n: string) => boolean): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const r = buscar(p, coincide);
      if (r) return r;
    } else if (coincide(e.name)) return p;
  }
  return null;
}

const rutaGrafo = buscar(TMP, (n) => n.endsWith('_graph.json'));
if (!rutaGrafo) throw new Error('No se encontró el agentGraph en lo recuperado de la org.');

const crudo = readFileSync(rutaGrafo, 'utf8').trim();
// El grafo viene en base64 dentro del bundle.
const texto = /^[A-Za-z0-9+/=\s]+$/.test(crudo) && !crudo.startsWith('{')
  ? Buffer.from(crudo, 'base64').toString('utf8')
  : crudo;

interface Herramienta {
  name: string;
  target?: string;
  type?: string;
  description?: string;
  llmInputs?: string[];
}
interface NodoAgente {
  developerName: string;
  type: string;
  description?: string;
  tools?: Herramienta[];
}
const grafo = JSON.parse(texto) as {
  agentVersion: { developerName: string; initialNode: string; nodes: NodoAgente[] };
};

const nodos = grafo.agentVersion.nodes;

// Las acciones no se mantienen en una lista paralela: se descubren en el grafo
// activo y se recupera su GenAiFunction directamente de la org. Si una acción
// publicada no tiene metadata recuperable, el generador se detiene; no adivina
// qué backend podría ejecutar.
const accionesOrg = [
  ...new Set(
    nodos.flatMap((n) =>
      (n.tools ?? [])
        .filter((t) => t.type === 'action' && t.target && t.target !== '__state_update_action__')
        .map((t) => t.target!),
    ),
  ),
];

console.log(`Recuperando ${accionesOrg.length} GenAiFunctions descubiertas en el grafo activo…`);
for (const accion of accionesOrg) {
  sf([
    'project', 'retrieve', 'start', '-o', ALIAS,
    '-m', `"GenAiFunction:${accion}"`,
    '--json',
  ], TMP);
}

interface ImplementacionAccion {
  accion: string;
  tipo: string;
  destino: string;
  fuenteMetadata: string;
  fuenteBackend: string;
  escribe: string[];
  lee: string[];
}

function valorXml(xml: string, etiqueta: string): string | null {
  return xml.match(new RegExp(`<${etiqueta}>(.*?)</${etiqueta}>`))?.[1]?.trim() ?? null;
}

const implementaciones: ImplementacionAccion[] = accionesOrg.map((accion) => {
  const ruta = buscar(TMP, (n) => n === `${accion}.genAiFunction-meta.xml`);
  if (!ruta) {
    throw new Error(`La acción activa ${accion} no tiene GenAiFunction recuperable en la org.`);
  }
  const xml = readFileSync(ruta, 'utf8');
  const tipo = valorXml(xml, 'invocationTargetType');
  const destino = valorXml(xml, 'invocationTarget');
  if (!tipo || !destino) {
    throw new Error(`GenAiFunction:${accion} no declara invocationTargetType/invocationTarget.`);
  }
  return {
    accion,
    tipo: tipo.toLowerCase(),
    destino,
    fuenteMetadata: `GenAiFunction:${accion} recuperada de org ${ALIAS}`,
    fuenteBackend: `${tipo === 'apex' ? 'ApexClass' : 'Flow'}:${destino} recuperado de org ${ALIAS}`,
    escribe: [],
    lee: [],
  };
});

const apexOrg = [...new Set(implementaciones.filter((i) => i.tipo === 'apex').map((i) => i.destino))];
console.log(`Recuperando ${apexOrg.length} clases Apex invocadas por las acciones…`);
for (const clase of apexOrg) {
  sf([
    'project', 'retrieve', 'start', '-o', ALIAS,
    '-m', `"ApexClass:${clase}"`,
    '--json',
  ], TMP);
}

// ── 4. Qué objeto toca cada Flow, leyendo su XML ─────────────────────────────
const FLOWS = ['Crear_Orden_Servicio', 'Reprogramar_Orden_Servicio', 'Crear_Reporte_Unidad_Varada', 'Registrar_Log_Agente'];

function objetosDeFlow(nombre: string): { escribe: string[]; lee: string[] } {
  const ruta = buscar(TMP, (n) => n === `${nombre}.flow-meta.xml`);
  if (!ruta) return { escribe: [], lee: [] };
  const xml = readFileSync(ruta, 'utf8');

  const bloques = (bloque: string): string[] => {
    const re = new RegExp(`<${bloque}>([\\s\\S]*?)</${bloque}>`, 'g');
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) if (m[1]) out.push(m[1]);
    return out;
  };
  const campo = (b: string, k: string): string | null => b.match(new RegExp(`<${k}>(.*?)</${k}>`))?.[1] ?? null;

  // Un recordUpdates puede no traer <object>: cuando actualiza por variable sObject
  // sólo trae <inputReference>. Hay que resolver el tipo de esa variable o el
  // diagrama pierde aristas reales — justo la desincronización que se quiere evitar.
  const tipoDeVariable = new Map<string, string>();
  for (const b of bloques('variables')) {
    const n = campo(b, 'name');
    const o = campo(b, 'objectType');
    if (n && o) tipoDeVariable.set(n, o);
  }
  // Las variables de colección/registro también se pueblan desde un lookup.
  for (const b of bloques('recordLookups')) {
    const o = campo(b, 'object');
    const out = campo(b, 'outputReference');
    if (o && out && !tipoDeVariable.has(out)) tipoDeVariable.set(out, o);
  }

  const objetosDe = (bloque: string): string[] => {
    const objs = new Set<string>();
    for (const b of bloques(bloque)) {
      const o = campo(b, 'object');
      if (o) {
        objs.add(o);
        continue;
      }
      const ref = campo(b, 'inputReference');
      if (ref) {
        // 'recSlot.Campo' → 'recSlot'
        const raiz = ref.split('.')[0] ?? ref;
        const t = tipoDeVariable.get(raiz);
        if (t) objs.add(t);
        else console.warn(`  aviso: en ${nombre}, ${bloque} usa "${ref}" y no se pudo resolver su objeto`);
      }
    }
    return [...objs];
  };

  const escribe = [...new Set([...objetosDe('recordCreates'), ...objetosDe('recordUpdates')])];
  const lee = objetosDe('recordLookups').filter((o) => !escribe.includes(o));
  return { escribe, lee };
}

const mapaFlows = Object.fromEntries(FLOWS.map((f) => [f, objetosDeFlow(f)]));

// En Apex, una escritura sólo se atribuye cuando la variable tipada participa
// en una operación DML real. Las lecturas salen de SOQL. Esto evita convertir
// menciones, DTOs o comentarios en efectos persistentes ficticios.
function objetosDeApex(nombre: string): { escribe: string[]; lee: string[] } {
  const ruta = buscar(TMP, (n) => n === `${nombre}.cls`);
  if (!ruta) throw new Error(`No se recuperó ApexClass:${nombre} desde la org.`);
  const apex = readFileSync(ruta, 'utf8');
  const tiposPorVariable = new Map<string, string>();

  for (const m of apex.matchAll(/\b(?:List|Set)<\s*([A-Za-z][A-Za-z0-9_]*)\s*>\s+([A-Za-z][A-Za-z0-9_]*)/g)) {
    if (m[1] && m[2]) tiposPorVariable.set(m[2], m[1]);
  }
  for (const m of apex.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s+([a-z][A-Za-z0-9_]*)\s*=\s*new\s+\1\b/g)) {
    if (m[1] && m[2]) tiposPorVariable.set(m[2], m[1]);
  }

  const escribe = new Set<string>();
  const registrarDml = (variable: string | undefined) => {
    if (!variable) return;
    const tipo = tiposPorVariable.get(variable);
    if (tipo) escribe.add(tipo);
  };
  for (const m of apex.matchAll(/\bDatabase\.(?:insert|update|upsert|delete|undelete)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)/gi)) {
    registrarDml(m[1]);
  }
  for (const m of apex.matchAll(/\b(?:insert|update|upsert|delete|undelete)\s+([A-Za-z][A-Za-z0-9_]*)\s*;/gi)) {
    registrarDml(m[1]);
  }

  const lee = new Set<string>();
  for (const consulta of apex.matchAll(/\[\s*SELECT[\s\S]*?\]/gi)) {
    let profundidad = 0;
    for (const token of consulta[0].matchAll(/\(|\)|\bFROM\s+([A-Za-z][A-Za-z0-9_]*)/gi)) {
      if (token[0] === '(') {
        profundidad++;
      } else if (token[0] === ')') {
        profundidad = Math.max(0, profundidad - 1);
      } else if (profundidad === 0 && token[1]) {
        if (!escribe.has(token[1])) lee.add(token[1]);
        break;
      }
    }
  }
  return { escribe: [...escribe], lee: [...lee] };
}

for (const implementacion of implementaciones) {
  const objetos = implementacion.tipo === 'flow'
    ? objetosDeFlow(implementacion.destino)
    : implementacion.tipo === 'apex'
      ? objetosDeApex(implementacion.destino)
      : null;
  if (!objetos) {
    throw new Error(
      `GenAiFunction:${implementacion.accion} usa el tipo no soportado ${implementacion.tipo}; no se dibujará a mano.`,
    );
  }
  implementacion.escribe = objetos.escribe;
  implementacion.lee = objetos.lee;
}

// Gate de negocio del proyecto: una etiqueta de "escalamiento" no basta. La
// arquitectura candidata sólo es válida si la acción publicada llega al Apex
// transaccional y éste demuestra DML sobre los tres registros durables exigidos.
const escalamiento = implementaciones.find((i) => i.accion === 'Crear_Escalamiento_Asesor');
const objetosEscalamientoRequeridos = ['Case', 'CaseComment', 'Log_Agente__c'];
if (
  !escalamiento
  || escalamiento.tipo !== 'apex'
  || escalamiento.destino !== 'EscalarAsesorHumano'
  || objetosEscalamientoRequeridos.some((o) => !escalamiento.escribe.includes(o))
) {
  throw new Error(
    'El grafo activo no demuestra Crear_Escalamiento_Asesor → EscalarAsesorHumano ' +
    'con escrituras Case + CaseComment + Log_Agente__c.',
  );
}

// ── 5. Emitir mermaid ────────────────────────────────────────────────────────
const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
const etiqueta = (s: string) => s.replace(/_/g, ' ');

const lineas: string[] = ['graph LR'];
lineas.push(`  BOT["Agente Postventa Zapata<br/>${versionActiva} · activa"]:::bot`);

const accionesVistas = new Set<string>();

for (const n of nodos) {
  if (n.developerName.startsWith('AgentScriptInternal')) continue;
  const clase = n.type === 'router' ? 'router' : 'sub';
  lineas.push(`  ${id(n.developerName)}["${etiqueta(n.developerName)}"]:::${clase}`);

  if (n.type === 'router') {
    lineas.push(`  BOT --> ${id(n.developerName)}`);
    for (const t of n.tools ?? []) {
      if (t.target) lineas.push(`  ${id(n.developerName)} -->|enruta| ${id(t.target)}`);
    }
    continue;
  }

  const acciones = (n.tools ?? []).filter((t) => t.type === 'action' && t.target);
  if (!acciones.length) {
    lineas.push(`  ${id(n.developerName)} -.->|sin acción| SINACCION_${id(n.developerName)}["no ejecuta nada"]:::vacio`);
    continue;
  }
  for (const t of acciones) {
    const destino = t.target!;
    if (destino === '__state_update_action__') {
      lineas.push(
        `  ${id(n.developerName)} -.->|"${t.name}"| ESTADO_${id(n.developerName)}["sólo cambia estado<br/>NO ejecuta acción"]:::vacio`,
      );
      continue;
    }
    if (!accionesVistas.has(destino)) {
      lineas.push(`  ${id(destino)}(["${etiqueta(destino)}"]):::accion`);
      accionesVistas.add(destino);
    }
    lineas.push(`  ${id(n.developerName)} --> ${id(destino)}`);
  }
}

// acción → implementación real, según cada GenAiFunction recuperada.
for (const implementacion of implementaciones) {
  const prefijo = implementacion.tipo === 'apex' ? 'APEX' : 'FLOW';
  const clase = implementacion.tipo === 'apex' ? 'apex' : 'flow';
  const nodoBackend = `${prefijo}_${id(implementacion.destino)}`;
  lineas.push(
    `  ${id(implementacion.accion)} --> ${nodoBackend}[["${implementacion.tipo === 'apex' ? 'Apex' : 'Flow'} ${etiqueta(implementacion.destino)}"]]:::${clase}`,
  );
  for (const o of implementacion.escribe) {
    lineas.push(`  OBJ_${id(o)}[("${o}")]:::objeto`);
    lineas.push(`  ${nodoBackend} -->|escribe| OBJ_${id(o)}`);
  }
  for (const o of implementacion.lee) {
    lineas.push(`  OBJ_${id(o)}[("${o}")]:::objeto`);
    lineas.push(`  ${nodoBackend} -.->|lee| OBJ_${id(o)}`);
  }
}

// Flows auxiliares no invocados directamente como acción.
for (const [flow, objs] of Object.entries(mapaFlows)) {
  if (!implementaciones.some((i) => i.tipo === 'flow' && i.destino === flow)) {
    lineas.push(`  FLOW_${id(flow)}[["Flow ${etiqueta(flow)}"]]:::flow`);
    for (const o of objs.escribe) {
      lineas.push(`  OBJ_${id(o)}[("${o}")]:::objeto`);
      lineas.push(`  FLOW_${id(flow)} -->|escribe| OBJ_${id(o)}`);
    }
    for (const o of objs.lee) {
      lineas.push(`  OBJ_${id(o)}[("${o}")]:::objeto`);
      lineas.push(`  FLOW_${id(flow)} -.->|lee| OBJ_${id(o)}`);
    }
  }
}

// Los tres Flows de negocio llaman a Registrar_Log_Agente como subflow.
for (const f of ['Crear_Orden_Servicio', 'Reprogramar_Orden_Servicio', 'Crear_Reporte_Unidad_Varada']) {
  lineas.push(`  FLOW_${id(f)} -.->|subflow| FLOW_Registrar_Log_Agente`);
}

lineas.push('  classDef bot fill:#3a2a0a,stroke:#fbbf24,stroke-width:2px,color:#f3f4f6');
lineas.push('  classDef router fill:#121318,stroke:#ffffff33,color:#f3f4f6');
lineas.push('  classDef sub fill:#0d0e12,stroke:#ffffff33,color:#f3f4f6');
lineas.push('  classDef accion fill:#0b0c10,stroke:#fbbf2455,color:#f3f4f6');
lineas.push('  classDef flow fill:#0b0c10,stroke:#ffffff22,color:#d1d5db');
lineas.push('  classDef apex fill:#111827,stroke:#60a5fa,color:#dbeafe');
lineas.push('  classDef objeto fill:#07080a,stroke:#ffffff22,color:#9ca3af');
lineas.push('  classDef vacio fill:#3a1010,stroke:#dc2626,color:#fecaca');

const mermaid = lineas.join('\n');

// ── 6. Guardar ───────────────────────────────────────────────────────────────
const datos = {
  generadoEn: new Date().toISOString(),
  fuente: `org ${ALIAS} · GenAiPlannerBundle ${bundle} · Flows recuperados`,
  versionActiva,
  subagentes: nodos
    .filter((n) => !n.developerName.startsWith('AgentScriptInternal'))
    .map((n) => ({
      nombre: n.developerName,
      tipo: n.type,
      descripcion: n.description ?? '',
      acciones: (n.tools ?? [])
        .filter((t) => t.type === 'action')
        .map((t) => ({ nombre: t.name, destino: t.target, entradas: t.llmInputs ?? [] })),
      transiciones: (n.tools ?? []).filter((t) => !t.type && t.target).map((t) => t.target),
      ejecutaAlgo: (n.tools ?? []).some((t) => t.type === 'action' && t.target !== '__state_update_action__'),
    })),
  implementacionesAcciones: implementaciones,
  requisitosArquitectura: {
    escalamientoDurable: {
      cumple: true,
      accion: escalamiento.accion,
      backend: escalamiento.destino,
      escriturasRequeridas: objetosEscalamientoRequeridos,
      derivadoDe: [escalamiento.fuenteMetadata, escalamiento.fuenteBackend],
    },
  },
  flows: mapaFlows,
  mermaid,
};

mkdirSync(join(RAIZ, 'publico', 'datos'), { recursive: true });
writeFileSync(join(RAIZ, 'publico', 'datos', 'arquitectura.json'), JSON.stringify(datos, null, 1));

mkdirSync(join(RAIZ, 'evidencia', '11-arquitectura'), { recursive: true });
writeFileSync(join(RAIZ, 'evidencia', '11-arquitectura', `arquitectura.${ts}.json`), JSON.stringify(datos, null, 1));
writeFileSync(join(RAIZ, 'evidencia', '11-arquitectura', `diagrama.${ts}.mmd`), mermaid);

console.log(`\nSubagentes encontrados: ${datos.subagentes.length}`);
for (const s of datos.subagentes) {
  console.log(`  ${s.nombre.padEnd(30)} ${s.tipo.padEnd(9)} acciones=${s.acciones.length} ejecuta=${s.ejecutaAlgo}`);
}
console.log('\nFlows → objetos:');
for (const [f, o] of Object.entries(mapaFlows)) {
  console.log(`  ${f.padEnd(30)} escribe=[${o.escribe.join(', ')}] lee=[${o.lee.join(', ')}]`);
}
console.log(`\nEscrito publico/datos/arquitectura.json y evidencia/11-arquitectura/`);
