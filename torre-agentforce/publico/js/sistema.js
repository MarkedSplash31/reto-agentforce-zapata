/* ══════════════════════════════════════════════════════════════════════════
   Torre Agentforce Zapata — shell y utilidades compartidas.

   La nav y el footer se inyectan desde aquí en vez de repetirse en cada página.
   Mismo criterio que torre-postventa: un shell único hace imposible la deriva
   que Zapata sufre por tener nav y footer copiados en sus 78 páginas.

   REGLA CERO: ninguna función de este archivo inventa datos. `pedir()` muestra
   el error real del servidor; no hay respuesta de reserva ni "modo demo".
   ══════════════════════════════════════════════════════════════════════════ */

// Navegación del sitio de CLIENTES de Zapata. Cada entrada corresponde a algo que
// el cliente quiere resolver, no a un objeto de la base de datos: el agente y estos
// menús hacen lo mismo por dos caminos, y ambos terminan escribiendo en Salesforce.
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

const CLAVE_TOKEN_SESION = 'torre-agentforce.api-token';
let tokenEnMemoria = '';
let accesoRequerido = false;
let identidad = {
  provider: 'unknown',
  authenticated: false,
  principal: null,
  csrfToken: '',
  expiresAt: null,
  loginPath: null,
};
let cargaIdentidad = null;

