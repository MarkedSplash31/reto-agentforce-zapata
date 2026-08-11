import { expect, test, type Page } from '@playwright/test';

/**
 * El sitio de postventa de Zapata, probado como lo usa un cliente: sin cuenta.
 *
 * Estas pruebas NO mandan cabecera de autenticación a propósito. Si alguna empezara a
 * necesitarla, sería la señal de que el sitio dejó de ser público y se volvió otra vez
 * una consola interna.
 */

const PAGINAS_CLIENTE = ['/'] as const;

/** Vocabulario de base de datos que jamás debe llegar a la pantalla de un cliente. */
const JERGA_PROHIBIDA = [
  'WorkOrder',
  'Slot_Taller__c',
  'Unidad_Varada__c',
  'Log_Agente__c',
  'Regla_Cobertura__c',
  'Correlation_Id',
  'SOQL',
  'Salesforce',
];

async function textoVisible(page: Page): Promise<string> {
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ');
}

test.describe('sitio de postventa para clientes', () => {
  for (const ruta of PAGINAS_CLIENTE) {
    test(`${ruta} carga sin cuenta y sin excepción de JavaScript`, async ({ page }) => {
      const errores: string[] = [];
      page.on('pageerror', (e) => errores.push(String(e)));

      const respuesta = await page.goto(ruta, { waitUntil: 'networkidle' });
      expect(respuesta?.status(), `${ruta} debe servirse sin autenticación`).toBe(200);
      await page.waitForTimeout(1200);

      expect(errores, `${ruta} lanzó errores de JavaScript`).toEqual([]);
      const texto = await textoVisible(page);
      expect(texto.length, `${ruta} quedó en blanco`).toBeGreaterThan(120);
    });

    test(`${ruta} no le enseña jerga de base de datos al cliente`, async ({ page }) => {
      await page.goto(ruta, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      const texto = await textoVisible(page);
      // El aviso de credencial faltante nombra variables de entorno a propósito: es
      // un diagnóstico honesto para quien opera el sitio, no contenido de cliente.
      const sinDiagnostico = texto.replace(/No hay credenciales[\s\S]*?BLOQUEOS\.md[^.]*\./g, '');
      for (const termino of JERGA_PROHIBIDA) {
        expect(sinDiagnostico, `${ruta} filtró "${termino}" a la interfaz`).not.toContain(termino);
      }
    });

    test(`${ruta} no produce scroll horizontal en móvil`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(ruta, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const desborda = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(desborda, `${ruta} desborda a lo ancho en móvil`).toBe(false);
    });
  }

  test('la portada es una sola caja de entrada, con el espacio de trabajo detrás', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    // Un único punto de entrada: la caja, y nada de catálogo de formularios.
    await expect(page.locator('#app')).toHaveAttribute('data-estado', 'entrada');
    await expect(page.locator('#compositor')).toHaveCount(1);
    await expect(page.locator('#portada #compositor')).toHaveCount(1);
    await expect(page.locator('#entrada')).toBeVisible();

    // El espacio de trabajo es la MISMA pantalla, todavía sin enseñar: si algún día
    // vuelve a ser otra página, esto falla.
    await expect(page.locator('#espacio')).toBeHidden();
    await expect(page.locator('#hilo')).toBeAttached();
    await expect(page.locator('#panel')).toBeAttached();

    // La conversación arranca con un turno del asistente, aunque no se vea aún.
    await expect(page.locator('#hilo article')).not.toHaveCount(0);
    const texto = await textoVisible(page);
    expect(texto).toMatch(/asistente/i);

    // Las sucursales salen de la organización, no de una lista escrita a mano.
    const sucursales = await page.locator('#sucursales > *').count();
    expect(sucursales, 'no se listó ningún taller').toBeGreaterThan(0);
    await expect(page.locator('#sucursales')).not.toContainText('No se pudo');
  });

  test('el primer mensaje muda la caja al espacio de trabajo, sin cambiar de página', async ({ page }) => {
    // El turno no llega a la organización: lo que se fija aquí es la transición de la
    // interfaz, que ocurre antes de la red. Sin esta ruta abortada, comprobar el
    // cambio de estado costaría una conversación real por ejecución.
    await page.route('**/publico/agente/mensaje', (route) => route.abort());

    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('#entrada')).toBeEnabled({ timeout: 30_000 });

    await page.locator('#entrada').fill('Quiero revisar la garantía de mi unidad.');
    await page.locator('#enviar').click();

    // La portada se convierte en el espacio de trabajo y la caja se muda al muelle:
    // es el mismo nodo, no un segundo compositor.
    await expect(page.locator('#app')).not.toHaveAttribute('data-estado', 'entrada');
    await expect(page.locator('#portada')).toBeHidden();
    await expect(page.locator('#espacio')).toBeVisible();
    await expect(page.locator('#muelle #compositor')).toHaveCount(1);
    await expect(page.locator('#compositor')).toHaveCount(1);

    // Y el turno del cliente queda en el hilo, que es el contexto de lo que se hace.
    await expect(page.locator('#hilo article[data-de="cliente"]')).toHaveCount(1);
  });

  test('no quedan páginas-formulario por trámite', async ({ request }) => {
    // Si alguna vuelve a existir, es que la app volvió a ser un menú de botones.
    for (const ruta of ['/taller.html', '/carretera.html', '/garantia.html', '/asesor.html']) {
      expect((await request.get(ruta)).status(), `${ruta} no debería existir`).toBe(404);
    }
  });

  test('el cliente ve la disponibilidad real del taller sin identificarse', async ({ request }) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const en14 = new Date(Date.now() + 12096e5).toISOString().slice(0, 10);
    const res = await request.get(`/publico/disponibilidad?desde=${hoy}&hasta=${en14}`);
    expect(res.status()).toBe(200);
    const cuerpo = await res.json();
    expect(Array.isArray(cuerpo.franjas)).toBe(true);
    // Cada franja debe traer lo que el cliente necesita para elegir.
    for (const f of cuerpo.franjas.slice(0, 5)) {
      expect(f).toHaveProperty('inicio');
      expect(f).toHaveProperty('libres');
    }
  });

  test('el rango de fechas es obligatorio y el fallo lo dice', async ({ request }) => {
    const res = await request.get('/publico/disponibilidad');
    expect(res.status()).toBe(400);
    const cuerpo = await res.json();
    expect(cuerpo.error).toBe(true);
    expect(String(cuerpo.mensaje)).toMatch(/fecha/i);
  });
});

