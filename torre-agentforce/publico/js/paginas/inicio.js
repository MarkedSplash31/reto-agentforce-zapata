/* ══════════════════════════════════════════════════════════════════════════
   La conversación ES la aplicación.

   Una sola ventana, como la del agente en Salesforce, pero en Zapata y con apoyo
   visual: lo que el asistente consulta o crea se dibuja al lado, tomado de las
   salidas reales de sus acciones.

   El escalamiento se decide entre el agente y la persona, no con un botón que el
   cliente aprieta a ciegas: cuando el agente invoca su acción de escalamiento, o
   cuando el cliente lo pide con todas sus letras, la MISMA ventana cambia de
   interlocutor y sigue el hilo con un asesor. El cliente no se muda de pantalla.
   ══════════════════════════════════════════════════════════════════════════ */

import { encabezado, bloqueError, cargando, vacio, escapar, chip } from '../sistema.js';
import { crearPanel } from '../panel-contextual.js';

const panel = crearPanel(document.getElementById('panel'));
const raiz = document.getElementById('conversacion');

/** Un número de serie que el cliente escribe: 11 o más alfanuméricos seguidos. */
const POSIBLE_VIN = /\b[A-HJ-NPR-Z0-9]{11,17}\b/i;

raiz.innerHTML = `
  <div class="border border-white/10 bg-[#0d0e12] flex flex-col min-h-[560px]">
    <div class="border-b border-white/5 px-5 py-4 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <span id="punto" class="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0"></span>
        <p id="interlocutor" class="text-[10px] uppercase tracking-[0.3em] text-gray-400 truncate">Asistente de postventa</p>
      </div>
      <div id="estado" class="shrink-0"></div>
    </div>

    <div id="hilo" role="log" aria-live="polite" aria-relevant="additions"
         class="flex-1 p-5 space-y-4 overflow-y-auto max-h-[420px]"></div>

    <div class="border-t border-white/5 p-4">
      <form id="form" class="flex flex-col sm:flex-row gap-3">
        <label for="entrada" class="sr-only">Escribe tu mensaje</label>
        <input id="entrada" autocomplete="off" placeholder="Cuéntanos qué pasa con tu unidad"
          class="flex-1 min-w-0 bg-[#0b0c10] border border-white/10 text-white px-3 py-2.5 text-xs focus:outline-none focus:border-white/40 transition-colors rounded-none placeholder:text-gray-700 disabled:opacity-40">
        <button id="enviar" type="submit"
          class="bg-white text-black px-8 py-2.5 text-xs uppercase tracking-widest font-medium hover:bg-neutral-200 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed">
          Enviar
        </button>
      </form>
      <p id="pie" class="text-[10px] text-gray-600 font-light mt-3 leading-relaxed"></p>
    </div>
  </div>`;

const hilo = document.getElementById('hilo');
const entrada = document.getElementById('entrada');
const boton = document.getElementById('enviar');
const estado = document.getElementById('estado');
const punto = document.getElementById('punto');
const interlocutor = document.getElementById('interlocutor');
const pie = document.getElementById('pie');

const turnos = [];
let conAsesor = false;
let fuenteAsesor = null;
const comentariosVistos = new Set();
/**
 * Nodo del saludo que pinta la propia página para no dejar la ventana vacía mientras
 * Salesforce abre la sesión. Cuando llega la bienvenida real del agente se sustituye
 * su texto en vez de añadir otra burbuja: si no, el cliente leía dos saludos casi
 * idénticos y el segundo parecía que el agente no lo había escuchado.
 */
let saludoLocal = null;

function burbuja(quien, texto) {
  const mio = quien === 'cliente';
  const fila = document.createElement('div');
  fila.className = mio ? 'flex justify-end' : 'flex justify-start';
  const etiqueta = mio ? 'Tú' : quien === 'asesor' ? 'Asesor de postventa' : 'Asistente';
  fila.innerHTML = `
    <div class="max-w-[85%] border ${mio ? 'border-white/20 bg-white/5' : quien === 'asesor' ? 'border-amber-400/30 bg-amber-400/[0.04]' : 'border-white/5 bg-[#0b0c10]'} p-4">
      <p class="text-[10px] uppercase tracking-widest ${quien === 'asesor' ? 'text-amber-400/80' : 'text-gray-500'} mb-2">${escapar(etiqueta)}</p>
      <p class="text-gray-100 text-xs leading-relaxed font-light whitespace-pre-wrap"></p>
    </div>`;
  fila.querySelector('p:last-child').textContent = texto;
  hilo.appendChild(fila);
  hilo.scrollTop = hilo.scrollHeight;
  return fila.querySelector('p:last-child');
}