async function cargarIdentidad(forzar = false) {
  if (cargaIdentidad && !forzar) return cargaIdentidad;
  cargaIdentidad = (async () => {
    let respuesta;
    try {
      respuesta = await fetch('/auth/session', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
    } catch (e) {
      throw new Error(`No se pudo consultar la sesión corporativa: ${e.message}`);
    }
    const datos = await respuesta.json().catch(() => null);
    if (!respuesta.ok || !datos || typeof datos.provider !== 'string') {
      throw new Error(datos?.mensaje || `No se pudo consultar la sesión corporativa (HTTP ${respuesta.status}).`);
    }
    identidad = {
      provider: datos.provider,
      authenticated: datos.authenticated === true,
      principal: datos.principal && typeof datos.principal === 'object' ? datos.principal : null,
      csrfToken: typeof datos.csrfToken === 'string' ? datos.csrfToken : '',
      expiresAt: typeof datos.expiresAt === 'number' ? datos.expiresAt : null,
      loginPath: typeof datos.loginPath === 'string' ? datos.loginPath : null,
    };
    if (identidad.provider === 'oidc') {
      // Una instalación que migra desde QA no conserva ni usa el antiguo Bearer.
      tokenEnMemoria = '';
      try { sessionStorage.removeItem(CLAVE_TOKEN_SESION); } catch { /* storage puede estar bloqueado */ }
    }
    return identidad;
  })();
  try {
    return await cargaIdentidad;
  } finally {
    if (forzar) cargaIdentidad = null;
  }
}

function rutaLoginActual() {
  const destino = `${location.pathname}${location.search}`;
  const base = identidad.loginPath || '/auth/salesforce/login';
  return `${base}?returnTo=${encodeURIComponent(destino)}`;
}

export function sesionAutenticada() {
  return identidad.authenticated;
}

/**
 * La credencial nunca se persiste más allá de la pestaña. `sessionStorage` puede
 * estar bloqueado por el navegador, por eso existe el respaldo sólo en memoria.
 */
export function tokenActual() {
  if (identidad.provider === 'oidc') return '';
  if (tokenEnMemoria) return tokenEnMemoria;
  try {
    return sessionStorage.getItem(CLAVE_TOKEN_SESION) || '';
  } catch {
    return '';
  }
}

function guardarToken(valor) {
  if (identidad.provider === 'oidc') return;
  tokenEnMemoria = valor.trim().replace(/^Bearer\s+/i, '');
  try {
    if (tokenEnMemoria) sessionStorage.setItem(CLAVE_TOKEN_SESION, tokenEnMemoria);
    else sessionStorage.removeItem(CLAVE_TOKEN_SESION);
  } catch {
    // El token sigue disponible sólo en memoria durante esta carga.
  }
}

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
  const etiquetaAcceso = identidad.provider === 'oidc'
    ? identidad.authenticated
      ? `Salir · ${identidad.principal?.role || 'sesión'}`
      : 'Iniciar sesión'
    : identidad.provider === 'disabled'
      ? 'Sesión local'
      : 'Acceso API';

  document.getElementById('nav').innerHTML = `
  <nav class="fixed top-0 left-0 w-full z-50 bg-[#0b0c10]/80 backdrop-blur-md border-b border-white/5">
    <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
      <a href="index.html" class="flex items-center" aria-label="Inicio">${MARCA}</a>

      <div id="nav-links-escritorio" class="hidden lg:flex items-center space-x-6 text-xs tracking-widest text-gray-400 uppercase">
        ${links}
      </div>

      <div id="nav-acciones-escritorio" class="hidden lg:flex items-center gap-3">
        <button type="button" data-abrir-acceso class="border border-white/10 px-4 py-2.5 text-[10px] uppercase tracking-widest text-gray-300 hover:border-white/30 hover:text-white transition-colors">
          ${escapar(etiquetaAcceso)}
        </button>
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
      <button type="button" data-abrir-acceso class="block w-full mt-6 text-center border border-white/10 px-5 py-3 text-xs uppercase tracking-widest text-gray-300 hover:border-white/30 hover:text-white transition-colors">
        ${escapar(etiquetaAcceso)}
      </button>
      <a href="index.html#red" class="block mt-6 text-center border border-white/20 bg-white/5 px-5 py-3 text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-all duration-300">
        Talleres y telefonos
      </a>
    </div>

    <dialog id="dialogo-acceso" aria-labelledby="titulo-acceso" class="w-[min(92vw,34rem)] border border-white/10 bg-[#0d0e12] p-0 text-gray-100 backdrop:bg-black/80">
      <form id="form-acceso" method="dialog" class="p-6 sm:p-8">
        <p class="text-[10px] uppercase tracking-[0.3em] text-gray-500 mb-2">Sesión de esta pestaña</p>
        <h2 id="titulo-acceso" class="font-serif-luxury text-2xl text-white tracking-wide mb-3">Acceso a la API</h2>
        <p class="text-gray-400 text-xs font-light leading-relaxed mb-6">
          Pega un token de acceso. Se enviará como Bearer y sólo se conservará en esta pestaña; no se escribe en archivos ni en almacenamiento permanente.
        </p>
        <label class="block mb-2" for="token-api">
          <span class="text-[10px] uppercase tracking-widest text-gray-500 block mb-1.5">Token</span>
        </label>
        <input id="token-api" type="password" autocomplete="off" spellcheck="false" required
          class="w-full min-w-0 bg-[#0b0c10] border border-white/10 text-white px-3 py-3 text-xs font-mono focus:outline-none focus:border-white/40 placeholder:text-gray-700"
          placeholder="Token de la sesión">
        <p id="estado-token" class="text-[11px] text-gray-500 mt-3" role="status"></p>
        <div class="flex flex-col-reverse sm:flex-row sm:justify-between gap-3 mt-6">
          <button id="borrar-token" type="button" class="border border-red-500/30 px-5 py-3 text-xs uppercase tracking-widest text-red-200 hover:bg-red-950/50 transition-colors">Borrar token</button>
          <div class="flex flex-col sm:flex-row gap-3">
            <button value="cancel" formnovalidate class="border border-white/10 px-5 py-3 text-xs uppercase tracking-widest text-gray-300 hover:border-white/30 transition-colors">Cancelar</button>
            <button id="guardar-token" value="default" class="bg-white text-black px-5 py-3 text-xs uppercase tracking-widest font-medium hover:bg-neutral-200 transition-colors">Usar en esta pestaña</button>
          </div>
        </div>
      </form>
    </dialog>
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

  const dialogo = document.getElementById('dialogo-acceso');
  const campoToken = document.getElementById('token-api');
  const estadoToken = document.getElementById('estado-token');
  const actualizarEstadoToken = (mensaje) => {
    estadoToken.textContent = mensaje || (tokenActual() ? 'Hay un token configurado para esta pestaña.' : 'No hay un token configurado.');
  };
  document.querySelectorAll('[data-abrir-acceso]').forEach((abrir) => {
    abrir.addEventListener('click', async () => {
      cerrar();
      if (identidad.provider === 'oidc') {
        if (!identidad.authenticated) {
          location.assign(rutaLoginActual());
          return;
        }
        abrir.disabled = true;
        try {
          const respuesta = await fetch('/auth/logout', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-CSRF-Token': identidad.csrfToken },
          });
          const datos = await respuesta.json().catch(() => null);
          if (!respuesta.ok) throw new Error(datos?.mensaje || `Logout respondió HTTP ${respuesta.status}.`);
          identidad = { ...identidad, authenticated: false, principal: null, csrfToken: '', expiresAt: null };
          location.reload();
        } catch (e) {
          abrir.disabled = false;
          window.alert(`No se pudo cerrar la sesión corporativa: ${e.message}`);
        }
        return;
      }
      if (identidad.provider === 'disabled') return;
      campoToken.value = '';
      actualizarEstadoToken();
      dialogo.showModal();
      campoToken.focus();
    });
  });
  document.getElementById('form-acceso').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const valor = campoToken.value.trim();
    if (!valor) {
      campoToken.setCustomValidity('Escribe un token de acceso.');
      campoToken.reportValidity();
      return;
    }
    campoToken.setCustomValidity('');
    guardarToken(valor);
    campoToken.value = '';
    actualizarEstadoToken('Token guardado sólo para esta pestaña. Recarga o reintenta la consulta.');
    setTimeout(() => dialogo.close(), 500);
  });
  campoToken.addEventListener('input', () => campoToken.setCustomValidity(''));
  document.getElementById('borrar-token').addEventListener('click', () => {
    guardarToken('');
    campoToken.value = '';
    actualizarEstadoToken('Token eliminado de esta pestaña.');
  });

  document.addEventListener('torre:auth-required', () => {
    if (identidad.provider === 'oidc') {
      location.assign(rutaLoginActual());
      return;
    }
    if (!dialogo.open) {
      campoToken.value = '';
      actualizarEstadoToken('La API rechazó o no recibió la credencial. Configura un token válido.');
      dialogo.showModal();
    }
  });
  if (accesoRequerido) document.dispatchEvent(new CustomEvent('torre:auth-required'));
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
      <div class="space-y-4">
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
      <div class="space-y-3">
        <p class="text-gray-300 uppercase tracking-widest font-medium text-[10px]">Estado del sistema</p>
        <div id="pie-salud" aria-live="polite" class="pt-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-400">
          <span class="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
          Consultando liveness
        </div>
        <p id="pie-readiness" aria-live="polite" class="font-light text-gray-400 text-[11px] pt-2 leading-relaxed">
          Readiness de dependencias no consultada.
        </p>
      </div>
    </div>
    <div class="max-w-7xl mx-auto px-6 border-t border-white/5 pt-8 text-center text-gray-600 font-light">
      &copy; 2026 Zapata. Todos los derechos reservados.
    </div>
  </footer>`;
}

