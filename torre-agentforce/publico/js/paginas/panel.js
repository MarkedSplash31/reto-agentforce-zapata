import { bloqueError, cargando, vacio, chip, escapar, fecha } from '../sistema.js';

const bandeja = document.getElementById('bandeja');
const conteo = document.getElementById('conteo');
const hilo = document.getElementById('hilo');
const cabecera = document.getElementById('cabecera');
const entrada = document.getElementById('entrada');
const boton = document.getElementById('enviar');

let casoActual = null;
let fuente = null;
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
        <p class="text-[10px] uppercase tracking-[0.3em] ${ctx.clase === 'turno' ? 'text-gray-600' : 'text-amber-400/80'} mb-2">${escapar(etiqueta)}</p>
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
        <p class="text-[10px] uppercase tracking-widest text-gray-500 mb-2">${mio ? 'Tú' : 'Cliente'} · ${escapar(fecha(c.creadoEn))}</p>
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
    const casos = d.casos ?? [];
    conteo.textContent = casos.length ? `${casos.length}` : '';

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
        <p class="text-[10px] uppercase tracking-widest text-gray-600 mt-2">${escapar(fecha(c.creadoEn))} · ${c.comentarios ?? 0} mensajes</p>
      </button>`,
          )
          .join('')
      : vacio('No hay conversaciones esperando. Cuando un cliente pida hablar con una persona, aparecerá aquí.');

    for (const b of bandeja.querySelectorAll('button[data-caso]')) {
      b.addEventListener('click', () => abrir(b.dataset.caso));
    }
  } catch (e) {
    bandeja.innerHTML = bloqueError(e, 'No se pudo leer la lista de conversaciones');
  }
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
        <span class="text-[11px] font-light text-gray-500">${escapar(c.caso?.asunto || '')}</span>
      </div>`;

    hilo.innerHTML = '';
    (c.comentarios ?? []).forEach(burbuja);

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
          `<li class="text-[10px] uppercase tracking-widest text-gray-600">${escapar(
            (a.accion ?? 'acción').replace(/_/g, ' '),
          )} · ${escapar(a.resultado ?? '—')} · ${escapar(a.folio)}</li>`,
      )
      .join('');

    salidaConsulta.innerHTML = `
      <div class="border border-white/10 bg-[#0b0c10] p-4">
        <p class="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Respuesta del asistente · sólo para ti</p>
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
