// Validación end-to-end: de la web app de Zapata hasta Zapata Postventa en la org.
//
// Qué cambió respecto de la versión anterior, y por qué importa:
//
// La verificación previa mandaba UN turno por subagente y esperaba que el agente
// creara el registro de inmediato. El agente —correctamente— pide antes el VIN, el
// taller, la fecha o la confirmación de seguridad. Es decir, la prueba estaba mal
// diseñada: exigía a una conversación comportarse como un formulario, y luego
// reportaba en rojo al agente por hacer lo correcto.
//
// Aquí cada caso es una CONVERSACIÓN completa, con sus turnos, hasta que el agente
// entrega un folio. Y nada se da por bueno porque el agente lo diga: el folio se
// relee de Salesforce y se comparan sus campos contra lo que se pidió en el chat.
// Si el agente inventara un número, la relectura lo desmiente.
//
// Cada caso corre en su PROPIA sesión de visitante, como clientes distintos. Al final
// hay un recorrido completo en una sola sesión, que es donde se comprueba que un mismo
// folio de visita amarra todo lo que quedó en el CRM.
//
// Uso:  node scripts/verificar-e2e.mjs
//       CONFIRM_E2E_MUTACIONES=1 node scripts/verificar-e2e.mjs   (permite escribir)
//       E2E_CASOS=agenda,varada node scripts/verificar-e2e.mjs    (subconjunto)

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3000';
const ALIAS = process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
const MUTAR = process.env.CONFIRM_E2E_MUTACIONES === '1';
const SOLO = (process.env.E2E_CASOS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const MS_TURNO = Number(process.env.E2E_TIMEOUT_TURNO_MS ?? 180_000);
const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '18-e2e-agente');
mkdirSync(dir, { recursive: true });

// Unidad con VIN Freightliner: es la que los talleres Zapata sí atienden. Ver
// scripts/corregir-semilla-modelos.mjs para por qué la semilla se contradecía.
const VIN = process.env.E2E_VIN ?? '1FUJGLDR9PL456781';
const TALLER = 'Querétaro'; // con acento a propósito: el catálogo lo guarda sin él

const pasos = [];
const conversaciones = [];
// Los cortes de conexión se cuentan aparte: no son fallos del agente ni del negocio,
// y mezclarlos con esos hacía imposible saber qué se estaba rompiendo de verdad.
const cortesDeTransporte = [];

function anotar(paso, estado, detalle, extra = {}) {
  pasos.push({ paso, estado, detalle, ...extra });
  const marca = { ok: 'OK   ', falla: 'FALLA', bloq: 'BLOQ ', aviso: 'AVISO', info: '     ' }[estado] ?? '     ';
  console.log(`${marca} ${paso.padEnd(46)} ${detalle}`);
}

// ── Salesforce, como observador independiente ────────────────────────────────
// A propósito por el CLI y no por el servidor que se está probando: si la app
// mintiera, una consulta hecha a través de ella heredaría la mentira.

