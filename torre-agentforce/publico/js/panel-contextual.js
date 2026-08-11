/* ══════════════════════════════════════════════════════════════════════════
   Panel de apoyo visual de la conversación.

   No es un formulario ni un menú: es la ventana que muestra lo que el agente está
   haciendo AHORA. Se pinta con las salidas reales de las acciones que el planner
   invocó en el turno —lo que la Agent API devuelve en `message.result`— y con nada
   más.

   Si llega un resultado cuya forma no reconocemos, se muestra tal cual en vez de
   descartarlo: es preferible enseñar un dato crudo del agente que fingir que no
   pasó nada. Lo que jamás se hace es rellenar el panel con datos que el agente no
   haya devuelto.
   ══════════════════════════════════════════════════════════════════════════ */

import { escapar, chip, fecha, numero } from './sistema.js';

const VACIO = `
  <div class="border border-white/5 bg-[#0b0c10] p-6">
    <p class="text-[10px] uppercase tracking-[0.3em] text-gray-600 mb-2">Apoyo visual</p>
    <p class="text-gray-500 text-xs font-light leading-relaxed">
      Aquí aparece lo que el asistente vaya consultando: la cobertura de tu unidad,
      los horarios que encuentre en el taller o el reporte que levante por ti.
    </p>
  </div>`;

/** Normaliza el resultado de una acción, que puede venir anidado o como texto JSON. */
function comoObjeto(valor) {
  if (!valor) return null;
  if (typeof valor === 'string') {
    const t = valor.trim();
    if (!t.startsWith('{') && !t.startsWith('[')) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }
  if (typeof valor === 'object') return valor;
  return null;
}

function nombreAccion(r) {
  for (const clave of ['function', 'functionName', 'name', 'action', 'actionName']) {
    if (typeof r?.[clave] === 'string') return r[clave];
  }
  return null;
}

function cargaUtil(r) {
  for (const clave of ['result', 'output', 'outputValues', 'value', 'data']) {
    const v = comoObjeto(r?.[clave]);
    if (v) return v;
  }
  return comoObjeto(r) ?? {};
}

function tarjeta(titulo, eyebrow, cuerpo, tono = 'neutro') {
  const borde =
    tono === 'ok' ? 'border-emerald-400/25' : tono === 'alerta' ? 'border-amber-400/30' : 'border-white/5';
  return `
    <div class="border ${borde} bg-[#0b0c10] p-6">
      <p class="text-[10px] uppercase tracking-[0.3em] text-gray-500 mb-2">${escapar(eyebrow)}</p>
      <h3 class="font-serif-luxury text-xl text-white tracking-wide mb-4">${escapar(titulo)}</h3>
      ${cuerpo}
    </div>`;
}

function filas(pares) {
  const vivas = pares.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!vivas.length) return '';
  return `<dl class="space-y-1.5">${vivas
    .map(
      ([k, v, mono]) => `
      <div class="flex justify-between gap-4">
        <dt class="text-[10px] uppercase tracking-widest text-gray-600">${escapar(k)}</dt>
        <dd class="text-[11px] ${mono ? 'font-mono tracking-wide' : ''} text-gray-300 text-right">${escapar(String(v))}</dd>
      </div>`,
    )
    .join('')}</dl>`;
}

// ── Renderizadores por acción ───────────────────────────────────────────────

function pintarDisponibilidad(d) {
  const franjas = d.franjas ?? d.slots ?? d.disponibilidad ?? [];
  if (!Array.isArray(franjas) || !franjas.length) {
    return tarjeta(
      'Horarios del taller',
      'Agenda',
      `<p class="text-gray-400 text-xs font-light leading-relaxed">
         El asistente consultó la agenda y no encontró horarios que ofrecerte en ese rango.
       </p>`,
    );
  }
  const lista = franjas
    .slice(0, 8)
    .map((f) => {
      const inicio = f.inicio ?? f.Inicio__c ?? f.start;
      const libres = f.libres ?? f.Cupos_Libres__c;
      return `
      <li class="flex items-center justify-between gap-4 border-b border-white/5 pb-2 last:border-0">
        <span class="text-[11px] font-mono tracking-wide text-gray-300">${escapar(fecha(inicio))}</span>
        <span class="text-[10px] uppercase tracking-widest text-gray-500">${libres != null ? escapar(String(libres)) + ' lugares' : ''}</span>
      </li>`;
    })
    .join('');
  return tarjeta('Horarios que encontró', 'Agenda', `<ul class="space-y-2">${lista}</ul>`);
}

