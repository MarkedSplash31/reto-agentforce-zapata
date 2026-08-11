/**
 * Auditor del sistema de diseño Zapata.
 *
 * COPIA VENDORIZADA. El original vive en la skill `zapata-design`, en el espacio de
 * trabajo de quien la escribió, fuera de este repositorio. Mientras estuvo sólo allí,
 * `npm run verificar:diseno` funcionaba en una máquina y en ninguna otra: quien
 * clonara el repositorio se llevaba un ENOENT crudo apuntando a una ruta que en su
 * disco no existe. Un repositorio tiene que poder auditarse solo.
 *
 * Si hay que cambiar una regla, cámbiala en la skill y vuelve a copiar el archivo, o
 * apunta `ZAPATA_DESIGN_AUDITOR` a la copia canónica y ejecuta con ella.
 *
 * `verificar-clon.mjs` compara contra un original. Este no lo necesita: audita
 * una página contra las diez reglas duras de la skill. Es la única forma de
 * validar una página NUEVA — una que no existe en zapata.com.mx y que por tanto
 * no tiene contra qué difar.
 *
 * Clonar y generar son capacidades distintas. Esta es la de generar.
 *
 * Uso:  node auditar-sistema.mjs <url> [url2 …]
 * Sale con código 0 sólo si no hay ninguna violación.
 */
import { chromium } from 'playwright';

const URLS = process.argv.slice(2);
if (!URLS.length) { console.error('uso: node auditar-sistema.mjs <url> [url2 …]'); process.exit(1); }