function nota(texto, tono = 'neutro') {
  const p = document.createElement('p');
  const color = tono === 'error' ? 'text-red-300' : tono === 'ok' ? 'text-emerald-300' : 'text-gray-500';
  p.className = `text-[11px] font-light text-center py-2 ${color}`;
  p.textContent = texto;
  hilo.appendChild(p);
  hilo.scrollTop = hilo.scrollHeight;
}

function bloquear(si) {
  boton.disabled = si;
  entrada.disabled = si;
}

function marcarInterlocutor(quien) {
  if (quien === 'asesor') {
    conAsesor = true;
    interlocutor.textContent = 'Asesor de postventa';
    punto.className = 'w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0';
    estado.innerHTML = chip('Con una persona', 'bloqueo');
    entrada.placeholder = 'Escríbele al asesor';
    pie.textContent = 'Tu conversación quedó asentada. El asesor la está leyendo completa.';
  } else {
    interlocutor.textContent = 'Asistente de postventa';
    punto.className = 'w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0';
    estado.innerHTML = chip('En línea', 'ok');
    pie.innerHTML =
      'Lo que resuelvas aquí queda asentado en el sistema de Zapata. Si prefieres una persona, pídelo y te paso con un asesor.';
  }
}

// ── paso a una persona ──────────────────────────────────────────────────────

async function pasarConAsesor(motivo, avisar = true) {
  if (conAsesor) return;
  try {
    const res = await fetch('/publico/asesor/abrir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asunto: (turnos.find((t) => t.autor === 'cliente')?.texto ?? motivo).slice(0, 200),
        mensaje: motivo,
        turnos: turnos.slice(-40),
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.mensaje || `El servidor respondió ${res.status}`);

    marcarInterlocutor('asesor');
    if (avisar) nota('Te pasamos con un asesor de postventa. Sigue escribiendo aquí mismo.', 'ok');
    panel.aviso(
      'Te estamos pasando con una persona',
      `Tu conversación quedó registrada${d.caseNumber ? ` con el folio ${d.caseNumber}` : ''}. Un asesor la recibe completa.`,
      'ok',
    );
    escucharAsesor();
  } catch (e) {
    nota(`No pudimos abrir la conversación con un asesor: ${e.message}`, 'error');
  }
}

/**
 * El agente escaló por su cuenta y el SERVIDOR lo confirmó releyendo el Case de esta
 * correlación en Salesforce. No hace falta abrir nada: la conversación ya es de una
 * persona y sólo queda cambiar el interlocutor de la misma ventana.
 */
function adoptarAsesor(caseNumber) {
  if (conAsesor) return;
  marcarInterlocutor('asesor');
  nota('Te pasamos con un asesor de postventa. Sigue escribiendo aquí mismo.', 'ok');
  panel.aviso(
    'Te estamos pasando con una persona',
    `Tu conversación quedó registrada${caseNumber ? ` con el folio ${caseNumber}` : ''}. Un asesor la recibe completa.`,
    'ok',
  );
  escucharAsesor();
}

function escucharAsesor() {
  if (fuenteAsesor) return;
  fuenteAsesor = new EventSource('/publico/asesor/stream');
  fuenteAsesor.addEventListener('comentario', (ev) => {
    let c;
    try {
      c = JSON.parse(ev.data).comentario;
    } catch {
      nota('Llegó un mensaje que no se pudo leer. Recarga la página.', 'error');
      return;
    }
    if (!c || comentariosVistos.has(c.id)) return;
    comentariosVistos.add(c.id);
    // Los comentarios internos son el contexto que ya viste escribir; no se repiten.
    if (c.publicado === false) return;
    const deAsesor = /^ASESOR:/i.test(c.cuerpo || '');
    if (!deAsesor) return;
    burbuja('asesor', (c.cuerpo || '').replace(/^ASESOR:\s*/i, ''));
  });
  fuenteAsesor.addEventListener('error', () => {
    // Un hilo congelado sin aviso deja al cliente esperando sin saberlo.
    nota('Se interrumpió la conexión con el asesor. Reintentando.', 'error');
  });
  fuenteAsesor.addEventListener('restablecido', () => nota('Conexión restablecida.', 'ok'));
}

// ── apoyo visual que la propia app puede aportar ────────────────────────────

async function intentarCobertura(texto) {
  const posible = POSIBLE_VIN.exec(texto);
  if (!posible) return;
  try {
    const res = await fetch('/publico/garantia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: posible[0] }),
    });
    if (!res.ok) return;
    const d = await res.json();
    if (d.encontrada && d.cobertura) {
      panel.cobertura(d.cobertura);
      return;
    }
    // El número de serie no está registrado. Decirlo importa: preguntado por un VIN
    // que no existe, el asistente contesta con la póliza general —correcta, y marcada
    // como fuente no verificada— pero sin aclarar que esa unidad no aparece. Quien
    // tecleó un dígito de más se lleva un texto de garantía que no es el de su unidad.
    panel.sinUnidad(posible[0]);
  } catch {
    // El apoyo visual es complementario: si no se puede, la conversación sigue y el
    // asistente responde igual. No se interrumpe al cliente por esto.
  }
}

