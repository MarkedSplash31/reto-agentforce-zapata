/**
 * Ensayo del guion de video, escena por escena.
 *
 * Por qué existe. `verificar-e2e.mjs` comprueba que el agente PUEDE agendar, reportar
 * y escalar. Eso no es lo mismo que comprobar que el video se puede grabar: el guion
 * dicta frases literales, un orden, un VIN concreto y momentos que la narración señala
 * en pantalla («el sábado a las ocho no existe», «el panel derecho se pobló solo»). Si
 * cualquiera de esos momentos no ocurre, el video se cae aunque la aplicación esté
 * perfecta.
 *
 * Así que esto teclea el guion tal cual, en un navegador real, con el VIN del guion, y
 * después relee Salesforce por el CLI —nunca por la app— para ver si lo que se vio en
 * pantalla existe de verdad. Cada escena termina con un veredicto de director:
 *
 *   GRABABLE      se puede rodar tal como está escrito
 *   RIESGO        se puede rodar, pero algo depende del azar o caduca pronto
 *   NO GRABABLE   la escena, tal como está escrita, no ocurre
 *
 * Escribe en la organización a propósito: la escena 2 crea una orden y la 3 un caso.
 * Eso es exactamente lo que hará la cámara. `GUION_SIN_ESCRIBIR=1` corre sólo lo que
 * no muta, para un vistazo rápido.
 *
 * Uso:
 *   npm run verificar:guion
 *   GUION_VISIBLE=1 npm run verificar:guion        (con navegador a la vista)
 *   GUION_REPETIR_E1=5 npm run verificar:guion     (mide la varianza del SOSL)
 *   GUION_SIN_ESCRIBIR=1 npm run verificar:guion   (sin crear orden ni caso)
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.GUION_BASE ?? 'http://localhost:3000';
const ALIAS = process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
const VIN = process.env.GUION_VIN ?? '1FUJGLDR9PL456781';
const TALLER_TEXTO = 'Queretaro'; // sin acento, como lo teclea el guion
const TALLER_CODIGO = 'FL-QRO';
const ESCRIBIR = process.env.GUION_SIN_ESCRIBIR !== '1';
const REPETIR_E1 = Number(process.env.GUION_REPETIR_E1 ?? 3);
const MS_TURNO = Number(process.env.GUION_TIMEOUT_TURNO_MS ?? 180_000);
const VISIBLE = process.env.GUION_VISIBLE === '1';

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '19-guion', ts);
mkdirSync(dir, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────

const escenas = [];
let escenaActual = null;

function escena(clave, titulo, minutaje) {
  escenaActual = { clave, titulo, minutaje, checks: [], veredicto: null };
  escenas.push(escenaActual);
  console.log(`\n── ${minutaje} · ${titulo} ──`);
}

/** estado: ok | riesgo | falla | info */
function check(nombre, estado, detalle, extra = {}) {
  escenaActual.checks.push({ nombre, estado, detalle, ...extra });
  const marca = { ok: 'OK    ', riesgo: 'RIESGO', falla: 'FALLA ', info: '      ' }[estado] ?? '      ';
  console.log(`${marca} ${nombre.padEnd(52)} ${detalle}`);
}