const AUDITORIA = () => {
  const cs = el => getComputedStyle(el);
  const TERCEROS = '.grecaptcha-badge,[class*="grecaptcha"],.gm-style,[class^="gm-"],iframe';
  // head, script, style y title no renderizan: auditarlos da falsos positivos.
  const NO_RENDER = new Set(['HTML','HEAD','TITLE','META','LINK','SCRIPT','STYLE','NOSCRIPT','BASE','TEMPLATE']);
  const propio = el => !NO_RENDER.has(el.tagName) && !el.closest?.(TERCEROS);
  const todos = [...document.querySelectorAll('*')].filter(propio);

  // Parte una lista CSS por comas de nivel superior. `cubic-bezier(0.4, 0, 0.2, 1)`
  // lleva comas dentro de los paréntesis: partir a ciegas la trocea y produce
  // basura como "0.2" o "1)". Este fue el bug que el sitio real destapó.
  const partirCSS = (s) => {
    const out = []; let prof = 0, act = '';
    for (const ch of s) {
      if (ch === '(') prof++;
      else if (ch === ')') prof--;
      if (ch === ',' && prof === 0) { out.push(act.trim()); act = ''; }
      else act += ch;
    }
    if (act.trim()) out.push(act.trim());
    return out;
  };
  const desc = el => `${el.tagName.toLowerCase()}${el.id ? '#'+el.id : ''}.${el.className.toString().trim().split(/\s+/).slice(0,3).join('.')}`.slice(0, 70);
  const v = [];   // violaciones
  const push = (regla, detalle, nodo) => v.push({ regla, detalle, nodo: nodo ? desc(nodo) : '' });

  // ── R1 · border-radius: 0 en todo, salvo rounded-full en puntos y avatares
  todos.forEach(el => {
    const b = cs(el).borderRadius;
    if (!b || b === '0px' || b === '9999px' || b === '50%') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    push('R1 radius', `border-radius: ${b} — el sistema es esquina viva`, el);
  });

  // ── R2 · box-shadow sólo en capas flotantes
  // "Flotante" incluye al panel interior de un modal: es position:relative pero
  // vive dentro de un contenedor fixed. Hay que mirar la cadena de ancestros,
  // no sólo el propio elemento — esto lo destapó el modal de /accesorios.
  const enCapaFlotante = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = cs(n);
      if (s.position === 'fixed' && parseInt(s.zIndex || 0) >= 20) return true;
      if (s.position === 'absolute' && parseInt(s.zIndex || 0) >= 20) return true;
    }
    return false;
  };
  todos.forEach(el => {
    const s = cs(el);
    if (s.boxShadow === 'none') return;
    if (!enCapaFlotante(el))
      push('R2 sombra', `box-shadow en elemento en flujo (${s.position}, z:${s.zIndex})`, el);
  });

  // ── R3 · Cinzel para títulos, Inter para el resto. Ninguna otra familia.
  const FAM_OK = /^(Cinzel|Inter|ui-monospace|SFMono|Menlo|monospace|"?Font ?Awesome)/i;
  const familias = new Set();
  todos.forEach(el => {
    if (!el.textContent?.trim() || el.children.length) return;
    const f = cs(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    familias.add(f);
    if (!FAM_OK.test(f)) push('R3 familia', `font-family: ${f} — sólo Cinzel e Inter`, el);
  });
  todos.filter(el => /^H[123]$/.test(el.tagName)).forEach(el => {
    const f = cs(el).fontFamily.split(',')[0].replace(/["']/g,'').trim();
    if (!/Cinzel/i.test(f)) push('R3 título', `${el.tagName} en ${f} — los títulos son Cinzel`, el);
    const w = cs(el).fontWeight;
    if (!['300','400'].includes(w)) push('R3 peso', `${el.tagName} en peso ${w} — Cinzel va 300 o 400, nunca 600/700`, el);
  });

  // ── R4 · 12px es el texto de interfaz. Avisa de 13-15px, que no existen en el sistema.
  const tamanos = {};
  todos.forEach(el => {
    if (!el.textContent?.trim() || el.children.length) return;
    const px = parseFloat(cs(el).fontSize);
    tamanos[px] = (tamanos[px] || 0) + 1;
    if (px > 12 && px < 16 && px !== 14) push('R4 escala', `font-size: ${px}px — la escala usa 10/11/12/14/16, no valores intermedios`, el);
  });

  // ── R5 · el ámbar nunca es el relleno del CTA principal
  //
  // Lo prohibido es el ámbar SÓLIDO como fondo de un control grande con texto.
  // Un tinte (bg-amber-400/5) es tratamiento de superficie y sí es del sistema:
  // el botón de directorio del sitio real lo usa. Distinguir por alfa, no por
  // la mera presencia del color.
  const alfaDe = (rgb) => {
    const m = rgb.match(/rgba?\(([^)]+)\)/); if (!m) return 1;
    const p = m[1].split(',').map(x => parseFloat(x));
    return p.length > 3 ? p[3] : 1;
  };
  todos.forEach(el => {
    const s = cs(el);
    if (!/251, 191, 36/.test(s.backgroundColor)) return;
    if (alfaDe(s.backgroundColor) <= 0.5) return;          // tinte, no relleno
    const r = el.getBoundingClientRect();
    if (r.width > 90 && r.height > 32 && el.textContent?.trim())
      push('R5 ámbar', `relleno ámbar sólido en control de ${Math.round(r.width)}×${Math.round(r.height)}px con texto — el CTA principal es blanco`, el);
  });

  // ── R6 · las tarjetas invierten el fondo respecto a su sección
  const CANVAS = 'rgb(11, 12, 16)', SURFACE = 'rgb(13, 14, 18)';
  document.querySelectorAll('section, main > div').forEach(sec => {
    const bgSec = cs(sec).backgroundColor;
    if (bgSec !== CANVAS && bgSec !== SURFACE) return;
    const esperado = bgSec === CANVAS ? SURFACE : CANVAS;
    sec.querySelectorAll(':scope .grid > div').forEach(card => {
      const bgCard = cs(card).backgroundColor;
      if (bgCard !== CANVAS && bgCard !== SURFACE) return;
      if (bgCard !== esperado)
        push('R6 inversión', `tarjeta en ${bgCard} dentro de sección en ${bgSec} — deben invertirse`, card);
    });
  });

  // ── R7 · un solo easing
  const OK_EASING = new Set(['cubic-bezier(0.4, 0, 0.2, 1)', 'cubic-bezier(0.4, 0, 0.6, 1)']); // el 2º es animate-pulse
  const easings = {};
  todos.forEach(el => {
    const s = cs(el);
    const dur = partirCSS(s.transitionDuration || '');
    partirCSS(s.transitionTimingFunction || '').forEach((e, i) => {
      if (!e || e === 'ease') return;
      // una transición con duración 0s no se percibe: su easing es irrelevante
      const d = dur[i] ?? dur[0] ?? '0s';
      if (parseFloat(d) === 0) return;
      easings[e] = (easings[e] || 0) + 1;
      if (!OK_EASING.has(e))
        push('R7 easing', `timing-function: ${e} — el sistema usa cubic-bezier(0.4, 0, 0.2, 1)`, el);
    });
  });

  // ── R9 · el uppercase en Inter lleva tracking
  //
  // Sólo aplica a Inter: los títulos Cinzel usan tracking-wide (0.025em), que a
  // 18px da 0.45px — proporcionalmente correcto aunque el absoluto sea bajo.
  // Y se exige un mínimo de 4 caracteres: las celdas de calendario y los números
  // sueltos no tienen entre-letras que separar.
  todos.forEach(el => {
    const s = cs(el);
    if (s.textTransform !== 'uppercase' || el.children.length) return;
    const txt = el.textContent?.trim() || '';
    if (txt.length < 4) return;
    if (/Cinzel/i.test(s.fontFamily)) return;
    const ls = s.letterSpacing;
    const px = parseFloat(s.fontSize);
    // el sistema usa 0.1em en uppercase; se admite desde 0.05em
    if (ls === 'normal' || parseFloat(ls) < px * 0.05)
      push('R9 tracking', `uppercase sin tracking (${ls} a ${px}px) — sin él Inter se lee como dashboard`, el);
  });

  // ── R10 · contenedor a 1280 con padding 24
  const conts = [...document.querySelectorAll('.max-w-7xl')].filter(propio);
  conts.forEach(c => {
    const s = cs(c);
    if (s.maxWidth !== '1280px') push('R10 contenedor', `max-width: ${s.maxWidth} — el contenedor del sistema es 1280px`, c);
    if (s.paddingLeft !== '24px') push('R10 contenedor', `padding-left: ${s.paddingLeft} — debe ser 24px`, c);
  });

  // ── inventario informativo
  const ambar = todos.filter(el => [cs(el).color, cs(el).backgroundColor, cs(el).borderTopColor]
    .some(x => /251, 191, 36/.test(x)));
  return {
    violaciones: v,
    info: {
      nodos: todos.length,
      familias: [...familias],
      tamanos: Object.entries(tamanos).sort((a,b) => b[1]-a[1]).slice(0,8).map(([k,n]) => `${k}px×${n}`),
      easings: Object.keys(easings),
      ambar: ambar.length,
      contenedores: conts.length,
      alto: document.documentElement.scrollHeight,
    }
  };
};

const b = await chromium.launch();
let totalViol = 0;

for (const url of URLS) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errsJS = [];
  p.on('pageerror', e => errsJS.push(String(e).slice(0, 160)));
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await p.evaluate(async () => { await document.fonts.ready; });
  await p.waitForTimeout(900);
  const r = await p.evaluate(AUDITORIA);

  console.log(`\n${'═'.repeat(72)}\n  ${url}\n${'═'.repeat(72)}`);
  console.log(`  nodos ${r.info.nodos} · alto ${r.info.alto}px · contenedores ${r.info.contenedores} · ámbar ${r.info.ambar}`);
  console.log(`  familias: ${r.info.familias.join(', ')}`);
  console.log(`  tamaños:  ${r.info.tamanos.join('  ')}`);
  console.log(`  easings:  ${r.info.easings.join(' | ') || '(ninguno)'}`);
  if (errsJS.length) console.log(`  errores JS: ${errsJS.length} — ${errsJS[0]}`);

  // agrupar por regla
  const porRegla = {};
  r.violaciones.forEach(x => (porRegla[x.regla] ||= []).push(x));
  const n = r.violaciones.length;
  totalViol += n;

  if (!n) { console.log(`\n  ✓ SIN VIOLACIONES — cumple las diez reglas del sistema`); }
  else {
    console.log(`\n  ${n} VIOLACIONES:`);
    Object.entries(porRegla).forEach(([regla, lista]) => {
      console.log(`\n  ── ${regla} (${lista.length})`);
      lista.slice(0, 6).forEach(x => console.log(`     ${x.detalle}\n       en ${x.nodo}`));
      if (lista.length > 6) console.log(`     … y ${lista.length - 6} más`);
    });
  }
  await ctx.close();
}

await b.close();
console.log(`\n${'═'.repeat(72)}`);
console.log(`  TOTAL: ${totalViol} violaciones en ${URLS.length} página(s)`);
process.exit(totalViol === 0 ? 0 : 1);
