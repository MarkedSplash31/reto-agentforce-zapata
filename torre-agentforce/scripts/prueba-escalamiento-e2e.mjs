// Aceptacion mutante del escalamiento: apertura concurrente idempotente, contexto
// interno completo y mensajes posteriores en ambos sentidos. La evidencia persistida
// contiene solo ids/conteos/booleanos; nunca los cuerpos de la conversacion.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

if (process.env.CONFIRM_MUTATING_ESCALATION_E2E !== '1') {
  console.error('OMITIDA: define CONFIRM_MUTATING_ESCALATION_E2E=1 para autorizar una mutacion real.');
  process.exit(2);
}

const PUERTO = 3011;
const BASE = `http://localhost:${PUERTO}`;
const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '15-escalamiento-apex');
mkdirSync(dir, { recursive: true });
// El servidor deriva la correlación (op-principal-nonce) y rechaza que el cliente
// la invente: ClientSuppliedContextError / UNTRUSTED_CONTEXT_FIELD. Lo único que el
// cliente puede aportar es un nonce UUID v4, que además sirve de llave de idempotencia.
const operationNonce = randomUUID();
let cid = null; // se llena con lo que devuelva el servidor
const turnos = [
  { autor: 'cliente', texto: 'Mi Cascadia pierde potencia en subida y ya revise el filtro.' },
  { autor: 'agente', texto: 'Encontre dos articulos, ninguno concluyente para tu caso.' },
  { autor: 'cliente', texto: 'Prefiero hablar con una persona.' },
];

