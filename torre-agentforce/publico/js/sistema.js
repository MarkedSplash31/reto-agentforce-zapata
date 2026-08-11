/* ══════════════════════════════════════════════════════════════════════════
   Torre Agentforce Zapata — shell y utilidades compartidas.

   La nav y el footer se inyectan desde aquí en vez de repetirse en cada página.
   Mismo criterio que torre-postventa: un shell único hace imposible la deriva
   que Zapata sufre por tener nav y footer copiados en sus 78 páginas.

   REGLA CERO: ninguna función de este archivo inventa datos. Los errores se
   pintan con la causa real del servidor; no hay respuesta de reserva ni
   "modo demo".
   ══════════════════════════════════════════════════════════════════════════ */

// Navegación del sitio de CLIENTES de Zapata. Cada entrada corresponde a algo que
// el cliente quiere resolver, no a un objeto de la base de datos.
// La aplicación es una sola conversación: no hay una página por trámite, porque el
// asistente enruta según lo que el cliente cuenta. La navegación sólo lleva al sitio
// y a la entrada interna de los asesores.
// El botón de la barra ya no marca un teléfono escrito aquí. El que había —(55)
// 2122-0370, tomado del sitio público de Zapata— no existe en la org, y la etiqueta
// «Asistencia 24/7» además prometía algo que los datos desmienten: las sucursales del
// catálogo declaran horario de lunes a viernes. Ahora lleva a la red de talleres,
// donde cada teléfono es el que Salesforce tiene registrado para esa sucursal.
const RUTAS = [
  { href: 'index.html', txt: 'Postventa' },
  { href: 'https://zapata.com.mx', txt: 'zapata.com.mx' },
];

const MARCA = `
<svg viewBox="0 0 290 56" class="h-7 w-auto" role="img" aria-label="Zapata">
  <g fill="#ffffff">
    <text x="0" y="40" font-family="Inter, sans-serif" font-size="38" font-weight="600" letter-spacing="3.04">ZAPATA</text>
    <path d="M203 40 L209 12 L220 12 L214 40 Z"/>
    <path d="M226 40 L232 12 L243 12 L237 40 Z"/>
    <path d="M249 40 L255 12 L266 12 L260 40 Z"/>
  </g>
</svg>`;

function montarNav(activa) {
  const links = RUTAS.map(
    (r) =>
      `<a href="${r.href}" class="hover:text-white transition-colors ${r.href === activa ? 'text-white' : ''}">${r.txt}</a>`,
  ).join('');
  const linksMovil = RUTAS.map(
    (r) =>
      `<a href="${r.href}" class="block py-4 text-xs uppercase tracking-widest text-gray-400 hover:text-white border-b border-white/5 transition-colors">${r.txt}</a>`,
  ).join('');

  document.getElementById('nav').innerHTML = `
  <nav class="fixed top-0 left-0 w-full z-50 bg-[#0b0c10]/80 backdrop-blur-md border-b border-white/5">
    <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
      <a href="index.html" class="flex items-center" aria-label="Inicio">${MARCA}</a>

      <div id="nav-links-escritorio" class="hidden lg:flex items-center space-x-6 text-xs tracking-widest text-gray-400 uppercase">
        ${links}
      </div>

      <div id="nav-acciones-escritorio" class="hidden lg:flex items-center gap-3">
        <a href="index.html#red" class="border border-white/20 bg-white/5 px-5 py-2.5 text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-all duration-300 rounded-none">
          Talleres y telefonos
        </a>
      </div>

      <button id="btn-burger" aria-label="Abrir menú" aria-expanded="false" aria-controls="menu-movil"
        class="lg:hidden flex flex-col justify-center items-center gap-[5.5px] w-10 h-10 text-gray-300 hover:text-white transition-colors">
        <span class="linea-burger linea-sup"></span>
        <span class="linea-burger linea-med"></span>
        <span class="linea-burger linea-inf"></span>
      </button>
    </div>

    <div id="menu-movil" role="dialog" aria-label="Menú de navegación"
         class="lg:hidden absolute top-full left-0 w-full bg-[#0b0c10]/95 backdrop-blur-lg border-b border-white/5 px-6 pb-8 pt-6">
      ${linksMovil}
      <a href="index.html#red" class="block mt-6 text-center border border-white/20 bg-white/5 px-5 py-3 text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-all duration-300">
        Talleres y telefonos
      </a>
    </div>
  </nav>`;

  const btn = document.getElementById('btn-burger');
  const menu = document.getElementById('menu-movil');
  const cerrar = () => {
    menu.classList.remove('abierto');
    btn.classList.remove('abierto');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Abrir menú');
  };
  btn.addEventListener('click', () => {
    const abierto = menu.classList.toggle('abierto');
    btn.classList.toggle('abierto', abierto);
    btn.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    btn.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
  });
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) cerrar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrar();
  });
}

