/* ══════════════════════════════════════════════════════════════════════════
   Qué cubre cada modelo, sin pedir número de serie.

   La cobertura de UNA unidad necesita su VIN: depende de su odómetro y de su
   antigüedad, y esa evaluación ya existe y se pinta con la tarjeta de garantía.
   La póliza del MODELO no depende de ninguna unidad. Es la misma para toda la
   línea, y hasta ahora estaba encerrada detrás de un número de serie: quien
   quería saber qué cubre un T680 tenía que demostrar que tenía uno.

   Sale de `/publico/modelos`, que proyecta `Regla_Cobertura__c` —las mismas
   reglas con las que se evalúa una unidad concreta—.
   ══════════════════════════════════════════════════════════════════════════ */

import { escapar, bloqueError, cargando, numero, chip } from '../sistema.js';

export async function montarModelos(raiz) {
  raiz.innerHTML = cargando('la póliza por modelo');

  let datos;
  try {
    const res = await fetch('/publico/modelos');
    datos = await res.json();
    if (!res.ok) {
      const e = new Error(datos?.mensaje || `El servidor respondió ${res.status}`);
      e.detalle = { operacion: 'póliza por modelo', status: res.status };
      throw e;
    }
  } catch (e) {
    raiz.innerHTML = bloqueError(e, 'No se pudo leer la póliza por modelo');
    return;
  }

  const modelos = datos.modelos ?? [];
  if (!modelos.length) {
    raiz.innerHTML = `
      <p class="text-gray-400 text-xs font-light leading-relaxed border border-white/5 bg-[#0d0e12] p-5">
        No hay reglas de cobertura activas publicadas para ningún modelo.
      </p>`;
    return;
  }

  let elegido = modelos[0].nombre;

  const limite = (s) => {
    const partes = [];
    if (s.mesesLimite != null) partes.push(`${s.mesesLimite} meses`);
    if (s.sinLimiteKm) partes.push('sin límite de kilometraje');
    else if (s.kmLimite != null) partes.push(`${numero(s.kmLimite)} km`);
    return partes.join(' · ') || 'sin límite declarado';
  };

  function pintar() {
    const modelo = modelos.find((m) => m.nombre === elegido) ?? modelos[0];
    raiz.innerHTML = `
      ${
        datos.mismaPolizaParaTodos
          ? `<p class="text-[11px] text-amber-300/90 font-light leading-relaxed border-l-2 border-amber-400/40 pl-3 mb-5">
               Los ${escapar(String(modelos.length))} modelos comparten hoy la misma póliza, sistema por sistema.
               Cambiar de modelo aquí no cambia lo que cubre.
             </p>`
          : ''
      }
      <p class="text-[10px] uppercase tracking-widest texto-apagado mb-3">Elige el modelo</p>
      <div class="flex flex-wrap gap-2 mb-6">
        ${modelos
          .map(
            (m) => `
          <button type="button" data-modelo="${escapar(m.nombre)}"
            class="border px-4 py-2.5 text-[10px] uppercase tracking-widest transition-colors duration-300 ${
              m.nombre === elegido
                ? 'border-white/40 bg-white/10 text-white'
                : 'border-white/10 text-gray-400 hover:border-white/30 hover:text-white'
            }">${escapar(m.nombre)}</button>`,
          )
          .join('')}
      </div>

      <ul class="space-y-3">
        ${modelo.sistemas
          .map(
            (s) => `
          <li class="border-b border-white/5 pb-3 last:border-0">
            <div class="flex items-center justify-between gap-3 mb-1.5">
              <span class="text-xs text-gray-200">${escapar(s.sistema)}</span>
              ${s.esExtendida ? chip('Garantía extendida', 'bloqueo') : ''}
            </div>
            <p class="text-[10px] uppercase tracking-widest texto-apagado">${escapar(limite(s))}</p>
          </li>`,
          )
          .join('')}
      </ul>

      ${
        datos.base && (datos.base.meses != null || datos.base.km != null)
          ? `<p class="text-[11px] texto-tenue font-light leading-relaxed border-t border-white/5 pt-4 mt-5">
               La póliza base de Zapata es de ${escapar(String(datos.base.meses ?? '—'))} meses
               y ${escapar(datos.base.km != null ? numero(datos.base.km) : '—')} km. Lo de arriba es lo
               que la regla activa dice para este modelo, sistema por sistema.
             </p>`
          : ''
      }

      <p class="text-[11px] texto-tenue font-light leading-relaxed mt-4">
        Esto es la póliza del modelo. Que tu unidad esté dentro depende de su
        kilometraje y su antigüedad: dile al asistente su número de serie y te lo
        evalúa contra estas mismas reglas.
      </p>`;

    for (const boton of raiz.querySelectorAll('[data-modelo]')) {
      boton.addEventListener('click', () => {
        elegido = boton.dataset.modelo;
        pintar();
      });
    }
  }

  pintar();
}
