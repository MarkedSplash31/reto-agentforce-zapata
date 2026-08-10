import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CSS_INPUT = join(ROOT, 'publico', 'css', 'tailwind-input.css');
const CSS_OUTPUT = join(ROOT, 'publico', 'css', 'tailwind.css');
const FONT_OUTPUT_DIR = join(ROOT, 'publico', 'fonts');
const CSS_ONLY = process.argv.includes('--css-only');

const FONTS = [
  { family: 'Inter', weight: 300, source: '@fontsource/inter/files/inter-latin-300-normal.woff2', output: 'inter-300-latin.woff2' },
  { family: 'Inter', weight: 400, source: '@fontsource/inter/files/inter-latin-400-normal.woff2', output: 'inter-400-latin.woff2' },
  { family: 'Inter', weight: 500, source: '@fontsource/inter/files/inter-latin-500-normal.woff2', output: 'inter-500-latin.woff2' },
  { family: 'Inter', weight: 600, source: '@fontsource/inter/files/inter-latin-600-normal.woff2', output: 'inter-600-latin.woff2' },
  { family: 'Cinzel', weight: 400, source: '@fontsource/cinzel/files/cinzel-latin-400-normal.woff2', output: 'cinzel-400-latin.woff2' },
  { family: 'Cinzel', weight: 600, source: '@fontsource/cinzel/files/cinzel-latin-600-normal.woff2', output: 'cinzel-600-latin.woff2' },
];

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Build frontend terminó por señal ${signal}.`));
      else if (code !== 0) reject(new Error(`Build frontend terminó con código ${code}.`));
      else resolvePromise();
    });
  });
}

function validateCss(css) {
  const text = css.toString('utf8');
  if (css.byteLength < 8_000) throw new Error('tailwind.css quedó demasiado pequeño.');
  for (const required of ['.hidden', '.max-w-7xl', '@media (min-width:1024px)']) {
    if (!text.includes(required)) throw new Error(`tailwind.css no contiene ${required}.`);
  }
}

const temporary = await mkdtemp(join(tmpdir(), 'torre-frontend-'));
try {
  const cssTemporary = join(temporary, 'tailwind.css');
  const tailwindCli = join(ROOT, 'node_modules', 'tailwindcss', 'lib', 'cli.js');
  await run(process.execPath, [
    tailwindCli,
    '--input',
    CSS_INPUT,
    '--output',
    cssTemporary,
    '--content',
    './publico/**/*.{html,js}',
    '--minify',
  ]);

  const tailwind = await readFile(cssTemporary);
  const fontCss = FONTS.map(
    ({ family, weight, output }) =>
      `@font-face{font-family:${family};font-style:normal;font-display:swap;font-weight:${weight};src:url('/fonts/${output}') format('woff2')}`,
  ).join('');
  const css = Buffer.concat([Buffer.from(fontCss), tailwind]);
  validateCss(css);
  await mkdir(dirname(CSS_OUTPUT), { recursive: true });
  await writeFile(CSS_OUTPUT, css);

  await mkdir(FONT_OUTPUT_DIR, { recursive: true });
  for (const font of FONTS) {
    const source = await readFile(join(ROOT, 'node_modules', ...font.source.split('/')));
    if (source.byteLength < 5_000) throw new Error(`Fuente ${font.output} demasiado pequeña.`);
    await writeFile(join(FONT_OUTPUT_DIR, font.output), source);
  }

  // Mermaid quedó deliberadamente fuera del bundle: exige estilos inline y la CSP de
  // la app es `style-src 'self'`. La topología se pinta en DOM desde el mismo
  // `arquitectura.json` generado de la org, sin 3.5 MB de dependencia por una pantalla
  // ni relajar la política de seguridad.

  console.log(`Frontend local construido: css ${css.byteLength} bytes`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
