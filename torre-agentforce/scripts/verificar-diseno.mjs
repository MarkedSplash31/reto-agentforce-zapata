import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const RAIZ_PROYECTO = resolve(fileURLToPath(new URL('..', import.meta.url)));
// El auditor se resuelve DENTRO del repositorio. Antes se buscaba en la skill
// `zapata-design`, dos niveles arriba: una ruta que sólo existe en el espacio de
// trabajo de quien la escribió, así que este comando fallaba con un ENOENT crudo en
// cualquier clon. `ZAPATA_DESIGN_AUDITOR` permite apuntar a la copia canónica de la
// skill cuando se está trabajando sobre las reglas mismas.
const AUDITOR = process.env.ZAPATA_DESIGN_AUDITOR?.trim()
  ? resolve(process.env.ZAPATA_DESIGN_AUDITOR.trim())
  : resolve(RAIZ_PROYECTO, 'scripts', 'auditar-sistema.mjs');

// La aplicación es una conversación, no un catálogo de formularios: una sola página
// de cliente y dos internas para el asesor.
const PAGINAS = ['/', '/acceso.html', '/panel.html'];

function puertoLocal() {
  const puerto = Number(process.env.QA_DESIGN_PORT ?? 3011);
  if (!Number.isSafeInteger(puerto) || puerto < 1024 || puerto > 65_535) {
    throw new Error('QA_DESIGN_PORT debe ser un puerto entre 1024 y 65535.');
  }
  return puerto;
}

function terminar(proceso) {
  if (!proceso || proceso.exitCode !== null || proceso.killed) return;
  proceso.kill('SIGTERM');
}

async function esperarServidor(url, proceso, limiteMs = 60_000) {
  const inicio = Date.now();
  let ultimaCausa = 'sin respuesta';

  while (Date.now() - inicio < limiteMs) {
    if (proceso.exitCode !== null) {
      throw new Error(`El servidor local terminó antes de estar listo (código ${proceso.exitCode}).`);
    }
    try {
      const respuesta = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (respuesta.ok) return;
      ultimaCausa = `HTTP ${respuesta.status}`;
    } catch (error) {
      ultimaCausa = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolver) => setTimeout(resolver, 250));
  }

  throw new Error(`El servidor no quedó listo en ${limiteMs} ms: ${ultimaCausa}`);
}

function ejecutar(comando, argumentos, opciones) {
  return new Promise((resolver, rechazar) => {
    const proceso = spawn(comando, argumentos, opciones);
    proceso.once('error', rechazar);
    proceso.once('exit', (codigo, signal) => {
      if (signal) rechazar(new Error(`El proceso terminó por señal ${signal}.`));
      else resolver(codigo ?? 1);
    });
  });
}

try {
  await access(AUDITOR);
} catch {
  throw new Error(
    `No se encontró el auditor de diseño en ${AUDITOR}. Viene con el repositorio en ` +
      'scripts/auditar-sistema.mjs; si definiste ZAPATA_DESIGN_AUDITOR, revisa esa ruta.',
  );
}

const baseExterna = process.env.BASE_URL?.trim().replace(/\/+$/, '');
const puerto = puertoLocal();
const baseUrl = baseExterna || `http://127.0.0.1:${puerto}`;
const argumentos = process.argv.slice(2);
const paginas = argumentos.length ? argumentos : PAGINAS;
const urls = paginas.map((pagina) => {
  if (/^https?:\/\//i.test(pagina)) return pagina;
  return new URL(pagina.startsWith('/') ? pagina : `/${pagina}`, `${baseUrl}/`).href;
});

let servidor;
try {
  if (!baseExterna) {
    servidor = spawn(
      process.execPath,
      ['--experimental-strip-types', 'src/servidor/index.ts'],
      {
        cwd: RAIZ_PROYECTO,
        env: {
          ...process.env,
          PORT: String(puerto),
          APP_ENV: 'test',
          // El auditor sólo carga estáticos. Hacer explícito el modo evita exigir
          // credenciales humanas y sigue respetando el fail-closed de producción.
          APP_AUTH_MODE: 'disabled',
        },
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
    await esperarServidor(`${baseUrl}/`, servidor);
  }

  const codigo = await ejecutar(process.execPath, [AUDITOR, ...urls], {
    cwd: RAIZ_PROYECTO,
    env: process.env,
    stdio: 'inherit',
  });
  process.exitCode = codigo;
} finally {
  terminar(servidor);
}
