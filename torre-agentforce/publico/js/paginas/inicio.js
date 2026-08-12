/* ══════════════════════════════════════════════════════════════════════════
   Una sola pantalla en dos momentos.

   PORTADA. Una caja para escribir y nada más. Quien llega no tiene que entender
   un menú: dice qué le pasa a su unidad.

   ESPACIO DE TRABAJO. Al mandar el primer mensaje, la MISMA caja se muda al pie
   de la pantalla y el resto se abre alrededor: la conversación queda a un lado
   como el mecanismo con el que se dirige lo que ocurre, y lo que el asistente
   consulta o registra —cobertura, horarios, la orden, el reporte de carretera,
   el caso con un asesor— toma el escenario, que es donde hace falta espacio.

   No hay dos conversaciones ni dos formularios: es un solo nodo del DOM que
   cambia de sitio. El flujo funcional es exactamente el que ya existía.

   El escalamiento se decide entre el agente y la persona, no con un botón que el
   cliente aprieta a ciegas: cuando el agente invoca su acción de escalamiento, o
   cuando el cliente lo pide con todas sus letras, la MISMA ventana cambia de
   interlocutor y sigue el hilo con un asesor. El cliente no se muda de pantalla.
   ══════════════════════════════════════════════════════════════════════════ */

import { encabezado, bloqueError, cargando, vacio, escapar, chip } from '../sistema.js';
import { crearPanel } from '../panel-contextual.js';
import { montarAgenda } from '../componentes/agenda.js';

const app = document.getElementById('app');
const compositor = document.getElementById('compositor');
const muelle = document.getElementById('muelle');
const hilo = document.getElementById('hilo');
const entrada = document.getElementById('entrada');
const boton = document.getElementById('enviar');
const estado = document.getElementById('estado');
const punto = document.getElementById('punto');
const interlocutor = document.getElementById('interlocutor');
const pie = document.getElementById('pie');
const aviso = document.getElementById('aviso');

/** Un número de serie que el cliente escribe: 11 o más alfanuméricos seguidos. */
const POSIBLE_VIN = /\b[A-HJ-NPR-Z0-9]{11,17}\b/i;

const turnos = [];
let conAsesor = false;
let fuenteAsesor = null;
const comentariosVistos = new Set();
/** Lo que la org dijo si el asistente no está disponible. Se conserva para no
 *  volver a pintar «En línea» al terminar un turno que en realidad no tuvo agente. */
let asistenteDisponible = false;
let causaNoDisponible = null;
/**
 * Nodo del saludo que pinta la propia página para no dejar la ventana vacía mientras
 * Salesforce abre la sesión. Cuando llega la bienvenida real del agente se sustituye
 * su texto en vez de añadir otra burbuja: si no, el cliente leía dos saludos casi
 * idénticos y el segundo parecía que el agente no lo había escuchado.
 */
let saludoLocal = null;

// ── estados de la pantalla ──────────────────────────────────────────────────

/**
 * La portada se convierte en el espacio de trabajo: el compositor se muda al
 * muelle y el resto aparece a su alrededor. Se llama al mandar el primer mensaje,
 * antes de que la red conteste, para que el cambio de contexto se entienda ya.
 */
function entrarAlEspacio({ animar = true } = {}) {
  if (app.dataset.estado !== 'entrada') return;
  const mudar = () => {
    muelle.appendChild(compositor);
    app.dataset.estado = panel.tieneContenido() ? 'trabajo' : 'conversando';
    // La portada medía una pantalla entera: si quien escribía venía de mirar la red
    // de talleres, sin esto el espacio de trabajo aparecería ya desplazado.
    window.scrollTo(0, 0);
  };
  // View Transitions anima la mudanza del compositor sin que haya que calcular
  // nada. Donde no exista —o donde se pidió menos movimiento— el cambio ocurre
  // igual, sin animación: la transición ayuda a entenderlo, no es el contenido.
  // Al cargar la página con una conversación ya abierta no se anima nada: no hubo
  // portada que evolucionara, y animarla parecería un salto sin causa.
  if (animar && document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(mudar);
  } else {
    mudar();
  }
}

