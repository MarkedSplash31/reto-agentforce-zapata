// Verificación de N6 contra la org REAL. No hay mocks: cada aserción se comprueba
// releyendo de Salesforce, no mirando lo que el módulo dijo que hizo.
//
//   node --experimental-strip-types scripts/prueba-escalamiento.ts
//
// Deja la salida cruda en evidencia/10-escalamiento/.

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ejecutar = promisify(execFile);

import { consultar, consultarTodo } from '../src/servidor/sf.ts';
import { configSegura } from '../src/servidor/config.ts';
import {
  abrirEscalamiento,
  bandejaAsesor,
  cerrarEscalamiento,
  conversacion,
  responder,
  suscribirComentarios,
  type EventoComentarios,
} from '../src/servidor/escalamiento.ts';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELLO = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const DESTINO = join(RAIZ, 'evidencia', '10-escalamiento');

await mkdir(DESTINO, { recursive: true });

const guardados: string[] = [];
async function guardar(nombre: string, datos: unknown): Promise<void> {
  const ruta = join(DESTINO, `${nombre}.${SELLO}.json`);
  await writeFile(ruta, JSON.stringify(datos, null, 2) + '\n', 'utf8');
  guardados.push(ruta);
  console.log(`  · evidencia -> ${ruta}`);
}

