/* ══════════════════════════════════════════════════════════════════════════
   Torre de Postventa — shell y componentes compartidos.

   La nav y el footer se inyectan desde aquí en vez de repetirse en cada página:
   Zapata los tiene duplicados en las 78 páginas, que es lo que produce sus
   inconsistencias (el <h3> usado como etiqueta, el padding de contenedor
   distinto en /estrena). Un shell único hace imposible ese tipo de deriva.
   ══════════════════════════════════════════════════════════════════════════ */

const RUTAS = [
  { href: 'index.html',    txt: 'Torre' },
  { href: 'unidades.html', txt: 'Unidades' },
  { href: 'agenda.html',   txt: 'Agenda' },
  { href: 'cobertura.html',txt: 'Cobertura' },
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
  const links = RUTAS.map(r =>
    `<a href="${r.href}" class="hover:text-white transition-colors ${r.href === activa ? 'text-white' : ''}">${r.txt}</a>`
  ).join('');
  const linksMovil = RUTAS.map(r =>
    `<a href="${r.href}" class="block py-4 text-xs uppercase tracking-widest text-gray-400 hover:text-white border-b border-white/5 transition-colors">${r.txt}</a>`
  ).join('');

  document.getElementById('nav').innerHTML = `
  <nav class="fixed top-0 left-0 w-full z-50 bg-[#0b0c10]/80 backdrop-blur-md border-b border-white/5">
    <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
      <a href="index.html" class="flex items-center" aria-label="Inicio">${MARCA}</a>

      <div class="hidden md:flex items-center space-x-8 text-xs tracking-widest text-gray-400 uppercase">
        ${links}
      </div>

      <div class="hidden md:block">
        <a href="agenda.html" class="border border-white/20 bg-white/5 px-5 py-2.5 text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-all duration-300 rounded-none">
          Reportar Varada
        </a>
      </div>

      <button id="btn-burger" aria-label="Abrir menú" aria-expanded="false" aria-controls="menu-movil"
        class="md:hidden flex flex-col justify-center items-center gap-[5.5px] w-10 h-10 text-gray-300 hover:text-white transition-colors">
        <span class="linea-burger linea-sup"></span>
        <span class="linea-burger linea-med"></span>
        <span class="linea-burger linea-inf"></span>
      </button>
    </div>

    <div id="menu-movil" role="dialog" aria-label="Menú de navegación"
         class="md:hidden absolute top-full left-0 w-full bg-[#0b0c10]/95 backdrop-blur-lg border-b border-white/5 px-6 pb-8 pt-6">
      ${linksMovil}
      <a href="agenda.html" class="block mt-6 text-center border border-white/20 bg-white/5 px-5 py-3 text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-all duration-300">
        Reportar Varada
      </a>
    </div>
  </nav>`;

  const btn  = document.getElementById('btn-burger');
  const menu = document.getElementById('menu-movil');
  const cerrar = () => {
    menu.classList.remove('abierto'); btn.classList.remove('abierto');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Abrir menú');
  };
  btn.addEventListener('click', () => {
    const abierto = menu.classList.toggle('abierto');
    btn.classList.toggle('abierto', abierto);
    btn.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    btn.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
  });
  document.addEventListener('click', e => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) cerrar();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
}

function montarFooter() {
  const col = (titulo, items) => `
    <div class="space-y-3">
      <p class="text-gray-300 uppercase tracking-widest font-medium text-[10px]">${titulo}</p>
      <ul class="space-y-2 font-light text-gray-400 text-[11px]">
        ${items.map(i => `<li><a href="${i[1]}" class="hover:text-white transition-colors">${i[0]}</a></li>`).join('')}
      </ul>
    </div>`;

  document.getElementById('footer').innerHTML = `
  <footer class="bg-[#07080a] py-16 border-t border-white/5 text-xs text-gray-500">
    <div class="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-10 mb-12 text-left">
      <div class="space-y-4">
        <p class="font-serif-luxury tracking-widest text-white text-sm">TORRE DE POSTVENTA</p>
        <p class="text-[11px] leading-relaxed font-light text-gray-400">
          Boulevard Manuel Ávila Camacho 685<br>
          Piso 10, Centro Industrial Alce Blanco,<br>
          CP 53370 Naucalpan de Juárez.
        </p>
      </div>
      ${col('Operación', [['Torre de control','index.html'],['Unidades en ruta','unidades.html'],['Agenda de taller','agenda.html'],['Cobertura y garantía','cobertura.html']])}
      ${col('Red', [['Freightliner','#'],['Mercedes-Benz Autobuses','#'],['Great Dane','#'],['Directorio de sucursales','#']])}
      <div class="space-y-3">
        <p class="text-gray-300 uppercase tracking-widest font-medium text-[10px]">Asistencia 24/7</p>
        <p class="font-light text-gray-400">Carretera: <span class="text-white font-medium"><a href="tel:+525521220370" class="font-mono tracking-wide hover:text-amber-400 transition-colors">(55) 2122-0370</a></span></p>
        <div class="pt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-400">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
          Centro de mando activo
        </div>
      </div>
    </div>
    <div class="max-w-7xl mx-auto px-6 border-t border-white/5 pt-8 text-center text-gray-600 font-light">
      &copy; 2026  Zapata. Todos los derechos reservados.
    </div>
  </footer>`;
}

/* ── toast ── */
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'fixed right-6 bottom-6 px-4 py-3 bg-red-950/80 border border-red-500/30 text-red-200 text-xs tracking-wide opacity-0 translate-y-2 transition-all duration-300 z-50 pointer-events-none';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.remove('opacity-0', 'translate-y-2'));
  clearTimeout(t._tmr);
  t._tmr = setTimeout(() => t.classList.add('opacity-0', 'translate-y-2'), 3000);
}

/* ── modal ── */
function modal({ titulo, cuerpo, cta = 'Entendido' }) {
  const prev = document.getElementById('modal');
  if (prev) prev.remove();
  const m = document.createElement('div');
  m.id = 'modal';
  m.className = 'fixed inset-0 z-50 flex items-center justify-center p-4';
  m.innerHTML = `
    <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" data-cerrar></div>
    <div class="relative w-full max-w-sm bg-[#0d0e12] border border-white/10 shadow-lg p-6" role="dialog" aria-modal="true" aria-label="${titulo}">
      <h2 class="font-serif-luxury text-lg text-white tracking-wide mb-3">${titulo}</h2>
      <p class="text-gray-400 text-xs leading-relaxed font-light mb-6">${cuerpo}</p>
      <button class="w-full bg-white text-black py-3 text-xs uppercase tracking-widest font-semibold hover:bg-neutral-200 transition-colors duration-300" data-cerrar>${cta}</button>
    </div>`;
  document.body.appendChild(m);
  const cerrar = () => m.remove();
  m.addEventListener('click', e => { if (e.target.hasAttribute('data-cerrar')) cerrar(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', esc); }
  });
  m.querySelector('[data-cerrar]:last-of-type')?.focus();
}

/* ── arranque ── */
document.addEventListener('DOMContentLoaded', () => {
  const activa = location.pathname.split('/').pop() || 'index.html';
  if (document.getElementById('nav'))    montarNav(activa);
  if (document.getElementById('footer')) montarFooter();
});
