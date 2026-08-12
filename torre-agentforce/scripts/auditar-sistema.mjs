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
 * una página contra las once reglas duras de la skill. Es la única forma de
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

  // ── R10 · contenedor a 1280 con el gutter del sistema
  //
  // El gutter es 24px, y 16px por debajo de 640px — está declarado así en
  // `--z-gutter`. Exigir 24 a cualquier ancho hacía que la auditoría en móvil
  // reprobara una decisión deliberada del propio sistema.
  const gutter = window.innerWidth < 640 ? '16px' : '24px';
  const conts = [...document.querySelectorAll('.max-w-7xl')].filter(propio);
  conts.forEach(c => {
    const s = cs(c);
    if (s.maxWidth !== '1280px') push('R10 contenedor', `max-width: ${s.maxWidth} — el contenedor del sistema es 1280px`, c);
    if (s.paddingLeft !== gutter) push('R10 contenedor', `padding-left: ${s.paddingLeft} — a ${window.innerWidth}px el gutter del sistema es ${gutter}`, c);
  });

  // ── R11 · el texto se lee
  //
  // Las diez reglas anteriores miden si la página SE PARECE al sistema. Ninguna medía
  // si se puede leer, y en un lienzo casi negro esa es la falla fácil: `text-gray-600`
  // sobre `#0d0e12` da 2.9:1 y un placeholder en `text-gray-700` da 1.9:1 — el sistema
  // se respeta y el texto es invisible. WCAG AA pide 4.5:1, y 3:1 para texto grande
  // (24px, o 18.66px en negrita).
  //
  // Lo deshabilitado queda fuera a propósito: la propia norma lo exceptúa y un control
  // apagado DEBE verse apagado.
  const aRGBA = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  /** Compone `frente` sobre `fondo`, ambos opacos salvo el alfa de `frente`. */
  const sobre = (frente, fondo) => ({
    r: frente.r * frente.a + fondo.r * (1 - frente.a),
    g: frente.g * frente.a + fondo.g * (1 - frente.a),
    b: frente.b * frente.a + fondo.b * (1 - frente.a),
    a: 1,
  });
  const luminancia = ({ r, g, b }) => {
    const canal = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
  };
  const razon = (a, b) => {
    const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  /** El fondo real: se sube por los ancestros componiendo hasta encontrar opacidad. */
  const fondoDe = (el) => {
    let acumulado = null;
    for (let n = el; n; n = n.parentElement) {
      const c = aRGBA(cs(n).backgroundColor);
      if (!c || c.a === 0) continue;
      acumulado = acumulado ? sobre(acumulado, c) : c;
      if (acumulado.a >= 0.999) return acumulado;
    }
    // Nadie pintó nada opaco: el lienzo del sistema.
    return sobre(acumulado ?? { r: 0, g: 0, b: 0, a: 0 }, { r: 11, g: 12, b: 16, a: 1 });
  };
  /** La opacidad heredada multiplica el alfa del texto. */
  const opacidadDe = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= parseFloat(cs(n).opacity || '1');
    return o;
  };
  const apagado = (el) => !!el.closest?.('[disabled],[aria-disabled="true"],:disabled');

  const medirContraste = (el, color, etiqueta) => {
    const fg = aRGBA(color);
    if (!fg || fg.a === 0) return;
    const s = cs(el);
    const px = parseFloat(s.fontSize);
    const peso = parseInt(s.fontWeight, 10) || 400;
    const grande = px >= 24 || (px >= 18.66 && peso >= 700);
    const minimo = grande ? 3 : 4.5;
    const fondo = fondoDe(el);
    const texto = sobre({ ...fg, a: fg.a * opacidadDe(el) }, fondo);
    const r = razon(texto, fondo);
    if (r + 0.05 < minimo) {
      push(
        'R11 contraste',
        `${etiqueta} a ${r.toFixed(2)}:1 sobre su fondo (mínimo ${minimo}:1 a ${px}px) — se ve, pero no se lee`,
        el,
      );
    }
  };

  todos.forEach((el) => {
    if (apagado(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (cs(el).visibility === 'hidden') return;
    // Sólo hojas con texto propio: medir un contenedor mide el color que heredó.
    const propioTexto = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (propioTexto) medirContraste(el, cs(el).color, 'texto');
    // El placeholder es texto que el usuario tiene que leer para saber qué escribir.
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const c = getComputedStyle(el, '::placeholder').color;
      if (c) medirContraste(el, c, 'placeholder');
    }
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
  // `#viewport=375x812` audita la misma página en móvil. El sistema se diseñó y se
  // midió a 1440, y a ese ancho se auditaba siempre: las reglas de tamaño, tracking y
  // contraste nunca se habían comprobado en el ancho por el que entra la mitad de la
  // gente.
  const medida = /#.*\bviewport=(\d+)x(\d+)/.exec(url);
  const viewport = medida
    ? { width: Number(medida[1]), height: Number(medida[2]) }
    : { width: 1440, height: 900 };
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errsJS = [];
  p.on('pageerror', e => errsJS.push(String(e).slice(0, 160)));

  // Las páginas con sesión se auditaban SIN sesión: el navegador llegaba, recibía un
  // 401 y la propia página se redirigía al acceso. El auditor creía estar mirando el
  // panel del asesor y estaba midiendo la pantalla de entrada dos veces, de modo que
  // el panel —la única pantalla que nadie había auditado nunca— salía siempre limpio.
  // `AUDITORIA_ACCESO` ({"ruta":"…","cuerpo":{…},"paginas":["/panel.html"]}) inicia
  // sesión antes de navegar, y sólo en las páginas que la piden: con sesión abierta la
  // pantalla de acceso se redirige al panel, así que iniciarla en todas cambiaba una
  // vista sin auditar por otra.
  const acceso = process.env.AUDITORIA_ACCESO ? JSON.parse(process.env.AUDITORIA_ACCESO) : null;
  const necesitaSesion =
    acceso && (!acceso.paginas?.length || acceso.paginas.includes(new URL(url).pathname));
  if (necesitaSesion) {
    await p.goto(new URL('/', url).href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const ok = await p.evaluate(
      ([ruta, cuerpo]) =>
        fetch(ruta, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
        }).then(r => r.ok),
      [acceso.ruta, acceso.cuerpo],
    ).catch(() => false);
    if (!ok) console.log(`  (aviso: no se pudo iniciar sesión para auditar ${url})`);
  }

  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});

  // Una página que se audita sólo en reposo se audita a medias: las capacidades del
  // cliente —agenda, modelos, material— las pinta JavaScript con datos de la org y
  // nunca habían pasado por aquí. `#abrir=agenda,modelos` las despliega antes de medir.
  const abrir = /[#&]abrir=([^&]+)/.exec(new URL(url).hash)?.[1]?.split(',').filter(Boolean) ?? [];
  for (const clave of abrir) {
    // `:visible` no es cosmética: el mismo botón existe en la portada y en el espacio
    // de trabajo, y al abrir el primero la portada se retira. Sin filtrar, el segundo
    // clic iba al botón que acababa de ocultarse y expiraba.
    const boton = p.locator(`[data-abre="${clave}"]:visible`).first();
    await boton.click({ timeout: 10000 }).catch(() => console.log(`  (aviso: no se pudo abrir «${clave}»)`));
    await p.waitForSelector(`[data-componente="${clave}"]`, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(600);
  }

  await p.evaluate(async () => { await document.fonts.ready; });
  await p.waitForTimeout(900);
  const r = await p.evaluate(AUDITORIA);

  console.log(`\n${'═'.repeat(72)}\n  ${url}\n${'═'.repeat(72)}`);
  console.log(`  viewport ${viewport.width}×${viewport.height} · nodos ${r.info.nodos} · alto ${r.info.alto}px · contenedores ${r.info.contenedores} · ámbar ${r.info.ambar}`);
  console.log(`  familias: ${r.info.familias.join(', ')}`);
  console.log(`  tamaños:  ${r.info.tamanos.join('  ')}`);
  console.log(`  easings:  ${r.info.easings.join(' | ') || '(ninguno)'}`);
  if (errsJS.length) console.log(`  errores JS: ${errsJS.length} — ${errsJS[0]}`);

  // agrupar por regla
  const porRegla = {};
  r.violaciones.forEach(x => (porRegla[x.regla] ||= []).push(x));
  const n = r.violaciones.length;
  totalViol += n;

  if (!n) { console.log(`\n  ✓ SIN VIOLACIONES — cumple las once reglas del sistema`); }
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