/* ══ acceso al servidor ═══════════════════════════════════════════════════
   Nunca devuelve datos de reserva. Si el servidor falla, lanza con el mensaje
   real para que quien llame lo pinte. Un panel vacío y un 403 deben verse
   distinto: ésa es la diferencia entre una demo honesta y una que engaña.   */
export async function pedir(ruta, opciones = {}) {
  const { authInteractiva = true, ...opcionesFetch } = opciones;
  const esApi = String(ruta).startsWith('/api/');
  if (esApi) await cargarIdentidad();
  const headers = new Headers(opcionesFetch.headers || {});
  if (!headers.has('Content-Type') && opcionesFetch.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const token = tokenActual();
  if (identidad.provider === 'oidc') headers.delete('Authorization');
  if (esApi && identidad.provider === 'static' && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const method = String(opcionesFetch.method || 'GET').toUpperCase();
  if (esApi && identidad.provider === 'oidc' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!identidad.csrfToken) throw new Error('La sesión corporativa no entregó un token CSRF; inicia sesión de nuevo.');
    headers.set('X-CSRF-Token', identidad.csrfToken);
  }
  let res;
  try {
    res = await fetch(ruta, {
      ...opcionesFetch,
      headers,
      credentials: 'same-origin',
    });
  } catch (e) {
    throw new Error(`No se pudo contactar el servidor de la Torre: ${e.message}`);
  }

  const texto = await res.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    throw new Error(`El servidor respondió algo que no es JSON (HTTP ${res.status}): ${texto.slice(0, 200)}`);
  }

  if (!res.ok) {
    const requiereCredencial = res.status === 401;
    const accesoDenegado = res.status === 403;
    const base = datos?.mensaje || `El servidor respondió ${res.status}`;
    const e = new Error(
      requiereCredencial
        ? identidad.provider === 'oidc'
          ? `${base} Inicia sesión con Salesforce.`
          : `${base} Configura un token válido en «Acceso API».`
        : accesoDenegado
          ? `${base} La credencial es válida, pero su rol no autoriza esta operación.`
          : base,
    );
    e.detalle = { ...(datos || {}), status: res.status };
    e.status = res.status;
    if (requiereCredencial && authInteractiva) {
      accesoRequerido = true;
      document.dispatchEvent(new CustomEvent('torre:auth-required'));
    }
    throw e;
  }
  return datos;
}

