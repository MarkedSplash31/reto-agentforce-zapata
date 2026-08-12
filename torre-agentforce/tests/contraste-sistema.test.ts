/**
 * Los tonos callados del sistema tienen que poder leerse.
 *
 * `npm run verificar:diseno` ya lo mide sobre la página viva, pero eso exige levantar
 * un servidor y un navegador, y por eso no corre en cada commit. Esta prueba mira los
 * tokens directamente: si alguien devuelve `--z-txt-min` al gris medido en
 * zapata.com.mx —#4b5563, que da 2.55:1— falla aquí en dos milisegundos y con el
 * número delante, en vez de descubrirse cuando alguien mire la pantalla de lado.
 *
 * El umbral es el de WCAG AA para texto normal, 4.5:1, porque el sistema usa estos
 * tres tonos en cuerpos de 10 y 11 píxeles. No hay texto grande que pueda acogerse al
 * 3:1.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const CSS = readFileSync(
  fileURLToPath(new URL('../publico/css/sistema.css', import.meta.url)),
  'utf8',
);

function token(nombre: string): string {
  const valor = new RegExp(`--${nombre}\\s*:\\s*(#[0-9a-f]{6})`, 'i').exec(CSS)?.[1];
  assert.ok(valor, `el token --${nombre} no está declarado en sistema.css`);
  return valor.toLowerCase();
}

function luminancia(hex: string): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function razon(a: string, b: string): number {
  const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (alto + 0.05) / (bajo + 0.05);
}

const MINIMO = 4.5;

test('la escala de texto se lee sobre los dos fondos del sistema', () => {
  const fondos = { lienzo: token('z-canvas'), superficie: token('z-surface') };
  const textos = ['z-txt-max', 'z-txt-base', 'z-txt-sub', 'z-txt-desc', 'z-txt-eyeb', 'z-txt-min', 'z-txt-ph'];

  for (const nombre of textos) {
    const color = token(nombre);
    for (const [donde, fondo] of Object.entries(fondos)) {
      const r = razon(color, fondo);
      assert.ok(
        r >= MINIMO,
        `--${nombre} (${color}) da ${r.toFixed(2)}:1 sobre el ${donde} (${fondo}); ` +
          `el mínimo legible es ${MINIMO}:1`,
      );
    }
  }
});

test('la escala conserva su jerarquía: cada tono es más callado que el anterior', () => {
  // Que todos pasen AA no basta: si al subirlos se aplanan, la pantalla pierde el orden
  // de lectura y todo grita igual. El orden tiene que seguir siendo estrictamente
  // descendente en contraste.
  const escala = ['z-txt-base', 'z-txt-sub', 'z-txt-desc', 'z-txt-eyeb', 'z-txt-min'];
  const fondo = token('z-surface');
  let previo = Infinity;
  for (const nombre of escala) {
    const r = razon(token(nombre), fondo);
    assert.ok(r < previo, `--${nombre} (${r.toFixed(2)}:1) no es más callado que el tono anterior (${previo.toFixed(2)}:1)`);
    previo = r;
  }
});

test('el placeholder no es más callado que el texto mínimo', () => {
  // Un placeholder dice qué hay que escribir: es una instrucción, no un adorno.
  const fondo = token('z-canvas');
  assert.ok(
    razon(token('z-txt-ph'), fondo) >= razon(token('z-txt-min'), fondo) - 0.01,
    'el placeholder quedó por debajo del tono mínimo del sistema',
  );
});
