import { chromium } from '@playwright/test';
const PAGS = ['index','taller','carretera','garantia','asesor','acceso'];
const b = await chromium.launch();
let malas = 0;
for (const n of PAGS) {
  const ctx = await b.newContext({ viewport:{width:1440,height:900} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0,140)));
  const r = await p.goto(`http://localhost:3000/${n}.html`, { waitUntil:'networkidle' });
  await p.waitForTimeout(2000);
  const alertas = await p.locator('[role="alert"]').allTextContents();
  const visibles = alertas.map(a=>a.replace(/\s+/g,' ').trim()).filter(Boolean);
  const alto = await p.evaluate(()=>document.body.scrollHeight);
  if (errs.length) malas++;
  console.log(`${n.padEnd(10)} http=${r.status()} alto=${String(alto).padStart(5)} jsErr=${errs.length} alertas=${visibles.length}`);
  errs.forEach(e=>console.log('    ERROR '+e));
  visibles.forEach(a=>console.log('    aviso: '+a.slice(0,88)));
  await ctx.close();
}
await b.close();
console.log(malas===0 ? '\nSIN ERRORES DE JAVASCRIPT' : `\n${malas} paginas con error`);