const fallos: string[] = [];
let totalAserciones = 0;
function afirmar(condicion: boolean, descripcion: string): void {
  totalAserciones += 1;
  if (condicion) {
    console.log(`  OK   ${descripcion}`);
  } else {
    console.log(`  FALLA ${descripcion}`);
    fallos.push(descripcion);
  }
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

console.log('CONFIG:', JSON.stringify(configSegura()));

// ─────────────────────────────────────────────────────────────────────────────
// Caso A — ciclo completo, queda ABIERTO para la bandeja del asesor
// ─────────────────────────────────────────────────────────────────────────────

const correlationA = `TORRE-N6-${SELLO}`;
console.log(`\n[1] abrirEscalamiento  correlationId=${correlationA}`);

const abierto = await abrirEscalamiento({
  correlationId: correlationA,
  asunto: 'Cliente pide asesor humano por contradiccion de cobertura en unidad 105',
  contexto:
    'El agente no pudo resolver la contradiccion entre Regla_Cobertura__c (Cabina: 36 meses, ' +
    'sin limite de km) y Asset.Garantia_Vigente__c (24 meses / 250,000 km). La unidad 105 tiene ' +
    '268,000 km y 30 meses desde instalacion. Las dos fuentes dan veredictos opuestos y la ' +
    'decision es de negocio, no del agente.',
  politicaAplicada: 'Contradiccion_Cobertura',
  transcripcion: [
    {
      autor: 'cliente',
      texto: 'Buenas. Mi unidad 105 trae una falla en la cabina y quiero saber si entra en garantia.',
      fecha: '2026-08-05T20:40:00Z',
    },
    {
      autor: 'agente',
      texto:
        'Reviso la cobertura de la unidad 105. Odometro 268,000 km, 30 meses desde instalacion.',
      fecha: '2026-08-05T20:40:12Z',
    },
    {
      autor: 'agente',
      texto:
        'Encuentro dos fuentes que no coinciden. Regla_Cobertura__c para Cabina dice 36 meses sin ' +
        'limite de kilometraje, y con eso la unidad SI esta cubierta. El campo formula ' +
        'Asset.Garantia_Vigente__c aplica 24 meses y 250,000 km a todo sistema, y con eso da falso. ' +
        'No voy a elegir por usted cual manda.',
      fecha: '2026-08-05T20:40:31Z',
    },
    {
      autor: 'cliente',
      texto: 'Entonces paseme con una persona, esto no me lo puede resolver un bot.',
      fecha: '2026-08-05T20:41:02Z',
    },
    {
      autor: 'agente',
      texto:
        'De acuerdo. Escalo a un asesor humano con todo el contexto: unidad, odometro, las dos ' +
        'reglas en conflicto y el articulo de conocimiento de cada una.',
      fecha: '2026-08-05T20:41:10Z',
    },
  ],
});

console.log('  abierto:', JSON.stringify(abierto));
await guardar('01-abrir', abierto);

afirmar(typeof abierto.caseId === 'string' && abierto.caseId.length >= 15, 'devuelve caseId');
afirmar(/^\d+$/.test(abierto.caseNumber), `devuelve caseNumber real (${abierto.caseNumber})`);
afirmar(abierto.correlationId === correlationA, 'devuelve el mismo correlationId');
afirmar(abierto.comentariosSembrados.length >= 6, 'sembro encabezado + 5 turnos');

// ─────────────────────────────────────────────────────────────────────────────
// [2] mensajes cruzados: cliente y asesor
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n[2] responder — un mensaje como cliente y otro como asesor');

const delCliente = await responder({
  caseId: abierto.caseId,
  autor: 'cliente',
  cuerpo: 'Sigo aqui. La unidad esta parada en el patio y necesito una respuesta hoy.',
});
console.log('  cliente ->', JSON.stringify(delCliente.map((c) => c.id)));

const delAsesor = await responder({
  caseId: abierto.caseId,
  autor: 'asesor',
  cuerpo:
    'Recibido. Tomo el caso. Aplico la Regla_Cobertura__c de Cabina (36 meses, sin limite de km) ' +
    'y autorizo la reparacion en garantia. Escalo la contradiccion del campo formula a producto.',
});
console.log('  asesor  ->', JSON.stringify(delAsesor.map((c) => c.id)));

await guardar('02-mensajes', { cliente: delCliente, asesor: delAsesor });

afirmar(delCliente.length === 1, 'el mensaje del cliente produjo un CaseComment');
afirmar(delAsesor.length === 1, 'el mensaje del asesor produjo un CaseComment');
afirmar(
  delCliente[0] !== undefined && delCliente[0].id.startsWith('00a'),
  `el Id del comentario del cliente es un Id real de CaseComment (${delCliente[0]?.id})`,
);
afirmar(
  delAsesor[0] !== undefined && delAsesor[0].id.startsWith('00a'),
  `el Id del comentario del asesor es un Id real de CaseComment (${delAsesor[0]?.id})`,
);
afirmar(
  delCliente[0]?.cuerpo.startsWith('CLIENTE: ') === true,
  'el cuerpo del cliente lleva prefijo de autor',
);
afirmar(
  delAsesor[0]?.cuerpo.startsWith('ASESOR: ') === true,
  'el cuerpo del asesor lleva prefijo de autor',
);

// ─────────────────────────────────────────────────────────────────────────────
// [3] RELECTURA CRUDA desde Salesforce — la única prueba que vale
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n[3] relectura cruda desde la org');

const casoCrudo = await consultar<Record<string, unknown>>(
  `SELECT Id, CaseNumber, Status, Origin, Priority, Subject, Owner.Name, OwnerId, ` +
    `Correlation_Id__c, Politica_Aplicada__c, Description, CreatedDate ` +
    `FROM Case WHERE Correlation_Id__c = '${correlationA}'`,
  'prueba.case',
);
await guardar('03-case-crudo', casoCrudo);

const caso = casoCrudo.records[0] as Record<string, unknown> | undefined;
afirmar(casoCrudo.totalSize === 1, 'la org devuelve exactamente 1 Case con ese Correlation_Id__c');
afirmar(caso?.Id === abierto.caseId, 'el Case releido es el que devolvio abrirEscalamiento');
afirmar(caso?.OwnerId === configSegura().colaEscalamientoId, 'el OwnerId es la cola real');
afirmar(caso?.Origin === 'Agentforce', "Origin = 'Agentforce'");
afirmar(caso?.Status === 'New', "Status = 'New'");
afirmar(caso?.Priority === 'High', "Priority = 'High'");
afirmar(caso?.Politica_Aplicada__c === 'Contradiccion_Cobertura', 'Politica_Aplicada__c grabada');

const comentariosCrudos = await consultarTodo<Record<string, unknown>>(
  `SELECT Id, CommentBody, CreatedDate, CreatedBy.Name, IsPublished FROM CaseComment ` +
    `WHERE ParentId = '${abierto.caseId}' ORDER BY CreatedDate ASC, Id ASC`,
  'prueba.comentarios',
);
await guardar('04-comentarios-crudos', comentariosCrudos);
console.log(`  ${comentariosCrudos.length} CaseComment en la org`);

const idsEnOrg = new Set(comentariosCrudos.map((c) => String(c.Id)));
afirmar(
  abierto.comentariosSembrados.every((i) => idsEnOrg.has(i)),
  'todos los comentarios de la transcripcion estan en la org',
);
afirmar(
  delCliente[0] !== undefined && idsEnOrg.has(delCliente[0].id),
  'el mensaje del cliente esta en la org con su Id',
);
afirmar(
  delAsesor[0] !== undefined && idsEnOrg.has(delAsesor[0].id),
  'el mensaje del asesor esta en la org con su Id',
);
afirmar(
  comentariosCrudos.some((c) => String(c.CommentBody ?? '').includes('paseme con una persona')),
  'la transcripcion quedo COMPLETA (turno textual del cliente presente)',
);
// CreatedDate solo tiene granularidad de segundo: la rafaga inicial empata y desempata
// por Id, que no es monotono. El ordinal impreso deja el orden real a la vista.
const ordinales = comentariosCrudos
  .map((c) => /^\[turno (\d+)\/(\d+)\]/.exec(String(c.CommentBody ?? '')))
  .filter((m): m is RegExpExecArray => m !== null);
afirmar(ordinales.length === 5, `los 5 turnos llevan su ordinal impreso (${ordinales.length})`);
afirmar(
  ordinales.every((m) => m[2] === '5'),
  'cada ordinal declara el total real de turnos',
);
afirmar(
  new Set(ordinales.map((m) => m[1])).size === 5,
  'los ordinales van del 1 al 5 sin repetirse',
);

const logsCrudos = await consultarTodo<Record<string, unknown>>(
  `SELECT Id, Name, Subagent__c, Action_Name__c, Outcome__c, Case__c, Correlation_Id__c, ` +
    `Timestamp__c, CreatedDate FROM Log_Agente__c WHERE Correlation_Id__c = '${correlationA}' ` +
    `ORDER BY CreatedDate ASC`,
  'prueba.log',
);
await guardar('05-log-crudo', logsCrudos);
console.log('  logs:', JSON.stringify(logsCrudos));

const logApertura = logsCrudos.find((l) => l.Action_Name__c === 'Escalamiento_A_Humano');
afirmar(logApertura !== undefined, 'existe Log_Agente__c con Action_Name__c=Escalamiento_A_Humano');
afirmar(logApertura?.Subagent__c === 'Compensacion', 'el log trae Subagent__c=Compensacion');
afirmar(logApertura?.Outcome__c === 'SUCCESS', 'el log trae Outcome__c=SUCCESS');
afirmar(logApertura?.Case__c === abierto.caseId, 'el log apunta al Case creado');
afirmar(logApertura?.Correlation_Id__c === correlationA, 'el log lleva el MISMO correlationId');

// ─────────────────────────────────────────────────────────────────────────────
// [4] bandejaAsesor y conversacion
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n[4] bandejaAsesor / conversacion');

const bandeja = await bandejaAsesor();
await guardar('06-bandeja', bandeja);
console.log(`  ${bandeja.length} casos abiertos en la cola`);

const enBandeja = bandeja.find((c) => c.id === abierto.caseId);
afirmar(enBandeja !== undefined, 'el Case recien abierto aparece en la bandeja de la cola');
afirmar(enBandeja?.caseNumber === abierto.caseNumber, 'la bandeja trae el CaseNumber');
afirmar(enBandeja?.correlationId === correlationA, 'la bandeja trae el Correlation_Id__c');
afirmar(
  (enBandeja?.comentarios ?? 0) === comentariosCrudos.length,
  `el conteo de comentarios de la bandeja (${enBandeja?.comentarios}) coincide con la org (${comentariosCrudos.length})`,
);

const conv = await conversacion(abierto.caseId);
await guardar('07-conversacion', conv);

afirmar(conv.caso.id === abierto.caseId, 'conversacion devuelve el Case pedido');
afirmar(
  conv.comentarios.length === comentariosCrudos.length,
  `conversacion trae TODOS los comentarios (${conv.comentarios.length})`,
);
const fechas = conv.comentarios.map((c) => Date.parse(c.creadoEn));
afirmar(
  fechas.every((f, i) => i === 0 || f >= (fechas[i - 1] ?? 0)),
  'los comentarios vienen en orden cronologico',
);
afirmar(
  conv.comentarios.every((c) => c.creadoPor !== '' && c.id !== ''),
  'cada comentario trae Id y CreatedBy.Name',
);

// ─────────────────────────────────────────────────────────────────────────────
// [5] suscribirComentarios — dedup por Id y entrega en vivo
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n[5] suscribirComentarios (sondeo 2 s)');

const eventos: EventoComentarios[] = [];
const cancelar = suscribirComentarios(abierto.caseId, (e) => {
  eventos.push(e);
  if (e.tipo === 'comentario') console.log(`  <- ${e.comentario.id} ${e.comentario.cuerpo.slice(0, 48)}`);
  else console.log(`  <- evento ${e.tipo}`);
});

await esperar(3000);
const yaEmitidos = eventos.filter((e) => e.tipo === 'comentario').length;
console.log(`  backlog emitido: ${yaEmitidos}`);

const enVivo = await responder({
  caseId: abierto.caseId,
  autor: 'cliente',
  cuerpo: 'Perfecto, quedo atento a la orden de servicio. Gracias.',
});
const idEnVivo = enVivo[0]?.id ?? '';
console.log(`  mensaje en vivo escrito: ${idEnVivo}`);

await esperar(7000);
cancelar();
await esperar(2500); // si el sondeo no se detuvo, aqui se notaria

const idsEmitidos = eventos
  .filter((e): e is Extract<EventoComentarios, { tipo: 'comentario' }> => e.tipo === 'comentario')
  .map((e) => e.comentario.id);

await guardar('08-sondeo', {
  totalEventos: eventos.length,
  backlogPrimeraRonda: yaEmitidos,
  idEnVivo,
  idsEmitidos,
  eventos,
});

afirmar(yaEmitidos === comentariosCrudos.length, 'la primera ronda emitio el hilo existente completo');
afirmar(idsEmitidos.includes(idEnVivo), 'el comentario escrito EN VIVO llego por el sondeo');
afirmar(
  new Set(idsEmitidos).size === idsEmitidos.length,
  `ningun Id se emitio dos veces (${idsEmitidos.length} eventos, ${new Set(idsEmitidos).size} unicos)`,
);
afirmar(
  eventos.filter((e) => e.tipo === 'error').length === 0,
  'el sondeo no reporto errores de red',
);
const eventosAlCancelar = eventos.length;
await esperar(2500);
afirmar(eventos.length === eventosAlCancelar, 'cancelar() detuvo el sondeo de verdad');

// ─────────────────────────────────────────────────────────────────────────────
// [6] cerrarEscalamiento — sobre un Case propio, para no cerrar el de la bandeja
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n[6] cerrarEscalamiento (Case B, dedicado al cierre)');

const correlationB = `TORRE-N6C-${SELLO}`;
const abiertoB = await abrirEscalamiento({
  correlationId: correlationB,
  asunto: 'Verificacion del cierre de escalamiento',
  contexto: 'Case levantado unicamente para verificar cerrarEscalamiento contra la org real.',
  politicaAplicada: 'Verificacion_N6',
  transcripcion: [
    { autor: 'cliente', texto: 'Necesito hablar con alguien.' },
    { autor: 'asesor', texto: 'Aqui estoy, lo atiendo.' },
  ],
});

const cierre = await cerrarEscalamiento(
  abiertoB.caseId,
  'Atendido por el asesor. Se autorizo la reparacion en garantia y se cierra el escalamiento.',
);
console.log('  cierre:', JSON.stringify(cierre));

const casoBCrudo = await consultar<Record<string, unknown>>(
  `SELECT Id, CaseNumber, Status, IsClosed, Correlation_Id__c FROM Case WHERE Id = '${abiertoB.caseId}'`,
  'prueba.caseB',
);
const logsB = await consultarTodo<Record<string, unknown>>(
  `SELECT Id, Name, Subagent__c, Action_Name__c, Outcome__c, Case__c, Correlation_Id__c ` +
    `FROM Log_Agente__c WHERE Correlation_Id__c = '${correlationB}' ORDER BY CreatedDate ASC`,
  'prueba.logB',
);
const comentariosB = await consultarTodo<Record<string, unknown>>(
  `SELECT Id, CommentBody, CreatedDate FROM CaseComment WHERE ParentId = '${abiertoB.caseId}' ` +
    `ORDER BY CreatedDate ASC, Id ASC`,
  'prueba.comentariosB',
);
await guardar('09-cierre', { abiertoB, cierre, casoBCrudo, logsB, comentariosB });

const cb = casoBCrudo.records[0] as Record<string, unknown> | undefined;
afirmar(cb?.Status === 'Closed', "el Case B quedo con Status='Closed' en la org");
afirmar(cb?.IsClosed === true, 'la org confirma IsClosed=true');
afirmar(
  comentariosB.some((c) => String(c.CommentBody ?? '').includes('CIERRE DEL ESCALAMIENTO')),
  'el comentario de cierre esta en la org',
);
afirmar(
  logsB.some((l) => l.Action_Name__c === 'Cierre_Escalamiento' && l.Case__c === abiertoB.caseId),
  'existe Log_Agente__c del cierre apuntando al Case B',
);

const bandejaDespues = await bandejaAsesor();
afirmar(
  bandejaDespues.every((c) => c.id !== abiertoB.caseId),
  'el Case cerrado ya NO aparece en la bandeja',
);
afirmar(
  bandejaDespues.some((c) => c.id === abierto.caseId),
  'el Case A sigue abierto en la bandeja para la demo',
);

// ─────────────────────────────────────────────────────────────────────────────
// [7] el sondeo ante una caída de red REAL — no se muere ni se queda callado
// ─────────────────────────────────────────────────────────────────────────────
//
// Se corre en un proceso aparte con SF_LOGIN_URL apuntando a un puerto sin nadie
// escuchando: el ECONNREFUSED es de verdad. Nada se parchea ni se simula.

console.log('\n[7] sondeo con la red caida (proceso aparte, ECONNREFUSED real)');

const hijo = await ejecutar(
  process.execPath,
  ['--experimental-strip-types', join(RAIZ, 'scripts', 'prueba-sondeo-red-caida.ts'), abierto.caseId],
  {
    cwd: RAIZ,
    env: { ...process.env, SF_LOGIN_URL: 'http://127.0.0.1:1' },
    maxBuffer: 4 * 1024 * 1024,
  },
);

const red = JSON.parse(hijo.stdout.trim().split('\n').pop() ?? '{}') as {
  totalEventos: number;
  errores: number;
  comentarios: number;
  eventosAntesDeCancelar: number;
  eventosDespuesDeCancelar: number;
  mensajes: string[];
  fallosSeguidos: number[];
};
console.log(`  ${red.errores} eventos de error, ${red.comentarios} comentarios`);
console.log(`  primer mensaje: ${red.mensajes[0]}`);
await guardar('10-sondeo-red-caida', red);

afirmar(red.errores >= 2, `el sondeo siguio intentando tras fallar (${red.errores} eventos de error)`);
afirmar(red.comentarios === 0, 'con la red caida no emitio ningun comentario inventado');
afirmar(
  red.mensajes.every((m) => /No se pudo contactar la org|ECONNREFUSED|fetch failed/i.test(m)),
  'cada evento de error lleva la causa REAL, no un mensaje generico',
);
afirmar(
  red.fallosSeguidos.join(',') === red.fallosSeguidos.map((_, i) => i + 1).join(','),
  'el contador de fallos seguidos avanza 1,2,3... para que la UI sepa cuanto lleva caido',
);
afirmar(
  red.eventosDespuesDeCancelar === red.eventosAntesDeCancelar,
  'cancelar() tambien detiene un sondeo que esta fallando',
);

// ─────────────────────────────────────────────────────────────────────────────
// Resumen
// ─────────────────────────────────────────────────────────────────────────────

const resumen = {
  sello: SELLO,
  caseA: {
    caseId: abierto.caseId,
    caseNumber: abierto.caseNumber,
    correlationId: correlationA,
    estado: 'New (abierto en la bandeja)',
    comentariosSembrados: abierto.comentariosSembrados,
    comentarioCliente: delCliente[0]?.id ?? null,
    comentarioAsesor: delAsesor[0]?.id ?? null,
    comentarioEnVivo: idEnVivo,
    totalComentariosEnOrg: comentariosCrudos.length + 1,
    logId: logApertura?.Id ?? null,
    logName: logApertura?.Name ?? null,
  },
  caseB: {
    caseId: abiertoB.caseId,
    caseNumber: abiertoB.caseNumber,
    correlationId: correlationB,
    estado: 'Closed',
    comentariosCierre: cierre.comentariosCierre,
  },
  aserciones: { total: totalAserciones, fallidas: fallos },
  evidencia: guardados,
};
await guardar('00-resumen', resumen);

console.log('\n═══════════════════════════════════════════════');
console.log(`Case A  ${abierto.caseNumber}  ${abierto.caseId}  (${correlationA})`);
console.log(`Case B  ${abiertoB.caseNumber}  ${abiertoB.caseId}  (${correlationB}) CERRADO`);
console.log(`comentario cliente: ${delCliente[0]?.id}`);
console.log(`comentario asesor:  ${delAsesor[0]?.id}`);
console.log(`comentario en vivo: ${idEnVivo}`);
console.log(`log apertura:       ${logApertura?.Name} (${logApertura?.Id})`);

if (fallos.length > 0) {
  console.error(`\n${fallos.length} ASERCIONES FALLIDAS:`);
  for (const f of fallos) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nTodas las aserciones pasaron contra la org real.');