function montarFooter() {
  const col = (titulo, items) => `
    <div class="space-y-3">
      <p class="text-gray-300 uppercase tracking-widest font-medium text-[10px]">${titulo}</p>
      <ul class="space-y-2 font-light text-gray-400 text-[11px]">
        ${items.map((i) => `<li><a href="${i[1]}" class="hover:text-white transition-colors">${i[0]}</a></li>`).join('')}
      </ul>
    </div>`;

  document.getElementById('footer').innerHTML = `
  <footer class="bg-[#07080a] py-16 border-t border-white/5 text-xs text-gray-500">
    <div class="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-10 mb-12 text-left">
      <div class="space-y-4 md:col-span-2">
        <p class="font-serif-luxury tracking-widest text-white text-sm">TORRE AGENTFORCE</p>
        <p class="text-[11px] leading-relaxed font-light text-gray-400">
          Atención de postventa para tu unidad.<br>
          Lo que resuelvas aquí queda asentado<br>
          en el sistema de Zapata.
        </p>
      </div>
      ${col('Postventa', [
        ['Hablar con el asistente', 'index.html'],
        ['Talleres y telefonos', 'index.html#red'],
      ])}
      ${col('Interno', [
        ['Acceso de asesores', 'acceso.html'],
      ])}
    </div>
    <div class="max-w-7xl mx-auto px-6 border-t border-white/5 pt-8 text-center text-gray-600 font-light">
      &copy; 2026 Zapata. Todos los derechos reservados.
    </div>
  </footer>`;
}

/* ══ componentes de estado ════════════════════════════════════════════════ */

/** Chip de estado. `tono`: ok | error | bloqueo | neutro */
export function chip(texto, tono = 'neutro') {
  const tonos = {
    ok: 'border-emerald-400/25 text-emerald-300 bg-emerald-500/10',
    error: 'border-red-500/30 text-red-200 bg-red-950/50',
    bloqueo: 'border-amber-400/30 text-amber-300 bg-amber-400/5',
    neutro: 'border-white/10 text-gray-400',
  };
  const puntos = {
    ok: 'bg-emerald-400',
    error: 'bg-red-400',
    bloqueo: 'bg-amber-400',
    neutro: 'bg-gray-500',
  };
  return `<span class="inline-flex items-center border ${tonos[tono] || tonos.neutro} px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em]">
    <span class="w-1.5 h-1.5 rounded-full ${puntos[tono] || puntos.neutro} mr-2"></span>${escapar(texto)}</span>`;
}

/** Bloque de error visible. Muestra la causa real, no un "algo salió mal". */
export function bloqueError(e, contexto) {
  const d = e?.detalle || {};
  const filas = [
    ['Operación', d.operacion],
    ['HTTP', d.status],
    ['Código Salesforce', d.codigoSalesforce],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '');

  return `
  <div class="border border-red-500/30 bg-red-950/50 p-6" role="alert">
    <p class="text-[10px] uppercase tracking-[0.3em] text-red-300/70 mb-2">Fallo real, sin maquillar</p>
    <h3 class="font-serif-luxury text-xl text-red-100 tracking-wide mb-3">${escapar(contexto)}</h3>
    <p class="text-red-200 text-xs leading-relaxed font-light mb-4">${escapar(e?.message || String(e))}</p>
    ${
      filas.length
        ? `<dl class="space-y-1.5 border-t border-red-500/20 pt-4">
            ${filas
              .map(
                ([k, v]) => `<div class="flex justify-between gap-4">
                  <dt class="text-[10px] uppercase tracking-widest text-red-300/60">${escapar(k)}</dt>
                  <dd class="text-[11px] font-mono tracking-wide text-red-200">${escapar(String(v))}</dd>
                </div>`,
              )
              .join('')}
          </dl>`
        : ''
    }
  </div>`;
}

/** Estado de carga. Sin latencia fingida: se muestra mientras la red trabaja. */
export function cargando(que) {
  return `<div class="border border-white/5 bg-[#0d0e12] p-6 text-center">
    <p class="text-[10px] uppercase tracking-[0.3em] text-gray-500">Consultando ${escapar(que)}</p>
  </div>`;
}

/** Vacío legítimo: la consulta funcionó y no hay filas. Distinto de un fallo. */
export function vacio(mensaje) {
  return `<div class="border border-white/5 bg-[#0d0e12] p-8 text-center">
    <p class="text-gray-400 text-xs font-light leading-relaxed">${escapar(mensaje)}</p>
  </div>`;
}

export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function fecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function numero(n) {
  return typeof n === 'number' ? n.toLocaleString('es-MX') : '—';
}

/** Encabezado de sección con el ritmo 96/64/8 del sistema. */
export function encabezado(eyebrow, titulo, descripcion, nivel = 2) {
  const etiqueta = nivel === 1 ? 'h1' : 'h2';
  return `<div class="mb-16">
    <span class="text-xs uppercase tracking-[0.3em] text-gray-500 block mb-2">${escapar(eyebrow)}</span>
    <${etiqueta} class="font-serif-luxury text-3xl text-white tracking-wide font-light">${escapar(titulo)}</${etiqueta}>
    ${descripcion ? `<p class="text-gray-400 text-xs font-light mt-2 leading-relaxed max-w-2xl">${escapar(descripcion)}</p>` : ''}
  </div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const activa = location.pathname.split('/').pop() || 'index.html';
  if (document.getElementById('nav')) montarNav(activa);
  if (document.getElementById('footer')) montarFooter();
});