function pintarCita(d) {
  const folio = d.varFolio ?? d.folio ?? d.workOrderNumber;
  const texto = d.varCitaTexto ?? d.citaTexto ?? d.varMensaje ?? d.mensaje;
  if (d.varMotivoBloqueo || d.motivoBloqueo) {
    return tarjeta(
      'La cita no procedió',
      'Agenda',
      `<p class="text-gray-300 text-xs font-light leading-relaxed">${escapar(texto || 'El taller no pudo tomar esa cita.')}</p>`,
      'alerta',
    );
  }
  return tarjeta(
    'Tu cita quedó registrada',
    'Agenda',
    `${folio ? `<p class="font-mono tracking-wide text-white text-2xl mb-3">${escapar(folio)}</p>` : ''}
     ${texto ? `<p class="text-gray-300 text-xs font-light leading-relaxed">${escapar(texto)}</p>` : ''}`,
    'ok',
  );
}

function pintarVarada(d) {
  const folio = d.varFolio ?? d.folio;
  const aviso = d.varAvisoSeguridad ?? d.avisoSeguridad;
  const texto = d.varMensaje ?? d.mensaje;
  return tarjeta(
    'Reporte de asistencia',
    'Carretera',
    `${aviso ? `<p class="text-amber-300 text-xs font-light leading-relaxed mb-4 border-l-2 border-amber-400 pl-3">${escapar(aviso)}</p>` : ''}
     ${folio ? `<p class="font-mono tracking-wide text-white text-2xl mb-3">${escapar(folio)}</p>` : ''}
     ${texto ? `<p class="text-gray-300 text-xs font-light leading-relaxed">${escapar(texto)}</p>` : ''}`,
    aviso ? 'alerta' : 'ok',
  );
}

function pintarConocimiento(d, citas) {
  const cuerpo = d.contenido ?? d.respuesta ?? d.answer;
  const titulos = d.titulos ?? d.titles ?? [];
  const fuentes = [...(citas ?? []).map((c) => c.title ?? c.titulo ?? c.url), ...(Array.isArray(titulos) ? titulos : [])]
    .filter(Boolean)
    .slice(0, 5);
  return tarjeta(
    'De los manuales de Zapata',
    'Consulta',
    `${cuerpo ? `<p class="text-gray-300 text-xs font-light leading-relaxed mb-4">${escapar(String(cuerpo).slice(0, 600))}</p>` : ''}
     ${
       fuentes.length
         ? `<p class="text-[10px] uppercase tracking-widest text-gray-600 mb-2">Fuentes</p>
            <ul class="space-y-1.5">${fuentes.map((f) => `<li class="text-[11px] text-gray-400 font-light">${escapar(String(f))}</li>`).join('')}</ul>`
         : ''
     }`,
  );
}

function pintarEscalamiento(d) {
  const caso = d.caseNumber ?? d.numeroCaso ?? d.folio;
  return tarjeta(
    'Te estamos pasando con una persona',
    'Asesor',
    `${caso ? `<p class="font-mono tracking-wide text-white text-2xl mb-3">${escapar(caso)}</p>` : ''}
     <p class="text-gray-300 text-xs font-light leading-relaxed">
       Un asesor de postventa recibe tu conversación completa. Puedes seguir escribiendo
       en la misma ventana; cuando conteste, verás su respuesta aquí mismo.
     </p>`,
    'ok',
  );
}