function cerrarEscena() {
  const c = escenaActual.checks;
  escenaActual.veredicto = c.some((x) => x.estado === 'falla')
    ? 'NO GRABABLE'
    : c.some((x) => x.estado === 'riesgo')
      ? 'RIESGO'
      : 'GRABABLE';
  console.log(`       → ${escenaActual.veredicto}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Salesforce, como observador independiente del sitio que se está probando
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
      // stderr descartado: el CLI escupe su aviso de actualización en cada llamada y
      // ensuciaba el informe. Los errores de la consulta viajan por stdout con --json.
      {
        encoding: 'utf8',
        shell: true,
        env: entorno,
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
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

const escapar = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// ─────────────────────────────────────────────────────────────────────────────
// Fechas: el guion habla de «el sábado», y eso depende del día en que se grabe
// ─────────────────────────────────────────────────────────────────────────────

const HOY = new Date();

/** El próximo sábado a partir de hoy (si hoy es sábado, hoy). */
function proximoSabado(desde = HOY) {
  const d = new Date(desde);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d;
}

const aISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const horaLocal = (iso) =>
  new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });

// ─────────────────────────────────────────────────────────────────────────────
// El servidor
// ─────────────────────────────────────────────────────────────────────────────

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
  if (await contesta()) return 'ya estaba levantado';
  console.log(`\nNadie contesta en ${BASE}. Levantando el servidor para el ensayo…`);
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
    if (await contesta()) return 'lo levantó este ensayo';
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

// ─────────────────────────────────────────────────────────────────────────────
// El navegador: una pestaña por escena, como pide el guion
// ─────────────────────────────────────────────────────────────────────────────

let navegador = null;

/**
 * Una pestaña nueva del cliente. El guion es explícito: «Entre escenas: cierra la
 * pestaña de la app y abre una nueva. Nunca F5». Un contexto por escena reproduce eso,
 * cookie de visitante incluida.
 */
async function nuevaPestana() {
  const contexto = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
  });
  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text().slice(0, 200));
  });
  pagina.on('pageerror', (e) => errores.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60_000 });
  return { contexto, pagina, errores };
}

/** Cierra la visita en el servidor antes de tirar la pestaña: si no, las sesiones de
 *  Agent API se acumulan vivas en la org y a las pocas empiezan a rechazarse. */
async function cerrarPestana(p) {
  try {
    await p.pagina.evaluate(() => fetch('/publico/salir', { method: 'POST' }));
  } catch {}
  await p.contexto.close();
}

/** El folio de la visita, que es lo que amarra la traza. */
const folioDeLaVisita = (pagina) =>
  pagina.evaluate(() =>
    fetch('/publico/sesion')
      .then((r) => r.json())
      .then((d) => d.correlationId ?? null),
  );

/**
 * Teclea un turno y espera a que el agente termine.
 *
 * La señal es la propia página: al mandar bloquea la caja y la desbloquea en el
 * `finally` del turno. Esperar texto sería frágil —llega por partes— y esperar un
 * tiempo fijo sería mentira.
 */
async function decir(pagina, texto) {
  const antes = await pagina.locator('#hilo article.turno[data-de="agente"]').count();
  await pagina.fill('#entrada', texto);
  await pagina.click('#enviar');
  await pagina.waitForSelector('#entrada:disabled', { timeout: 15_000 }).catch(() => {});
  await pagina.waitForSelector('#entrada:not([disabled])', { timeout: MS_TURNO });
  // El último párrafo del agente es la respuesta al turno. Si no apareció ninguno
  // nuevo, se devuelve cadena vacía y quien llama decide si eso es un fallo.
  const burbujas = pagina.locator('#hilo article.turno[data-de="agente"]');
  const total = await burbujas.count();
  if (total <= antes) return '';
  let dicho = '';
  for (let i = antes; i < total; i++) dicho += (await burbujas.nth(i).innerText()) + '\n';
  return dicho.trim();
}

const foto = (pagina, nombre) =>
  pagina.screenshot({ path: join(dir, `${nombre}.png`), fullPage: false }).catch(() => {});

// ═════════════════════════════════════════════════════════════════════════════
// ESCENA 0 · Condiciones antes de grabar
// ═════════════════════════════════════════════════════════════════════════════

async function condiciones() {
  escena('condiciones', 'Condiciones antes de grabar', 'pre');

  // El guion manda correr `sf org display --target-org hackaton2`. El alias real de
  // esta máquina es otro, y con el del guion el comando falla con NamedOrgNotFound —
  // que se lee como «la org está caída» cuando lo único que pasa es que el alias no
  // existe.
  let conectada = false;
  let aliasReal = ALIAS;
  try {
    // El entorno se limpia igual que en `soql`: `.env` trae SF_API_VERSION en formato
    // «v67.0» y el CLI lo rechaza en este comando, así que la comprobación de conexión
    // fallaba por la configuración de la máquina y parecía que la org estaba caída.
    const entorno = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
    delete entorno.SF_API_VERSION;
    delete entorno.SF_ORG_API_VERSION;
    const salida = execFileSync('sf', ['org', 'display', '--target-org', ALIAS, '--json'], {
      encoding: 'utf8',
      shell: true,
      env: entorno,
    });
    const r = JSON.parse(salida.slice(salida.indexOf('{'))).result;
    conectada = r.connectedStatus === 'Connected';
    aliasReal = r.alias ?? ALIAS;
  } catch (e) {
    check('el comando de conexión corrió', 'falla', String(e.message).split('\n')[0].slice(0, 140));
  }
  check(
    'la organización contesta',
    conectada ? 'ok' : 'falla',
    conectada ? `alias «${aliasReal}» · Connected` : 'no está conectada',
  );
  check(
    'el alias que dice el guion existe',
    aliasReal === 'hackaton2' ? 'ok' : 'riesgo',
    aliasReal === 'hackaton2'
      ? 'coincide'
      : `el guion dice «hackaton2» y en esta máquina el alias es «${aliasReal}»: el comando del guion falla`,
  );

  const arranque = await asegurarServidor();
  check('el sitio responde', 'ok', `${BASE} · ${arranque}`);

  const estado = await fetch(`${BASE}/publico/agente/estado`).then((r) => r.json());
  check(
    'la Agent API abre sesión',
    estado.disponible === true ? 'ok' : 'falla',
    estado.disponible ? `proveedor ${estado.proveedorToken}` : String(estado.causa ?? '').slice(0, 110),
  );

  const suc = await fetch(`${BASE}/publico/sucursales`).then((r) => r.json());
  const n = suc.sucursales?.length ?? 0;
  check(
    'los nueve talleres cargan desde la org',
    n === 9 ? 'ok' : n ? 'riesgo' : 'falla',
    `${n} talleres en la portada`,
  );

  // La unidad del guion. Los números que la narración dice en voz alta —cuarenta y un
  // mil doscientos kilómetros, nueve meses— son datos de esta fila: si cambian, la
  // narración deja de coincidir con la pantalla.
  const unidad = soql(
    `SELECT Name, SerialNumber, Product2.Name, Odometro__c, Meses_Desde_Instalacion__c ` +
      `FROM Asset WHERE SerialNumber = '${escapar(VIN)}'`,
  ).records?.[0];
  check(
    'el VIN del guion existe en la flota',
    unidad ? 'ok' : 'falla',
    unidad ? `${unidad.Name} · ${unidad.Product2?.Name}` : `${VIN} no está en la org`,
  );
  if (unidad) {
    const coincide = unidad.Odometro__c === 41200 && unidad.Meses_Desde_Instalacion__c === 9;
    check(
      'los números que dice la narración son los de la unidad',
      coincide ? 'ok' : 'riesgo',
      `${unidad.Odometro__c} km · ${unidad.Meses_Desde_Instalacion__c} meses ` +
        `(la narración dice 41 200 km y 9 meses)`,
    );
  }

  // El calendario tiene fondo, y ese fondo se agota. Sin franjas futuras la escena 2
  // —la que el guion prohíbe recortar— no ocurre.
  const horizonte = soql(
    `SELECT MAX(Inicio__c) ultima FROM Slot_Taller__c ` +
      `WHERE Disponible__c = true AND Procedencia__c = 'OPERACIONAL_VERIFICADO'`,
  ).records?.[0]?.ultima;
  const diasRestantes = horizonte
    ? Math.floor((new Date(horizonte).getTime() - HOY.getTime()) / 86_400_000)
    : -1;
  check(
    'el calendario llega más allá de hoy',
    diasRestantes >= 3 ? 'ok' : diasRestantes >= 0 ? 'riesgo' : 'falla',
    horizonte
      ? `última franja apartable: ${new Date(horizonte).toLocaleString('es-MX')} (${diasRestantes} días)`
      : 'no hay ninguna franja apartable en toda la red',
  );

  // «Agéndame el sábado a las 8» sólo funciona como corrección si ese sábado existe
  // en el catálogo y las ocho NO existen en él.
  const sabado = proximoSabado();
  const franjasSabado = soql(
    `SELECT Inicio__c, Tipo_Servicio__c, Cupos_Libres__c FROM Slot_Taller__c ` +
      `WHERE Sucursal__r.Codigo_Sucursal__c = '${TALLER_CODIGO}' ` +
      `AND Disponible__c = true AND Procedencia__c = 'OPERACIONAL_VERIFICADO' ` +
      `AND Inicio__c >= ${aISO(sabado)}T00:00:00Z AND Inicio__c <= ${aISO(sabado)}T23:59:59Z ` +
      `ORDER BY Inicio__c`,
  ).records ?? [];
  const horas = franjasSabado.map((f) => horaLocal(f.Inicio__c));
  const hayOcho = horas.includes('08:00');
  check(
    'el sábado que verá la cámara tiene franjas',
    franjasSabado.length ? 'ok' : 'falla',
    franjasSabado.length
      ? `${aISO(sabado)} en ${TALLER_CODIGO}: ${horas.join(', ')}`
      : `${aISO(sabado)} no tiene ninguna franja apartable en ${TALLER_CODIGO}: ` +
        'el agente no podrá corregir al cliente, dirá que no hay nada',
  );
  check(
    'las 8:00 NO existen como franja verificada',
    franjasSabado.length && !hayOcho ? 'ok' : franjasSabado.length ? 'falla' : 'riesgo',
    hayOcho
      ? 'las 8:00 SÍ existen: el agente aceptaría y la corrección del guion no ocurre'
      : franjasSabado.length
        ? `la primera del día es ${horas[0]}, que es lo que el agente debe ofrecer`
        : 'sin franjas ese día no hay nada que corregir',
  );

  cerrarEscena();
  return { unidad, sabado, horasSabado: horas };
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENA 1 · Conocimiento con procedencia declarada
// ═════════════════════════════════════════════════════════════════════════════

async function conocimiento() {
  escena('conocimiento', 'Conocimiento con procedencia declarada', '0:32–1:05');

  // La pregunta es la del guion. `GUION_PREGUNTA_E1` permite medir una alternativa:
  // el término que el agente manda al SOSL sale de cómo esté formulada, y de ahí viene
  // la varianza que el propio guion advierte.
  const PREGUNTA = process.env.GUION_PREGUNTA_E1 ?? '¿Qué cubre la garantía del turbocargador?';
  const corridas = [];

  // El propio guion avisa de que «el SOSL varía entre corridas» y manda repetir la
  // toma. Aquí se mide cuántas veces de cuántas sale bien: eso es lo que decide si la
  // escena es grabable a la primera o hay que ir con varias tomas preparadas.
  for (let i = 1; i <= REPETIR_E1; i++) {
    const p = await nuevaPestana();
    try {
      const dicho = await decir(p.pagina, PREGUNTA);
      const mencionaTurbo = /turbo/i.test(dicho);
      // La marca de procedencia no es texto suelto: la página la separa del cuerpo y
      // la pinta abajo. Se comprueba en el DOM, que es lo que se ve en cámara.
      const marca = await p.pagina
        .locator('#hilo article.turno[data-de="agente"] .border-t')
        .last()
        .innerText()
        .catch(() => '');
      const declaraFuente = /no verificad|sint[eé]tic/i.test(marca + dicho);
      const cita = /Material consultado/i.test(marca) || /Material consultado/i.test(dicho);
      const sugiereAsesor = /asesor|una persona|con[ií]rmalo|conf[ií]rmalo|confirmar/i.test(dicho);
      corridas.push({ i, mencionaTurbo, declaraFuente, cita, sugiereAsesor, dicho, marca });
      if (i === 1) await foto(p.pagina, 'e1-conocimiento');
      console.log(
        `       toma ${i}: ${mencionaTurbo ? 'habla del turbo' : 'NO habla del turbo'} · ` +
          `${cita ? 'cita material' : 'sin cita'} · ${declaraFuente ? 'declara fuente' : 'sin declarar'}`,
      );
    } finally {
      await cerrarPestana(p);
    }
  }

  if (!corridas.length) {
    check('la escena se ensayó', 'riesgo', 'GUION_REPETIR_E1=0: no se probó ninguna toma');
    return cerrarEscena();
  }

  const buenas = corridas.filter((c) => c.mencionaTurbo && c.cita && c.declaraFuente).length;
  check(
    'el agente contesta la pregunta del guion',
    corridas.every((c) => c.dicho.length > 20) ? 'ok' : 'falla',
    `${corridas.length} tomas, todas con respuesta`,
  );
  check(
    'la respuesta habla del turbocargador',
    corridas.every((c) => c.mencionaTurbo)
      ? 'ok'
      : corridas.some((c) => c.mencionaTurbo)
        ? 'riesgo'
        : 'falla',
    `${corridas.filter((c) => c.mencionaTurbo).length} de ${corridas.length} tomas lo mencionan`,
  );
  check(
    'cita el material que consultó',
    corridas.every((c) => c.cita) ? 'ok' : corridas.some((c) => c.cita) ? 'riesgo' : 'falla',
    `${corridas.filter((c) => c.cita).length} de ${corridas.length} tomas traen «Material consultado»`,
  );
  check(
    'declara que la fuente no está verificada',
    corridas.every((c) => c.declaraFuente) ? 'ok' : 'falla',
    `${corridas.filter((c) => c.declaraFuente).length} de ${corridas.length} tomas lo declaran`,
  );
  check(
    'sugiere confirmarlo con un asesor',
    corridas.every((c) => c.sugiereAsesor) ? 'ok' : 'riesgo',
    `${corridas.filter((c) => c.sugiereAsesor).length} de ${corridas.length} tomas lo sugieren`,
  );
  check(
    'tomas limpias a la primera',
    buenas === corridas.length ? 'ok' : buenas ? 'riesgo' : 'falla',
    `${buenas} de ${corridas.length} tomas servirían tal cual`,
  );

  escenaActual.corridas = corridas.map((c) => ({ ...c, dicho: c.dicho.slice(0, 900) }));
  cerrarEscena();
}

// ═════════════════════════════════════════════════════════════════════════════
// ESCENA 2 · Agendar, con los guardrails a la vista
// ESCENA 3 · Escalamiento honesto (misma conversación, a propósito)
// ESCENA 4 · Traza
// ═════════════════════════════════════════════════════════════════════════════

async function agendarYEscalar(contexto) {
  escena('agenda', 'Agendar, con los guardrails a la vista', '1:05–2:05');

  if (!ESCRIBIR) {
    check('la escena escribe en la org', 'riesgo', 'GUION_SIN_ESCRIBIR=1: no se ejecutó');
    cerrarEscena();
    return null;
  }

  const p = await nuevaPestana();
  const folio = await folioDeLaVisita(p.pagina);
  const antes = new Date(Date.now() - 120_000).toISOString();

  try {
    // ── turno 1: el guion escribe «Quiero agendar servicio en Queretaro»
    const t1 = await decir(p.pagina, `Quiero agendar servicio en ${TALLER_TEXTO}`);
    const pideVin = /\bVIN\b|n[uú]mero de serie/i.test(t1);
    const dice17 = /17|diecisiete/i.test(t1);
    const explica = /identificar|unidad|cobertura|garant[ií]a|saber|verificar/i.test(t1);
    check(
      'pide el VIN antes de actuar',
      pideVin ? 'ok' : 'falla',
      pideVin ? `lo pidió: «${t1.replace(/\s+/g, ' ').slice(0, 110)}»` : `no lo pidió: «${t1.slice(0, 140)}»`,
    );
    check(
      'dice que son diecisiete caracteres',
      dice17 ? 'ok' : 'riesgo',
      dice17 ? 'lo dice' : 'no menciona la longitud; la narración del guion sí',
    );
    check('explica para qué lo necesita', explica ? 'ok' : 'riesgo', explica ? 'lo explica' : 'lo pide sin motivo');
    await foto(p.pagina, 'e2-pide-vin');

    // ── turno 2: la frase clave del video
    const t2 = await decir(
      p.pagina,
      `Agendame el sabado a las 8 de la mañana, VIN ${VIN}`,
    );

    // Las horas OFRECIDAS son las de la lista numerada, y sólo su hora de INICIO.
    // Barrer el turno entero con una expresión de reloj era un mal método: se llevaba
    // por delante el «8:00» de la frase que niega esa hora —justo la que hace la
    // escena— y el «15:00» que es el fin del rango de la tercera opción, y luego
    // acusaba al agente de inventar franjas que nunca ofreció.
    // La hora de inicio es la PRIMERA de cada línea numerada. El agente redacta la
    // lista de dos maneras según la corrida —«1. 09:00 a 11:00» y «1. Sábado 15 de
    // agosto de 09:00 a 11:00»—, así que entre el número y la hora se admite texto.
    const horasOfrecidas = [
      ...t2.matchAll(/^\s*\d+[.)]\s*[^\n:]{0,70}?\b([01]?\d|2[0-3]):([0-5]\d)\b/gm),
    ].map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
    // La frase que hace la escena: nombrar las ocho para decir que no existen.
    const niegaLasOcho =
      /no (hay|existe|tengo|est[aá])[^.]{0,40}\b(8|ocho|08)[:.\s]?(00)?\s*(a\.?\s?m|de la ma[ñn]ana|h)?/i.test(t2);
    const acepto = horasOfrecidas.includes('08:00');

    check(
      'no agenda a las 8:00, que no existen',
      acepto ? 'falla' : 'ok',
      acepto ? 'ofreció las 8:00 como si existieran' : 'no las ofreció',
    );
    check(
      'le dice al cliente que esa hora no está',
      niegaLasOcho ? 'ok' : 'riesgo',
      niegaLasOcho
        ? `lo dice con todas sus letras: «${/[^.]*\b(8|ocho|08)[^.]*\./i.exec(t2)?.[0]?.trim().slice(0, 120) ?? ''}»`
        : 'ofrece horarios pero no explica que las 8:00 no existen; la narración sí lo dice',
    );
    check(
      'ofrece franjas concretas para elegir',
      horasOfrecidas.length ? 'ok' : 'falla',
      horasOfrecidas.length
        ? `ofreció ${horasOfrecidas.join(', ')}`
        : `no ofreció horarios: «${t2.replace(/\s+/g, ' ').slice(0, 160)}»`,
    );

    // Y las horas que ofreció, ¿existen de verdad? Se cruzan contra la org.
    if (horasOfrecidas.length) {
      const reales = soql(
        `SELECT Inicio__c FROM Slot_Taller__c ` +
          `WHERE Sucursal__r.Codigo_Sucursal__c = '${TALLER_CODIGO}' ` +
          `AND Disponible__c = true AND Procedencia__c = 'OPERACIONAL_VERIFICADO' ` +
          `AND Inicio__c >= ${new Date().toISOString()} ORDER BY Inicio__c LIMIT 200`,
      ).records ?? [];
      const catalogo = new Set(reales.map((r) => horaLocal(r.Inicio__c)));
      const inventadas = [...new Set(horasOfrecidas)].filter((h) => !catalogo.has(h));
      check(
        'los horarios que ofreció existen en el catálogo',
        inventadas.length === 0 ? 'ok' : 'falla',
        inventadas.length
          ? `inventó ${inventadas.join(', ')}; el catálogo sólo tiene ${[...catalogo].join(', ')}`
          : `las ${new Set(horasOfrecidas).size} horas ofrecidas están en Slot_Taller__c`,
      );
    }

    // El panel derecho: la narración lo señala y dice tres datos en voz alta.
    const panel = await p.pagina.locator('#panel').innerText().catch(() => '');
    const pintoKm = /41[.,\s]?200\s*km/i.test(panel);
    const pintoMeses = /\b9\s*meses\b/i.test(panel);
    const pintoSistemas = /sistema/i.test(panel);
    check(
      'el panel derecho se pobló solo con la cobertura',
      pintoKm && pintoMeses && pintoSistemas ? 'ok' : panel.length > 40 ? 'riesgo' : 'falla',
      panel.length
        ? `km ${pintoKm ? 'sí' : 'no'} · meses ${pintoMeses ? 'sí' : 'no'} · sistemas ${pintoSistemas ? 'sí' : 'no'}`
        : 'el panel quedó vacío: la narración señalaría una pantalla en blanco',
    );
    await foto(p.pagina, 'e2-corrige-y-panel');

    // ── turno 3: el guion dice «Escribe el número de la opción que ofrezca (la
    // primera)». Con el número a secas no basta: junto con las opciones el agente
    // pide también el tipo de servicio y el motivo de la visita, así que un «1» solo
    // devuelve otra pregunta y la cámara se queda esperando. La línea corregida
    // contesta las tres cosas de una vez, que es lo que cierra la cita en un turno.
    const RESPUESTA_OPCION = 'La 1, es mantenimiento preventivo de 40 mil kilómetros';
    let t3 = await decir(p.pagina, RESPUESTA_OPCION);
    let folios = [...t3.matchAll(/\b(\d{8})\b/g)].map((m) => m[1]);
    let turnosDeCierre = 1;
    // Si aun así vuelve a preguntar, se le contesta una vez más y se DEJA ANOTADO:
    // cada turno extra son diez segundos de video que el presupuesto no tiene.
    if (!folios.length) {
      t3 = await decir(p.pagina, 'Sí, confírmala por favor.');
      folios = [...t3.matchAll(/\b(\d{8})\b/g)].map((m) => m[1]);
      turnosDeCierre = 2;
    }
    check(
      'la cita se cierra en un solo turno',
      folios.length && turnosDeCierre === 1 ? 'ok' : folios.length ? 'riesgo' : 'falla',
      folios.length
        ? `hicieron falta ${turnosDeCierre} turno(s) tras las opciones`
        : 'no cerró ni con dos turnos',
    );
    check(
      'cierra dictando el folio de la orden',
      folios.length ? 'ok' : 'falla',
      folios.length ? `dictó ${folios.join(', ')}` : `terminó sin folio: «${t3.replace(/\s+/g, ' ').slice(0, 160)}»`,
    );
    escenaActual.turnos = [
      { cliente: `Quiero agendar servicio en ${TALLER_TEXTO}`, agente: t1 },
      { cliente: `Agendame el sabado a las 8 de la mañana, VIN ${VIN}`, agente: t2 },
      { cliente: RESPUESTA_OPCION, agente: t3 },
    ];
    await foto(p.pagina, 'e2-folio');

    let orden = null;
    if (folios.length) {
      const lista = folios.map((f) => `'${escapar(f)}'`).join(',');
      orden = soql(
        `SELECT WorkOrderNumber, Status, Subject, CreatedDate, CreatedBy.Name, ` +
          `Asset.SerialNumber, Sucursal__r.Codigo_Sucursal__c, Sucursal__r.Name, ` +
          `Slot_Taller__r.Inicio__c, Correlation_Id__c ` +
          `FROM WorkOrder WHERE WorkOrderNumber IN (${lista}) AND CreatedDate >= ${antes}`,
      ).records?.[0] ?? null;
    }
    check(
      'la orden existe en Salesforce con ese folio',
      orden ? 'ok' : 'falla',
      orden ? `${orden.WorkOrderNumber} · ${orden.Subject ?? 'sin asunto'}` : 'ninguno de los folios dictados existe',
    );
    if (orden) {
      check(
        'la orden quedó en el taller de Querétaro',
        orden.Sucursal__r?.Codigo_Sucursal__c === TALLER_CODIGO ? 'ok' : 'falla',
        `taller ${orden.Sucursal__r?.Codigo_Sucursal__c ?? 'sin asignar'} · ${orden.Sucursal__r?.Name ?? ''}`,
      );
      check(
        'la orden es de la unidad del guion',
        orden.Asset?.SerialNumber === VIN ? 'ok' : 'falla',
        `unidad ${orden.Asset?.SerialNumber ?? 'ninguna'}`,
      );
      // «Y miren el creador: el usuario del agente. Ejecutó, no describió.»
      const creador = orden.CreatedBy?.Name ?? '';
      const esAgente = /einstein|agent/i.test(creador);
      check(
        'el creador visible es el usuario del agente',
        esAgente ? 'ok' : 'falla',
        `CreatedBy = «${creador}»${esAgente ? '' : ' — la narración señala este dato en cámara'}`,
      );
      check(
        'la cita apunta a una franja real',
        orden.Slot_Taller__r?.Inicio__c ? 'ok' : 'riesgo',
        orden.Slot_Taller__r?.Inicio__c
          ? `${new Date(orden.Slot_Taller__r.Inicio__c).toLocaleString('es-MX')}`
          : 'la orden no quedó ligada a ninguna franja',
      );
    }
    cerrarEscena();

    // ═══ ESCENA 3 · misma conversación, a propósito ═══
    escena('escalamiento', 'Escalamiento honesto', '2:05–2:40');

    const t4 = await decir(p.pagina, 'Quiero hablar con una persona');
    // La ventana cambia de interlocutor y el folio va en la cabecera. Eso es lo que
    // la narración llama «la tarjeta con el folio».
    const cabecera = await p.pagina.locator('#interlocutor').innerText().catch(() => '');
    const cambio = /asesor/i.test(cabecera);
    const folioEnCabecera = /caso\s*(\d{6,8})/i.exec(cabecera)?.[1] ?? null;
    check(
      'la ventana pasa a una persona sin cambiar de pantalla',
      cambio ? 'ok' : 'falla',
      cambio ? `cabecera: «${cabecera}»` : `la cabecera sigue diciendo «${cabecera}»`,
    );
    check(
      'el folio del caso queda a la vista',
      folioEnCabecera ? 'ok' : 'riesgo',
      folioEnCabecera ? `caso ${folioEnCabecera}` : 'no se ve ningún folio en la cabecera',
    );
    // No prometer una transferencia en vivo es el punto honesto de la escena.
    const prometeVivo = /te (transfiero|paso) (ahora|en vivo)|en este momento te comunico/i.test(t4);
    check(
      'no promete una transferencia en vivo',
      prometeVivo ? 'falla' : 'ok',
      prometeVivo ? `prometió transferencia en vivo: «${t4.slice(0, 140)}»` : 'no la promete',
    );
    await foto(p.pagina, 'e3-escalado');

    const caso = soql(
      `SELECT Id, CaseNumber, Origin, Status, Owner.Name, CreatedBy.Name, Correlation_Id__c, Subject ` +
        `FROM Case WHERE Correlation_Id__c = '${escapar(folio)}' ORDER BY CreatedDate DESC LIMIT 1`,
    ).records?.[0] ?? null;
    check(
      'el caso existe en Salesforce con el folio de la visita',
      caso ? 'ok' : 'falla',
      caso ? `${caso.CaseNumber} · origen ${caso.Origin} · dueño ${caso.Owner?.Name}` : `nada bajo ${folio}`,
    );
    if (caso) {
      check(
        'el origen se ve como Agentforce en la lista de Cases',
        /agentforce/i.test(String(caso.Origin)) ? 'ok' : 'riesgo',
        `Origin = «${caso.Origin}» — la narración manda mostrar esta columna`,
      );
      check(
        'el caso cayó en la cola de postventa',
        /escalamiento/i.test(String(caso.Owner?.Name)) ? 'ok' : 'falla',
        `dueño: ${caso.Owner?.Name ?? 'sin dueño'}`,
      );
      if (folioEnCabecera) {
        check(
          'el folio que enseña la app es el real',
          folioEnCabecera === caso.CaseNumber ? 'ok' : 'falla',
          folioEnCabecera === caso.CaseNumber ? 'coinciden' : `pantalla ${folioEnCabecera} vs org ${caso.CaseNumber}`,
        );
      }
      // La transcripción no viaja como un comentario por turno: la app siembra UNO
      // con la conversación entera. Contar comentarios era el aserto equivocado —dos
      // apuntes pueden contener los nueve turnos—; lo que importa es que el asesor
      // pueda leer lo que el cliente dijo, así que se busca dentro del cuerpo.
      const com = soql(
        `SELECT CommentBody FROM CaseComment WHERE ParentId = '${escapar(caso.Id)}' ` +
          `AND IsPublished = false ORDER BY CreatedDate`,
      ).records ?? [];
      const cuerpos = com.map((c) => String(c.CommentBody ?? '')).join('\n');
      const turnosSembrados = Number(/de\s+(\d+)\]|turno \d+\/(\d+)\]/.exec(cuerpos)?.[2] ?? 0) ||
        [...cuerpos.matchAll(/\[turno \d+\/\d+\]/g)].length;
      const traeResumen = /Resumen para el asesor/i.test(cuerpos);
      check(
        'la conversación completa viaja al expediente',
        turnosSembrados >= 3 && traeResumen ? 'ok' : com.length ? 'riesgo' : 'falla',
        com.length
          ? `${com.length} apuntes internos con ${turnosSembrados} turnos` +
            (traeResumen ? ' y resumen para el asesor' : ' pero sin resumen')
          : 'el expediente llegó vacío',
      );
    }
    cerrarEscena();

    // ═══ Variante B · el panel del asesor ═══
    escena('panel', 'Variante B — el asesor responde en vivo', '2:05–2:40 (opcional)');
    if (!caso) {
      check('hay un caso que atender', 'falla', 'la escena 3 no dejó caso');
      cerrarEscena();
    } else {
      await variantePanel(caso, p.pagina);
    }

    // ═══ ESCENA 4 · Traza ═══
    escena('traza', 'Traza correlacionada', '2:40–2:52');
    const logs = soql(
      `SELECT Name, Subagent__c, Action_Name__c, Outcome__c, Related_Record_Id__c, ` +
        `Odometer_Used__c, Policy_Version__c FROM Log_Agente__c ` +
        `WHERE Correlation_Id__c = '${escapar(folio)}' ORDER BY CreatedDate`,
    ).records ?? [];
    check(
      'el folio de la visita filtra la traza',
      logs.length ? 'ok' : 'falla',
      logs.length
        ? `${logs.length} registros bajo ${folio}: ${logs.map((l) => l.Action_Name__c).join(', ')}`
        : `Log_Agente__c no tiene ningún registro con ${folio}: el filtro del guion sale vacío`,
    );
    if (logs.length) {
      // La narración del guion nombra en voz alta cuatro columnas. Dos de ellas están
      // vacías en toda la org (2 registros con odómetro y 5 con versión de política de
      // 341), así que señalarlas en cámara enseña celdas en blanco mientras se afirma
      // que están llenas. La escena sigue siendo grabable; la frase, no.
      const conKm = logs.filter((l) => l.Odometer_Used__c != null).length;
      const conPoliza = logs.filter((l) => l.Policy_Version__c).length;
      const conRegistro = logs.filter((l) => l.Related_Record_Id__c).length;
      check(
        'las columnas que nombra la narración están llenas',
        conKm && conPoliza ? 'ok' : 'riesgo',
        `acción y registro: ${conRegistro}/${logs.length} · odómetro: ${conKm}/${logs.length} · ` +
          `versión de política: ${conPoliza}/${logs.length}` +
          (conKm && conPoliza ? '' : ' — la narración nombra columnas vacías'),
      );
    }
    escenaActual.folio = folio;
    cerrarEscena();

    if (p.errores.length) {
      console.log(`\n       (consola del navegador: ${p.errores.length} errores)`);
      escenas.push({ clave: 'consola', titulo: 'Errores en consola', checks: [], veredicto: 'info', errores: p.errores });
    }
    return { folio, orden, caso };
  } finally {
    await cerrarPestana(p);
  }
}

/**
 * Variante B del guion: el asesor abre `/panel.html`, toma el caso que acaba de llegar
 * y le responde al cliente; el mensaje aparece en la ventana del cliente sin recargar.
 *
 * Lo que se mide aquí, además de que funcione, es si se puede ENCONTRAR el caso: la
 * cola arrastra casos viejos de todas las pruebas, y el guion ya avisa de que no se
 * muestre entera.
 */
async function variantePanel(caso, paginaCliente) {
  const usuario = process.env.APP_ADMIN_USER ?? 'asesor';
  const clave = process.env.APP_ADMIN_PASS ?? 'demo-zapata-2026';

  const p = await nuevaPestana();
  try {
    const acceso = await p.pagina.evaluate(
      ([u, c]) =>
        fetch('/publico/acceso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario: u, clave: c }),
        }).then((r) => r.json().then((d) => ({ status: r.status, d }))),
      [usuario, clave],
    );
    check(
      'el asesor entra al panel',
      acceso.status === 200 ? 'ok' : 'falla',
      acceso.status === 200 ? `rol ${acceso.d?.rol}` : `HTTP ${acceso.status}`,
    );
    if (acceso.status !== 200) return cerrarEscena();

    await p.pagina.goto(`${BASE}/panel.html`, { waitUntil: 'networkidle' });
    await p.pagina.waitForSelector('#bandeja button[data-caso]', { timeout: 30_000 }).catch(() => {});
    const enCola = await p.pagina.locator('#bandeja button[data-caso]').count();

    // ¿En qué posición aparece el caso recién escalado? Si está enterrado, el guion
    // pide filtrar y eso son segundos de video que no sobran.
    const textos = await p.pagina.locator('#bandeja button[data-caso]').allInnerTexts();
    const posicion = textos.findIndex((t) => t.includes(caso.CaseNumber));
    check(
      'el caso recién escalado se ve sin buscar',
      posicion === 0 ? 'ok' : posicion > 0 && posicion < 3 ? 'riesgo' : 'falla',
      posicion < 0
        ? `${caso.CaseNumber} no aparece entre los ${enCola} de la cola`
        : `aparece en la posición ${posicion + 1} de ${enCola}`,
    );
    check(
      'la cola es presentable en cámara',
      enCola <= 12 ? 'ok' : 'riesgo',
      `${enCola} conversaciones en la bandeja` +
        (enCola > 12 ? ' — el guion pide no mostrarla entera' : ''),
    );
    await foto(p.pagina, 'e3b-panel-cola');

    if (posicion < 0) return cerrarEscena();

    await p.pagina.locator('#bandeja button[data-caso]').nth(posicion).click();
    await p.pagina.waitForSelector('#entrada:not([disabled])', { timeout: 20_000 });
    const respuesta = `Buen día, ya tengo su conversación completa. Ensayo ${ts}.`;
    await p.pagina.fill('#entrada', respuesta);
    await p.pagina.click('#enviar');
    // El hilo del panel se repinta al publicar el comentario.
    await p.pagina.waitForFunction(
      (t) => document.getElementById('hilo')?.innerText.includes(t),
      respuesta,
      { timeout: 30_000 },
    ).catch(() => {});
    const publicado = await p.pagina.locator('#hilo').innerText().then((t) => t.includes(respuesta));
    check('el asesor le responde al cliente', publicado ? 'ok' : 'falla', publicado ? 'el mensaje quedó en el hilo' : 'no se publicó');
    await foto(p.pagina, 'e3b-panel-responde');

    // Y lo que hace fuerte a la escena: al cliente le llega sin recargar.
    const llego = await paginaCliente
      .waitForFunction(
        (t) => document.getElementById('hilo')?.innerText.includes(t),
        respuesta,
        { timeout: 60_000 },
      )
      .then(() => true)
      .catch(() => false);
    check(
      'el mensaje del asesor llega al cliente en vivo',
      llego ? 'ok' : 'falla',
      llego ? 'apareció en la ventana del cliente sin recargar' : 'no llegó en 60 s',
    );
    await foto(paginaCliente, 'e3b-cliente-recibe');
    cerrarEscena();
  } finally {
    await p.contexto.close();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Corrida
// ═════════════════════════════════════════════════════════════════════════════

console.log(`\nEnsayo del guion · ${new Date().toLocaleString('es-MX')} · VIN ${VIN}`);
console.log(ESCRIBIR ? 'Escribe en la organización, igual que la cámara.' : 'Sin escribir (GUION_SIN_ESCRIBIR=1).');

const previo = await condiciones();

// `GUION_SOLO=conocimiento` (o `agenda`) acota el ensayo a una escena. Sirve para
// medir la varianza de una toma sin volver a crear una orden y un caso cada vez.
const SOLO = (process.env.GUION_SOLO ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const corre = (clave) => !SOLO.length || SOLO.includes(clave);

navegador = await chromium.launch({ headless: !VISIBLE });
try {
  if (corre('conocimiento')) await conocimiento();
  if (corre('agenda')) await agendarYEscalar(previo);
} finally {
  await navegador.close();
}

// ── Cierre ───────────────────────────────────────────────────────────────────

const todos = escenas.flatMap((e) => e.checks);
const fallas = todos.filter((c) => c.estado === 'falla').length;
const riesgos = todos.filter((c) => c.estado === 'riesgo').length;

writeFileSync(join(dir, 'guion.json'), JSON.stringify({ ts, base: BASE, vin: VIN, escenas }, null, 1));

console.log('\n═══ Veredicto por escena ═══');
for (const e of escenas) {
  if (e.veredicto === 'info') continue;
  console.log(`  ${String(e.veredicto).padEnd(12)} ${e.minutaje ?? ''} · ${e.titulo}`);
}
console.log(
  `\n${fallas ? 'ROJO' : riesgos ? 'ÁMBAR' : 'VERDE'} — ${fallas} escenas rotas, ${riesgos} riesgos`,
);
console.log(`evidencia y capturas en evidencia/19-guion/${ts}/`);
process.exit(fallas ? 1 : 0);
