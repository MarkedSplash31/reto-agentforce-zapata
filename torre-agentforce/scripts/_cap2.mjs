import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('output/capturas-app', { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport:{width:1440,height:1000} });
const p = await ctx.newPage();
await p.goto('http://localhost:3000/', { waitUntil:'networkidle' });
await p.waitForTimeout(2500);
await p.screenshot({ path:'output/capturas-app/conversacion.png', fullPage:true });
// El cliente escribe: sin credenciales del agente, pasa directo a una persona.
await p.fill('#entrada','Mi Cascadia pierde potencia en subida y ya revise el filtro');
await p.click('#enviar');
await p.waitForTimeout(6000);
await p.screenshot({ path:'output/capturas-app/escalado.png', fullPage:true });
console.log('capturas listas');
await b.close();
