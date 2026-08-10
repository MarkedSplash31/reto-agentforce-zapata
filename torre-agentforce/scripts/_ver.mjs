/**
 * Abre una página del sitio público en Chromium headless y reporta lo que un
 * cliente vería de verdad: los errores de JavaScript que rompen la pantalla y
 * el texto que quedó en <main>.
 *
 * No maquilla nada: si el módulo de la página revienta, aquí sale.
 *
 * Uso:  node scripts/_ver.mjs taller [--base http://localhost:3010]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const pagina = args.find((a) => !a.startsWith('--')) ?? 'index';
const iBase = args.indexOf('--base');
const base = (iBase !== -1 ? args[iBase + 1] : process.env.BASE_URL) ?? 'http://localhost:3000';

const ruta = /\.html$/.test(pagina) || pagina === '/' ? pagina : `${pagina}.html`;
const url = new URL(ruta.replace(/^\//, ''), `${base.replace(/\/+$/, '')}/`).href;

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
const pag = await contexto.newPage();

const erroresJS = [];
const erroresConsola = [];
const fallosRed = [];

pag.on('pageerror', (e) => erroresJS.push(String(e?.stack || e).slice(0, 600)));
pag.on('console', (m) => {
  if (m.type() === 'error') erroresConsola.push(m.text().slice(0, 300));
});
pag.on('requestfailed', (r) => fallosRed.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
pag.on('response', (r) => {
  if (r.status() >= 400) fallosRed.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
});

console.log(`\n═══ ${url} ═══`);
await pag.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
await pag.waitForTimeout(1_500);

const texto = await pag.evaluate(() => document.querySelector('main')?.innerText ?? '(sin <main>)');

console.log(`\n── errores de JavaScript: ${erroresJS.length}`);
for (const e of erroresJS) console.log(`   ${e}`);
console.log(`\n── errores de consola: ${erroresConsola.length}`);
for (const e of erroresConsola) console.log(`   ${e}`);
console.log(`\n── peticiones fallidas: ${fallosRed.length}`);
for (const e of fallosRed) console.log(`   ${e}`);

console.log(`\n── texto de <main> ──────────────────────────────────────────`);
console.log(texto);

await navegador.close();
process.exit(erroresJS.length === 0 ? 0 : 1);