/** Abre una respuesta SSE autenticada y conserva sus errores HTTP como estados visibles. */
export async function pedirFlujo(ruta, opciones = {}) {
  const esApi = String(ruta).startsWith('/api/');
  if (esApi) await cargarIdentidad();
  const headers = new Headers(opciones.headers || {});
  headers.set('Content-Type', 'application/json');
  const token = tokenActual();
  if (identidad.provider === 'oidc') headers.delete('Authorization');
  if (esApi && identidad.provider === 'static' && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const method = String(opciones.method || 'GET').toUpperCase();
  if (esApi && identidad.provider === 'oidc' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!identidad.csrfToken) throw new Error('La sesión corporativa no entregó un token CSRF; inicia sesión de nuevo.');
    headers.set('X-CSRF-Token', identidad.csrfToken);
  }

  let res;
  try {
    res = await fetch(ruta, { ...opciones, headers, credentials: 'same-origin' });
  } catch (e) {
    throw new Error(`No se pudo contactar el servidor de la Torre: ${e.message}`);
  }

  if (!res.ok) {
    const texto = await res.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { /* se conserva el texto */ }
    const requiereCredencial = res.status === 401;
    const accesoDenegado = res.status === 403;
    const base = datos?.mensaje || texto.slice(0, 200) || `El servidor respondió ${res.status}`;
    const e = new Error(
      requiereCredencial
        ? identidad.provider === 'oidc'
          ? `${base} Inicia sesión con Salesforce.`
          : `${base} Configura un token válido en «Acceso API».`
        : accesoDenegado
          ? `${base} La credencial es válida, pero su rol no autoriza esta operación.`
          : base,
    );
    e.detalle = { ...(datos || {}), status: res.status };
    e.status = res.status;
    if (requiereCredencial) {
      accesoRequerido = true;
      document.dispatchEvent(new CustomEvent('torre:auth-required'));
    }
    throw e;
  }
  if (!res.body) throw new Error('El servidor abrió el flujo sin un cuerpo legible.');
  const tipo = res.headers.get('content-type') || '';
  if (!tipo.includes('text/event-stream')) {
    throw new Error(`El servidor respondió «${tipo || 'sin Content-Type'}» en vez de text/event-stream.`);
  }
  return res;
}

