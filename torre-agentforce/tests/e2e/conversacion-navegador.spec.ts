// La conversación conducida desde un NAVEGADOR real sobre el sitio de clientes.
//
// Por qué existe además de `scripts/verificar-e2e.mjs`: aquel ejercita las rutas
// HTTP, que es el backend de la web app. Esto teclea en el widget de chat, espera las
// burbujas del agente y sólo entonces relee Salesforce. Cierra la única rendija que
// quedaba entre «las rutas funcionan» y «un cliente puede hacerlo desde el sitio».
//
// Opt-in porque escribe en la org y tarda: cada turno del agente son varios segundos.
//
//   CONFIRM_E2E_NAVEGADOR=1 npx playwright test tests/e2e/conversacion-navegador.spec.ts --project=api-and-ui

import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const HABILITADO = process.env.CONFIRM_E2E_NAVEGADOR === '1';
const ALIAS = process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
// Unidad con VIN Freightliner: es la que los talleres Zapata sí atienden.
const VIN = process.env.E2E_VIN ?? '1FUJGLDR9PL456781';

function soql(consulta: string): { totalSize: number; records: Record<string, unknown>[] } {
  const entorno = { ...process.env };
  delete entorno.SF_API_VERSION;
  delete entorno.SF_ORG_API_VERSION;
  // Playwright exporta FORCE_COLOR a sus workers y el CLI de Salesforce lo obedece:
  // mete secuencias ANSI DENTRO del JSON y lo vuelve imparseable. Fuera del runner el
  // mismo comando funciona, y por eso el fallo parecía cosa de la consulta.
  entorno.FORCE_COLOR = '0';
  entorno.NO_COLOR = '1';
  const salida = execFileSync(
    'sf',
    ['data', 'query', '-o', ALIAS, '--json', '--api-version', '67.0', '-q', `"${consulta}"`],
    { encoding: 'utf8', shell: true, env: entorno, maxBuffer: 8 * 1024 * 1024 },
  );
  // El CLI antepone avisos («update available…») al JSON y no siempre en su propia
  // línea. En vez de adivinar el formato del prefijo, se prueba a parsear desde cada
  // llave de apertura hasta que una funcione: es corto y no se rompe con el próximo
  // aviso que a Salesforce se le ocurra imprimir.
  // Los avisos aparecen antes Y DESPUÉS del JSON, así que no basta con cortar por el
  // principio: hay que acotar también el final en la última llave de cierre.
  const fin = salida.lastIndexOf('}') + 1;
  for (let i = salida.indexOf('{'); i !== -1 && i < fin; i = salida.indexOf('{', i + 1)) {
    try {
      return JSON.parse(salida.slice(i, fin)).result;
    } catch {
      // Esa llave no abría el objeto de la respuesta; se prueba la siguiente.
    }
  }
  throw new Error(`sf no devolvió JSON parseable:\n${salida.slice(0, 600)}`);
}

test.describe('conversación desde el navegador', () => {
  test.skip(!HABILITADO, 'define CONFIRM_E2E_NAVEGADOR=1: escribe en la organización');
  test.setTimeout(300_000);

  test('un cliente reporta una unidad varada tecleando en el sitio y queda el registro', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('#hilo')).toBeVisible();
    await expect(page.locator('#entrada')).toBeEnabled({ timeout: 30_000 });

    // El folio de la visita lo emite el servidor; es la llave que después se busca en
    // el CRM. Se lee del mismo endpoint que usa la página, con la cookie del navegador.
    const folio = await page.evaluate(async () => {
      const r = await fetch('/publico/sesion', { credentials: 'same-origin' });
      return (await r.json()).correlationId as string;
    });
    expect(folio, 'la visita no recibió folio').toBeTruthy();

    /** Teclea un turno y espera a que el agente termine de contestar. */
    const decir = async (texto: string) => {
      const burbujasAntes = await page.locator('#hilo > *').count();
      await page.locator('#entrada').fill(texto);
      await page.locator('#enviar').click();
      // El widget bloquea la entrada mientras el agente responde y la reabre al final:
      // esperar a que vuelva a estar habilitada es esperar al turno completo, sin
      // adivinar tiempos.
      await expect(page.locator('#entrada')).toBeDisabled({ timeout: 20_000 });
      await expect(page.locator('#entrada')).toBeEnabled({ timeout: 180_000 });
      await expect
        .poll(async () => page.locator('#hilo > *').count(), { timeout: 30_000 })
        .toBeGreaterThan(burbujasAntes);
      return (await page.locator('#hilo').innerText()).trim();
    };

    const GUION = [
      'Mi unidad se quedó parada en la carretera México-Querétaro, en el kilómetro 120.',
      'Sí, está fuera del carril de circulación y con las intermitentes encendidas.',
      `El VIN es ${VIN}. Perdió potencia y prendió el testigo del motor.`,
      'Va cargada, sentido norte, cerca de la caseta de Palmillas.',
      'Sí, por favor levanta el reporte.',
      'Confirmo, adelante.',
    ];

    let hilo = '';
    for (const turno of GUION) {
      hilo = await decir(turno);
      if (/(qued[oó] registrad|levant[eé] el reporte).*\b(UV-|VAR-|\d{5,})/is.test(hilo)) break;
    }

    // El protocolo de seguridad tiene que haber ocurrido en pantalla, no sólo en el CRM.
    expect(hilo, 'el agente no verificó la seguridad del conductor en el hilo').toMatch(
      /carril|intermitentes/i,
    );

    // Y ahora lo único que cuenta: qué quedó en Salesforce bajo el folio de ESTA visita.
    // Si falla, el hilo completo va en el mensaje: sin él, «no quedó reporte» no dice
    // si el agente se negó, si pidió otro dato o si perdió la correlación.
    const r = soql(
      `SELECT Name, Carretera__c, Kilometro__c, Fuera_De_Carril__c, ` +
        `Intermitentes_Encendidas__c, Correlation_Id__c ` +
        `FROM Unidad_Varada__c WHERE Correlation_Id__c = '${folio.replace(/'/g, "\\'")}'`,
    );
    expect(
      r.totalSize,
      `no quedó reporte bajo el folio ${folio}. Hilo de la conversación:\n${hilo}`,
    ).toBeGreaterThan(0);

    const reporte = r.records[0] as Record<string, unknown>;
    expect(String(reporte.Carretera__c)).toMatch(/m[ée]xico.?quer[ée]taro/i);
    expect(Number(reporte.Kilometro__c)).toBe(120);
    expect(reporte.Fuera_De_Carril__c, 'se perdió la respuesta de seguridad').toBe(true);
    expect(reporte.Intermitentes_Encendidas__c, 'se perdió la respuesta de seguridad').toBe(true);
  });
});