const srv = spawn('node', ['--experimental-strip-types', 'src/servidor/index.ts'], {
  env: { ...process.env, PORT: String(PUERTO) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logServidor = '';
srv.stdout.on('data', (dato) => { logServidor += dato; });
srv.stderr.on('data', (dato) => { logServidor += dato; });

const json = async (respuesta, etiqueta) => {
  const texto = await respuesta.text();
  let cuerpo;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    throw new Error(`${etiqueta}: respuesta no JSON (HTTP ${respuesta.status})`);
  }
  if (!respuesta.ok) {
    throw new Error(`${etiqueta}: HTTP ${respuesta.status} ${JSON.stringify(cuerpo).slice(0, 300)}`);
  }
  return cuerpo;
};
const post = (ruta, body) => fetch(`${BASE}${ruta}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then((respuesta) => json(respuesta, ruta));

let fallos = 0;
const verificaciones = [];
const paso = (ok, texto) => {
  if (!ok) fallos++;
  verificaciones.push({ ok: Boolean(ok), texto });
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${texto}`);
};
const mismosElementos = (a, b) =>
  a.length === b.length && [...a].sort().every((valor, indice) => valor === [...b].sort()[indice]);

try {
  let saludable = false;
  for (let i = 0; i < 40; i++) {
    try {
      const respuesta = await fetch(`${BASE}/salud`);
      if (respuesta.ok) {
        saludable = true;
        break;
      }
    } catch {}
    await new Promise((resolver) => setTimeout(resolver, 500));
  }
  if (!saludable) {
    throw new Error(`El servidor no inicio en ${BASE}; salida=${logServidor.slice(0, 500)}`);
  }

  const apertura = {
    operationNonce,
    asunto: 'Prueba de aceptacion de escalamiento',
    contexto: 'El cliente pidio hablar con una persona tras un diagnostico no concluyente.',
    politicaAplicada: 'K_ESCALAMIENTO_MANUAL',
    transcripcion: turnos,
  };

  // Las dos llamadas compiten con la misma llave: solo una debe crear registros.
  const [primera, segunda] = await Promise.all([
    post('/api/escalamiento/abrir', apertura),
    post('/api/escalamiento/abrir', apertura),
  ]);
  paso(Boolean(primera.caseId && primera.caseNumber),
    `caso abierto ${primera.caseNumber} (${primera.caseId})`);
  cid = primera.correlationId;
  paso(typeof cid === 'string' && cid.includes(operationNonce),
    `el servidor derivo la correlacion e incluye el nonce del cliente`);
  paso(segunda.caseId === primera.caseId && segunda.caseNumber === primera.caseNumber,
    'el reintento concurrente devolvio el mismo Case y folio');
  paso(mismosElementos(primera.comentariosSembrados, segunda.comentariosSembrados),
    'ambas aperturas devolvieron los mismos ids semilla');
  paso(primera.comentariosSembrados.length === 2 + turnos.length,
    `resumen + cabecera + ${turnos.length} turnos internos sembrados`);

  const conversacionInicial = await json(
    await fetch(`${BASE}/api/escalamiento/${primera.caseId}`),
    'conversacion inicial',
  );
  const textoCompleto = conversacionInicial.comentarios.map((c) => c.cuerpo).join('\n');
  paso(turnos.every((turno) => textoCompleto.includes(turno.texto)),
    'el asesor relee los turnos completos desde Salesforce');
  const idsSemilla = new Set(primera.comentariosSembrados);
  paso(
    conversacionInicial.comentarios
      .filter((comentario) => idsSemilla.has(comentario.id))
      .every((comentario) => comentario.publicado === false),
    'todos los comentarios de apertura son internos',
  );

  const respuestaAsesor = await post('/api/escalamiento/responder', {
    caseId: primera.caseId,
    cuerpo: 'Soy Ana, de postventa. Te agendo diagnostico en Queretaro manana.',
    autor: 'asesor',
  });
  const respuestaCliente = await post('/api/escalamiento/responder', {
    caseId: primera.caseId,
    cuerpo: 'De acuerdo Ana, manana a primera hora me sirve.',
    autor: 'cliente',
  });
  paso(respuestaAsesor.comentarios?.length === 1 && respuestaAsesor.comentarios[0].publicado,
    'el mensaje posterior del asesor quedo publico');
  paso(respuestaCliente.comentarios?.length === 1 && respuestaCliente.comentarios[0].publicado,
    'la respuesta posterior del cliente quedo publica');

  // La app usa la versión con prefijo ("v67.0") porque así van las rutas REST, pero el
  // CLI la exige sin prefijo ("67.0") y aborta con InvalidApiVersionError si la hereda
  // del entorno. Se normaliza y se pasa explícita en vez de depender del ambiente.
  const versionCli = String(process.env.SF_API_VERSION ?? 'v67.0').replace(/^v/i, '');
  const entornoCli = { ...process.env };
  delete entornoCli.SF_API_VERSION;
  delete entornoCli.SF_ORG_API_VERSION;
  delete entornoCli.ORG_API_VERSION;

  const soql = (consulta) => JSON.parse(execFileSync(
    'sf',
    ['data', 'query', '-o', 'zapata', '--json', '--api-version', versionCli, '-q', `"${consulta}"`],
    { encoding: 'utf8', shell: true, env: entornoCli },
  )).result;
  const caso = soql(
    `SELECT Id,CaseNumber,Status,Origin,Owner.Name,Correlation_Id__c,Politica_Aplicada__c ` +
      `FROM Case WHERE Correlation_Id__c='${cid}'`,
  );
  const comentarios = soql(
    `SELECT Id,CommentBody,IsPublished FROM CaseComment ` +
      `WHERE ParentId='${primera.caseId}' ORDER BY CreatedDate,Id`,
  );
  const logs = soql(
    `SELECT Id,Action_Name__c,Outcome__c,Case__c FROM Log_Agente__c ` +
      `WHERE Correlation_Id__c='${cid}'`,
  );
  const internos = comentarios.records.filter((comentario) => !comentario.IsPublished);
  const publicos = comentarios.records.filter((comentario) => comentario.IsPublished);
  const cuerpos = comentarios.records.map((comentario) => comentario.CommentBody).join('\n');

  paso(caso.totalSize === 1, 'existe exactamente un Case para la correlacion');
  paso(internos.length === 2 + turnos.length,
    'existen exactamente resumen + cabecera + turnos internos');
  paso(publicos.length === 2, 'existen exactamente dos mensajes publicos posteriores');
  paso(logs.totalSize === 1, 'existe exactamente un Log_Agente__c');
  paso(logs.records[0]?.Case__c === primera.caseId, 'el Log apunta al Case correcto');
  paso(cuerpos.includes('Soy Ana') && cuerpos.includes('manana a primera hora'),
    'Salesforce conserva la ida y vuelta posterior');

  const evidencia = {
    ts,
    correlationId: cid,
    caseId: primera.caseId,
    caseNumber: primera.caseNumber,
    comentariosSembrados: primera.comentariosSembrados,
    comentariosAsesor: respuestaAsesor.comentarios.map((comentario) => comentario.id),
    comentariosCliente: respuestaCliente.comentarios.map((comentario) => comentario.id),
    conteos: {
      cases: caso.totalSize,
      comentariosInternos: internos.length,
      comentariosPublicosPosteriores: publicos.length,
      logs: logs.totalSize,
    },
    contextoCompletoVerificado: turnos.every((turno) => cuerpos.includes(turno.texto)),
    idaVueltaVerificada: cuerpos.includes('Soy Ana') && cuerpos.includes('manana a primera hora'),
    verificaciones,
    fallos,
  };
  const archivo = join(dir, `escalamiento-e2e.${ts}.json`);
  writeFileSync(archivo, `${JSON.stringify(evidencia, null, 2)}\n`);
  console.log(`\n${fallos === 0 ? 'VERDE' : 'ROJO'} — folio ${cid}`);
  console.log(`evidencia sanitizada en ${archivo}`);
  process.exitCode = fallos === 0 ? 0 : 1;
} finally {
  srv.kill();
}