/** El asistente puso algo en la mesa: el escenario deja de estar vacío. */
function abrirEscenario() {
  if (app.dataset.estado === 'conversando') app.dataset.estado = 'trabajo';
}

const panel = crearPanel(document.getElementById('panel'), { alPintar: abrirEscenario });

// ── la conversación ─────────────────────────────────────────────────────────

/**
 * Un turno del hilo. Sin burbujas encaradas: la conversación es el contexto de lo
 * que se está haciendo, y una sucesión de globos la convertía en el protagonista
 * de la pantalla. Devuelve el párrafo para poder seguir escribiendo en él mientras
 * el texto llega por partes.
 */
function turno(quien, texto) {
  const etiqueta = quien === 'cliente' ? 'Tú' : quien === 'asesor' ? 'Asesor de postventa' : 'Asistente';
  const fila = document.createElement('article');
  fila.className = 'turno';
  fila.dataset.de = quien;
  fila.innerHTML = `
    <p class="text-[10px] uppercase tracking-[0.3em] ${quien === 'asesor' ? 'text-amber-400/80' : 'text-gray-500'} mb-2">${escapar(etiqueta)}</p>
    <p class="text-gray-100 text-xs leading-relaxed font-light whitespace-pre-wrap"></p>`;
  fila.querySelector('p:last-child').textContent = texto;
  hilo.appendChild(fila);
  hilo.scrollTop = hilo.scrollHeight;
  return fila.querySelector('p:last-child');
}

function nota(texto, tono = 'neutro') {
  const p = document.createElement('p');
  const color = tono === 'error' ? 'text-red-300' : tono === 'ok' ? 'text-emerald-300' : 'text-gray-500';
  p.className = `nota text-[11px] font-light ${color}`;
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
    pie.textContent =
      'Lo que resuelvas aquí queda asentado en el sistema de Zapata. Si prefieres una persona, pídelo y te paso con un asesor.';
  }
}

/** El asistente no está. No se finge una conversación: se dice, y la caja sigue
 *  sirviendo porque una persona sí puede atender. */
function marcarNoDisponible(causa) {
  asistenteDisponible = false;
  causaNoDisponible = causa ?? causaNoDisponible;
  interlocutor.textContent = 'Asistente no disponible';
  punto.className = 'w-1.5 h-1.5 rounded-full bg-red-400 shrink-0';
  estado.innerHTML = chip('No disponible', 'error');
  pie.textContent = 'Escribe lo que necesitas y tu mensaje pasa directo a una persona.';
}

