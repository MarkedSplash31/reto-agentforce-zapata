/* ══════════════════════════════════════════════════════════════════════════
   El material de apoyo, para leerlo.

   Es el MISMO que el agente cita cuando contesta. Hasta ahora sólo salía por su
   boca: `BuscarConocimientoPostventa` lo busca, lo recorta y lo devuelve dentro
   de una respuesta. Quien quería leer qué dice sobre refacciones, un sistema o
   un procedimiento tenía que sacárselo por conversación, párrafo a párrafo.

   Aquí se busca y se lee. La marca de fuente viaja con cada artículo, y no es
   decoración: el Apex antepone a cada respuesta un aviso de material sintético
   no verificado, y esta pantalla lo respeta. Un artículo sin versión de política
   se enseña como lo que es —material de apoyo del reto, no documentación oficial
   de Zapata—, porque presentarlo de otro modo sería la mentira que ese aviso
   existe para impedir.
   ══════════════════════════════════════════════════════════════════════════ */

import { escapar, bloqueError, cargando, chip } from '../sistema.js';

/**
 * El contenido llega como texto enriquecido. Se convierte a texto plano con el
 * parser del navegador —sin insertarlo en el documento vivo— y se pinta con
 * textContent: nada de lo que venga de un artículo se interpreta como marcado.
 */
function comoTexto(html) {
  if (!html) return '';
  try {
    return new DOMParser().parseFromString(String(html), 'text/html').body.textContent ?? '';
  } catch {
    return String(html).replace(/<[^>]*>/g, ' ');
  }
}

export async function montarManuales(raiz) {
  let articulos = [];
  let aviso = '';
  let abierto = null;

  raiz.innerHTML = `
    <form data-manuales-form class="flex flex-col sm:flex-row gap-3 mb-5">
      <label class="sr-only" for="manuales-busca">Buscar en el material</label>
      <input id="manuales-busca" data-manuales-busca autocomplete="off"
        placeholder="Buscar: frenos, refacciones, servicio de 40,000 km…"
        class="flex-1 min-w-0 bg-[#0b0c10] border border-white/10 text-white px-3 py-2.5 text-xs focus:outline-none focus:border-white/40 transition-colors rounded-none placeholder-apagado">
      <button type="submit"
        class="border border-white/20 px-6 py-2.5 text-[10px] uppercase tracking-widest text-white hover:bg-white hover:text-black transition-all duration-300">
        Buscar
      </button>
    </form>
    <div data-manuales-aviso class="mb-5"></div>
    <div data-manuales-lista aria-live="polite"></div>`;

  const form = raiz.querySelector('[data-manuales-form]');
  const campo = raiz.querySelector('[data-manuales-busca]');
  const nodoAviso = raiz.querySelector('[data-manuales-aviso]');
  const lista = raiz.querySelector('[data-manuales-lista]');

  async function cargar(termino = '') {
    lista.innerHTML = cargando('el material de apoyo');
    try {
      const res = await fetch(`/publico/manuales${termino ? `?busca=${encodeURIComponent(termino)}` : ''}`);
      const d = await res.json();
      if (!res.ok) {
        const e = new Error(d?.mensaje || `El servidor respondió ${res.status}`);
        e.detalle = { operacion: 'material de apoyo', status: res.status };
        throw e;
      }
      articulos = d.articulos ?? [];
      aviso = d.aviso ?? '';
      abierto = null;
      pintar(termino);
    } catch (e) {
      lista.innerHTML = bloqueError(e, 'No se pudo leer el material de apoyo');
    }
  }

  function pintar(termino) {
    nodoAviso.innerHTML = aviso
      ? `<p class="text-[11px] text-amber-300/90 font-light leading-relaxed border-l-2 border-amber-400/40 pl-3">${escapar(aviso)}</p>`
      : '';

    if (!articulos.length) {
      lista.innerHTML = `
        <p class="text-gray-400 text-xs font-light leading-relaxed border border-white/5 bg-[#0d0e12] p-5">
          ${
            termino
              ? `No hay material publicado que hable de «${escapar(termino)}». El asistente puede pasarte con un asesor si lo necesitas.`
              : 'No hay material publicado en este momento.'
          }
        </p>`;
      return;
    }

    lista.innerHTML = articulos
      .map(
        (a) => `
      <div class="border-b border-white/5 py-4 first:pt-0 last:border-0">
        <button type="button" data-articulo="${escapar(a.id)}"
          class="w-full text-left group" aria-expanded="${abierto === a.id ? 'true' : 'false'}">
          <div class="flex items-start justify-between gap-4 mb-1.5">
            <span class="text-xs text-gray-100 group-hover:text-white transition-colors">${escapar(a.titulo)}</span>
            ${chip(a.version || 'Sin versión', a.verificado ? 'ok' : 'bloqueo')}
          </div>
          ${a.resumen ? `<p class="text-[11px] texto-tenue font-light leading-relaxed">${escapar(a.resumen)}</p>` : ''}
        </button>
        ${
          abierto === a.id
            ? `<p data-cuerpo="${escapar(a.id)}" class="text-gray-300 text-xs font-light leading-relaxed whitespace-pre-wrap mt-4 border-l border-white/10 pl-4"></p>`
            : ''
        }
      </div>`,
      )
      .join('');

    // El cuerpo se escribe con textContent: viene de un artículo, no se interpreta.
    if (abierto) {
      const nodo = lista.querySelector(`[data-cuerpo="${CSS.escape(abierto)}"]`);
      const articulo = articulos.find((a) => a.id === abierto);
      if (nodo && articulo) {
        const texto = comoTexto(articulo.contenido).trim();
        nodo.textContent = texto || 'Este artículo no tiene contenido publicado.';
      }
    }

    for (const boton of lista.querySelectorAll('[data-articulo]')) {
      boton.addEventListener('click', () => {
        abierto = abierto === boton.dataset.articulo ? null : boton.dataset.articulo;
        pintar(termino);
      });
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void cargar(campo.value.trim());
  });

  await cargar();
}