function pintarCobertura(c) {
  const u = c.unidad ?? {};
  const conflicto = c.hayConflicto;
  const sinReglas = c.sinReglasParaElModelo;

  const traduccion = {
    CUBIERTO: ['Cubierto', 'ok'],
    NO_CUBIERTO: ['Fuera de cobertura', 'error'],
    REQUIERE_DATO: ['Falta información', 'bloqueo'],
    SIN_REGLA_PARA_EL_MODELO: ['Sin póliza registrada', 'neutro'],
  };

  const sistemas = (c.porSistema ?? [])
    .slice(0, 8)
    .map((s) => {
      const [txt, tono] = traduccion[s.porRegla?.veredicto] ?? [s.porRegla?.veredicto ?? '—', 'neutro'];
      const limite = s.porRegla?.sinLimiteKm
        ? 'sin límite de kilometraje'
        : s.porRegla?.kmLimite != null
          ? `${numero(s.porRegla.kmLimite)} km`
          : '';
      return `
      <li class="border-b border-white/5 pb-3 last:border-0">
        <div class="flex items-center justify-between gap-3 mb-1">
          <span class="text-xs text-gray-200">${escapar(s.sistema)}</span>
          ${chip(txt, tono)}
        </div>
        <p class="text-[10px] uppercase tracking-widest text-gray-600">
          ${s.porRegla?.mesesLimite != null ? escapar(String(s.porRegla.mesesLimite)) + ' meses' : ''}
          ${limite ? ' · ' + escapar(limite) : ''}
        </p>
        ${
          s.hayConflicto
            ? `<p class="text-[11px] text-amber-300 font-light leading-relaxed mt-2">
                 La póliza y el registro de tu unidad no coinciden en este sistema. Un asesor lo aclara.
               </p>`
            : ''
        }
      </li>`;
    })
    .join('');

  return tarjeta(
    'Cobertura de tu unidad',
    'Garantía',
    `${filas([
      ['Unidad', u.Name],
      ['Número de serie', u.SerialNumber, true],
      ['Kilometraje', u.Odometro__c != null ? `${numero(u.Odometro__c)} km` : null, true],
      ['Antigüedad', u.Meses_Desde_Instalacion__c != null ? `${u.Meses_Desde_Instalacion__c} meses` : null],
    ])}
     ${
       sinReglas
         ? `<p class="text-amber-300 text-xs font-light leading-relaxed mt-4 border-l-2 border-amber-400 pl-3">
              No hay una póliza registrada para el modelo de tu unidad, así que no podemos
              determinar su cobertura aquí. Un asesor lo revisa contigo.
            </p>`
         : sistemas
           ? `<p class="text-[10px] uppercase tracking-widest text-gray-600 mt-5 mb-3">Por sistema</p>
              <ul class="space-y-3">${sistemas}</ul>`
           : ''
     }`,
    conflicto || sinReglas ? 'alerta' : 'neutro',
  );
}

// ── Superficie pública del módulo ───────────────────────────────────────────

