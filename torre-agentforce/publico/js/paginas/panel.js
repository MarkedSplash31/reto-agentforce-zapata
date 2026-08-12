import { bloqueError, cargando, vacio, chip, escapar, fecha, numero } from '../sistema.js';

const bandeja = document.getElementById('bandeja');
const conteo = document.getElementById('conteo');
const filtro = document.getElementById('filtro');
const contexto = document.getElementById('contexto');
const hilo = document.getElementById('hilo');
const cabecera = document.getElementById('cabecera');
const entrada = document.getElementById('entrada');
const boton = document.getElementById('enviar');

let casoActual = null;
let fuente = null;
let casosEnMemoria = [];
/** `hoy` | `todas` — qué parte de la cola se está mirando. */
let alcance = 'hoy';
const vistos = new Set();

// Sin sesión de asesor esta pantalla no existe. Se comprueba antes de pintar nada.
try {
  const s = await (await fetch('/publico/sesion')).json();
  if (s.rol !== 'admin') {
    location.replace('acceso.html');
  }
} catch {
  location.replace('acceso.html');
}

document.getElementById('salir').addEventListener('click', async () => {
  try {
    await fetch('/publico/salir', { method: 'POST' });
  } finally {
    location.href = 'acceso.html';
  }
});

/** Los comentarios internos de apertura son el contexto que mandó el cliente. */
function esContexto(c) {
  return c.publicado === false;
}

function ladoDe(c) {
  return /^ASESOR:/i.test(c.cuerpo || '') ? 'asesor' : 'cliente';
}

function limpio(c) {
  return (c.cuerpo || '').replace(/^(ASESOR|CLIENTE):\s*/i, '');
}

/**
 * Los comentarios de apertura llegan con un sobre a prueba de manipulación: una
 * cabecera con su huella y, debajo, el contenido. Esa huella sirve para auditar que
 * nadie alteró el contexto, pero al asesor no le dice nada: lo que necesita es leer
 * lo que dijo el cliente. Se separa una cosa de la otra en vez de enseñarle hashes.
 */