// ── arranque ────────────────────────────────────────────────────────────────

bloquear(true);
try {
  // Una sola ida: `/publico/agente/abrir` ABRE la conversación y, al hacerlo, prueba
  // que el asistente está disponible. Antes se preguntaba primero por el estado —lo
  // que gastaba una sesión de sonda— y la conversación real no se abría hasta el
  // primer mensaje, así que el cliente pagaba entonces la propagación y los
  // reintentos. Ahora eso ocurre mientras lee la pantalla.
  const sesion = await (await fetch('/publico/sesion')).json();
  const agente = sesion.tieneEscalamiento
    ? { disponible: false, causa: null, bienvenida: null }
    : await (await fetch('/publico/agente/abrir', { method: 'POST' })).json();

  if (sesion.tieneEscalamiento) {
    // El cliente ya venía hablando con una persona: se retoma donde quedó.
    marcarInterlocutor('asesor');
    const conv = await (await fetch('/publico/asesor/conversacion')).json();
    for (const c of conv.comentarios ?? []) {
      comentariosVistos.add(c.id);
      if (c.publicado === false) continue;
      const deAsesor = /^ASESOR:/i.test(c.cuerpo || '');
      burbuja(deAsesor ? 'asesor' : 'cliente', (c.cuerpo || '').replace(/^(ASESOR|CLIENTE):\s*/i, ''));
    }
    escucharAsesor();
    bloquear(false);
  } else if (agente.disponible) {
    marcarInterlocutor('agente');
    // La bienvenida real ya llegó con la apertura. Sólo si la org no mandó ninguna se
    // pinta el saludo de cortesía de la página, para no dejar la ventana en blanco.
    if (agente.bienvenida) {
      burbuja('agente', agente.bienvenida);
    } else {
      saludoLocal = burbuja(
        'agente',
        'Hola. Soy el asistente de postventa de Zapata. Cuéntame qué pasa con tu unidad: puedo revisar su garantía, buscarte horario en el taller, levantar un reporte si quedó detenida en carretera, o pasarte con un asesor.',
      );
    }
    bloquear(false);
  } else {
    // El asistente no está disponible. No se finge una conversación: se dice, y la
    // ventana sigue sirviendo porque una persona sí puede atender.
    punto.className = 'w-1.5 h-1.5 rounded-full bg-red-400 shrink-0';
    estado.innerHTML = chip('No disponible', 'error');
    nota(`El asistente no está disponible: ${agente.causa ?? 'no se pudo abrir la conversación'}`, 'error');
    burbuja(
      'agente',
      'En este momento no puedo atenderte yo, pero sí puedo pasarte con un asesor de postventa. Cuéntame qué necesitas y lo escalo.',
    );
    interlocutor.textContent = 'Asistente no disponible';
    pie.textContent = 'Escribe lo que necesitas y tu mensaje pasa directo a una persona.';
    bloquear(false);
  }
} catch (e) {
  raiz.innerHTML = bloqueError(e, 'No se pudo abrir la conversación');
}