/** Devuelve la cabecera al estado que de verdad corresponde al terminar un turno. */
function restaurarEstado() {
  if (conAsesor) marcarInterlocutor('asesor');
  else if (asistenteDisponible) marcarInterlocutor('agente');
  else marcarNoDisponible();
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
    turno('asesor', (c.cuerpo || '').replace(/^ASESOR:\s*/i, ''));
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
      // La unidad existe: la agenda deja de pedir el número de serie que el cliente
      // ya dictó en la conversación. Sólo se recuerda si la org lo reconoció.
      vinConocido = posible[0];
      agenda?.conVin(vinConocido);
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

// ── capacidades que se abren solas ──────────────────────────────────────────
//
// La agenda del taller no necesita al agente de intermediario: el mismo endpoint
// que él consulta lo puede mirar el cliente, y escoger una franja tocándola es
// mejor que dictar «la opción 5» de una lista en prosa. Mirar no exige número de
// serie; sólo confirmar, que es cuando el Flow lo pide.

/** El último número de serie que la conversación dejó ver. */
let vinConocido = null;
let agenda = null;

async function abrirAgenda() {
  entrarAlEspacio();
  const raiz = panel.componente('agenda', 'Taller', 'Elige tu cita');
  if (raiz.dataset.montado === 'si') {
    agenda?.conVin(vinConocido);
    return;
  }
  raiz.dataset.montado = 'si';
  agenda = await montarAgenda(raiz, {
    vin: vinConocido,
    alAgendar: (cita) => {
      // Queda en el hilo: la conversación es el registro de lo que se hizo,
      // aunque lo haya hecho el cliente con sus propias manos.
      nota(`Tu cita quedó registrada${cita?.folio ? ` con el folio ${cita.folio}` : ''}.`, 'ok');
      turnos.push({
        autor: 'cliente',
        texto: `Agendé una cita desde la agenda del taller${cita?.folio ? ` (folio ${cita.folio})` : ''}.`,
      });
    },
  });
}

// ── atajos de la portada ────────────────────────────────────────────────────
// Los que llevan `data-atajo` escriben una frase en la caja y el usuario decide si
// la manda: son cosas que el agente tiene que conducir —el protocolo de seguridad
// de una varada, el paso a una persona—. Los que llevan `data-abre` abren
// directamente la capacidad, porque la plataforma la resuelve sin intermediario.

for (const atajo of document.querySelectorAll('[data-atajo]')) {
  atajo.addEventListener('click', () => {
    entrada.value = atajo.dataset.atajo;
    entrada.focus();
    entrada.setSelectionRange(entrada.value.length, entrada.value.length);
  });
}

for (const boton of document.querySelectorAll('[data-abre]')) {
  boton.addEventListener('click', () => {
    if (boton.dataset.abre === 'agenda') void abrirAgenda();
  });
}

// ── arranque ────────────────────────────────────────────────────────────────

bloquear(true);
pie.textContent = 'Abriendo la conversación con el asistente.';
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
    // El cliente ya venía hablando con una persona: se retoma donde quedó, y con
    // conversación viva la pantalla arranca ya en el espacio de trabajo.
    marcarInterlocutor('asesor');
    const resConv = await fetch('/publico/asesor/conversacion');
    const conv = await resConv.json().catch(() => null);
    if (!resConv.ok || !conv) {
      // No se pinta un hilo vacío como si no hubiera pasado nada: el cliente
      // creería que su conversación se perdió. Se dice, y se le deja escribir.
      nota(`No pudimos recuperar los mensajes anteriores: ${conv?.mensaje ?? `el servidor respondió ${resConv.status}`}`, 'error');
    }
    for (const c of conv?.comentarios ?? []) {
      comentariosVistos.add(c.id);
      if (c.publicado === false) continue;
      const deAsesor = /^ASESOR:/i.test(c.cuerpo || '');
      turno(deAsesor ? 'asesor' : 'cliente', (c.cuerpo || '').replace(/^(ASESOR|CLIENTE):\s*/i, ''));
    }
    entrarAlEspacio({ animar: false });
    escucharAsesor();
    bloquear(false);
  } else if (agente.disponible) {
    asistenteDisponible = true;
    marcarInterlocutor('agente');
    // La bienvenida real ya llegó con la apertura. Sólo si la org no mandó ninguna se
    // pinta el saludo de cortesía de la página, para no dejar la ventana en blanco.
    if (agente.bienvenida) {
      turno('agente', agente.bienvenida);
    } else {
      saludoLocal = turno(
        'agente',
        'Hola. Soy el asistente de postventa de Zapata. Cuéntame qué pasa con tu unidad: puedo revisar su garantía, buscarte horario en el taller, levantar un reporte si quedó detenida en carretera, o pasarte con un asesor.',
      );
    }
    bloquear(false);
  } else {
    // El asistente no está disponible. No se finge una conversación: se dice en la
    // propia caja, antes de que el cliente escriba, y la pantalla sigue sirviendo
    // porque una persona sí puede atender.
    marcarNoDisponible(agente.causa ?? 'no se pudo abrir la conversación');
    aviso.innerHTML = `
      <div class="border border-amber-400/30 bg-amber-400/5 p-4" role="status">
        <p class="text-[10px] uppercase tracking-[0.3em] text-amber-400/80 mb-2">El asistente no está disponible</p>
        <p class="text-gray-300 text-xs font-light leading-relaxed">
          ${escapar(causaNoDisponible)}. Escribe lo que necesitas: tu mensaje pasa directo a un asesor de postventa.
        </p>
      </div>`;
    turno(
      'agente',
      'En este momento no puedo atenderte yo, pero sí puedo pasarte con un asesor de postventa. Cuéntame qué necesitas y lo escalo.',
    );
    bloquear(false);
  }
} catch (e) {
  aviso.innerHTML = bloqueError(e, 'No se pudo abrir la conversación');
  pie.textContent = '';
}