function leerContexto(cuerpo) {
  const texto = String(cuerpo || '');
  const turno = /^\[turno (\d+)\/(\d+)\]/.exec(texto);
  const cuerpoLimpio = texto
    .split('\n')
    .filter((l) => !/^\[(escalamiento|contexto-torre|turno)/.test(l))
    .filter((l) => !/^(Contexto|Politica|Asunto):/i.test(l))
    .filter((l) => !/^Autor:/i.test(l))
    .filter((l) => !/^Resumen para el asesor:/i.test(l))
    .join('\n')
    .trim();

  const autor = /^Autor:\s*(\w+)/m.exec(texto)?.[1] ?? null;
  const asunto = /^Asunto:\s*(.+)$/m.exec(texto)?.[1] ?? null;
  const politica = /^Politica:\s*(.+)$/m.exec(texto)?.[1] ?? null;

  if (turno) {
    return { clase: 'turno', orden: `${turno[1]} de ${turno[2]}`, autor, texto: cuerpoLimpio };
  }
  if (asunto || politica) {
    return { clase: 'ficha', asunto, politica, texto: cuerpoLimpio };
  }
  return { clase: 'motivo', texto: cuerpoLimpio };
}

function burbuja(c) {
  if (!c || vistos.has(c.id)) return;
  vistos.add(c.id);

  const lado = ladoDe(c);
  const mio = lado === 'asesor';
  const contexto = esContexto(c);

  const fila = document.createElement('div');
  fila.className = contexto ? 'flex justify-center' : mio ? 'flex justify-end' : 'flex justify-start';

  if (contexto) {
    // Contexto de apertura: se distingue de un mensaje en vivo para que el asesor no
    // crea que el cliente acaba de escribirlo.
    const ctx = leerContexto(c.cuerpo);
    const etiqueta =
      ctx.clase === 'turno'
        ? `Conversación previa · turno ${ctx.orden} · ${ctx.autor === 'agente' ? 'asistente' : 'cliente'}`
        : ctx.clase === 'ficha'
          ? 'Motivo declarado'
          : 'Lo que pidió el cliente';
    fila.innerHTML = `
      <div class="w-full border ${ctx.clase === 'turno' ? 'border-white/5' : 'border-amber-400/20'} bg-[#0b0c10] p-4">
        <p class="text-[10px] uppercase tracking-[0.3em] ${ctx.clase === 'turno' ? 'texto-apagado' : 'text-amber-400/80'} mb-2">${escapar(etiqueta)}</p>
        ${ctx.asunto ? `<p class="text-gray-300 text-xs font-light mb-1">${escapar(ctx.asunto)}</p>` : ''}
        <p class="text-gray-400 text-[11px] leading-relaxed font-light whitespace-pre-wrap"></p>
      </div>`;
    fila.querySelector('p:last-child').textContent = ctx.texto;
    hilo.appendChild(fila);
    hilo.scrollTop = hilo.scrollHeight;
    return;
  }
  {
    fila.innerHTML = `
      <div class="max-w-[80%] border ${mio ? 'border-white/20 bg-white/5' : 'border-white/5 bg-[#0b0c10]'} p-4">
        <p class="text-[10px] uppercase tracking-widest texto-tenue mb-2">${mio ? 'Tú' : 'Cliente'} · ${escapar(fecha(c.creadoEn))}</p>
        <p class="text-gray-100 text-xs leading-relaxed font-light whitespace-pre-wrap"></p>
      </div>`;
  }
  fila.querySelector('p:last-child').textContent = limpio(c);
  hilo.appendChild(fila);
  hilo.scrollTop = hilo.scrollHeight;
}

async function cargarBandeja() {
  bandeja.innerHTML = cargando('las conversaciones');
  try {
    const res = await fetch('/publico/panel/bandeja');
    if (res.status === 401) {
      location.replace('acceso.html');
      return;
    }
    const d = await res.json();
    casosEnMemoria = d.casos ?? [];
    pintarBandeja();
  } catch (e) {
    bandeja.innerHTML = bloqueError(e, 'No se pudo leer la lista de conversaciones');
  }
}

/** Una conversación está viva si se abrió en las últimas 24 horas. */
const HORAS_VIVAS = 24;
function esDeHoy(c) {
  const t = Date.parse(c.creadoEn ?? '');
  return Number.isFinite(t) && Date.now() - t <= HORAS_VIVAS * 3_600_000;
}

/**
 * La cola llega a decenas de casos y muchos comparten asunto —«Escalamiento
 * solicitado desde Agentforce»—, así que sin filtro encontrar el que un cliente
 * acaba de escalar era cuestión de suerte. Se filtra en memoria: ya están todos.
 *
 * El alcance por omisión es lo de hoy. Un asesor que abre el panel atiende lo que
 * está pasando, no el archivo entero de la organización; y con más de cien casos
 * abiertos —ninguno se cierra solo— la lista completa era ruido en el que el caso
 * recién escalado quedaba enterrado. Nada se oculta: el conteo dice cuántos quedan
 * fuera y «Todas» los trae.
 */
function pintarBandeja() {
  const termino = (filtro?.value ?? '').trim().toLowerCase();
  const enAlcance = alcance === 'hoy' ? casosEnMemoria.filter(esDeHoy) : casosEnMemoria;
  const casos = termino
    ? enAlcance.filter((c) =>
        `${c.caseNumber ?? ''} ${c.asunto ?? ''}`.toLowerCase().includes(termino),
      )
    : enAlcance;

  const anteriores = casosEnMemoria.length - enAlcance.length;
  conteo.textContent = termino
    ? `${casos.length} de ${enAlcance.length}`
    : casosEnMemoria.length
      ? alcance === 'hoy' && anteriores
        ? `${enAlcance.length} · ${anteriores} anteriores`
        : `${enAlcance.length}`
      : '';

  try {
    bandeja.innerHTML = casos.length
      ? casos
          .map(
            (c) => `
      <button type="button" data-caso="${escapar(c.id)}"
        class="w-full text-left border ${c.id === casoActual ? 'border-white/20' : 'border-white/5'} bg-[#0b0c10] p-4 hover:border-white/20 transition-all duration-300">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="text-[11px] font-mono tracking-wide text-gray-300">${escapar(c.caseNumber)}</span>
          ${chip(c.estado || '—', c.estado === 'Closed' ? 'ok' : 'neutro')}
        </div>
        <p class="text-gray-400 text-[11px] leading-relaxed font-light">${escapar((c.asunto || '').slice(0, 80))}</p>
        <p class="text-[10px] uppercase tracking-widest texto-apagado mt-2">${escapar(fecha(c.creadoEn))} · ${c.comentarios ?? 0} mensajes</p>
      </button>`,
          )
          .join('')
      : vacio(
          termino
            ? `Ninguna conversación coincide con «${termino}».`
            : alcance === 'hoy' && anteriores
              ? `Hoy no ha escalado nadie. Quedan ${anteriores} conversaciones de días anteriores en «Todas».`
              : 'No hay conversaciones esperando. Cuando un cliente pida hablar con una persona, aparecerá aquí.',
        );

    for (const b of bandeja.querySelectorAll('button[data-caso]')) {
      b.addEventListener('click', () => abrir(b.dataset.caso));
    }
  } catch (e) {
    bandeja.innerHTML = bloqueError(e, 'No se pudo pintar la lista de conversaciones');
  }
}

filtro?.addEventListener('input', pintarBandeja);

for (const b of document.querySelectorAll('#alcance button[data-alcance]')) {
  b.addEventListener('click', () => {
    alcance = b.dataset.alcance;
    for (const otro of document.querySelectorAll('#alcance button[data-alcance]')) {
      const activo = otro === b;
      otro.setAttribute('aria-pressed', String(activo));
      otro.className = activo
        ? 'flex-1 border border-white/20 bg-white/5 px-3 py-2 text-[10px] uppercase tracking-widest text-white transition-colors duration-300'
        : 'flex-1 border border-white/10 px-3 py-2 text-[10px] uppercase tracking-widest text-gray-400 hover:border-white/30 hover:text-white transition-colors duration-300';
    }
    pintarBandeja();
  });
}

async function abrir(id) {
  casoActual = id;
  vistos.clear();
  hilo.innerHTML = cargando('la conversación');
  if (fuente) {
    fuente.close();
    fuente = null;
  }

  try {
    const res = await fetch(`/publico/panel/caso/${encodeURIComponent(id)}`);
    if (res.status === 401) {
      location.replace('acceso.html');
      return;
    }
    const c = await res.json();

    cabecera.innerHTML = `
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-[11px] font-mono tracking-wide text-white">${escapar(c.caso?.caseNumber || '')}</span>
        ${chip(c.caso?.estado || '—', 'neutro')}
        <span class="text-[11px] font-light texto-tenue">${escapar(c.caso?.asunto || '')}</span>
      </div>`;

    hilo.innerHTML = '';
    (c.comentarios ?? []).forEach(burbuja);

    // El expediente en paralelo: que tarde en releerse la traza no debe retrasar la
    // conversación, que es lo que el asesor necesita primero.
    void cargarContexto(id);

    entrada.disabled = false;
    boton.disabled = false;
    entrada.placeholder = 'Responde al cliente';
    entrada.focus();

    // Vivo: el servidor relee los mensajes desde el expediente y sólo emite lo nuevo.
    fuente = new EventSource(`/publico/panel/caso/${encodeURIComponent(id)}/stream`);
    fuente.addEventListener('comentario', (ev) => {
      try {
        burbuja(JSON.parse(ev.data).comentario);
      } catch {
        avisar('Llegó un mensaje que no se pudo leer. Recarga la conversación.');
      }
    });
    fuente.addEventListener('error', (ev) => {
      // Un hilo congelado sin aviso deja al cliente esperando sin que nadie lo sepa.
      let msg = 'Se perdió la conexión en vivo. Reintentando.';
      try {
        if (ev.data) msg = JSON.parse(ev.data).mensaje ?? msg;
      } catch {
        /* evento sin datos: se conserva el mensaje por defecto */
      }
      avisar(msg);
    });
    fuente.addEventListener('restablecido', () => avisar('Conexión restablecida.', true));

    await cargarBandeja();
  } catch (e) {
    hilo.innerHTML = bloqueError(e, 'No se pudo abrir la conversación');
  }
}

/* ══ el expediente de la conversación ═════════════════════════════════════
   Lo que ocurrió bajo la misma correlación y no llegaba a esta pantalla: la
   unidad de la que se habló, la orden que se creó, el reporte de carretera y
   qué subagente ejecutó qué. Todo releído de la org, nada deducido del texto. */

function filas(pares) {
  const vivas = pares.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!vivas.length) return '';
  return `<dl class="space-y-1.5">${vivas
    .map(
      ([k, v, mono]) => `
      <div class="flex justify-between gap-4">
        <dt class="text-[10px] uppercase tracking-widest texto-apagado">${escapar(k)}</dt>
        <dd class="text-[11px] ${mono ? 'font-mono tracking-wide' : ''} text-gray-300 text-right">${escapar(String(v))}</dd>
      </div>`,
    )
    .join('')}</dl>`;
}