/** Parser SSE incremental: admite eventos y data multilínea, incluido el bloque final. */
export async function* eventosSSE(res) {
  const lector = res.body.getReader();
  const decodificador = new TextDecoder();
  let buffer = '';
  const interpretar = (bloque) => {
    let tipo = '';
    const datos = [];
    for (const linea of bloque.split('\n')) {
      if (!linea || linea.startsWith(':')) continue;
      const separador = linea.indexOf(':');
      const campo = separador < 0 ? linea : linea.slice(0, separador);
      const valor = separador < 0 ? '' : linea.slice(separador + 1).replace(/^ /, '');
      if (campo === 'event') tipo = valor;
      if (campo === 'data') datos.push(valor);
    }
    if (!tipo && !datos.length) return null;
    const crudo = datos.join('\n');
    let datosParseados = crudo;
    try { datosParseados = crudo ? JSON.parse(crudo) : null; } catch { /* payload textual */ }
    return { tipo: tipo || 'message', datos: datosParseados };
  };

  while (true) {
    const { done, value } = await lector.read();
    buffer += decodificador.decode(value || new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, '\n');
    const bloques = buffer.split('\n\n');
    buffer = bloques.pop() || '';
    for (const bloque of bloques) {
      const evento = interpretar(bloque);
      if (evento) yield evento;
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const evento = interpretar(buffer);
    if (evento) yield evento;
  }
}

/* ══ superficie contextual de Agentforce ══════════════════════════════════
   Las páginas de dominio usan este componente para conversar con el mismo
   Agente Postventa. Las vistas CRM permanecen debajo como fallback explícito;
   este bloque nunca inventa una respuesta ni interpreta `crudo`.             */

function valorVisible(resultado, nombres) {
  if (!resultado || typeof resultado !== 'object') return null;
  const candidatos = [
    resultado,
    resultado.output,
    resultado.outputs,
    resultado.outputValues,
    resultado.result,
  ].filter((valor) => valor && typeof valor === 'object' && !Array.isArray(valor));
  for (const candidato of candidatos) {
    for (const nombre of nombres) {
      const valor = candidato[nombre];
      if (typeof valor === 'string' && valor.trim()) return valor.trim();
      if (Array.isArray(valor)) {
        const textos = valor.filter((item) => typeof item === 'string' && item.trim()).slice(0, 4);
        if (textos.length) return textos.join(' · ');
      }
    }
  }
  return null;
}

function nombreResultado(resultado) {
  return valorVisible(resultado, ['name', 'actionName', 'functionName', 'action', 'type']);
}

/**
 * Monta una conversación real de Agentforce dentro de una página de dominio.
 * Los iniciadores sólo precargan texto: el usuario decide si lo envía.
 */
export async function montarAgenteContextual({
  contenedor,
  contexto,
  titulo,
  descripcion,
  iniciadores = [],
}) {
  const raiz = typeof contenedor === 'string' ? document.getElementById(contenedor) : contenedor;
  if (!raiz) throw new Error(`No existe el contenedor contextual ${contenedor}.`);

  const id = crypto.randomUUID().replace(/-/g, '');
  raiz.innerHTML = `
    <div class="border border-white/5 bg-[#0d0e12] p-5 sm:p-6" data-agent-context="${escapar(contexto)}">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div class="min-w-0">
          <p class="text-[10px] uppercase tracking-[0.3em] text-amber-400/90 mb-2">Agentforce · ${escapar(contexto)}</p>
          <h2 class="font-serif-luxury text-xl text-white tracking-wide mb-2">${escapar(titulo)}</h2>
          <p class="text-gray-400 text-xs font-light leading-relaxed">${escapar(descripcion)}</p>
        </div>
        <div data-agent-estado class="shrink-0">${chip('Comprobando Agent API', 'neutro')}</div>
      </div>

      <div data-agent-aviso class="mb-5" aria-live="polite"></div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 border border-white/5 bg-[#0b0c10] flex flex-col min-w-0">
          <div data-agent-hilo role="log" aria-live="polite" aria-relevant="additions"
            class="min-h-40 max-h-80 overflow-y-auto p-4 space-y-3">
            <p class="text-gray-500 text-[11px] font-light leading-relaxed">
              Escribe tu caso con datos confirmados. La respuesta aparecerá sólo si la Agent API la devuelve.
            </p>
          </div>
          <div class="border-t border-white/5 p-4">
            ${iniciadores.length ? `
              <div class="flex flex-wrap gap-2 mb-3" aria-label="Iniciadores de conversación">
                ${iniciadores.map((iniciador) => `
                  <button type="button" data-agent-iniciador="${escapar(iniciador.texto)}"
                    class="border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[10px] uppercase tracking-widest text-amber-300 hover:bg-amber-400 hover:text-black transition-colors duration-300">
                    ${escapar(iniciador.etiqueta)}
                  </button>`).join('')}
              </div>` : ''}
            <form data-agent-form class="flex flex-col sm:flex-row gap-3">
              <label class="sr-only" for="agent-entrada-${id}">Mensaje para el Agente Postventa</label>
              <input id="agent-entrada-${id}" data-agent-entrada autocomplete="off" disabled
                placeholder="Describe el resultado que necesitas"
                class="flex-1 min-w-0 bg-[#0d0e12] border border-white/10 text-white px-3 py-2.5 text-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 focus:border-white/40 transition-colors rounded-none placeholder:text-gray-700">
              <button data-agent-enviar type="submit" disabled
                class="bg-white text-black px-6 py-2.5 text-xs uppercase tracking-widest font-medium hover:bg-neutral-200 transition-colors duration-300 disabled:opacity-10 disabled:pointer-events-none">
                Consultar al agente
              </button>
              <button data-agent-cerrar type="button" disabled
                class="border border-white/10 px-4 py-2.5 text-[10px] uppercase tracking-widest text-gray-300 hover:border-white/30 transition-colors duration-300 disabled:opacity-30 disabled:cursor-not-allowed">
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>

        <aside class="space-y-3">
          <div class="border border-white/5 bg-[#0b0c10] p-4">
            <p class="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Aclaración</p>
            <p class="text-gray-400 text-[11px] font-light leading-relaxed">
              Si faltan intención o datos, el agente debe pedir precisión antes de actuar. No completa VIN, taller, política ni ubicación.
            </p>
          </div>
          <div class="border border-white/5 bg-[#0b0c10] p-4">
            <p class="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Fuera de alcance</p>
            <p class="text-gray-400 text-[11px] font-light leading-relaxed">
              El agente limita su respuesta a postventa de camiones y puede ofrecer un Case con asesor; no improvisa otros servicios.
            </p>
          </div>
          <div data-agent-actividad class="border border-white/5 bg-[#0b0c10] p-4">
            <p class="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Actividad confirmada</p>
            <p class="text-gray-500 text-[11px] font-light leading-relaxed">Sin acciones reportadas en este turno.</p>
          </div>
        </aside>
      </div>
    </div>`;

  const estado = raiz.querySelector('[data-agent-estado]');
  const aviso = raiz.querySelector('[data-agent-aviso]');
  const hilo = raiz.querySelector('[data-agent-hilo]');
  const actividad = raiz.querySelector('[data-agent-actividad]');
  const form = raiz.querySelector('[data-agent-form]');
  const entrada = raiz.querySelector('[data-agent-entrada]');
  const enviar = raiz.querySelector('[data-agent-enviar]');
  const cerrar = raiz.querySelector('[data-agent-cerrar]');
  let sessionId = null;
  let enviando = false;
  let actividadLimpia = false;
  const actividadVista = new Set();

  const bloquear = (valor) => {
    enviando = valor;
    entrada.disabled = valor;
    enviar.disabled = valor;
    cerrar.disabled = valor || !sessionId;
  };

  const mensaje = (autor, texto) => {
    const fila = document.createElement('div');
    const usuario = autor === 'tú';
    fila.className = usuario ? 'flex justify-end' : 'flex justify-start';
    fila.innerHTML = `
      <div class="max-w-[80%] border ${usuario ? 'border-white/20 bg-white/5' : 'border-white/5 bg-[#0d0e12]'} p-3">
        <p class="text-[10px] uppercase tracking-widest text-gray-500 mb-1.5">${escapar(autor)}</p>
        <p data-agent-texto class="text-gray-100 text-xs leading-relaxed font-light whitespace-pre-wrap"></p>
      </div>`;
    fila.querySelector('[data-agent-texto]').textContent = texto;
    hilo.appendChild(fila);
    hilo.scrollTop = hilo.scrollHeight;
    return fila.querySelector('[data-agent-texto]');
  };

  const anotar = (etiqueta, detalle, tono = 'neutro') => {
    const clave = `${etiqueta}\u0000${detalle}`;
    if (actividadVista.has(clave)) return;
    actividadVista.add(clave);
    if (!actividadLimpia) {
      actividad.innerHTML = '<p class="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Actividad confirmada</p>';
      actividadLimpia = true;
    }
    actividad.insertAdjacentHTML(
      'beforeend',
      `<div class="border-t border-white/5 pt-3 mt-3">
        <div class="mb-2">${chip(etiqueta, tono)}</div>
        <p data-breakable class="text-gray-400 text-[11px] font-mono tracking-wide leading-relaxed">${escapar(detalle)}</p>
      </div>`,
    );
  };

  const registrar = (dato) => {
    if (!dato || typeof dato !== 'object') return;
    if (dato.traceId) anotar('Traza Agent API', dato.traceId);
    if (dato.planId) anotar('Plan', dato.planId);
    for (const referencia of dato.citedReferences || []) {
      const valor = referencia?.valor || referencia?.tipo;
      if (valor) anotar('Fuente citada', valor, 'ok');
    }
    for (const resultado of dato.resultados || []) {
      const nombre = nombreResultado(resultado);
      if (!nombre) continue;
      const comprobante = valorVisible(resultado, [
        'caseNumber', 'numeroCaso', 'varCasoCreado', 'varFolio', 'folio',
        'mensaje', 'varMensaje', 'titulos', 'opciones',
      ]);
      anotar('Acción Agentforce', comprobante ? `${nombre} · ${comprobante}` : nombre, 'bloqueo');
    }
  };

  raiz.querySelectorAll('[data-agent-iniciador]').forEach((boton) => {
    boton.addEventListener('click', () => {
      entrada.value = boton.dataset.agentIniciador || '';
      entrada.focus();
    });
  });

  try {
    const disponibilidad = await pedir('/api/agente/estado');
    if (disponibilidad?.disponible === true) {
      estado.innerHTML = chip('Agent API disponible', 'ok');
      aviso.innerHTML = '<p class="text-[11px] text-emerald-300 font-light">La siguiente consulta abrirá una sesión real con el Agente Postventa.</p>';
      bloquear(false);
    } else {
      estado.innerHTML = chip('Agent API bloqueada', 'error');
      aviso.innerHTML = `
        <div class="border border-red-500/30 bg-red-950/50 p-4" role="alert">
          <p class="text-red-200 text-xs font-light leading-relaxed">${escapar(disponibilidad?.causa || 'Salesforce no confirmó disponibilidad.')}</p>
          ${disponibilidad?.pasoQueFalta ? `<p class="text-red-200/70 text-[11px] font-light leading-relaxed border-t border-red-500/20 pt-3 mt-3">${escapar(disponibilidad.pasoQueFalta)}</p>` : ''}
        </div>`;
      bloquear(true);
    }
  } catch (error) {
    estado.innerHTML = chip('Agent API no comprobada', 'error');
    aviso.innerHTML = bloqueError(error, 'No se pudo comprobar la Agent API');
    bloquear(true);
  }

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const texto = entrada.value.trim();
    if (!texto || enviando) return;
    entrada.value = '';
    mensaje('tú', texto);
    bloquear(true);
    try {
      if (!sessionId) {
        const sesion = await pedir('/api/agente/sesion', { method: 'POST', body: JSON.stringify({}) });
        sessionId = sesion.sessionId;
        anotar('Sesión abierta', sesion.sessionId, 'ok');
        for (const inicial of sesion.mensajesIniciales || []) {
          if (inicial.texto) mensaje('agente', inicial.texto);
          registrar(inicial);
        }
      }

      const respuesta = await pedirFlujo('/api/agente/mensaje', {
        method: 'POST',
        body: JSON.stringify({ sessionId, texto }),
      });
      let parrafo = null;
      let acumulado = '';
      for await (const eventoAgente of eventosSSE(respuesta)) {
        const tipo = eventoAgente.tipo;
        const dato = eventoAgente.datos && typeof eventoAgente.datos === 'object'
          ? eventoAgente.datos
          : { texto: String(eventoAgente.datos || '') };
        registrar(dato);
        if (tipo === 'TextChunk' && dato.texto) {
          if (!parrafo) parrafo = mensaje('agente', '');
          acumulado += dato.texto;
          parrafo.textContent = acumulado;
          hilo.scrollTop = hilo.scrollHeight;
        } else if (tipo === 'Inform' && dato.texto) {
          mensaje('agente', dato.texto);
        } else if (tipo === 'ProgressIndicator') {
          anotar('Procesando', dato.texto || 'La Agent API no incluyó más detalle.');
        } else if (tipo === 'Error') {
          const causa = dato.mensaje || dato.texto || 'La Agent API devolvió un error sin mensaje.';
          anotar('Error', causa, 'error');
          mensaje('sistema', `La consulta no terminó: ${causa}`);
        } else if (tipo === 'SessionEnded') {
          sessionId = null;
          anotar('Sesión finalizada', dato.texto || 'Salesforce notificó el cierre.');
        }
      }
    } catch (error) {
      hilo.insertAdjacentHTML('beforeend', bloqueError(error, 'La conversación contextual falló'));
    } finally {
      bloquear(false);
      entrada.focus();
    }
  });

  cerrar.addEventListener('click', async () => {
    if (!sessionId || enviando) return;
    bloquear(true);
    try {
      const cerrada = await pedir('/api/agente/cerrar', {
        method: 'POST',
        body: JSON.stringify({ sessionId, motivo: 'UserRequest' }),
      });
      sessionId = null;
      anotar('Sesión cerrada', `${cerrada.sessionId} · ${cerrada.motivo}`, 'ok');
      mensaje('sistema', 'Salesforce confirmó el cierre de la sesión.');
    } catch (error) {
      aviso.innerHTML = bloqueError(error, 'No se pudo cerrar la sesión de Agentforce');
    } finally {
      bloquear(false);
    }
  });
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