export function crearPanel(contenedor) {
  contenedor.innerHTML = VACIO;
  let vacio = true;
  /** Llaves ya pintadas, para que un mismo hecho no genere dos tarjetas iguales. */
  const vistos = new Set();

  function agregar(html) {
    if (vacio) {
      contenedor.innerHTML = '';
      vacio = false;
    }
    const caja = document.createElement('div');
    caja.className = 'mb-6 last:mb-0';
    caja.innerHTML = html;
    contenedor.prepend(caja);
  }

  return {
    /** Recibe un evento del agente y pinta lo que sus acciones hayan devuelto. */
    desdeEvento(evento) {
      for (const bruto of evento?.resultados ?? []) {
        const accion = nombreAccion(bruto) ?? '';
        const d = cargaUtil(bruto);

        if (/Consultar_disponibilidad/i.test(accion)) agregar(pintarDisponibilidad(d));
        else if (/Crear_Orden_Servicio|Reprogramar_Orden_Servicio/i.test(accion)) agregar(pintarCita(d));
        else if (/Crear_Reporte_Unidad_Varada/i.test(accion)) agregar(pintarVarada(d));
        else if (/Buscar_Conocimiento/i.test(accion)) agregar(pintarConocimiento(d, evento.citedReferences));
        else if (/Escalamiento|Escalar/i.test(accion)) agregar(pintarEscalamiento(d));
        else if (accion) {
          // Acción real que todavía no tiene vista propia: se muestra su nombre y sus
          // datos en crudo. Callarla haría creer que el agente no hizo nada.
          agregar(
            tarjeta(
              accion.replace(/_/g, ' '),
              'El asistente consultó',
              `<pre class="text-[10px] text-gray-500 font-mono leading-relaxed overflow-x-auto">${escapar(JSON.stringify(d, null, 1).slice(0, 800))}</pre>`,
            ),
          );
        }
      }
    },

    /**
     * Una acción que el agente ejecutó de verdad, releída de `Log_Agente__c` por el
     * servidor. Es la fuente buena: la Agent API entrega `message.result` vacío, así
     * que `desdeEvento` —que se conserva por si algún día lo llena— nunca pintó nada.
     */
    actividad(a) {
      if (!a || vistos.has(a.folio)) return;
      vistos.add(a.folio);

      const fallo = a.resultado && a.resultado !== 'SUCCESS';
      const d = a.detalle;

      if (d?.clase === 'orden') {
        agregar(
          tarjeta(
            'Tu cita quedó agendada',
            'Taller',
            filas([
              ['Folio', d.folio, true],
              ['Unidad', d.vin, true],
              ['Taller', d.sucursal, true],
              ['Inicio', d.inicio ? fecha(d.inicio) : null],
              ['Estado', d.estado],
            ]),
            'ok',
          ),
        );
        return;
      }
      if (d?.clase === 'varada') {
        agregar(
          tarjeta(
            'Reporte de unidad varada',
            'Carretera',
            filas([
              ['Folio', d.folio, true],
              ['Carretera', d.carretera],
              ['Kilómetro', d.kilometro === null ? null : numero(d.kilometro)],
              ['Prioridad', d.prioridad],
            ]),
            'alerta',
          ),
        );
        return;
      }
      if (d?.clase === 'caso') {
        agregar(
          tarjeta(
            'Un asesor tiene tu caso',
            'Escalamiento',
            filas([
              ['Folio', d.folio, true],
              ['Estado', d.estado],
              ['Asunto', d.asunto],
            ]),
            'ok',
          ),
        );
        return;
      }

      // Acción sin registro relacionado —consultar disponibilidad, buscar en la base
      // de conocimiento—. Se enseña igual: que el agente consultó algo es información,
      // y ocultarlo haría parecer que no hizo nada.
      agregar(
        tarjeta(
          (a.accion ?? 'Acción del asistente').replace(/_/g, ' '),
          fallo ? 'No se pudo completar' : 'El asistente ejecutó',
          filas([
            ['Subagente', a.subagente],
            ['Resultado', a.resultado],
            ['Traza', a.folio, true],
          ]),
          fallo ? 'alerta' : 'neutro',
        ),
      );
    },

    /**
     * El número de serie que escribió el cliente no está registrado.
     *
     * Se avisa aquí porque el asistente no lo hace: ante un VIN inexistente contesta
     * con la póliza general en vez de decir que no encontró esa unidad, y quien se
     * equivocó de dígito puede leerlo como si fuera la cobertura de su camión.
     */
    sinUnidad(vin) {
      const llave = `sin-unidad:${vin}`;
      if (vistos.has(llave)) return;
      vistos.add(llave);
      agregar(
        tarjeta(
          'No encontramos esa unidad',
          'Garantía',
          `${filas([['Número de serie', vin, true]])}
           <p class="text-amber-300 text-xs font-light leading-relaxed mt-4 border-l-2 border-amber-400 pl-3">
             Ese número de serie no aparece en el padrón de Zapata, así que lo que leas
             sobre garantía es la póliza general y no la cobertura de tu unidad.
             Revísalo o pide que te pasemos con un asesor.
           </p>`,
          'alerta',
        ),
      );
    },

    /** Cobertura consultada por la propia app cuando el cliente da un número de serie. */
    cobertura(c) {
      // Un mismo VIN mencionado varias veces apilaba tarjetas idénticas. Sólo se
      // pinta la primera vez por unidad.
      const llave = `cobertura:${c?.unidad?.SerialNumber ?? c?.unidad?.Id ?? 'sin-unidad'}`;
      if (vistos.has(llave)) return;
      vistos.add(llave);
      agregar(pintarCobertura(c));
    },

    aviso(titulo, texto, tono = 'neutro') {
      agregar(tarjeta(titulo, 'Asistente', `<p class="text-gray-300 text-xs font-light leading-relaxed">${escapar(texto)}</p>`, tono));
    },

    limpiar() {
      contenedor.innerHTML = VACIO;
      vacio = true;
      vistos.clear();
    },
  };
}