compositor.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const texto = entrada.value.trim();
  if (!texto) return;
  entrada.value = '';

  // El cambio de contexto ocurre YA, con lo que el cliente acaba de escribir, no
  // cuando la red conteste: la pantalla tiene que explicar de inmediato que la
  // portada se convirtió en el sitio donde se trabaja.
  entrarAlEspacio();
  turno('cliente', texto);
  turnos.push({ autor: 'cliente', texto });
  bloquear(true);
  if (!conAsesor) {
    estado.innerHTML = chip('Trabajando', 'bloqueo');
    pie.textContent = 'El asistente está trabajando en tu petición.';
  }

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
              turno('agente', d.texto);
            }
          }
        } else if (tipo === 'TextChunk') {
          if (!parrafo) parrafo = turno('agente', '');
          acumulado += d.texto ?? '';
          parrafo.textContent = acumulado;
          hilo.scrollTop = hilo.scrollHeight;
        } else if (tipo === 'Inform' && !parrafo && d.texto) {
          acumulado = d.texto;
          turno('agente', d.texto);
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
    restaurarEstado();
    entrada.focus();
  }
});

// ── la red de talleres, dato real del catálogo ──────────────────────────────

const red = document.getElementById('sucursales');
red.innerHTML = cargando('la red de talleres');
try {
  // Sin comprobar `res.ok` la página decía «No hay talleres publicados en este
  // momento» cuando en realidad la consulta había fallado: el cuerpo de error no
  // trae `sucursales`, así que el conteo salía 0 y la pantalla afirmaba que Zapata
  // no tiene red. Un catálogo vacío y una consulta caída tienen que verse distinto.
  const res = await fetch('/publico/sucursales');
  const d = await res.json();
  if (!res.ok) {
    const fallo = new Error(d?.mensaje || `El servidor respondió ${res.status}`);
    fallo.detalle = { operacion: 'catálogo de talleres', status: res.status };
    throw fallo;
  }

  // El encabezado se escribe DESPUÉS de conocer la respuesta. Antes decía «Nueve
  // talleres» escrito a mano: un número que la página afirmaba sin haberlo contado y
  // que dejaba de ser cierto en cuanto la org sumara o diera de baja una sucursal.
  const cuantos = d.sucursales?.length ?? 0;
  document.getElementById('enc-red').innerHTML = encabezado(
    'Localidades',
    'La red que atiende tu unidad',
    cuantos
      ? `${cuantos} ${cuantos === 1 ? 'taller' : 'talleres'} con su horario y la anticipación con la que aparta citas cada uno.`
      : 'Todavía no hay talleres publicados en el catálogo.',
  );

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
  // Si el catálogo no se pudo leer, el encabezado tampoco puede afirmar cuántos hay.
  document.getElementById('enc-red').innerHTML = encabezado(
    'Localidades',
    'La red que atiende tu unidad',
    'No se pudo leer el catálogo de talleres.',
  );
  red.innerHTML = `<div class="sm:col-span-2 lg:col-span-3">${bloqueError(e, 'No se pudo cargar la red de talleres')}</div>`;
}
