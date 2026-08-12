/* ══════════════════════════════════════════════════════════════════════════
   La agenda del taller, para trabajar con ella.

   El asistente ya sabía consultar horarios, pero los dictaba: «1. Jueves 13 de
   09:00 a 11:00 — Garantía; 2. …». Leer diez renglones y contestar «el 5» no es
   escoger una cita, es deletrearla. Aquí el mismo dato —el MISMO endpoint que
   alimenta al agente— se puede mirar por día, filtrar por tipo de servicio y
   tocar.

   Nada de lo que se ve aquí lo inventa esta pantalla:

     · los talleres salen de `/publico/sucursales` (Sucursal__c)
     · las franjas de `/publico/disponibilidad` (Slot_Taller__c), con su tipo de
       servicio, sus cupos libres y su sucursal
     · la cita la crea `/publico/taller/agendar`, que ejecuta el Flow
       `Crear_Orden_Servicio` bajo el folio de ESTA visita

   Mirar la agenda no exige número de serie: un cliente puede querer saber si hay
   lugar el jueves sin tener que demostrar nada. El número de serie se pide en el
   único momento en que hace falta de verdad —al confirmar—, porque el Flow lo
   exige para colgar la orden de una unidad registrada.
   ══════════════════════════════════════════════════════════════════════════ */

import { escapar, bloqueError, cargando } from '../sistema.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Cuántos días hacia adelante se piden. El catálogo de franjas es finito. */
const DIAS_HORIZONTE = 21;

function aISO(fecha) {
  return fecha.toISOString().slice(0, 10);
}

/**
 * La fecha LOCAL de un instante, como `YYYY-MM-DD`.
 *
 * Agrupar por `inicio.slice(0, 10)` agrupa por la fecha UTC, que no es la del cliente.
 * Con las franjas de hoy —15:00Z a 23:00Z, o sea 09:00 a 17:00 en México— las dos
 * coinciden y no se notaba; una franja a las 19:00 locales caería en el día siguiente.
 */
