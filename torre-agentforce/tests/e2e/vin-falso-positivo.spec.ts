import { expect, test } from '@playwright/test';

/**
 * Que preguntar por una sucursal no se confunda con dictar un número de serie.
 *
 * Encontrado el 11-ago-2026 hablando con la org real: a «¿Qué horarios tiene disponibles
 * el taller de Guadalajara esta semana?» el agente contestaba «el número de serie que
 * mencionas para Guadalajara no corresponde a ninguna unidad registrada» y se negaba a
 * consultar horarios. La app antepone al turno lo que la org dice del número de serie que
 * el cliente mencionó, y su patrón —11 a 17 alfanuméricos sin I, O ni Q— acepta
 * «Guadalajara»: once letras y ninguna de las tres excluidas. Es una de las nueve
 * sucursales, así que el falso positivo caía en la pregunta más común del cliente.
 *
 * `vin-mencionado.test.ts` fija la regla en la unidad; esto la fija de extremo a extremo,
 * que es donde apareció. Se comprueba contra la org real, así que sólo se afirma lo que no
 * puede pasar: que el turno arranque negando una unidad que el cliente nunca dictó.
 */

const NIEGA_LA_UNIDAD = /no corresponde a ninguna unidad|no aparece en el padr[oó]n/i;

async function respuestaDelAgente(request: import('@playwright/test').APIRequestContext, texto: string) {
  const sesion = await request.post('/publico/sesion', { data: {} });
  expect(sesion.status(), 'el sitio de clientes abre sesión sin cuenta').toBe(200);

  const turno = await request.post('/publico/agente/mensaje', { data: { texto } });
  expect(turno.status()).toBe(200);
  const sse = await turno.text();

  return sse
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as { tipo?: string; texto?: string })
    .filter((e) => e.tipo === 'TextChunk')
    .map((e) => e.texto ?? '')
    .join('');
}

test.describe('el nombre de una sucursal no es un número de serie', () => {
  test('preguntar por el taller de Guadalajara no niega una unidad inexistente', async ({ request }) => {
    const texto = await respuestaDelAgente(request, '¿Qué horarios tiene el taller de Guadalajara?');

    expect(texto.length, 'el agente debe contestar algo').toBeGreaterThan(0);
    expect(texto, 'el cliente no dictó ninguna unidad: no se le puede negar una').not.toMatch(
      NIEGA_LA_UNIDAD,
    );
  });

  test('dictar un número de serie inexistente sí lo dice, y una sola vez', async ({ request }) => {
    const texto = await respuestaDelAgente(
      request,
      '¿Qué cubre la garantía de mi unidad 9ZZZZZZZZZZ999999?',
    );

    const veces = (texto.match(/no aparece en el padr[oó]n/gi) ?? []).length;
    expect(veces, 'debe avisarse exactamente una vez, sin duplicar el aviso').toBe(1);
  });
});