function bloque(titulo, cuerpo) {
  // Superficie sobre el lienzo, igual que el resto de las tarjetas del panel: una
  // tarjeta del mismo color que su fondo no se ve.
  return `
    <div class="border border-white/5 bg-[#0d0e12] p-5">
      <p class="text-[10px] uppercase tracking-[0.3em] texto-tenue mb-3">${escapar(titulo)}</p>
      ${cuerpo}
    </div>`;
}

async function cargarContexto(id) {
  contexto.innerHTML = cargando('el expediente de la conversación');
  try {
    const res = await fetch(`/publico/panel/caso/${encodeURIComponent(id)}/contexto`);
    if (res.status === 401) {
      location.replace('acceso.html');
      return;
    }
    const d = await res.json();
    if (!res.ok) throw new Error(d.mensaje || `El servidor respondió ${res.status}`);

    if (!d.correlationId) {
      contexto.innerHTML = bloque(
        'Expediente',
        '<p class="texto-tenue text-xs font-light leading-relaxed">Este caso no trae correlación, así que no hay traza que releer.</p>',
      );
      return;
    }

    const partes = [];

    if (d.unidades?.length) {
      partes.push(
        bloque(
          'Unidad de la que se habló',
          `<ul class="space-y-1.5">${d.unidades
            .map((v) => `<li class="text-[11px] font-mono tracking-wide text-white">${escapar(v)}</li>`)
            .join('')}</ul>`,
        ),
      );
    }

    for (const o of d.ordenes ?? []) {
      partes.push(
        bloque(
          'Cita en taller',
          filas([
            ['Folio', o.folio, true],
            ['Estado', o.estado],
            ['Taller', o.sucursal, true],
            ['Inicio', o.inicio ? fecha(o.inicio) : null],
            ['Síntoma', o.sintoma],
          ]),
        ),
      );
    }

    for (const v of d.varadas ?? []) {
      partes.push(
        bloque(
          'Reporte de carretera',
          filas([
            ['Folio', v.folio, true],
            ['Carretera', v.carretera],
            ['Kilómetro', v.kilometro === null || v.kilometro === undefined ? null : numero(v.kilometro)],
            ['Prioridad', v.prioridad],
            ['Estado', v.estado],
            // Antes de mandar auxilio: el agente pierde a veces estas dos respuestas
            // y cambian por completo cómo se atiende la unidad.
            ['Fuera del carril', v.fueraDeCarril === null || v.fueraDeCarril === undefined ? null : v.fueraDeCarril ? 'Sí' : 'No'],
            ['Intermitentes', v.intermitentes === null || v.intermitentes === undefined ? null : v.intermitentes ? 'Sí' : 'No'],
          ]),
        ),
      );
    }

    if (d.acciones?.length) {
      partes.push(
        bloque(
          `Lo que ejecutó el asistente · ${d.acciones.length}`,
          `<ul class="space-y-2.5">${d.acciones
            .map(
              (a) => `
            <li class="flex items-start justify-between gap-3 border-b border-white/5 pb-2.5 last:border-0 last:pb-0">
              <div class="min-w-0">
                <p class="text-[11px] text-gray-200">${escapar((a.accion ?? 'acción').replace(/_/g, ' '))}</p>
                <p class="text-[10px] uppercase tracking-widest texto-apagado mt-1">${escapar(a.subagente ?? 'sin subagente')} · ${escapar(a.folio)}</p>
              </div>
              ${chip(a.resultado ?? '—', a.resultado === 'SUCCESS' ? 'ok' : a.resultado === 'BLOCKED' ? 'bloqueo' : a.resultado ? 'error' : 'neutro')}
            </li>`,
            )
            .join('')}</ul>`,
        ),
      );
    }

    if (!partes.length) {
      partes.push(
        bloque(
          'Expediente',
          `<p class="texto-tenue text-xs font-light leading-relaxed">
             El asistente no dejó traza bajo esta conversación: no ejecutó ninguna acción
             que registre, o el cliente pidió una persona antes de que hiciera nada.
           </p>`,
        ),
      );
    }

    contexto.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">${partes.join('')}</div>
      <p class="text-[10px] uppercase tracking-widest texto-apagado mt-4">
        Folio de la visita · <span class="font-mono tracking-wide texto-tenue">${escapar(d.correlationId)}</span>
      </p>`;
  } catch (e) {
    contexto.innerHTML = bloqueError(e, 'No se pudo leer el expediente de la conversación');
  }
}

function avisar(texto, ok = false) {
  const p = document.createElement('p');
  p.className = `text-[11px] font-light text-center py-2 ${ok ? 'text-emerald-300' : 'text-red-300'}`;
  p.textContent = texto;
  hilo.appendChild(p);
  hilo.scrollTop = hilo.scrollHeight;
}

document.getElementById('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const texto = entrada.value.trim();
  if (!texto || !casoActual) return;
  entrada.value = '';
  boton.disabled = true;

  try {
    const res = await fetch(`/publico/panel/caso/${encodeURIComponent(casoActual)}/responder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cuerpo: texto }),
    });
    if (res.status === 401) {
      location.replace('acceso.html');
      return;
    }
    const d = await res.json();
    if (!res.ok) throw new Error(d.mensaje || `El servidor respondió ${res.status}`);
    (d.comentarios ?? []).forEach(burbuja);
  } catch (e) {
    hilo.insertAdjacentHTML('beforeend', bloqueError(e, 'No se pudo enviar tu respuesta'));
  } finally {
    boton.disabled = false;
    entrada.focus();
  }
});

