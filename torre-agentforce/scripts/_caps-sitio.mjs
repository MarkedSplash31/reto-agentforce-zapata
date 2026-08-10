import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const OUT = 'output/capturas-sitio';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();

for (const n of ['index','taller','carretera','garantia','asesor','acceso']) {
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3000/${n}.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(2200);
  await p.screenshot({ path:`${OUT}/${n}.png`, fullPage:true });
  console.log('  ' + n);
  await ctx.close();
}

// El panel exige sesión: se entra de verdad, como lo haría el asesor.
const ctx = await b.newContext({ viewport:{width:1440,height:900} });
const p = await ctx.newPage();
await p.goto('http://localhost:3000/acceso.html', { waitUntil:'networkidle' });
await p.fill('#usuario','asesor');
await p.fill('#clave', process.env.APP_ADMIN_PASS ?? '');
await Promise.all([p.waitForURL('**/panel.html',{timeout:15000}).catch(()=>{}), p.click('#entrar')]);
await p.waitForTimeout(2500);
// Abre la primera conversación para que se vea el chat del asesor.
const primera = p.locator('#bandeja button[data-caso]').first();
if (await primera.count()) { await primera.click(); await p.waitForTimeout(2500); }
await p.screenshot({ path:`${OUT}/panel.png`, fullPage:true });
console.log('  panel');
await b.close();