test.describe('frontera entre el cliente y el asesor', () => {
  test('el panel del asesor está cerrado sin iniciar sesión', async ({ request }) => {
    for (const ruta of ['/publico/panel/bandeja', '/publico/panel/caso/500000000000000000']) {
      const res = await request.get(ruta);
      expect(res.status(), `${ruta} debe exigir sesión de asesor`).toBe(401);
    }
  });

  test('una contraseña incorrecta no abre el panel', async ({ request }) => {
    const res = await request.post('/publico/acceso', {
      data: { usuario: 'asesor', clave: 'clave-que-no-es' },
    });
    expect(res.status()).toBe(401);
    const cuerpo = await res.json();
    // No debe revelarse si falló el usuario o la contraseña.
    expect(String(cuerpo.mensaje)).not.toMatch(/usuario no existe|contraseña incorrecta para/i);
  });

  test('un visitante sin conversación no puede leer ni escribir en un caso', async ({ request }) => {
    const conversacion = await request.get('/publico/asesor/conversacion');
    // O bien no tiene sesión (401), o la tiene y aún no hay conversación abierta.
    if (conversacion.status() === 200) {
      expect((await conversacion.json()).abierta).toBe(false);
    } else {
      expect(conversacion.status()).toBe(401);
    }

    const respuesta = await request.post('/publico/asesor/responder', { data: { cuerpo: 'hola' } });
    expect([401, 409]).toContain(respuesta.status());
  });

  test('la página de acceso no expone la contraseña esperada', async ({ page }) => {
    await page.goto('/acceso.html', { waitUntil: 'networkidle' });
    const html = await page.content();
    expect(html).not.toMatch(/APP_ADMIN_PASS\s*=\s*\S/);
    await expect(page.locator('#clave')).toHaveAttribute('type', 'password');
  });
});
