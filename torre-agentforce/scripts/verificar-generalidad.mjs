/**
 * ¿Funciona el sistema, o funciona el demo?
 *
 * `verificar-e2e.mjs` prueba que las conversaciones cierran. `verificar-guion.mjs`
 * prueba que el video se puede grabar. Las dos usan la unidad y el taller del guion,
 * y por eso ninguna de las dos contesta la pregunta que importa antes de enseñarle
 * esto a alguien: si mañana entra OTRO cliente, con OTRA unidad, de OTRO modelo, y
 * pide cita en OTRO taller, ¿sigue funcionando, o sólo funcionaba aquel camino?
 *
 * Aquí no hay ni un dato escrito a mano. Todo —unidades, modelos, sucursales,
 * clientes— se le pregunta a la organización al arrancar, y las comprobaciones se
 * derivan de lo que la org conteste. Si mañana se carga una flota distinta, esta
 * verificación se adapta sola; y si la flota no da para probar algo, lo dice en vez
 * de saltárselo en silencio.
 *
 * El criterio de cada caso es siempre el mismo, y es una DISYUNCIÓN:
 *
 *     o hace el trabajo de verdad, y Salesforce lo confirma,
 *     o se niega dando una razón que es cierta.
 *
 * Lo que nunca puede hacer es inventar. Un taller que no puede apartar y dice que sí,
 * un modelo sin catálogo que recibe un veredicto de cobertura, una unidad que no
 * existe y a la que se le atribuye un kilometraje: eso es lo que se busca.
 *
 * Uso:
 *   npm run verificar:generalidad
 *   GEN_SIN_AGENTE=1 npm run verificar:generalidad   (sólo lo determinista, sin gastar sesiones)
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.GEN_BASE ?? 'http://localhost:3000';
const ALIAS = process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
const CON_AGENTE = process.env.GEN_SIN_AGENTE !== '1';
const MS_TURNO = Number(process.env.GEN_TIMEOUT_TURNO_MS ?? 180_000);

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '20-generalidad');
mkdirSync(dir, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────

const bloques = [];
let bloque = null;

function seccion(titulo, subtitulo) {
  bloque = { titulo, subtitulo, checks: [] };
  bloques.push(bloque);
  console.log(`\n── ${titulo} ──`);
  if (subtitulo) console.log(`   ${subtitulo}`);
}

/** estado: ok | falla | dato | bloq */
function check(nombre, estado, detalle) {
  bloque.checks.push({ nombre, estado, detalle });
  const marca = { ok: 'OK   ', falla: 'FALLA', dato: '  ·  ', bloq: 'BLOQ ' }[estado] ?? '     ';
  console.log(`${marca} ${nombre.padEnd(50)} ${detalle}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Salesforce, por el CLI: observador independiente del servidor que se prueba
// ─────────────────────────────────────────────────────────────────────────────

function soql(consulta) {
  const entorno = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
  delete entorno.SF_API_VERSION;
  delete entorno.SF_ORG_API_VERSION;
  let salida;
  try {
    salida = execFileSync(
      'sf',
      ['data', 'query', '-o', ALIAS, '--json', '--api-version', '67.0', '-q', `"${consulta}"`],
      { encoding: 'utf8', shell: true, env: entorno, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (e) {
    const crudo = String(e.stdout ?? '');
    let mensaje = e.message;
    try {
      mensaje = JSON.parse(crudo.slice(crudo.indexOf('{'))).message;
    } catch {}
    throw new Error(`SOQL falló: ${String(mensaje).split('\n').pop()}`);
  }
  return JSON.parse(salida.slice(salida.indexOf('{'))).result;
}

const lit = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// ─────────────────────────────────────────────────────────────────────────────
// El servidor
// ─────────────────────────────────────────────────────────────────────────────

let servidorPropio = null;

async function contesta() {
  try {
    return (await fetch(`${BASE}/salud`, { signal: AbortSignal.timeout(2500) })).ok;
  } catch {
    return false;
  }
}

async function asegurarServidor() {
  if (await contesta()) return;
  console.log(`\nNadie contesta en ${BASE}. Levantando el servidor…`);
  servidorPropio = spawn(
    'node',
    ['--env-file-if-exists=.env', '--experimental-strip-types', 'scripts/sitio.mjs'],
    { env: process.env, stdio: ['ignore', 'ignore', 'ignore'] },
  );
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await contesta()) return;
  }
  servidorPropio.kill();
  throw new Error('El servidor no levantó.');
}

process.on('exit', () => servidorPropio && !servidorPropio.killed && servidorPropio.kill());

// ─────────────────────────────────────────────────────────────────────────────
// Un cliente del sitio
// ─────────────────────────────────────────────────────────────────────────────

function nuevoCliente() {
  let cookie = '';
  const conCookie = (extra = {}) => ({
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  });
  return {
    async web(ruta, opciones = {}) {
      const res = await fetch(`${BASE}${ruta}`, { ...opciones, headers: conCookie(opciones.headers) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const texto = await res.text();
      let cuerpo = null;
      try {
        cuerpo = texto ? JSON.parse(texto) : null;
      } catch {
        cuerpo = { crudo: texto.slice(0, 300) };
      }
      return { status: res.status, cuerpo };
    },
    async hablar(texto) {
      let res;
      try {
        res = await fetch(`${BASE}/publico/agente/mensaje`, {
          method: 'POST',
          headers: conCookie(),
          body: JSON.stringify({ texto }),
          signal: AbortSignal.timeout(MS_TURNO),
        });
      } catch (e) {
        return { ok: false, transporte: String(e?.cause?.code ?? e?.message ?? e), dicho: '' };
      }
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      if (!res.ok || !res.body) return { ok: false, error: `HTTP ${res.status}`, dicho: '' };

      const lector = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = '';
      let dicho = '';
      let error = null;
      while (true) {
        const { done, value } = await lector.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const partes = buffer.split('\n\n');
        buffer = partes.pop() ?? '';
        for (const p of partes) {
          const tipo = /^event: (.*)$/m.exec(p)?.[1];
          const crudo = /^data: (.*)$/m.exec(p)?.[1];
          if (!tipo || !crudo) continue;
          let d;
          try {
            d = JSON.parse(crudo);
          } catch {
            continue;
          }
          if (tipo === 'Bienvenida') continue;
          if (tipo === 'TextChunk') dicho += d.texto ?? '';
          else if (tipo === 'Inform' && !dicho && d.texto) dicho = d.texto;
          else if (tipo === 'Error') error = d.mensaje ?? d.codigo ?? 'error del servicio';
        }
      }
      return { ok: !error, error, dicho };
    },
    cerrar() {
      return this.web('/publico/salir', { method: 'POST' }).catch(() => {});
    },
  };
}

/**
 * Recorre turnos hasta que `listo` se cumpla. Devuelve todo lo dicho.
 *
 * La transcripción entera se guarda en la evidencia. Juzgar al agente por el final de
 * su respuesta —que es lo que cabe en una línea de informe— ya produjo tres acusaciones
 * falsas: el agente había dicho lo correcto en la primera frase y el recorte se quedaba
 * con la última.
 */
const transcripciones = [];
async function conversar(cliente, guion, listo, caso) {
  let todo = '';
  const turnos = [];
  for (const texto of guion) {
    const r = await cliente.hablar(texto);
    turnos.push({ cliente: texto, agente: r.dicho, error: r.error ?? r.transporte ?? null });
    if (r.transporte) {
      transcripciones.push({ caso, turnos });
      return { todo, corte: r.transporte };
    }
    todo += `\n${r.dicho}`;
    if (listo?.(todo)) break;
  }
  transcripciones.push({ caso, turnos });
  return { todo, corte: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// Lo que la organización tiene HOY. Nada de esto está escrito a mano.
// ═════════════════════════════════════════════════════════════════════════════

await asegurarServidor();

seccion('Lo que hay en la organización', 'el banco de pruebas se lee de la org, no se escribe aquí');

const unidades = (
  soql(
    `SELECT Name, SerialNumber, Product2.ProductCode, Product2.Name, Account.Name, ` +
      `Odometro__c, Meses_Desde_Instalacion__c FROM Asset WHERE SerialNumber != null ` +
      `ORDER BY Product2.ProductCode, Name`,
  ).records ?? []
).map((u) => ({
  nombre: u.Name,
  vin: u.SerialNumber,
  modelo: u.Product2?.ProductCode ?? null,
  modeloNombre: u.Product2?.Name ?? null,
  cliente: u.Account?.Name ?? null,
  km: u.Odometro__c,
  meses: u.Meses_Desde_Instalacion__c,
}));

const modelos = [...new Set(unidades.map((u) => u.modelo))];
const clientes = [...new Set(unidades.map((u) => u.cliente).filter(Boolean))];
check('unidades con número de serie', 'dato', `${unidades.length}`);
check('modelos distintos en la flota', 'dato', modelos.join(', '));
check('clientes distintos', 'dato', `${clientes.length}: ${clientes.slice(0, 3).join(', ')}…`);

const conCatalogo = new Set(
  (soql(`SELECT Modelo__r.ProductCode FROM Modelo_Sucursal__c WHERE Activo__c = true`).records ?? []).map(
    (r) => r.Modelo__r?.ProductCode,
  ),
);
const conReglas = new Set(
  (soql(`SELECT Modelo__r.ProductCode FROM Regla_Cobertura__c WHERE Activa__c = true`).records ?? []).map(
    (r) => r.Modelo__r?.ProductCode,
  ),
);
const huerfanos = modelos.filter((m) => !conCatalogo.has(m) || !conReglas.has(m));
check(
  'modelos de la flota que la red declara atender',
  huerfanos.length ? 'dato' : 'ok',
  huerfanos.length
    ? `${modelos.length - huerfanos.length} de ${modelos.length}; sin catálogo ni póliza: ${huerfanos.join(', ')}`
    : 'todos',
);

const sucursales = (await nuevoCliente().web('/publico/sucursales')).cuerpo?.sucursales ?? [];
check('talleres publicados por el sitio', 'dato', `${sucursales.length}`);

// ═════════════════════════════════════════════════════════════════════════════
// 1 · Cobertura: TODAS las unidades, no una
// ═════════════════════════════════════════════════════════════════════════════

seccion('Cobertura por unidad', `las ${unidades.length} unidades de la flota, una por una`);

// El umbral vive en configuración, no aquí: si mañana Zapata cambia la póliza, esta
// verificación cambia con ella. Los nombres son `Km_Base__c` y `Meses_Base__c`.
const parametros = soql(
  `SELECT Km_Base__c, Meses_Base__c FROM Parametros_Garantia__c LIMIT 1`,
).records?.[0] ?? null;
const KM_LIM = parametros?.Km_Base__c ?? 250_000;
const MES_LIM = parametros?.Meses_Base__c ?? 24;
check('la póliza que rige', 'dato', `${KM_LIM} km · ${MES_LIM} meses (Parametros_Garantia__c)`);

const cobertura = [];
for (const u of unidades) {
  const c = nuevoCliente();
  const r = await c.web('/publico/garantia', { method: 'POST', body: JSON.stringify({ vin: u.vin }) });
  const enc = r.cuerpo?.encontrada === true;
  const sistemas = r.cuerpo?.cobertura?.porSistema ?? [];
  const veredictos = sistemas.map((s) => s.porRegla?.veredicto).filter(Boolean);
  cobertura.push({ ...u, encontrada: enc, sistemas: sistemas.length, veredictos: [...new Set(veredictos)] });
  await c.cerrar();
}

const noEncontradas = cobertura.filter((c) => !c.encontrada);
check(
  'el sitio resuelve cualquier número de serie de la flota',
  noEncontradas.length === 0 ? 'ok' : 'falla',
  noEncontradas.length ? `no encontró ${noEncontradas.map((c) => c.vin).join(', ')}` : `${cobertura.length} de ${cobertura.length}`,
);

// El veredicto tiene que SEGUIR al dato, no ser siempre el mismo. Si toda la flota
// saliera «cubierta» daría igual el kilometraje, y eso es lo que se quiere descartar.
const dentro = cobertura.filter((c) => c.km <= KM_LIM && c.meses <= MES_LIM && c.veredictos.length);
const fuera = cobertura.filter((c) => (c.km > KM_LIM || c.meses > MES_LIM) && c.veredictos.length);
const dentroMal = dentro.filter((c) => !c.veredictos.includes('CUBIERTO'));
const fueraMal = fuera.filter((c) => !c.veredictos.some((v) => v !== 'CUBIERTO'));
check(
  'una unidad dentro de la póliza sale cubierta',
  dentro.length === 0 ? 'bloq' : dentroMal.length === 0 ? 'ok' : 'falla',
  dentro.length === 0
    ? 'no hay ninguna dentro de la póliza con reglas: nada que comprobar'
    : dentroMal.length
      ? `${dentroMal.map((c) => `${c.nombre} (${c.km} km/${c.meses} m) → ${c.veredictos}`).join(' · ')}`
      : `${dentro.length} unidades, todas CUBIERTO`,
);
check(
  'una unidad fuera de la póliza NO sale cubierta',
  fuera.length === 0 ? 'bloq' : fueraMal.length === 0 ? 'ok' : 'falla',
  fuera.length === 0
    ? 'no hay ninguna fuera de la póliza con reglas: nada que comprobar'
    : fueraMal.length
      ? `${fueraMal.map((c) => `${c.nombre} (${c.km} km/${c.meses} m) sale cubierta`).join(' · ')}`
      : `${fuera.length} unidades, ninguna cubierta del todo`,
);

const sinSistemas = cobertura.filter((c) => c.encontrada && c.sistemas === 0);
check(
  'un modelo sin póliza no recibe un veredicto inventado',
  sinSistemas.every((c) => !conReglas.has(c.modelo)) ? 'ok' : 'falla',
  sinSistemas.length
    ? `${sinSistemas.length} unidades sin veredicto, todas de modelos sin regla (${[...new Set(sinSistemas.map((c) => c.modelo))].join(', ')})`
    : 'todas las unidades tienen reglas aplicables',
);

// ═════════════════════════════════════════════════════════════════════════════
// 2 · Los nueve talleres, no uno
// ═════════════════════════════════════════════════════════════════════════════

seccion('Disponibilidad por taller', 'los nueve, con el mismo rango');

const hoy = new Date();
const desde = hoy.toISOString().slice(0, 10);
const hasta = new Date(hoy.getTime() + 21 * 86_400_000).toISOString().slice(0, 10);
const agenda = [];
for (const s of sucursales) {
  const clave = s.codigo ?? s.Codigo_Sucursal__c ?? s.clave;
  const c = nuevoCliente();
  const r = await c.web(`/publico/disponibilidad?desde=${desde}&hasta=${hasta}&sucursal=${encodeURIComponent(clave)}`);
  const franjas = r.cuerpo?.franjas ?? [];
  // La org, por su cuenta: cuántas franjas apartables tiene de verdad ese taller.
  const reales = soql(
    `SELECT COUNT(Id) FROM Slot_Taller__c WHERE Sucursal__r.Codigo_Sucursal__c = '${lit(clave)}' ` +
      `AND Disponible__c = true AND Procedencia__c = 'OPERACIONAL_VERIFICADO' ` +
      `AND Inicio__c >= ${desde}T00:00:00Z AND Inicio__c <= ${hasta}T23:59:59Z`,
  ).records?.[0]?.expr0 ?? 0;
  agenda.push({ clave, nombre: s.nombre ?? s.Name, ofrecidas: franjas.length, reales: Number(reales) });
  await c.cerrar();
}

const mienten = agenda.filter((a) => a.ofrecidas !== a.reales);
check(
  'lo que el sitio ofrece coincide con lo que la org tiene',
  mienten.length === 0 ? 'ok' : 'falla',
  mienten.length
    ? mienten.map((a) => `${a.clave}: ofrece ${a.ofrecidas}, la org tiene ${a.reales}`).join(' · ')
    : agenda.map((a) => `${a.clave}:${a.ofrecidas}`).join(' '),
);
const conCupo = agenda.filter((a) => a.reales > 0);
check(
  'talleres donde hoy se puede apartar',
  'dato',
  conCupo.length ? conCupo.map((a) => a.clave).join(', ') : 'ninguno',
);
check(
  'los talleres sin cupo confirmado se distinguen en la respuesta',
  agenda.filter((a) => a.reales === 0).every((a) => a.ofrecidas === 0) ? 'ok' : 'falla',
  `${agenda.length - conCupo.length} sin franjas apartables, y ninguno las ofrece`,
);

// ═════════════════════════════════════════════════════════════════════════════
// 3 · El agente, con datos que no son los del guion
// ═════════════════════════════════════════════════════════════════════════════

const tallerBueno = conCupo[0]?.clave ?? null;
const tallerBuenoNombre = agenda.find((a) => a.clave === tallerBueno)?.nombre ?? tallerBueno;
const tallerSinCupo = agenda.find((a) => a.reales === 0);
// Una unidad que NO es la del guion: de un modelo que la red sí atiende, del cliente
// que menos aparece, y la primera que no sea la primera de la lista.
const unidadAtendida = unidades.filter((u) => conCatalogo.has(u.modelo)).at(-1) ?? null;
const unidadHuerfana = unidades.find((u) => !conCatalogo.has(u.modelo)) ?? null;

if (!CON_AGENTE) {
  seccion('El agente', 'GEN_SIN_AGENTE=1: no se ejercitó');
  check('conversaciones con datos distintos', 'bloq', 'quita GEN_SIN_AGENTE para correrlas');
} else {
  const estado = await nuevoCliente().web('/publico/agente/estado');
  if (estado.cuerpo?.disponible !== true) {
    seccion('El agente', 'no disponible');
    check('la Agent API abre sesión', 'bloq', String(estado.cuerpo?.causa ?? '').slice(0, 110));
  } else {
    // ── 3.1 · otra unidad, otro cliente, taller que sí puede ──────────────────
    seccion(
      'Otra unidad, otro cliente, taller con cupo',
      unidadAtendida ? `${unidadAtendida.nombre} · ${unidadAtendida.modelo} · ${unidadAtendida.cliente} → ${tallerBueno}` : 'sin unidad',
    );
    if (!unidadAtendida || !tallerBueno) {
      check('hay con qué probarlo', 'bloq', 'la org no tiene unidad atendida o taller con cupo');
    } else {
      const antes = new Date(Date.now() - 120_000).toISOString();
      const c = nuevoCliente();
      const { todo, corte } = await conversar(
        c,
        [
          `Quiero agendar servicio en ${tallerBuenoNombre}. El VIN es ${unidadAtendida.vin}.`,
          '¿Qué horarios tienes?',
          'La primera opción, es mantenimiento preventivo.',
          'Sí, confírmala.',
        ],
        (t) => /\b\d{8}\b/.test(t) && /(qued[oó]|confirm|agend|folio)/i.test(t),
        'otra-unidad',
      );
      await c.cerrar();
      const folios = [...todo.matchAll(/\b(\d{8})\b/g)].map((m) => m[1]);
      const orden = folios.length
        ? soql(
            `SELECT WorkOrderNumber, Asset.SerialNumber, Sucursal__r.Codigo_Sucursal__c, CreatedBy.Name ` +
              `FROM WorkOrder WHERE WorkOrderNumber IN (${folios.map((f) => `'${lit(f)}'`).join(',')}) ` +
              `AND CreatedDate >= ${antes}`,
          ).records?.[0] ?? null
        : null;
      check(
        'agenda una unidad que no es la del guion',
        orden ? 'ok' : corte ? 'bloq' : 'falla',
        orden
          ? `${orden.WorkOrderNumber} · ${orden.Asset?.SerialNumber} · ${orden.Sucursal__r?.Codigo_Sucursal__c}`
          : corte
            ? `se cortó la conexión: ${corte}`
            : `no cerró: «${todo.trim().slice(-160)}»`,
      );
      if (orden) {
        check(
          'la orden es de ESA unidad, no de la del guion',
          orden.Asset?.SerialNumber === unidadAtendida.vin ? 'ok' : 'falla',
          `quedó con ${orden.Asset?.SerialNumber ?? 'ninguna'}`,
        );
        check(
          'la orden es de ESE taller',
          orden.Sucursal__r?.Codigo_Sucursal__c === tallerBueno ? 'ok' : 'falla',
          `quedó en ${orden.Sucursal__r?.Codigo_Sucursal__c}`,
        );
      }
    }

    // ── 3.2 · un modelo que la red NO declara atender ─────────────────────────
    seccion(
      'Un modelo que la red no declara atender',
      unidadHuerfana ? `${unidadHuerfana.nombre} · ${unidadHuerfana.modelo} · ${unidadHuerfana.km} km` : 'sin unidad huérfana',
    );
    if (!unidadHuerfana) {
      check('hay con qué probarlo', 'bloq', 'todos los modelos de la flota están en el catálogo');
    } else {
      const antes = new Date(Date.now() - 120_000).toISOString();
      const c = nuevoCliente();
      const { todo, corte } = await conversar(
        c,
        [
          `Quiero agendar servicio en ${tallerBuenoNombre}. El VIN es ${unidadHuerfana.vin}.`,
          '¿Qué horarios tienes?',
          'La primera opción, es mantenimiento preventivo. Confírmala.',
        ],
        (t) => /no (atiende|podemos|puedo)|no est[aá] disponible|otro taller/i.test(t),
        'modelo-sin-catalogo',
      );
      await c.cerrar();
      const folios = [...todo.matchAll(/\b(\d{8})\b/g)].map((m) => m[1]);
      const creada = folios.length
        ? soql(
            `SELECT WorkOrderNumber, Asset.SerialNumber FROM WorkOrder ` +
              `WHERE WorkOrderNumber IN (${folios.map((f) => `'${lit(f)}'`).join(',')}) AND CreatedDate >= ${antes}`,
          ).records?.[0] ?? null
        : null;
      // Se juzga la conversación ENTERA, no su último párrafo: el agente suele decir
      // lo importante en la primera frase y cerrar ofreciendo alternativas, y mirar
      // sólo el final producía una acusación falsa.
      // «no da servicio a ese modelo» es la frase literal que devuelve el Apex, y la
      // primera versión de esta expresión no la contemplaba: sólo buscaba «no atiende»
      // y acusaba al agente de callarse algo que había dicho con todas sus letras.
      const seNiega = /no (lo |la )?(atiende|atienden|puede|pueden|podemos|puedo)|no da servicio|no est[aá] (disponible|habilitado)|no figura|no aparece/i.test(
        todo,
      );
      check(
        'no crea una cita imposible',
        creada ? 'falla' : 'ok',
        creada
          ? `creó ${creada.WorkOrderNumber} para un modelo que ningún taller declara atender`
          : 'no se creó ninguna orden',
      );
      check(
        'dice que ese taller no atiende el modelo',
        corte ? 'bloq' : seNiega ? 'ok' : 'falla',
        corte
          ? `se cortó: ${corte}`
          : seNiega
            ? `«${/[^.]*(no (lo |la )?(atiende|atienden|puede|pueden|podemos|puedo)|no da servicio)[^.]*\./i.exec(todo)?.[0]?.trim().slice(0, 150) ?? ''}»`
            : `no lo dijo: «${todo.replace(/\s+/g, ' ').trim().slice(-190)}»`,
      );
      // Ninguna de las nueve atiende este modelo. Ofrecer «otro taller que sí pueda»
      // es una promesa que la red no puede cumplir, y manda al cliente a probar
      // sucursal por sucursal hasta rendirse.
      const prometeOtro = /otr[oa] (taller|sucursal)[^.]{0,60}(s[ií] pued|que s[ií]|cercan)/i.test(todo);
      check(
        'no promete otro taller que tampoco puede',
        prometeOtro ? 'falla' : 'ok',
        prometeOtro
          ? `ofreció buscar en otra sucursal, y ninguna de las ${sucursales.length} declara ese modelo: ` +
            `«${/[^.]*otr[oa] (taller|sucursal)[^.]*\./i.exec(todo)?.[0]?.trim().slice(0, 150) ?? ''}»`
          : 'no ofreció una alternativa que no existe',
      );
      // Y el sitio, por su cuenta, tampoco puede fingir cobertura de ese modelo.
      const cob = cobertura.find((x) => x.vin === unidadHuerfana.vin);
      check(
        'la pantalla de cobertura no le inventa una póliza',
        cob && cob.veredictos.length === 0 ? 'ok' : 'falla',
        cob ? `veredictos: ${cob.veredictos.join(', ') || 'ninguno'}` : 'no se evaluó',
      );
    }

    // ── 3.3 · un taller sin cupo confirmado ───────────────────────────────────
    seccion(
      'Un taller sin cupo confirmado',
      tallerSinCupo ? `${tallerSinCupo.nombre} (${tallerSinCupo.clave})` : 'todos tienen cupo',
    );
    if (!tallerSinCupo || !unidadAtendida) {
      check('hay con qué probarlo', 'bloq', 'no hay taller sin cupo o no hay unidad atendida');
    } else {
      const antes = new Date(Date.now() - 120_000).toISOString();
      const c = nuevoCliente();
      const { todo, corte } = await conversar(
        c,
        [
          `Quiero agendar servicio en ${tallerSinCupo.nombre}. El VIN es ${unidadAtendida.vin}.`,
          '¿Qué horarios tienes ahí?',
        ],
        (t) => /no (hay|tengo|tiene)|sin (horarios|disponibilidad)|otro taller/i.test(t),
        'taller-sin-cupo',
      );
      await c.cerrar();
      const folios = [...todo.matchAll(/\b(\d{8})\b/g)].map((m) => m[1]);
      const creada = folios.length
        ? soql(
            `SELECT WorkOrderNumber, Sucursal__r.Codigo_Sucursal__c FROM WorkOrder ` +
              `WHERE WorkOrderNumber IN (${folios.map((f) => `'${lit(f)}'`).join(',')}) AND CreatedDate >= ${antes}`,
          ).records?.[0] ?? null
        : null;
      check(
        'no aparta en un taller que no puede apartar',
        !creada || creada.Sucursal__r?.Codigo_Sucursal__c !== tallerSinCupo.clave ? 'ok' : 'falla',
        creada ? `creó ${creada.WorkOrderNumber} en ${creada.Sucursal__r?.Codigo_Sucursal__c}` : 'no se creó nada ahí',
      );
      // Si ofreció horarios, esas horas no pueden ser del taller que el cliente pidió
      // —no tiene ninguna—, así que tienen que ser de OTRO y el agente tiene que
      // decirlo. Ofrecer las franjas de Querétaro mientras el cliente cree que está
      // agendando en Aeropuerto es la mentira que se busca aquí.
      const horasOfrecidas = [
        ...todo.matchAll(/^\s*\d+[.)]\s*[^\n:]{0,70}?\b([01]?\d|2[0-3]):([0-5]\d)\b/gm),
      ].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
      const nombraOtro = agenda
        .filter((a) => a.clave !== tallerSinCupo.clave && a.reales > 0)
        .some((a) => todo.toLowerCase().includes(String(a.nombre ?? '').toLowerCase().replace(/^zapata camiones /i, '')));
      const diceQueNoHay = /no (hay|tengo|tiene|cuenta)|sin (horarios|disponibilidad|cupo)|no (est[aá]|figura)/i.test(todo);
      check(
        'no presenta como suyas las franjas de otro taller',
        corte ? 'bloq' : horasOfrecidas.length === 0 || nombraOtro ? 'ok' : 'falla',
        corte
          ? `se cortó: ${corte}`
          : horasOfrecidas.length === 0
            ? 'no ofreció ninguna hora'
            : nombraOtro
              ? `ofreció ${horasOfrecidas.length} horarios y nombró el taller al que pertenecen`
              : `ofreció ${horasOfrecidas.join(', ')} sin decir de qué taller son`,
      );
      check(
        'dice que en el taller pedido no hay',
        corte ? 'bloq' : diceQueNoHay ? 'ok' : 'falla',
        corte
          ? `se cortó: ${corte}`
          : diceQueNoHay
            ? `«${/[^.]*no (hay|tengo|tiene|cuenta)[^.]*\./i.exec(todo)?.[0]?.trim().slice(0, 150) ?? ''}»`
            : `no lo dijo: «${todo.replace(/\s+/g, ' ').trim().slice(-190)}»`,
      );
    }

    // ── 3.4 · un número de serie que no existe ────────────────────────────────
    seccion('Un número de serie que no existe', 'la unidad inventada no puede recibir datos');
    const inventado = '9XYZQ0000AA000000';
    {
      const c = nuevoCliente();
      const { todo, corte } = await conversar(
        c,
        [`Quiero saber la garantía de mi unidad, el VIN es ${inventado}.`],
        () => true,
        'vin-inexistente',
      );
      await c.cerrar();
      // Lo prohibido es hablar de ESA unidad como si la conociera. Recitar la póliza
      // general —«la garantía básica cubre 24 meses»— es legítimo y es lo que hace: la
      // primera versión de esta comprobación marcaba eso como invención y acusaba al
      // agente de algo que no hizo.
      const afirma =
        /tu unidad (tiene|es|est[aá]|cuenta|lleva)|tu (cami[oó]n|tractocami[oó]n) (tiene|es|est[aá])|(su|tu) (od[oó]metro|kilometraje) (es|marca)/i.test(
          todo,
        ) || /\best[aá] cubiert[oa]\b/i.test(todo);
      check(
        'no le atribuye datos a una unidad que no existe',
        corte ? 'bloq' : afirma ? 'falla' : 'ok',
        corte ? `se cortó: ${corte}` : `«${todo.replace(/\s+/g, ' ').trim().slice(-180)}»`,
      );
      const r = await nuevoCliente().web('/publico/garantia', {
        method: 'POST',
        body: JSON.stringify({ vin: inventado }),
      });
      check(
        'el sitio contesta que no lo encuentra, sin jerga',
        r.cuerpo?.encontrada === false && !/SOQL|SELECT|null|undefined/.test(String(r.cuerpo?.mensaje)) ? 'ok' : 'falla',
        String(r.cuerpo?.mensaje ?? r.status),
      );
    }

    // ── 3.5 · una varada de otro cliente, en otra carretera ───────────────────
    seccion('Una varada que no es la del guion', 'otra carretera, otro kilómetro, otra unidad');
    {
      const u = unidades.find((x) => x.vin !== unidadAtendida?.vin) ?? unidades[0];
      const antes = new Date(Date.now() - 120_000).toISOString();
      const c = nuevoCliente();
      const sesion = await c.web('/publico/sesion');
      const folio = sesion.cuerpo?.correlationId;
      const { todo, corte } = await conversar(
        c,
        [
          'Mi unidad se quedó parada en la carretera Monterrey-Saltillo, en el kilómetro 47.',
          'Sí, está fuera del carril y con las intermitentes encendidas.',
          `El VIN es ${u.vin}. Se sobrecalentó y perdió potencia.`,
          'Sí, levanta el reporte por favor.',
        ],
        (t) => /(VAR-|UV-)\d+/i.test(t),
        'varada',
      );
      await c.cerrar();
      const reporte = soql(
        `SELECT Name, Carretera__c, Kilometro__c, Correlation_Id__c FROM Unidad_Varada__c ` +
          `WHERE CreatedDate >= ${antes} ORDER BY CreatedDate DESC LIMIT 5`,
      ).records?.find((r) => r.Correlation_Id__c === folio) ?? null;
      check(
        'levanta el reporte con la carretera que le dictaron',
        corte ? 'bloq' : reporte ? 'ok' : 'falla',
        corte
          ? `se cortó: ${corte}`
          : reporte
            ? `${reporte.Name} · ${reporte.Carretera__c} km ${reporte.Kilometro__c ?? '—'}`
            : `no quedó reporte bajo ${folio}: «${todo.replace(/\s+/g, ' ').trim().slice(-160)}»`,
      );
      if (reporte) {
        check(
          'la carretera y el kilómetro son los que se dijeron',
          /monterrey.?saltillo/i.test(String(reporte.Carretera__c)) && Number(reporte.Kilometro__c) === 47 ? 'ok' : 'falla',
          `quedó «${reporte.Carretera__c}» km ${reporte.Kilometro__c}`,
        );
      }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Cierre
// ═════════════════════════════════════════════════════════════════════════════

const todos = bloques.flatMap((b) => b.checks);
const fallas = todos.filter((c) => c.estado === 'falla').length;
const bloqueos = todos.filter((c) => c.estado === 'bloq').length;

writeFileSync(
  join(dir, `generalidad.${ts}.json`),
  JSON.stringify({ ts, base: BASE, unidades, modelos, agenda, cobertura, bloques, transcripciones }, null, 1),
);

console.log(
  `\n${fallas ? 'ROJO' : bloqueos ? 'PARCIAL' : 'VERDE'} — ${fallas} fallas, ${bloqueos} sin poder comprobarse`,
);
console.log(`evidencia en evidencia/20-generalidad/generalidad.${ts}.json`);
process.exit(fallas ? 1 : 0);