/** Bloqueo de política: un guardrail funcionando. NO es un error. */
export function bloqueBloqueo(b) {
  return `
  <div class="border border-amber-400/30 bg-amber-400/5 p-6" role="status">
    <p class="text-[10px] uppercase tracking-[0.3em] text-amber-400/80 mb-2">Guardrail aplicado</p>
    <h3 class="font-serif-luxury text-xl text-white tracking-wide mb-3">La acción no procedió por política</h3>
    <p class="text-gray-300 text-xs leading-relaxed font-light mb-4">${escapar(b.mensaje || b.motivo)}</p>
    <dl class="space-y-1.5 border-t border-amber-400/20 pt-4">
      <div class="flex justify-between gap-4">
        <dt class="text-[10px] uppercase tracking-widest text-gray-500">Motivo</dt>
        <dd class="text-[11px] font-mono tracking-wide text-amber-300">${escapar(b.motivo)}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-[10px] uppercase tracking-widest text-gray-500">Folio</dt>
        <dd class="text-[11px] font-mono tracking-wide text-gray-300">${escapar(b.correlationId || '—')}</dd>
      </div>
    </dl>
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

/** Identificador que se lee carácter por carácter: siempre monoespaciado. */
export function mono(s) {
  return `<span class="font-mono tracking-wide">${escapar(s)}</span>`;
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

/* ── indicador de salud en el pie ── */
async function pintarSalud() {
  const liveness = document.getElementById('pie-salud');
  const readiness = document.getElementById('pie-readiness');
  if (!liveness || !readiness) return;
  try {
    const s = await pedir('/salud');
    const activo = s?.status === 'ok';
    liveness.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${activo ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
      ${activo ? 'Servidor activo' : 'Liveness no concluyente'} · build ${escapar(s?.build || 'no informado')}`;
  } catch {
    liveness.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>Servidor sin responder`;
  }

  try {
    await cargarIdentidad();
  } catch (e) {
    readiness.textContent = `Readiness no consultada: ${e.message}`;
    return;
  }
  if (
    (identidad.provider === 'oidc' && !identidad.authenticated) ||
    (identidad.provider === 'static' && !tokenActual())
  ) {
    readiness.textContent = identidad.provider === 'oidc'
      ? 'Readiness de dependencias no consultada: inicia sesión con Salesforce.'
      : 'Readiness de dependencias no consultada: requiere un Bearer de QA con rol admin.';
    return;
  }

  try {
    const s = await pedir('/api/admin/salud', { authInteractiva: false });
    if (!Array.isArray(s?.dependencias) || s.dependencias.length === 0) {
      readiness.textContent = 'Readiness no concluyente: la respuesta admin no incluyó dependencias.';
      return;
    }
    const total = s.dependencias.length;
    const disponibles = s.dependencias.filter((d) => d?.disponible === true).length;
    readiness.innerHTML = `<span class="${disponibles === total ? 'text-emerald-300' : 'text-amber-300'}">Readiness:</span> ${disponibles} de ${total} dependencias disponibles.`;
  } catch (e) {
    if (e?.status === 401 || e?.status === 403) {
      readiness.textContent = `Readiness no autorizada (HTTP ${e.status}); el token de esta pestaña no permite consultar salud administrativa.`;
    } else {
      readiness.textContent = 'Readiness no disponible: falló la consulta administrativa.';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void (async () => {
    try {
      await cargarIdentidad();
    } catch {
      // La nav queda usable y las consultas mostrarán el error real de identidad.
    }
    const activa = location.pathname.split('/').pop() || 'index.html';
    if (document.getElementById('nav')) montarNav(activa);
    if (document.getElementById('footer')) montarFooter();
    await pintarSalud();
  })();
});