// ── herramienta del asesor: consultar al asistente ──────────────────────────
//
// El asesor hereda la capacidad del agente en vez de tener que buscar los datos por
// su cuenta en Salesforce. La consulta viaja por una conversación propia del asesor:
// el cliente no la ve, y nada de lo que se responda aquí entra al expediente hasta
// que el asesor lo mande explícitamente.

const consulta = document.getElementById('consulta');
const botonConsulta = document.getElementById('preguntar');
const salidaConsulta = document.getElementById('respuesta-consulta');

document.getElementById('form-consulta').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const pregunta = consulta.value.trim();
  if (!pregunta) return;
  if (!casoActual) {
    salidaConsulta.innerHTML =
      '<p class="text-[11px] font-light text-amber-300">Elige primero la conversación que estás atendiendo.</p>';
    return;
  }

  botonConsulta.disabled = true;
  consulta.disabled = true;
  salidaConsulta.innerHTML = cargando('la respuesta del asistente');

  try {
    const res = await fetch(`/publico/panel/caso/${encodeURIComponent(casoActual)}/consultar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pregunta }),
    });
    if (res.status === 401) {
      location.replace('acceso.html');
      return;
    }
    const d = await res.json();
    if (!res.ok) throw new Error(d.mensaje || `El servidor respondió ${res.status}`);

    const traza = (d.actividad ?? [])
      .map(
        (a) =>
          `<li class="text-[10px] uppercase tracking-widest texto-apagado">${escapar(
            (a.accion ?? 'acción').replace(/_/g, ' '),
          )} · ${escapar(a.resultado ?? '—')} · ${escapar(a.folio)}</li>`,
      )
      .join('');

    salidaConsulta.innerHTML = `
      <div class="border border-white/10 bg-[#0b0c10] p-4">
        <p class="text-[10px] uppercase tracking-widest texto-tenue mb-2">Respuesta del asistente · sólo para ti</p>
        <p id="texto-consulta" class="text-gray-100 text-xs leading-relaxed font-light whitespace-pre-wrap"></p>
        ${traza ? `<ul class="mt-3 space-y-1 border-t border-white/5 pt-3">${traza}</ul>` : ''}
        <button id="usar-consulta" type="button"
          class="mt-4 border border-white/10 px-5 py-2 text-[10px] uppercase tracking-widest text-white hover:bg-white hover:text-black transition-colors duration-300">
          Usar en mi respuesta
        </button>
      </div>`;
    // textContent, no innerHTML: la respuesta viene de un modelo y no se interpreta.
    document.getElementById('texto-consulta').textContent =
      d.respuesta || '(el asistente no devolvió texto)';

    document.getElementById('usar-consulta').addEventListener('click', () => {
      // No se manda solo: el asesor es quien responde y decide qué le llega al cliente.
      entrada.value = d.respuesta || '';
      entrada.focus();
    });
    consulta.value = '';
  } catch (e) {
    salidaConsulta.innerHTML = bloqueError(e, 'No se pudo consultar al asistente');
  } finally {
    botonConsulta.disabled = false;
    consulta.disabled = false;
  }
});

await cargarBandeja();
