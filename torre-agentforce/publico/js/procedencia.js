/* ══════════════════════════════════════════════════════════════════════════
   La procedencia de una respuesta, separada de la respuesta.

   El agente antepone a sus respuestas de conocimiento tres renglones: qué material
   consultó, la versión de esa fuente y una advertencia de procedencia. Los recita
   al cliente palabra por palabra, y la advertencia está escrita PARA EL MODELO
   —«no debe presentarse como oficial», «verifica la política vigente con una fuente
   operacional antes de tomar una decisión»—. El cliente acaba leyendo una
   instrucción interna antes de su respuesta, que queda enterrada debajo.

   Esto no adivina prosa: las etiquetas son los `@InvocableVariable` de
   `BuscarConocimientoPostventa`, un contrato nuestro.

   Dos garantías que las pruebas fijan:
     · nunca se pierde texto del agente — si quitar el preámbulo dejaría la
       respuesta vacía, no se quita;
     · la procedencia nunca se descarta: sale del cuerpo para enseñarse marcada.
   ══════════════════════════════════════════════════════════════════════════ */

const ETIQUETAS_FUENTE =
  /^(Material consultado|T[ií]tulos consultados|Estado de la fuente|Advertencia de procedencia|Fuente)\s*:\s*(.*)$/i;

/**
 * @param {string} texto respuesta completa del agente
 * @returns {{ cuerpo: string, marcas: Array<{etiqueta: string, valor: string}> }}
 */
export function separarProcedencia(texto) {
  const lineas = String(texto ?? '').split('\n');
  const marcas = [];
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i].trim();
    if (!linea) {
      i++;
      continue;
    }
    const m = ETIQUETAS_FUENTE.exec(linea);
    if (!m) break;
    marcas.push({ etiqueta: m[1], valor: m[2].trim() });
    i++;
    // La advertencia sigue en las líneas siguientes hasta el primer renglón vacío.
    if (/Advertencia/i.test(m[1])) {
      while (i < lineas.length && lineas[i].trim()) {
        marcas[marcas.length - 1].valor += ` ${lineas[i].trim()}`;
        i++;
      }
    }
  }

  const cuerpo = lineas.slice(i).join('\n').trim();
  if (!marcas.length || !cuerpo) return { cuerpo: String(texto ?? ''), marcas: [] };
  return { cuerpo, marcas };
}