document.getElementById('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const texto = entrada.value.trim();
  if (!texto) return;
  entrada.value = '';
  burbuja('cliente', texto);
  turnos.push({ autor: 'cliente', texto });
  bloquear(true);

  try {
    // Ya está con una persona: el mensaje va al asesor, no al asistente.
    if (conAsesor) {
      const res = await fetch('/publico/asesor/responder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuerpo: texto }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.mensaje || `El servidor respondió ${res.status}`);
      for (const c of d.comentarios ?? []) comentariosVistos.add(c.id);
      return;
    }

    // Aquí NO se vuelve a preguntar si el asistente está disponible. Ese sondeo abría y
    // cerraba una sesión real contra la org en cada mensaje, y ni siquiera decidía
    // nada: si el asistente falla, el propio turno emite `Error` y de ahí se pasa a una
    // persona, que es la misma salida pero sin gastar una sesión por turno.
    void intentarCobertura(texto);

    const res = await fetch('/publico/agente/mensaje', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto }),
    });
    if (!res.ok || !res.body) throw new Error(`El asistente respondió ${res.status}`);

    let parrafo = null;
    let acumulado = '';
    let escaladoEn = null;

    const lector = res.body.getReader();
    const dec = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const bloques = buffer.split('\n\n');
      buffer = bloques.pop() ?? '';

      for (const bloque of bloques) {
        const tipo = /^event: (.*)$/m.exec(bloque)?.[1];
        const crudo = /^data: (.*)$/m.exec(bloque)?.[1];
        if (!tipo || !crudo) continue;
        let d;
        try {
          d = JSON.parse(crudo);
        } catch {
          continue;
        }

        // El apoyo visual sale de lo que el agente realmente invocó.
        panel.desdeEvento(d);

        if (tipo === 'Actividad') {
          // Lo que el agente ejecutó de verdad, releído por el servidor desde
          // Log_Agente__c. Es la única fuente: la Agent API no devuelve las acciones.
          panel.actividad(d);
        } else if (tipo === 'Escalado') {
          // No se cambia de interlocutor a mitad del texto: se anota y se aplica al
          // cerrar el turno, para que el cliente lea completa la última respuesta del
          // asistente antes de que la ventana pase a una persona.
          escaladoEn = d;
        } else if (tipo === 'Bienvenida') {
          // El saludo de apertura se pinta, pero NO se acumula como respuesta del
          // turno: si se acumulara, acabaría copiado en la transcripción que viaja
          // al asesor como si el agente lo hubiera dicho contestando.
          if (d.texto) {
            if (saludoLocal) {
              // Ya hay un saludo en pantalla —el que puso la página para no dejarla
              // vacía—. Se sustituye por el del agente en vez de apilar otro.
              saludoLocal.textContent = d.texto;
              saludoLocal = null;
            } else {
              burbuja('agente', d.texto);
            }
          }
        } else if (tipo === 'TextChunk') {
          if (!parrafo) parrafo = burbuja('agente', '');
          acumulado += d.texto ?? '';
          parrafo.textContent = acumulado;
          hilo.scrollTop = hilo.scrollHeight;
        } else if (tipo === 'Inform' && !parrafo && d.texto) {
          acumulado = d.texto;
          burbuja('agente', d.texto);
        } else if (tipo === 'Error') {
          nota(`El asistente falló: ${d.mensaje ?? 'error del servicio'}`, 'error');
          await pasarConAsesor(texto);
          return;
        }
      }
    }

    if (acumulado) turnos.push({ autor: 'agente', texto: acumulado });

    // El agente decidió que esto le toca a una persona: la ventana cambia sola.
    if (escaladoEn) adoptarAsesor(escaladoEn.caseNumber);
  } catch (e) {
    nota(`Se interrumpió la conexión: ${e.message}`, 'error');
  } finally {
    bloquear(false);
    entrada.focus();
  }
});

// ── la red de talleres, dato real del catálogo ──────────────────────────────

document.getElementById('enc-red').innerHTML = encabezado(
  'Localidades',
  'La red que atiende tu unidad',
  'Nueve talleres con su horario y la anticipación con la que aparta citas cada uno.',
);

const red = document.getElementById('sucursales');
red.innerHTML = cargando('la red de talleres');
try {
  const d = await (await fetch('/publico/sucursales')).json();
  red.innerHTML = d.sucursales?.length
    ? d.sucursales
        .map(
          (s) => `
      <div class="bg-[#0b0c10] border border-white/5 p-6 hover:border-white/20 transition-all duration-300">
        <div class="flex items-start justify-between gap-3 mb-4">
          <h3 class="font-serif-luxury text-xl text-white tracking-wide">${escapar(s.ciudad || s.nombre)}</h3>
          <span class="text-[11px] font-mono tracking-wide text-amber-400 shrink-0">${escapar(s.clave || '')}</span>
        </div>
        <dl class="space-y-1.5">
          <div class="flex justify-between gap-4">
            <dt class="text-[10px] uppercase tracking-widest text-gray-600">Entre semana</dt>
            <dd class="text-[11px] text-gray-300 text-right">${escapar(s.horario || '—')}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-[10px] uppercase tracking-widest text-gray-600">Anticipación</dt>
            <dd class="text-[11px] font-mono tracking-wide text-gray-300">${s.anticipacionHoras ?? '—'} h</dd>
          </div>
          ${
            s.telefono
              ? `<div class="flex justify-between gap-4">
                   <dt class="text-[10px] uppercase tracking-widest text-gray-600">Teléfono</dt>
                   <dd class="text-[11px]"><a href="tel:${escapar(String(s.telefono).replace(/[^0-9+]/g, ''))}" class="font-mono tracking-wide text-amber-400 hover:text-amber-300 transition-colors">${escapar(s.telefono)}</a></dd>
                 </div>`
              : ''
          }
        </dl>
      </div>`,
        )
        .join('')
    : `<div class="sm:col-span-2 lg:col-span-3">${vacio('No hay talleres publicados en este momento.')}</div>`;
} catch (e) {
  red.innerHTML = `<div class="sm:col-span-2 lg:col-span-3">${bloqueError(e, 'No se pudo cargar la red de talleres')}</div>`;
}