export function diaLocal(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * El día que el cliente lee sobre un grupo de franjas.
 *
 * Recibe `YYYY-MM-DD` y lo construye por partes, en local. Antes hacía
 * `new Date('2026-08-14')`, y eso NO es el 14 a medianoche local: es medianoche UTC,
 * que en México (UTC-6) cae a las 18:00 del día 13. El encabezado decía «jueves 13»
 * encima de franjas del viernes 14 —comprobado contra la org— mientras el asistente,
 * en la conversación de al lado, decía el día correcto. Un cliente que leyera el panel
 * se presentaba un día antes.
 */
export function diaLegible(fecha) {
  const [anio, mes, dia] = String(fecha).slice(0, 10).split('-').map(Number);
  const d = new Date(anio, mes - 1, dia);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

function hora(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Una sola lectura del catálogo de talleres por carga de página. */
let sucursalesEnMemoria = null;
async function sucursales() {
  if (sucursalesEnMemoria) return sucursalesEnMemoria;
  const res = await fetch('/publico/sucursales');
  const d = await res.json();
  if (!res.ok) {
    const e = new Error(d?.mensaje || `El servidor respondió ${res.status}`);
    e.detalle = { operacion: 'catálogo de talleres', status: res.status };
    throw e;
  }
  sucursalesEnMemoria = d.sucursales ?? [];
  return sucursalesEnMemoria;
}

/**
 * @param {HTMLElement} raiz  nodo que gobierna el componente
 * @param {object} opciones
 * @param {string|null} opciones.vin        número de serie ya conocido, si lo hay
 * @param {string|null} opciones.sucursal   clave de taller preseleccionada
 * @param {(cita:object)=>void} opciones.alAgendar  aviso de cita creada
 */
export async function montarAgenda(raiz, { vin = null, sucursal = null, alAgendar } = {}) {
  let taller = sucursal;
  let tipoFiltro = null;
  let franjas = [];
  let noOfrecidas = null;
  let numeroDeSerie = vin;
  /** Claves de taller que hoy tienen al menos una franja apartable. `null` mientras
   *  no se sepa: se prefiere no marcar nada antes que marcar mal. */
  let talleresConCupo = null;

  raiz.innerHTML = `
    <div data-agenda-talleres class="mb-5"></div>
    <div data-agenda-tipos class="mb-5"></div>
    <div data-agenda-dias aria-live="polite"></div>
    <div data-agenda-cierre class="mt-5"></div>`;

  const nodoTalleres = raiz.querySelector('[data-agenda-talleres]');
  const nodoTipos = raiz.querySelector('[data-agenda-tipos]');
  const nodoDias = raiz.querySelector('[data-agenda-dias]');
  const nodoCierre = raiz.querySelector('[data-agenda-cierre]');

  // ── talleres ──────────────────────────────────────────────────────────────
  let red = [];
  try {
    red = await sucursales();
  } catch (e) {
    raiz.innerHTML = bloqueError(e, 'No se pudo leer la red de talleres');
    return;
  }
  if (!red.length) {
    nodoTalleres.innerHTML =
      '<p class="text-gray-400 text-xs font-light">El catálogo no tiene talleres publicados.</p>';
    return;
  }

  const pintarTalleres = () => {
    // Qué talleres pueden apartar hoy se sabe de una sola lectura de la red entera.
    // Sin esto, ocho de los nueve son un callejón: el cliente elige, lee «por
    // confirmar» y tiene que ir probando taller por taller hasta dar con el que sí.
    const conCupo = talleresConCupo;
    nodoTalleres.innerHTML = `
      <p class="text-[10px] uppercase tracking-widest texto-apagado mb-3">Elige el taller</p>
      <div class="flex flex-wrap gap-2">
        ${red
          .map((s) => {
            const puede = !conCupo || conCupo.has(s.clave);
            return `
          <button type="button" data-taller="${escapar(s.clave)}"
            class="border px-4 py-2.5 text-[10px] uppercase tracking-widest transition-colors duration-300 ${
              s.clave === taller
                ? 'border-white/40 bg-white/10 text-white'
                : puede
                  ? 'border-white/10 text-gray-400 hover:border-white/30 hover:text-white'
                  : 'border-white/5 texto-apagado hover:border-white/20 hover:text-gray-400'
            }">
            ${escapar(s.ciudad || s.nombre)}${puede ? '' : ' ·'}
          </button>`;
          })
          .join('')}
      </div>
      ${
        conCupo && conCupo.size && conCupo.size < red.length
          ? `<p class="text-[10px] uppercase tracking-widest texto-apagado mt-3">
               Con horario apartable hoy · ${escapar([...conCupo].join(', '))}
             </p>`
          : ''
      }`;
    for (const boton of nodoTalleres.querySelectorAll('[data-taller]')) {
      boton.addEventListener('click', () => {
        taller = boton.dataset.taller;
        tipoFiltro = null;
        pintarTalleres();
        void cargarFranjas();
      });
    }
  };

  /** El taller elegido, con su anticipación mínima y su horario reales. */
  const tallerActual = () => red.find((s) => s.clave === taller) ?? null;

  // ── franjas ───────────────────────────────────────────────────────────────
  async function cargarFranjas({ conservarCierre = false } = {}) {
    nodoTipos.innerHTML = '';
    // Al releer tras agendar hay que conservar el comprobante: borrarlo dejaba al
    // cliente sin el folio que acababa de recibir, justo cuando iba a apuntarlo.
    if (!conservarCierre) nodoCierre.innerHTML = '';
    nodoDias.innerHTML = cargando('los horarios del taller');
    const hoy = new Date();
    const hasta = new Date(hoy.getTime() + DIAS_HORIZONTE * 86_400_000);
    try {
      const res = await fetch(
        `/publico/disponibilidad?desde=${aISO(hoy)}&hasta=${aISO(hasta)}&sucursal=${encodeURIComponent(taller)}`,
      );
      const d = await res.json();
      if (!res.ok) {
        const e = new Error(d?.mensaje || `El servidor respondió ${res.status}`);
        e.detalle = { operacion: 'disponibilidad del taller', status: res.status };
        throw e;
      }
      franjas = (d.franjas ?? []).filter((f) => f.inicio);
      noOfrecidas = d.noOfrecidas ?? null;
      pintarTipos();
      pintarDias();
    } catch (e) {
      nodoDias.innerHTML = bloqueError(e, 'No se pudieron leer los horarios');
    }
  }

  /**
   * Los tipos de servicio no están escritos aquí: son los que traen las franjas
   * que la organización devolvió para este taller. Si un taller no ofrece
   * diagnóstico esa semana, el filtro no aparece.
   */
  function pintarTipos() {
    const tipos = [...new Set(franjas.map((f) => f.tipo).filter(Boolean))].sort();
    if (tipos.length < 2) {
      nodoTipos.innerHTML = '';
      return;
    }
    nodoTipos.innerHTML = `
      <p class="text-[10px] uppercase tracking-widest texto-apagado mb-3">¿Qué necesita tu unidad?</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-tipo=""
          class="border px-4 py-2.5 text-[10px] uppercase tracking-widest transition-colors duration-300 ${
            tipoFiltro === null
              ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
              : 'border-white/10 text-gray-400 hover:border-white/30 hover:text-white'
          }">Todo</button>
        ${tipos
          .map(
            (t) => `
          <button type="button" data-tipo="${escapar(t)}"
            class="border px-4 py-2.5 text-[10px] uppercase tracking-widest transition-colors duration-300 ${
              tipoFiltro === t
                ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                : 'border-white/10 text-gray-400 hover:border-white/30 hover:text-white'
            }">${escapar(t)}</button>`,
          )
          .join('')}
      </div>`;
    for (const boton of nodoTipos.querySelectorAll('[data-tipo]')) {
      boton.addEventListener('click', () => {
        tipoFiltro = boton.dataset.tipo || null;
        pintarTipos();
        pintarDias();
      });
    }
  }

  function pintarDias() {
    const visibles = franjas.filter((f) => !tipoFiltro || f.tipo === tipoFiltro);
    if (!visibles.length) {
      // «No hay lugar» y «no te lo podemos ofrecer» no son lo mismo, y decir el
      // primero cuando pasa el segundo es mentirle al cliente: ocho de los nueve
      // talleres tienen horarios en el catálogo cuya capacidad nadie confirmó.
      const soloNoVerificadas = !tipoFiltro && !franjas.length && noOfrecidas?.noVerificadas > 0;
      nodoDias.innerHTML = soloNoVerificadas
        ? `<div class="border border-amber-400/30 bg-amber-400/5 p-5" role="status">
             <p class="text-[10px] uppercase tracking-[0.3em] text-amber-400/80 mb-2">Horario por confirmar</p>
             <p class="text-gray-200 text-xs font-light leading-relaxed mb-2">${escapar(noOfrecidas.motivo)}</p>
             <p class="text-gray-400 text-[11px] font-light leading-relaxed">
               Son ${escapar(String(noOfrecidas.noVerificadas))} horarios de los próximos ${DIAS_HORIZONTE} días.
               Pídeselo al asistente y un asesor lo confirma con el taller.
             </p>
             ${
               talleresConCupo?.size
                 ? `<div class="flex flex-wrap gap-2 mt-4">
                      ${[...talleresConCupo]
                        .map((c) => {
                          const otro = red.find((x) => x.clave === c);
                          return `<button type="button" data-ir-taller="${escapar(c)}"
                            class="border border-white/20 px-4 py-2.5 text-[10px] uppercase tracking-widest text-white hover:bg-white hover:text-black transition-colors duration-300">
                            Apartar en ${escapar(otro?.ciudad || otro?.nombre || c)}
                          </button>`;
                        })
                        .join('')}
                    </div>`
                 : ''
             }
           </div>`
        : `<p class="text-gray-400 text-xs font-light leading-relaxed border border-white/5 bg-[#0d0e12] p-5">
             ${
               tipoFiltro
                 ? `Este taller no tiene franjas de ${escapar(tipoFiltro)} apartables en los próximos ${DIAS_HORIZONTE} días.`
                 : `Este taller no tiene franjas apartables en los próximos ${DIAS_HORIZONTE} días.`
             }
           </p>`;
      return;
    }

    // La anticipación mínima es del taller, no de esta pantalla: el Flow rechaza
    // la cita si no se respeta. Decirlo antes vale más que fallar al confirmar.
    const anticipacion = Number(tallerActual()?.anticipacionHoras ?? 0);
    const limite = Date.now() + anticipacion * 3_600_000;

    const porDia = new Map();
    for (const f of visibles) {
      const dia = diaLocal(f.inicio);
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push(f);
    }

    nodoDias.innerHTML = [...porDia.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dia, lista]) => {
        const botones = lista
          .sort((a, b) => a.inicio.localeCompare(b.inicio))
          .map((f) => {
            const pronto = new Date(f.inicio).getTime() < limite;
            return `
            <li>
              <button type="button" data-franja="${escapar(f.id)}" ${pronto ? 'disabled' : ''}
                class="w-full text-left border px-4 py-3 transition-colors duration-300 ${
                  pronto
                    ? 'border-white/5 texto-apagado cursor-not-allowed'
                    : 'border-white/10 hover:border-amber-400/40 hover:bg-amber-400/5'
                }">
                <span class="block text-xs ${pronto ? 'texto-apagado' : 'text-white'} font-mono tracking-wide">${escapar(hora(f.inicio))}${f.fin ? `–${escapar(hora(f.fin))}` : ''}</span>
                <span class="block text-[10px] uppercase tracking-widest ${pronto ? 'texto-apagado' : 'texto-tenue'} mt-1.5">${escapar(f.tipo || 'servicio')}</span>
                ${
                  pronto
                    ? `<span class="block text-[10px] uppercase tracking-widest texto-apagado mt-1.5">Menos de ${anticipacion} h</span>`
                    : f.libres != null
                      ? `<span class="block text-[10px] uppercase tracking-widest texto-apagado mt-1.5">${escapar(String(f.libres))} lugares</span>`
                      : ''
                }
              </button>
            </li>`;
          })
          .join('');
        return `
          <div class="border-t border-white/5 pt-4 mt-4 first:border-0 first:pt-0 first:mt-0">
            <p class="text-[10px] uppercase tracking-[0.3em] texto-tenue mb-3">${escapar(diaLegible(dia))}</p>
            <ul class="grid grid-cols-2 sm:grid-cols-3 gap-2">${botones}</ul>
          </div>`;
      })
      .join('');

    for (const boton of nodoDias.querySelectorAll('[data-franja]:not([disabled])')) {
      boton.addEventListener('click', () => confirmar(boton.dataset.franja));
    }
    for (const ir of nodoDias.querySelectorAll('[data-ir-taller]')) {
      ir.addEventListener('click', async () => {
        taller = ir.dataset.irTaller;
        tipoFiltro = null;
        pintarTalleres();
        await cargarFranjas();
      });
    }
  }

  // ── confirmación ──────────────────────────────────────────────────────────
  function confirmar(idFranja) {
    const franja = franjas.find((f) => f.id === idFranja);
    if (!franja) return;
    const s = tallerActual();

    nodoCierre.innerHTML = `
      <form data-agenda-form class="border border-amber-400/30 bg-amber-400/5 p-5">
        <p class="text-[10px] uppercase tracking-[0.3em] text-amber-400/80 mb-3">Confirmar la cita</p>
        <p class="text-gray-200 text-xs font-light leading-relaxed mb-5">
          ${escapar(diaLegible(diaLocal(franja.inicio)))}, de ${escapar(hora(franja.inicio))}${franja.fin ? ` a ${escapar(hora(franja.fin))}` : ''}
          en ${escapar(s?.ciudad || s?.nombre || taller)}${franja.tipo ? ` · ${escapar(franja.tipo)}` : ''}.
        </p>

        <label class="block mb-4">
          <span class="text-[10px] uppercase tracking-widest texto-tenue block mb-1.5">Número de serie de tu unidad</span>
          <input data-agenda-vin value="${escapar(numeroDeSerie ?? '')}" autocomplete="off" required
            class="w-full min-w-0 bg-[#0b0c10] border border-white/10 text-white px-3 py-2.5 text-xs font-mono tracking-wide focus:outline-none focus:border-white/40 transition-colors rounded-none placeholder-apagado">
        </label>

        <label class="block mb-5">
          <span class="text-[10px] uppercase tracking-widest texto-tenue block mb-1.5">¿Qué le pasa a la unidad?</span>
          <input data-agenda-sintoma autocomplete="off" required
            placeholder="Ej. pierde potencia en subida"
            class="w-full min-w-0 bg-[#0b0c10] border border-white/10 text-white px-3 py-2.5 text-xs focus:outline-none focus:border-white/40 transition-colors rounded-none placeholder-apagado">
        </label>

        <div class="flex flex-col sm:flex-row gap-3">
          <button type="submit" data-agenda-confirmar
            class="bg-white text-black px-8 py-3 text-xs uppercase tracking-widest font-medium hover:bg-neutral-200 transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed">
            Agendar
          </button>
          <button type="button" data-agenda-cancelar
            class="border border-white/10 px-6 py-3 text-[10px] uppercase tracking-widest text-gray-400 hover:border-white/30 hover:text-white transition-colors duration-300">
            Elegir otro horario
          </button>
        </div>
        <div data-agenda-resultado class="mt-4" aria-live="polite"></div>
      </form>`;
    nodoCierre.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const form = nodoCierre.querySelector('[data-agenda-form]');
    const campoVin = form.querySelector('[data-agenda-vin]');
    const campoSintoma = form.querySelector('[data-agenda-sintoma]');
    const boton = form.querySelector('[data-agenda-confirmar]');
    const salida = form.querySelector('[data-agenda-resultado]');

    form.querySelector('[data-agenda-cancelar]').addEventListener('click', () => {
      nodoCierre.innerHTML = '';
    });
    (numeroDeSerie ? campoSintoma : campoVin).focus();

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const vinEscrito = campoVin.value.trim();
      const sintoma = campoSintoma.value.trim();
      if (!vinEscrito || !sintoma) return;
      boton.disabled = true;
      salida.innerHTML = cargando('la cita con el taller');

      try {
        const res = await fetch('/publico/taller/agendar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vin: vinEscrito,
            slotId: franja.id,
            sucursalClave: taller,
            tipoServicio: franja.tipo ?? '',
            sintoma,
          }),
        });
        const d = await res.json();
        if (!res.ok) {
          const e = new Error(d?.mensaje || `El servidor respondió ${res.status}`);
          e.detalle = { operacion: 'crear la cita', status: res.status };
          throw e;
        }

        // Un bloqueo de política no es un fallo: es un guardrail que funcionó.
        if (d.ok === false) {
          // Un bloqueo no puede ser un callejón: si la organización sabe qué talleres
          // sí atienden ese modelo, se ofrecen para cambiarse con un toque.
          const alternativas = (d.talleresQueAtienden ?? []).filter((c) => red.some((s) => s.clave === c));
          salida.innerHTML = `
            <div class="border border-amber-400/30 bg-amber-400/5 p-4" role="status">
              <p class="text-[10px] uppercase tracking-[0.3em] text-amber-400/80 mb-2">La cita no procedió</p>
              <p class="text-gray-200 text-xs font-light leading-relaxed">${escapar(d.mensaje || d.motivo || 'El taller no pudo tomar esa cita.')}</p>
              ${
                alternativas.length
                  ? `<div class="flex flex-wrap gap-2 mt-4">
                       ${alternativas
                         .map((c) => {
                           const s = red.find((x) => x.clave === c);
                           return `<button type="button" data-cambiar-taller="${escapar(c)}"
                             class="border border-white/20 px-4 py-2.5 text-[10px] uppercase tracking-widest text-white hover:bg-white hover:text-black transition-colors duration-300">
                             ${escapar(s?.ciudad || s?.nombre || c)}
                           </button>`;
                         })
                         .join('')}
                     </div>`
                  : ''
              }
            </div>`;
          for (const cambio of salida.querySelectorAll('[data-cambiar-taller]')) {
            cambio.addEventListener('click', async () => {
              taller = cambio.dataset.cambiarTaller;
              tipoFiltro = null;
              nodoCierre.innerHTML = '';
              pintarTalleres();
              await cargarFranjas();
            });
          }
          boton.disabled = false;
          return;
        }

        numeroDeSerie = vinEscrito;
        salida.innerHTML = `
          <div class="border border-emerald-400/25 bg-emerald-500/10 p-4" role="status">
            <p class="text-[10px] uppercase tracking-[0.3em] text-emerald-300/80 mb-2">Cita registrada</p>
            ${d.folio ? `<p class="font-mono tracking-wide text-white text-2xl mb-2">${escapar(d.folio)}</p>` : ''}
            <p class="text-gray-200 text-xs font-light leading-relaxed">${escapar(d.mensaje || d.citaTexto || 'Quedó agendada.')}</p>
          </div>`;
        form.querySelector('[data-agenda-cancelar]').textContent = 'Agendar otra';
        alAgendar?.(d);
        // La franja consumida deja de ofrecerse: releer es más barato que suponer
        // cuántos cupos quedaron.
        void cargarFranjas({ conservarCierre: true });
      } catch (e) {
        salida.innerHTML = bloqueError(e, 'No se pudo agendar');
        boton.disabled = false;
      }
    });
  }

  // Una sola lectura de la red entera para saber quién puede apartar. Si falla, el
  // componente sigue funcionando igual: simplemente no marca nada.
  try {
    const hoy = new Date();
    const hasta = new Date(hoy.getTime() + DIAS_HORIZONTE * 86_400_000);
    const res = await fetch(`/publico/disponibilidad?desde=${aISO(hoy)}&hasta=${aISO(hasta)}`);
    if (res.ok) {
      const d = await res.json();
      talleresConCupo = new Set((d.franjas ?? []).map((f) => f.sucursal).filter(Boolean));
    }
  } catch {
    talleresConCupo = null;
  }

  pintarTalleres();
  if (taller) await cargarFranjas();
  else {
    nodoDias.innerHTML = `
      <p class="text-gray-400 text-xs font-light leading-relaxed border border-white/5 bg-[#0d0e12] p-5">
        Elige un taller y verás sus horarios libres de los próximos ${DIAS_HORIZONTE} días,
        con el tipo de servicio que atiende cada franja.
      </p>`;
  }

  return {
    /** El agente supo el número de serie: la confirmación deja de pedirlo. */
    conVin(nuevo) {
      if (nuevo) numeroDeSerie = nuevo;
    },
    /** El cliente nombró un taller en la conversación: se cambia a ése. */
    async enTaller(clave, atiendeTuModelo) {
      if (!clave || !red.some((s) => s.clave === clave)) return;
      if (clave !== taller) {
        taller = clave;
        tipoFiltro = null;
        pintarTalleres();
        await cargarFranjas();
      }
      // El servidor lo comprobó contra la organización. Se dice cuando el agente
      // pudo haber afirmado lo contrario: es el dato, no una opinión.
      if (atiendeTuModelo === true) {
        const s = red.find((x) => x.clave === clave);
        nodoTalleres.insertAdjacentHTML(
          'beforeend',
          `<p class="text-[11px] text-emerald-300/90 font-light leading-relaxed mt-3">
             Comprobado en el sistema de Zapata: ${escapar(s?.ciudad || s?.nombre || clave)} sí atiende el modelo de tu unidad.
           </p>`,
        );
      }
    },
  };
}