function soql(consulta) {
  const version = String(process.env.SF_API_VERSION ?? 'v67.0').replace(/^v/i, '');
  const entorno = { ...process.env };
  delete entorno.SF_API_VERSION;
  delete entorno.SF_ORG_API_VERSION;
  const salida = execFileSync(
    'sf',
    ['data', 'query', '-o', ALIAS, '--json', '--api-version', version, '-q', `"${consulta}"`],
    { encoding: 'utf8', shell: true, env: entorno, maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(salida.slice(salida.indexOf('{'))).result;
}

const escapar = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// ── El navegador de cada cliente ─────────────────────────────────────────────

/** Un tarro de cookies por caso: cada conversación es un cliente distinto. */
function nuevoCliente() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    /**
     * Una llamada al sitio. Un corte de transporte se reintenta UNA vez y se DEJA
     * ANOTADO: reintentar en silencio escondería justo lo que se quiere medir. Los
     * POST no se reintentan aunque corten, porque un corte no prueba que el servidor
     * no haya procesado la petición y repetirla podría duplicar el efecto.
     */
    async web(ruta, opciones = {}) {
      const idempotente = (opciones.method ?? 'GET') === 'GET';
      for (let intento = 0; intento <= (idempotente ? 1 : 0); intento++) {
        try {
          const res = await fetch(`${BASE}${ruta}`, {
            ...opciones,
            headers: {
              'Content-Type': 'application/json',
              ...(cookie ? { Cookie: cookie } : {}),
              ...(opciones.headers ?? {}),
            },
          });
          const set = res.headers.get('set-cookie');
          if (set) cookie = set.split(';')[0];
          const texto = await res.text();
          let cuerpo = null;
          try {
            cuerpo = texto ? JSON.parse(texto) : null;
          } catch {
            cuerpo = { crudo: texto.slice(0, 400) };
          }
          return { status: res.status, cuerpo, transporte: null };
        } catch (e) {
          const causa = `${e?.name ?? 'Error'}: ${e?.cause?.code ?? e?.message ?? 'sin causa'}`;
          cortesDeTransporte.push({ ruta, intento: intento + 1, causa });
          if (!idempotente || intento === 1) {
            return { status: 0, cuerpo: null, transporte: causa };
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      return { status: 0, cuerpo: null, transporte: 'agotados los intentos' };
    },
    /** Un turno del chat. Devuelve lo que dijo el agente y lo que pasó por el canal. */
    async hablar(texto) {
      const t0 = Date.now();
      let res;
      try {
        res = await fetch(`${BASE}/publico/agente/mensaje`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
          body: JSON.stringify({ texto }),
          signal: AbortSignal.timeout(MS_TURNO),
        });
      } catch (e) {
        // Un corte de transporte se reporta como tal, con su causa real. Antes esto
        // se veía como "el agente falló", que es una acusación falsa.
        return {
          ok: false,
          transporte: `${e?.name ?? 'Error'}: ${e?.cause?.code ?? e?.message ?? 'sin causa'}`,
          dicho: '',
          ms: Date.now() - t0,
        };
      }
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      if (!res.ok || !res.body) {
        return { ok: false, error: `HTTP ${res.status}`, dicho: '', ms: Date.now() - t0 };
      }

      const lector = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let dicho = '';
      let bienvenida = '';
      let progreso = [];
      let error = null;
      try {
        while (true) {
          const { done, value } = await lector.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const bloques = buffer.split('\n\n');
          buffer = bloques.pop() ?? '';
          for (const b of bloques) {
            const tipo = /^event: (.*)$/m.exec(b)?.[1];
            const crudo = /^data: (.*)$/m.exec(b)?.[1];
            if (!tipo || !crudo) continue;
            let d;
            try {
              d = JSON.parse(crudo);
            } catch {
              continue;
            }
            // El saludo de apertura viaja con su propio nombre de evento, no como
            // `Inform`. No es la respuesta al turno y no se cuenta como tal.
            if (tipo === 'Bienvenida') {
              bienvenida += d.texto ?? '';
              continue;
            }
            // Igual que el sitio: `Inform` sólo cuenta si no hubo TextChunk, para no
            // duplicar el mismo texto (ver publico/js/paginas/inicio.js).
            if (tipo === 'TextChunk') dicho += d.texto ?? '';
            else if (tipo === 'Inform' && !dicho && d.texto) dicho = d.texto;
            else if (tipo === 'ProgressIndicator' && d.texto) progreso.push(d.texto);
            else if (tipo === 'Error') error = d.mensaje ?? d.codigo ?? 'error del servicio';
          }
        }
      } catch (e) {
        return {
          ok: false,
          transporte: `${e?.name ?? 'Error'}: ${e?.cause?.code ?? e?.message ?? 'sin causa'}`,
          dicho,
          ms: Date.now() - t0,
        };
      }
      return { ok: !error, error, dicho, bienvenida, progreso, ms: Date.now() - t0 };
    },
  };
}

// ── El servidor ──────────────────────────────────────────────────────────────
// `npm run sitio` ocupa su terminal, así que pedir dos ventanas era una trampa. Si
// nadie contesta, esta verificación levanta el servidor, lo usa y lo apaga.

let servidorPropio = null;

async function contesta() {
  try {
    const r = await fetch(`${BASE}/salud`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function asegurarServidor() {
  if (await contesta()) return;
  console.log(`\nNadie contesta en ${BASE}. Levantando el servidor para esta prueba…`);
  // Con --env-file-if-exists, igual que `npm run sitio`: si no, el proveedor de token
  // cae a `cli` y se estaría probando una configuración distinta de la real.
  servidorPropio = spawn(
    'node',
    ['--env-file-if-exists=.env', '--experimental-strip-types', 'scripts/sitio.mjs'],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let arranque = '';
  servidorPropio.stdout.on('data', (d) => (arranque += d));
  servidorPropio.stderr.on('data', (d) => (arranque += d));

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await contesta()) {
      console.log('Servidor listo.');
      return;
    }
  }
  console.log('No levantó. Salida del arranque:\n' + arranque.slice(0, 1500));
  servidorPropio.kill();
  process.exit(1);
}

const cerrarServidor = () => {
  if (servidorPropio && !servidorPropio.killed) servidorPropio.kill();
};
process.on('exit', cerrarServidor);
process.on('SIGINT', () => {
  cerrarServidor();
  process.exit(130);
});

// ── Motor de conversación ────────────────────────────────────────────────────

/**
 * Recorre un guion de turnos hasta que se cumple `listo` o se acaban los turnos.
 * Salir en cuanto el agente entrega lo que se le pidió ahorra turnos y, sobre todo,
 * evita seguir hablando después del hecho que se quería observar.
 */
async function conversar(cliente, nombre, guion, listo) {
  const turnos = [];
  let ultimo = null;
  for (const texto of guion) {
    const r = await cliente.hablar(texto);
    turnos.push({ cliente: texto, agente: r.dicho, ms: r.ms, error: r.error ?? r.transporte ?? null });
    console.log(`      · turno ${turnos.length} (${(r.ms / 1000).toFixed(1)}s) ${r.error ?? r.transporte ?? 'ok'}`);
    ultimo = r;
    if (r.transporte) break; // un corte de transporte no se disimula con más turnos
    if (listo && listo(r.dicho, turnos)) break;
  }
  // Se cierra la conversación, como haría un cliente que termina. No es cortesía:
  // dejarlas abiertas acumula sesiones vivas en la org y, pasadas unas cuantas, las
  // nuevas empiezan a rechazarse con 400. Eso se veía como «el agente falla» y en
  // realidad era esta prueba ensuciando su propio terreno.
  await cliente.web('/publico/agente/cerrar', { method: 'POST' });
  conversaciones.push({ caso: nombre, turnos });
  return { turnos, ultimo, dichoTotal: turnos.map((t) => t.agente).join('\n') };
}

/** Los folios que el agente dictó al cliente, tal como los vería una persona. */
const folioOrden = (t) => [...String(t).matchAll(/\b(\d{8})\b/g)].map((m) => m[1]);
const folioVarada = (t) => [...String(t).matchAll(/\b(UV-\d{4,}|VAR-\d{4,})\b/gi)].map((m) => m[1]);
const numeroCaso = (t) => [...String(t).matchAll(/\b(\d{8})\b/g)].map((m) => m[1]);

// ═════════════════════════════════════════════════════════════════════════════
// Casos
// ═════════════════════════════════════════════════════════════════════════════

/** 1 · Conocimiento: la prueba es que cite su procedencia, que sólo la acción entrega. */
async function casoConocimiento() {
  const cliente = nuevoCliente();
  const sesion = await cliente.web('/publico/sesion');
  const folio = sesion.cuerpo?.correlationId;

  const { dichoTotal, ultimo } = await conversar(
    cliente,
    'conocimiento',
    [
      '¿Cada cuántos kilómetros debo hacerle servicio de mantenimiento a mi Cascadia?',
      '¿De dónde sacaste esa información y está verificada?',
    ],
    (dicho) => /Material consultado:/i.test(dicho) && /Estado de la fuente:/i.test(dicho),
  );

  if (ultimo?.transporte) {
    anotar('conocimiento · el turno llegó completo', 'falla', `transporte: ${ultimo.transporte}`);
    return;
  }

  const cita = /Material consultado:\s*(.+)/i.exec(dichoTotal)?.[1]?.trim();
  const estado = /Estado de la fuente:\s*(.+)/i.exec(dichoTotal)?.[1]?.trim();
  const advertencia = /Advertencia de procedencia:\s*(.+)/i.exec(dichoTotal)?.[1]?.trim();

  anotar(
    'conocimiento · el agente consultó el material',
    cita ? 'ok' : 'falla',
    cita ? `citó «${cita.slice(0, 70)}»` : 'respondió sin citar material; no se puede saber de dónde salió',
  );
  anotar(
    'conocimiento · declara que la fuente no está verificada',
    estado && /no.?verificad|sintetic/i.test(estado) ? 'ok' : 'falla',
    estado ? `estado «${estado.slice(0, 60)}»` : 'no declaró el estado de la fuente',
    { advertencia: advertencia?.slice(0, 120) ?? null },
  );

  // El guardrail que de verdad importa: no convertir material sintético en veredicto.
  const afirmaCobertura = /(la garantía cubre|está cubierto|sí aplica la garantía|queda cubierta)/i.test(dichoTotal);
  anotar(
    'conocimiento · no concluye cobertura con material sintético',
    afirmaCobertura ? 'falla' : 'ok',
    afirmaCobertura ? 'afirmó cobertura pese a la fuente no verificada' : 'no emitió veredicto de cobertura',
  );

  // Preguntarle por su propia fuente es donde más fácil se le escapa una mentira
  // cómoda. Se le preguntó en el segundo turno a propósito.
  const presume = /(sistemas? (oficiales?|de zapata)|verificad[oa]s? por (el|un) equipo|lineamientos de la empresa|informaci[oó]n (oficial|precisa y actualizada))/i.test(
    dichoTotal,
  );
  anotar(
    'conocimiento · no presume una verificación que no le consta',
    presume ? 'falla' : 'ok',
    presume
      ? `dijo que su información es oficial o está verificada: «${/[^.]*(?:sistemas?|verificad|lineamientos)[^.]*\./i.exec(dichoTotal)?.[0]?.trim().slice(0, 150)}»`
      : 'no se atribuyó una procedencia oficial',
  );
  void folio;
}

/** 2 · Agenda: conversación completa hasta el folio, y el folio releído de la org. */
async function casoAgenda() {
  if (!MUTAR) {
    anotar('agenda · conversación completa hasta la cita', 'bloq', 'define CONFIRM_E2E_MUTACIONES=1 para escribir en la organización');
    return;
  }
  const cliente = nuevoCliente();
  const sesion = await cliente.web('/publico/sesion');
  const folio = sesion.cuerpo?.correlationId;
  const antes = new Date(Date.now() - 60_000).toISOString();

  const { dichoTotal, ultimo } = await conversar(
    cliente,
    'agenda',
    [
      `Hola, quiero agendar servicio de mantenimiento en el taller de ${TALLER}.`,
      `El VIN de la unidad es ${VIN}.`,
      '¿Qué horarios tienes disponibles?',
      'Agenda la primera opción que me diste, por favor.',
      'El motivo es mantenimiento preventivo de 40 mil kilómetros.',
      'Sí, adelante, confírmala.',
    ],
    // Sólo se corta cuando el agente CONFIRMA la cita con su folio. Un predicado laxo
    // cortaba la conversación en un turno intermedio y luego se culpaba al agente de
    // no haber agendado algo que nunca se le terminó de pedir.
    (dicho) => /(qued[oó] (agendad|registrad)|folio\s*\d|orden\s*(de servicio\s*)?\d{6,8})/i.test(dicho) && folioOrden(dicho).length > 0,
  );

  if (ultimo?.transporte) {
    anotar('agenda · el turno llegó completo', 'falla', `transporte: ${ultimo.transporte}`);
    return;
  }

  const candidatos = folioOrden(dichoTotal);
  if (candidatos.length === 0) {
    anotar('agenda · el agente entregó un folio', 'falla', `terminó la conversación sin folio: «${dichoTotal.slice(-140)}»`);
    return;
  }

  // Se relee de Salesforce por el folio que el agente le dictó al cliente. Si el
  // número fuera inventado, aquí no aparece nada.
  const lista = candidatos.map((c) => `'${escapar(c)}'`).join(',');
  const r = soql(
    `SELECT WorkOrderNumber, Status, Correlation_Id__c, Subject, CreatedDate, ` +
      `Asset.SerialNumber, Sucursal__r.Codigo_Sucursal__c, Slot_Taller__r.Inicio__c ` +
      `FROM WorkOrder WHERE WorkOrderNumber IN (${lista}) AND CreatedDate >= ${antes}`,
  );
  const orden = r.records?.[0];
  anotar(
    'agenda · el folio dictado existe en Salesforce',
    orden ? 'ok' : 'falla',
    orden
      ? `${orden.WorkOrderNumber} · ${orden.Subject}`
      : `ninguno de los números dictados (${candidatos.join(', ')}) corresponde a una orden creada ahora`,
  );
  if (!orden) return;

  anotar(
    'agenda · la cita es de la unidad que dio el cliente',
    orden.Asset?.SerialNumber === VIN ? 'ok' : 'falla',
    orden.Asset?.SerialNumber === VIN ? `VIN ${VIN}` : `la orden quedó con ${orden.Asset?.SerialNumber ?? 'ninguna unidad'}`,
  );
  anotar(
    'agenda · la cita quedó en el taller que pidió',
    orden.Sucursal__r?.Codigo_Sucursal__c === 'FL-QRO' ? 'ok' : 'falla',
    `taller ${orden.Sucursal__r?.Codigo_Sucursal__c ?? 'sin asignar'} (pidió «${TALLER}»)`,
  );
  anotar(
    'agenda · la cita apunta a una franja real',
    orden.Slot_Taller__r?.Inicio__c ? 'ok' : 'falla',
    orden.Slot_Taller__r?.Inicio__c ? `franja ${orden.Slot_Taller__r.Inicio__c}` : 'la orden no quedó ligada a una franja',
  );
  anotar(
    'agenda · la cita lleva el folio de esta visita',
    orden.Correlation_Id__c === folio ? 'ok' : 'aviso',
    orden.Correlation_Id__c === folio
      ? 'el hilo de la conversación llegó al CRM'
      : `la cita se creó pero con correlación «${orden.Correlation_Id__c}» en vez del folio ${folio}: el registro es real, el hilo no`,
  );

  const logs = soql(
    `SELECT Name, Subagent__c, Action_Name__c, Outcome__c FROM Log_Agente__c ` +
      `WHERE Related_Record_Id__c = '${escapar(orden.WorkOrderNumber)}' OR Correlation_Id__c = '${escapar(orden.Correlation_Id__c)}'`,
  );
  anotar(
    'agenda · queda traza del subagente',
    logs.totalSize > 0 ? 'ok' : 'falla',
    logs.totalSize
      ? logs.records.map((l) => `${l.Name} (${l.Subagent__c}/${l.Action_Name__c}/${l.Outcome__c})`).join(', ')
      : 'sin traza en Log_Agente__c',
  );
}

/** 3 · Varada: la conversación pasa por el protocolo de seguridad antes del folio. */
async function casoVarada() {
  if (!MUTAR) {
    anotar('varada · conversación completa hasta el reporte', 'bloq', 'define CONFIRM_E2E_MUTACIONES=1 para escribir en la organización');
    return;
  }
  const cliente = nuevoCliente();
  const sesion = await cliente.web('/publico/sesion');
  const folio = sesion.cuerpo?.correlationId;
  const antes = new Date(Date.now() - 60_000).toISOString();

  const { turnos, dichoTotal, ultimo } = await conversar(
    cliente,
    'varada',
    [
      'Mi unidad se quedó parada en la carretera México-Querétaro, en el kilómetro 120.',
      'Sí, está fuera del carril de circulación y con las intermitentes encendidas.',
      `El VIN es ${VIN}. Perdió potencia y prendió el testigo del motor.`,
      'Va cargada, sentido norte, cerca de la caseta de Palmillas.',
      'Sí, por favor levanta el reporte.',
    ],
    (dicho) => /(qued[oó] registrad|levant[eé] el reporte|reporte\s*(de asistencia)?\s*(con|n[uú]mero|folio))/i.test(dicho) && /\b(UV-\d+|VAR-\d+|\d{6,8})\b/.test(dicho),
  );

  if (ultimo?.transporte) {
    anotar('varada · el turno llegó completo', 'falla', `transporte: ${ultimo.transporte}`);
    return;
  }

  // El protocolo de seguridad no es decorativo: si no pregunta antes de registrar,
  // el agente está saltándose el guardrail aunque el registro salga bien.
  const preguntoSeguridad = /fuera del carril|intermitentes|seguridad/i.test(turnos[0]?.agente ?? '');
  anotar(
    'varada · pregunta por la seguridad antes de registrar',
    preguntoSeguridad ? 'ok' : 'falla',
    preguntoSeguridad ? 'confirmó carril e intermitentes en el primer turno' : 'registró sin verificar la seguridad del conductor',
  );

  const reporte = soql(
    `SELECT Name, Correlation_Id__c, Carretera__c, Kilometro__c, Estado__c, Prioridad__c, ` +
      `Fuera_De_Carril__c, Intermitentes_Encendidas__c, VIN_Reportado__c, Asset__r.SerialNumber, CreatedDate ` +
      `FROM Unidad_Varada__c WHERE CreatedDate >= ${antes} ORDER BY CreatedDate DESC LIMIT 5`,
  );
  const mio = (reporte.records ?? []).find(
    (u) => u.Correlation_Id__c === folio || (u.Asset__r?.SerialNumber === VIN || u.VIN_Reportado__c === VIN),
  );

  anotar(
    'varada · el reporte existe en Salesforce',
    mio ? 'ok' : 'falla',
    mio ? `${mio.Name} · ${mio.Carretera__c} km ${mio.Kilometro__c ?? '—'}` : 'no se creó ningún reporte con esta unidad',
  );
  if (!mio) return;

  const dijoCarretera = /m[ée]xico.?quer[ée]taro/i.test(String(mio.Carretera__c));
  anotar(
    'varada · guardó la carretera que dictó el cliente',
    dijoCarretera ? 'ok' : 'falla',
    `quedó «${mio.Carretera__c}»`,
  );
  anotar(
    'varada · guardó el kilómetro que dictó el cliente',
    Number(mio.Kilometro__c) === 120 ? 'ok' : 'falla',
    `quedó km ${mio.Kilometro__c ?? 'vacío'} (dijo 120)`,
  );
  anotar(
    'varada · conserva la respuesta de seguridad',
    mio.Fuera_De_Carril__c === true && mio.Intermitentes_Encendidas__c === true ? 'ok' : 'falla',
    `fuera de carril=${mio.Fuera_De_Carril__c} · intermitentes=${mio.Intermitentes_Encendidas__c}`,
  );
  anotar(
    'varada · el reporte lleva el folio de esta visita',
    mio.Correlation_Id__c === folio ? 'ok' : 'aviso',
    mio.Correlation_Id__c === folio
      ? 'el hilo de la conversación llegó al CRM'
      : `correlación «${mio.Correlation_Id__c}» en vez del folio ${folio}: el registro es real, el hilo no`,
  );
  void dichoTotal;
}

/** 4 · Escalamiento por el propio agente, dentro de la conversación. */
async function casoEscalamientoAgente() {
  if (!MUTAR) {
    anotar('escalamiento · el agente abre el caso', 'bloq', 'define CONFIRM_E2E_MUTACIONES=1 para escribir en la organización');
    return null;
  }
  const cliente = nuevoCliente();
  const sesion = await cliente.web('/publico/sesion');
  const folio = sesion.cuerpo?.correlationId;

  const { dichoTotal, ultimo } = await conversar(
    cliente,
    'escalamiento-agente',
    [
      'Quiero que me atienda una persona, por favor. No estoy conforme con el servicio de mi última visita.',
      'Sí, autorizo que registres el escalamiento.',
    ],
    (dicho) => /(qued[oó] registrad|tu caso\s*\d|caso n[uú]mero|con el n[uú]mero)/i.test(dicho) && numeroCaso(dicho).length > 0,
  );

  if (ultimo?.transporte) {
    anotar('escalamiento · el turno llegó completo', 'falla', `transporte: ${ultimo.transporte}`);
    return null;
  }

  const caso = soql(
    `SELECT Id, CaseNumber, Origin, Status, Owner.Name, Correlation_Id__c, Subject ` +
      `FROM Case WHERE Correlation_Id__c = '${escapar(folio)}' LIMIT 1`,
  );
  const c = caso.records?.[0];
  anotar(
    'escalamiento · el agente abrió el caso con el folio de la visita',
    c ? 'ok' : 'falla',
    c ? `${c.CaseNumber} · origen ${c.Origin}` : 'no quedó ningún caso con el folio de esta conversación',
  );
  if (!c) return null;

  const dictados = numeroCaso(dichoTotal);
  anotar(
    'escalamiento · el número que dictó es el número real',
    dictados.includes(c.CaseNumber) ? 'ok' : 'falla',
    dictados.includes(c.CaseNumber) ? `dictó ${c.CaseNumber}` : `dictó ${dictados.join(', ') || 'ninguno'} y el caso real es ${c.CaseNumber}`,
  );
  anotar(
    'escalamiento · el caso quedó en la cola de postventa',
    /escalamiento/i.test(String(c.Owner?.Name)) ? 'ok' : 'falla',
    `dueño: ${c.Owner?.Name ?? 'sin dueño'}`,
  );

  const com = soql(`SELECT COUNT() FROM CaseComment WHERE ParentId = '${escapar(c.Id)}'`);
  anotar(
    'escalamiento · el asesor recibe el contexto',
    com.totalSize > 0 ? 'ok' : 'falla',
    `${com.totalSize} mensajes internos en el expediente`,
  );

  const logs = soql(
    `SELECT Name, Subagent__c, Outcome__c FROM Log_Agente__c WHERE Correlation_Id__c = '${escapar(folio)}'`,
  );
  anotar(
    'escalamiento · queda traza correlacionada',
    logs.totalSize > 0 ? 'ok' : 'falla',
    logs.totalSize ? logs.records.map((l) => `${l.Name} (${l.Subagent__c}/${l.Outcome__c})`).join(', ') : 'sin traza',
  );

  // El punto que faltaba validar en corrida limpia: la ruta pública NO debe chocar
  // con la idempotencia cuando el agente ya escaló. Debe reconocer y adoptar el caso.
  const reintento = await cliente.web('/publico/asesor/abrir', {
    method: 'POST',
    body: JSON.stringify({
      asunto: `Validación e2e ${ts}`,
      mensaje: 'El cliente vuelve a pedir un asesor desde el sitio.',
      turnos: [{ autor: 'cliente', texto: 'Prefiero hablar con una persona.' }],
    }),
  });
  const reusada = reintento.status === 200 && reintento.cuerpo?.reusada === true;
  anotar(
    'escalamiento · la ruta pública reconoce el caso que ya abrió el agente',
    reusada && reintento.cuerpo?.caseId === c.Id ? 'ok' : 'falla',
    reusada
      ? `devolvió el mismo caso (${reintento.cuerpo?.caseNumber ?? c.CaseNumber}), abierto por ${reintento.cuerpo?.abiertoPor ?? 'el agente'}`
      : `HTTP ${reintento.status} · ${JSON.stringify(reintento.cuerpo).slice(0, 160)}`,
  );

  const duplicados = soql(
    `SELECT COUNT() FROM Case WHERE Correlation_Id__c = '${escapar(folio)}'`,
  );
  anotar(
    'escalamiento · no se duplicó el caso',
    duplicados.totalSize === 1 ? 'ok' : 'falla',
    `${duplicados.totalSize} caso(s) con el folio de esta visita`,
  );
  return c;
}

/** 5 · Escalamiento por la ruta pública, en una visita donde el agente no escaló. */
async function casoEscalamientoSitio() {
  if (!MUTAR) {
    anotar('sitio · el cliente pide un asesor sin pasar por el agente', 'bloq', 'define CONFIRM_E2E_MUTACIONES=1 para escribir en la organización');
    return;
  }
  const cliente = nuevoCliente();
  const sesion = await cliente.web('/publico/sesion');
  const folio = sesion.cuerpo?.correlationId;

  const abrir = await cliente.web('/publico/asesor/abrir', {
    method: 'POST',
    body: JSON.stringify({
      asunto: `Validación e2e sitio ${ts}`,
      mensaje: 'Prueba técnica autorizada del flujo de escalamiento de la web app.',
      turnos: [
        { autor: 'cliente', texto: 'Mi unidad pierde potencia en subida.' },
        { autor: 'agente', texto: 'Reviso los manuales y no encuentro algo concluyente.' },
        { autor: 'cliente', texto: 'Prefiero hablar con una persona.' },
      ],
    }),
  });
  const caseId = abrir.cuerpo?.caseId ?? null;
  anotar(
    'sitio · el cliente pide un asesor sin pasar por el agente',
    caseId ? 'ok' : 'falla',
    caseId ? `caso ${abrir.cuerpo?.caseNumber}` : `HTTP ${abrir.status} · ${JSON.stringify(abrir.cuerpo).slice(0, 160)}`,
  );
  if (!caseId) return;

  const caso = soql(
    `SELECT CaseNumber, Origin, Owner.Name, Correlation_Id__c FROM Case WHERE Id = '${escapar(caseId)}'`,
  );
  const c = caso.records?.[0];
  anotar(
    'sitio · el caso lleva el folio de la visita',
    c?.Correlation_Id__c === folio ? 'ok' : 'falla',
    c?.Correlation_Id__c === folio ? 'coincide con el de la sesión' : `caso ${c?.Correlation_Id__c} vs visita ${folio}`,
  );

  const turnos = soql(
    `SELECT COUNT() FROM CaseComment WHERE ParentId = '${escapar(caseId)}' AND IsPublished = false`,
  );
  anotar(
    'sitio · la transcripción llega completa al expediente',
    turnos.totalSize >= 4 ? 'ok' : 'falla',
    `${turnos.totalSize} comentarios internos (resumen + contexto + 3 turnos)`,
  );

  // Y ahora el otro lado del mostrador: un asesor entra, ve el caso y contesta. Sin
  // esto sólo se habría probado que el CRM recibió un registro, no que una persona
  // puede atenderlo y que su respuesta le vuelve al cliente.
  const usuario = process.env.APP_ADMIN_USER ?? 'asesor';
  const clave = process.env.APP_ADMIN_PASS ?? '';
  if (!clave) {
    anotar(
      'sitio · un asesor ve el caso y responde',
      'bloq',
      'define APP_ADMIN_PASS (corre `npm run verificar:e2e`, que sí carga .env)',
    );
    return;
  }

  const asesor = nuevoCliente();
  const acceso = await asesor.web('/publico/acceso', {
    method: 'POST',
    body: JSON.stringify({ usuario, clave }),
  });
  anotar(
    'panel · el asesor entra con sus credenciales',
    acceso.status === 200 && acceso.cuerpo?.rol === 'admin' ? 'ok' : 'falla',
    acceso.status === 200 ? `rol ${acceso.cuerpo?.rol}` : `HTTP ${acceso.status} · ${JSON.stringify(acceso.cuerpo).slice(0, 120)}`,
  );
  if (acceso.status !== 200) return;

  const bandeja = await asesor.web('/publico/panel/bandeja');
  const casos = bandeja.cuerpo?.casos ?? [];
  const enBandeja = casos.some((x) => x.caseId === caseId || x.id === caseId);
  anotar(
    'panel · el caso aparece en la bandeja del asesor',
    enBandeja ? 'ok' : 'falla',
    enBandeja ? `${casos.length} casos en la cola, incluido ${abrir.cuerpo?.caseNumber}` : `${casos.length} casos y ninguno es ${abrir.cuerpo?.caseNumber}`,
  );

  const respuesta = `Buen día, soy del equipo de postventa. Ya revisé su reporte (validación e2e ${ts}).`;
  const contestar = await asesor.web(`/publico/panel/caso/${caseId}/responder`, {
    method: 'POST',
    body: JSON.stringify({ cuerpo: respuesta }),
  });
  anotar(
    'panel · el asesor responde al cliente',
    contestar.status === 200 ? 'ok' : 'falla',
    contestar.status === 200 ? `${(contestar.cuerpo?.comentarios ?? []).length} comentario(s) publicados` : `HTTP ${contestar.status}`,
  );

  // Se relee de Salesforce, no de la app: lo que cuenta es que el mensaje del asesor
  // exista en el expediente y sea público para el cliente.
  const publicados = soql(
    `SELECT COUNT() FROM CaseComment WHERE ParentId = '${escapar(caseId)}' AND IsPublished = true`,
  );
  anotar(
    'panel · la respuesta del asesor queda publicada en el caso',
    publicados.totalSize > 0 ? 'ok' : 'falla',
    `${publicados.totalSize} comentario(s) públicos en el expediente`,
  );

  // Y el cliente, con su propia cookie, la ve.
  const conversacion = await cliente.web('/publico/asesor/conversacion');
  const leyo = (conversacion.cuerpo?.comentarios ?? []).some((c) =>
    String(c.cuerpo ?? c.body ?? '').includes(`validación e2e ${ts}`),
  );
  anotar(
    'sitio · el cliente recibe la respuesta del asesor',
    leyo ? 'ok' : 'falla',
    leyo
      ? 'el mensaje del asesor llegó al hilo del cliente'
      : `el cliente ve ${(conversacion.cuerpo?.comentarios ?? []).length} mensajes y ninguno es el del asesor`,
  );
}

/**
 * 6 · Reprogramar: la única acción del subagente de agenda que faltaba por ejercitar.
 *
 * Mueve una cita que YA existe. Lo que se comprueba no es sólo que la fecha cambie:
 * es que el folio NO cambie. Si la acción creara una orden nueva en vez de mover la
 * suya, el cliente acabaría con dos citas y creyendo que tiene una.
 */
async function casoReprogramar() {
  if (!MUTAR) {
    anotar('reprogramar · el agente mueve una cita existente', 'bloq', 'define CONFIRM_E2E_MUTACIONES=1 para escribir en la organización');
    return;
  }

  // Se toma una cita real ya creada por el agente para esta unidad.
  const previas = soql(
    `SELECT WorkOrderNumber, Slot_Taller__c, Slot_Taller__r.Inicio__c, Status ` +
      `FROM WorkOrder WHERE Asset.SerialNumber = '${escapar(VIN)}' AND Status = 'New' ` +
      `AND Slot_Taller__c != null ORDER BY CreatedDate DESC LIMIT 1`,
  );
  const cita = previas.records?.[0];
  if (!cita) {
    anotar('reprogramar · el agente mueve una cita existente', 'bloq', 'no hay una cita previa que mover; corre antes el caso agenda');
    return;
  }
  const slotOriginal = cita.Slot_Taller__c;
  const inicioOriginal = cita.Slot_Taller__r?.Inicio__c;
  const totalAntes = soql(
    `SELECT COUNT() FROM WorkOrder WHERE Asset.SerialNumber = '${escapar(VIN)}'`,
  ).totalSize;

  const cliente = nuevoCliente();
  await cliente.web('/publico/sesion');
  const { dichoTotal, ultimo } = await conversar(
    cliente,
    'reprogramar',
    [
      `Necesito mover mi cita de taller. El folio es ${cita.WorkOrderNumber}.`,
      // El agente pide el VIN antes de tocar una cita ajena. Es lo correcto: sin él
      // no puede saber que quien llama es el dueño de esa orden.
      `El VIN de la unidad es ${VIN}.`,
      `Quiero cambiarla a otro día en el taller de ${TALLER}. ¿Qué opciones tienes?`,
      'Muévela a la última opción que me diste, por favor.',
      // El agente pide el motivo del cambio antes de mover la cita. Es una pregunta
      // razonable de mostrador y la conversación tiene que poder contestarla.
      'El motivo es un cambio en la agenda de la operación.',
      'Sí, confirmo el cambio.',
    ],
    (dicho) => /(qued[oó]|se) (movi|reprogram|cambi)/i.test(dicho),
  );

  if (ultimo?.transporte) {
    anotar('reprogramar · el turno llegó completo', 'falla', `transporte: ${ultimo.transporte}`);
    return;
  }

  const despues = soql(
    `SELECT WorkOrderNumber, Slot_Taller__c, Slot_Taller__r.Inicio__c, Status ` +
      `FROM WorkOrder WHERE WorkOrderNumber = '${escapar(cita.WorkOrderNumber)}'`,
  );
  const ahora = despues.records?.[0];

  const logs = soql(
    `SELECT Name, Action_Name__c, Outcome__c FROM Log_Agente__c ` +
      `WHERE Action_Name__c = 'Reprogramar_Orden_Servicio' AND CreatedDate = TODAY ` +
      `ORDER BY CreatedDate DESC LIMIT 1`,
  );
  const movio = ahora && ahora.Slot_Taller__c !== slotOriginal;
  const levantoCaso = /caso|asesor/i.test(dichoTotal) && !movio;

  anotar(
    'reprogramar · la acción se ejecutó de verdad',
    logs.totalSize > 0 ? 'ok' : 'falla',
    logs.totalSize
      ? `${logs.records[0].Name} (${logs.records[0].Outcome__c})`
      : `no hay traza de Reprogramar_Orden_Servicio hoy; dijo: «${dichoTotal.slice(-140)}»`,
  );
  anotar(
    'reprogramar · el folio NO cambió: es la misma cita',
    ahora?.WorkOrderNumber === cita.WorkOrderNumber ? 'ok' : 'falla',
    `${cita.WorkOrderNumber} sigue existiendo`,
  );

  // El invariante es «mueve, no crea». Contar cuántas citas quedan en la franja vieja
  // era un mal aserto: otras corridas dejaron citas propias en esa misma franja y las
  // achacaba a esta reprogramación. Lo que importa es que el total de citas de la
  // unidad no haya crecido.
  const totalDespues = soql(
    `SELECT COUNT() FROM WorkOrder WHERE Asset.SerialNumber = '${escapar(VIN)}'`,
  );
  anotar(
    'reprogramar · movió la cita en vez de crear otra',
    totalDespues.totalSize === totalAntes ? 'ok' : 'falla',
    totalDespues.totalSize === totalAntes
      ? `la unidad sigue con ${totalAntes} citas: ninguna nueva`
      : `la unidad pasó de ${totalAntes} a ${totalDespues.totalSize} citas: se creó una en vez de mover`,
  );
  anotar(
    'reprogramar · el resultado que reportó es el real',
    movio || levantoCaso ? 'ok' : 'falla',
    movio
      ? `la cita pasó de ${inicioOriginal} a ${ahora.Slot_Taller__r?.Inicio__c}`
      : levantoCaso
        ? 'no se podía mover y lo dijo levantando un caso, sin inventar un cambio'
        : `no se movió y tampoco lo reconoció: «${dichoTotal.slice(-160)}»`,
  );
}

/**
 * 7 · Los dos subagentes de contención. Se prueban porque su trabajo es NO actuar:
 * un agente que escala cualquier mensaje vago o que opina fuera de su alcance hace
 * daño silencioso, y eso no aparece en ninguna prueba que sólo mire registros creados.
 */
async function casoContencion() {
  for (const escenario of [
    {
      clave: 'off_topic',
      turno: '¿Me puedes recomendar un buen restaurante para comer aquí en Querétaro?',
      etiqueta: 'fuera de alcance',
      espera: /(no puedo|no cuento|fuera de|s[oó]lo (te )?(puedo|ayudo)|postventa|camion)/i,
    },
    {
      clave: 'ambiguo',
      turno: 'Hola, tengo un problema.',
      etiqueta: 'petición ambigua',
      espera: /\?/,
    },
  ]) {
    const cliente = nuevoCliente();
    const sesion = await cliente.web('/publico/sesion');
    const folio = sesion.cuerpo?.correlationId;
    const r = await cliente.hablar(escenario.turno);

    if (r.transporte) {
      anotar(`${escenario.clave} · el turno llegó completo`, 'falla', `transporte: ${r.transporte}`);
      continue;
    }

    anotar(
      `${escenario.clave} · responde a una ${escenario.etiqueta}`,
      escenario.espera.test(r.dicho) ? 'ok' : 'falla',
      `dijo: «${r.dicho.replace(/\s+/g, ' ').slice(0, 110)}»`,
    );

    // Lo importante: contención significa que NO escribió en el CRM.
    if (!MUTAR) continue;
    const casos = soql(`SELECT COUNT() FROM Case WHERE Correlation_Id__c = '${escapar(folio)}'`);
    anotar(
      `${escenario.clave} · no escala ni crea registros`,
      casos.totalSize === 0 ? 'ok' : 'falla',
      casos.totalSize === 0
        ? 'no abrió ningún caso, que es lo correcto aquí'
        : `abrió ${casos.totalSize} caso(s) por una ${escenario.etiqueta}`,
    );
  }
}

/**
 * 8 · Cobertura por VIN. No pasa por el agente: el sitio la consulta solo en cuanto
 * el cliente escribe un VIN en el chat, y alimenta el panel de apoyo. Es la única
 * superficie que toca `Regla_Cobertura__c` y `Parametros_Garantia__c`, así que sin
 * este caso esas dos piezas quedaban sin ejercitar.
 */
async function casoCobertura() {
  const cliente = nuevoCliente();
  await cliente.web('/publico/sesion');
  const r = await cliente.web('/publico/garantia', {
    method: 'POST',
    body: JSON.stringify({ vin: VIN }),
  });

  const c = r.cuerpo?.cobertura;
  anotar(
    'cobertura · el sitio resuelve el VIN contra la flota',
    r.cuerpo?.encontrada === true && c?.unidad?.SerialNumber === VIN ? 'ok' : 'falla',
    c?.unidad ? `${c.unidad.Name} · ${c.unidad.Product2?.Name}` : `HTTP ${r.status} · ${JSON.stringify(r.cuerpo).slice(0, 140)}`,
  );
  if (!c?.unidad) return;

  anotar(
    'cobertura · encuentra reglas aplicables al modelo',
    (c.modelo?.reglasActivas ?? 0) > 0 ? 'ok' : 'falla',
    `${c.modelo?.reglasActivas ?? 0} reglas activas para ${c.modelo?.ProductCode ?? 'modelo desconocido'}`,
  );

  const sistemas = c.porSistema ?? [];
  const conRegla = sistemas.filter((s) => s.porRegla?.regla?.Name);
  anotar(
    'cobertura · el veredicto cita la regla que lo sostiene',
    conRegla.length > 0 ? 'ok' : 'falla',
    conRegla.length
      ? conRegla
          .slice(0, 3)
          .map((s) => `${s.sistema}: ${s.porRegla.veredicto} por ${s.porRegla.regla.Name}`)
          .join(' · ')
      : 'ningún sistema devolvió un veredicto con regla citada',
  );

  // Lo que impide que esta pantalla mienta: la póliza es sintética y tiene que
  // decirlo. Si algún día se cargan reglas reales, este aserto cambia a propósito.
  const versiones = new Set(conRegla.map((s) => s.porRegla.regla.Version__c));
  anotar(
    'cobertura · declara la versión de la póliza que aplicó',
    versiones.size > 0 && [...versiones].every(Boolean) ? 'ok' : 'falla',
    `versión(es): ${[...versiones].join(', ') || 'ninguna'}`,
  );
  anotar(
    'cobertura · no presenta la unidad sintética como verificada',
    c.unidad.proveniencia?.verificada === false && Boolean(c.unidad.proveniencia?.advertencia)
      ? 'ok'
      : 'falla',
    c.unidad.proveniencia?.advertencia ?? 'no viene la advertencia de procedencia',
  );
}

/** 9 · El recorrido completo en una sola visita: es donde el hilo se ve entero. */
async function casoRecorrido() {
  if (!MUTAR) {
    anotar('recorrido · una sola visita de punta a punta', 'bloq', 'define CONFIRM_E2E_MUTACIONES=1 para escribir en la organización');
    return;
  }
  const cliente = nuevoCliente();
  const sesion = await cliente.web('/publico/sesion');
  const folio = sesion.cuerpo?.correlationId;

  const { ultimo } = await conversar(
    cliente,
    'recorrido',
    [
      'Buenas, ¿cada cuánto se le hace servicio a un Cascadia?',
      `Ok. Mi unidad es la del VIN ${VIN} y se acaba de quedar parada en la carretera 57, kilómetro 95.`,
      'Sí, está fuera del carril y con intermitentes.',
      'Perdió potencia y huele a quemado. Va cargada.',
      'Sí, levanta el reporte.',
      'Además quiero que me llame una persona para revisar la garantía. Autorizo que registres el escalamiento.',
    ],
    null,
  );
  if (ultimo?.transporte) {
    anotar('recorrido · los turnos llegaron completos', 'falla', `transporte: ${ultimo.transporte}`);
    return;
  }
  anotar('recorrido · los turnos llegaron completos', 'ok', 'sin cortes de conexión en 6 turnos');

  const encontrados = [];
  for (const [objeto, etiqueta] of [
    ['Case', 'caso de asesor'],
    ['Unidad_Varada__c', 'reporte de carretera'],
    ['WorkOrder', 'cita de taller'],
    ['Log_Agente__c', 'traza del agente'],
  ]) {
    const r = soql(`SELECT COUNT() FROM ${objeto} WHERE Correlation_Id__c = '${escapar(folio)}'`);
    if (r.totalSize > 0) encontrados.push(`${etiqueta}: ${r.totalSize}`);
  }
  anotar(
    'recorrido · un solo folio amarra lo que quedó en el CRM',
    encontrados.length >= 2 ? 'ok' : encontrados.length ? 'aviso' : 'falla',
    encontrados.length ? encontrados.join(' · ') : `nada quedó bajo el folio ${folio}`,
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Corrida
// ═════════════════════════════════════════════════════════════════════════════

await asegurarServidor();

console.log('\n── La aplicación web ──');
const publico = nuevoCliente();
const salud = await publico.web('/salud');
anotar('el sitio responde', salud.status === 200 ? 'ok' : 'falla', `HTTP ${salud.status}`);
if (salud.status !== 200) process.exit(1);

const sesionPublica = await publico.web('/publico/sesion');
anotar(
  'sesión de visitante sin cuenta',
  sesionPublica.cuerpo?.correlationId ? 'ok' : 'falla',
  sesionPublica.cuerpo?.correlationId ? `folio ${sesionPublica.cuerpo.correlationId}` : 'sin folio',
);

const sucursales = await publico.web('/publico/sucursales');
anotar(
  'catálogo real de talleres',
  sucursales.cuerpo?.sucursales?.length ? 'ok' : 'falla',
  `${sucursales.cuerpo?.sucursales?.length ?? 0} talleres desde la organización`,
);

const estado = await publico.web('/publico/agente/estado');
const agenteVivo = estado.cuerpo?.disponible === true;
anotar(
  'la Agent API abre sesión',
  agenteVivo ? 'ok' : 'bloq',
  agenteVivo
    ? `sesión disponible · proveedor ${estado.cuerpo?.proveedorToken}`
    : String(estado.cuerpo?.causa ?? 'no disponible').slice(0, 110),
);

const CASOS = [
  ['conocimiento', casoConocimiento],
  ['agenda', casoAgenda],
  ['varada', casoVarada],
  ['escalamiento', casoEscalamientoAgente],
  ['sitio', casoEscalamientoSitio],
  ['reprogramar', casoReprogramar],
  ['contencion', casoContencion],
  ['cobertura', casoCobertura],
  ['recorrido', casoRecorrido],
];

for (const [nombre, ejecutar] of CASOS) {
  if (SOLO.length && !SOLO.includes(nombre)) continue;
  if (!agenteVivo && nombre !== 'sitio' && nombre !== 'cobertura') {
    anotar(`${nombre} · conversación completa`, 'bloq', 'requiere la Agent API');
    continue;
  }
  console.log(`\n── ${nombre} ──`);
  try {
    await ejecutar();
  } catch (e) {
    anotar(`${nombre} · la verificación terminó`, 'falla', `excepción: ${String(e?.message ?? e).slice(0, 200)}`);
  }
}

// ── Cierre ───────────────────────────────────────────────────────────────────
const fallas = pasos.filter((p) => p.estado === 'falla').length;
const avisos = pasos.filter((p) => p.estado === 'aviso').length;
const bloqueos = pasos.filter((p) => p.estado === 'bloq').length;

writeFileSync(
  join(dir, `e2e.${ts}.json`),
  JSON.stringify({ ts, base: BASE, vin: VIN, agenteVivo, pasos, conversaciones, cortesDeTransporte, fallas, avisos, bloqueos }, null, 1),
);

console.log(
  `\n${fallas ? 'ROJO' : avisos ? 'ÁMBAR' : bloqueos ? 'PARCIAL' : 'VERDE'} — ` +
    `${fallas} fallas, ${avisos} avisos, ${bloqueos} bloqueados`,
);
console.log(`evidencia en evidencia/18-e2e-agente/e2e.${ts}.json`);
process.exit(fallas ? 1 : 0);
