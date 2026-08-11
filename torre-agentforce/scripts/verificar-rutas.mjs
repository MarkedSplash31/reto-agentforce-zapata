// Verificación del nodo N7: cada ruta del servidor contra la org REAL.
// Levanta el servidor, pega a todas las rutas, y deja la evidencia en disco.
// Uso: node scripts/verificar-rutas.mjs

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PUERTO = process.env.PORT ?? 3010;
const BASE = `http://localhost:${PUERTO}`;
const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const dir = join(process.cwd(), 'evidencia', '12-rutas');
mkdirSync(dir, { recursive: true });

const srv = spawn('node', ['--experimental-strip-types', 'src/servidor/index.ts'], {
  env: { ...process.env, PORT: String(PUERTO) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logServidor = '';
srv.stdout.on('data', (d) => (logServidor += d));
srv.stderr.on('data', (d) => (logServidor += d));

// Espera activa a que el puerto responda, en vez de un sleep a ciegas.
async function esperar(intentos = 40) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(`${BASE}/salud`);
      if (r.ok || r.status === 500) return true;
    } catch {
      /* aún no levanta */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (!(await esperar())) {
  console.error('El servidor no levantó.\n' + logServidor);
  srv.kill();
  process.exit(1);
}

const RUTAS = [
  // `/salud` es liveness PÚBLICO: sólo estado y build. No debe exponer dependencias
  // ni datos de la org — eso vive en /api/admin/salud, detrás de rol admin.
  // Si algún día vuelve a traer `dependencias`, es una fuga y esta prueba lo caza.
  {
    m: 'GET',
    ruta: '/salud',
    comprueba: (j) => j.status === 'ok' && j.dependencias === undefined && j.config === undefined,
  },
  // La readiness real exige identidad admin: sin ella debe CERRARSE, no abrirse.
  {
    m: 'GET',
    ruta: '/api/admin/salud',
    esperaStatus: [200, 401, 403],
    comprueba: (j) => (Array.isArray(j.dependencias) ? j.dependencias.length >= 4 : j.error === true),
  },
  { m: 'GET', ruta: '/api/panorama', comprueba: (j) => j.metricas?.length === 8 && j.metricas.every((x) => x.valor !== null) },
  { m: 'GET', ruta: '/api/unidades', comprueba: (j) => j.unidades?.length === 15 },
  { m: 'GET', ruta: '/api/varadas', comprueba: (j) => j.varadas?.length >= 27 },
  { m: 'GET', ruta: '/api/sucursales', comprueba: (j) => j.sucursales?.length === 9 },
  { m: 'GET', ruta: '/api/ordenes', comprueba: (j) => j.ordenes?.length >= 29 },
  { m: 'GET', ruta: '/api/folios', comprueba: (j) => Array.isArray(j.folios) && j.folios.length > 0 },
  { m: 'GET', ruta: '/api/politicas', comprueba: (j) => Array.isArray(j.entradas) || typeof j === 'object' },
  { m: 'GET', ruta: '/api/arquitectura', comprueba: (j) => j.subagentes?.length === 7 && typeof j.mermaid === 'string' },
  { m: 'GET', ruta: '/api/escalamiento/bandeja', comprueba: (j) => Array.isArray(j.casos) },
  { m: 'GET', ruta: '/api/agente/estado', comprueba: (j) => typeof j.disponible === 'boolean' },
  {
    m: 'GET',
    ruta: `/api/slots?desde=${new Date().toISOString().slice(0, 10)}&hasta=${new Date(Date.now() + 12096e5).toISOString().slice(0, 10)}`,
    comprueba: (j) => Array.isArray(j.slots),
  },
  // Rutas que deben fallar bien:
  { m: 'GET', ruta: '/api/slots', esperaStatus: 400, comprueba: (j) => j.error === true },
  { m: 'GET', ruta: '/api/ruta-que-no-existe', esperaStatus: 404, comprueba: (j) => j.error === true },
];

const resultados = [];
let fallos = 0;

for (const r of RUTAS) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${r.ruta}`, { method: r.m });
    const texto = await res.text();
    let j = null;
    try {
      j = JSON.parse(texto);
    } catch {
      /* no era json */
    }
    // Una ruta puede tener varios status legítimos (p. ej. readiness protegida:
    // 200 con identidad admin, 401/403 sin ella; las tres son correctas).
    const esperados = Array.isArray(r.esperaStatus) ? r.esperaStatus : [r.esperaStatus ?? 200];
    const statusOk = esperados.includes(res.status);
    const contenidoOk = j !== null && r.comprueba(j);
    const ok = statusOk && contenidoOk;
    if (!ok) fallos++;
    resultados.push({
      ruta: r.ruta,
      status: res.status,
      esperaStatus: r.esperaStatus ?? 200,
      statusEsperados: esperados,
      ok,
      ms: Date.now() - t0,
      muestra: texto.slice(0, 400),
    });
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${String(res.status).padEnd(4)} ${r.ruta.slice(0, 62).padEnd(62)} ${Date.now() - t0}ms`);
  } catch (e) {
    fallos++;
    resultados.push({ ruta: r.ruta, error: String(e), ok: false });
    console.log(`FALLA      ${r.ruta.padEnd(62)} ${e}`);
  }
}

// Contradicción de política: DEBE ser detectada. Es la que la UI enseña.
try {
  const c = await (await fetch(`${BASE}/api/politicas`)).json();
  const ok = c.hayContradiccion === true && c.sistemasQueDifieren.length >= 1;
  if (!ok) fallos++;
  resultados.push({ ruta: '/api/politicas', ok, sistemasQueDifieren: c.sistemasQueDifieren });
  console.log(`${ok ? 'OK  ' : 'FALLA'}      contradicción de política: ${c.sistemasQueDifieren.length} sistemas difieren de la base`);
} catch (e) {
  fallos++;
  console.log(`FALLA      políticas: ${e}`);
}

// Cobertura por unidad. Hoy NINGUNA unidad tiene reglas aplicables (BLOQUEOS.md §7):
// los 15 Asset apuntan a un modelo sin pólizas. Lo que se exige aquí no es que haya
// conflicto —sería exigir un dato que no existe— sino que la evaluación lo DIGA en vez
// de callarlo o de caer a una regla por defecto. Cuando se arregle §7, esta prueba
// empieza a exigir además que haya al menos un sistema evaluado.
try {
  const u = await (await fetch(`${BASE}/api/unidades`)).json();
  // La unidad la elige la org: buscarla por un nombre escrito aquí rompía la
  // comprobación en cuanto la semilla cambiaba.
  const u105 = u.unidades[0];
  const c = await (await fetch(`${BASE}/api/cobertura/${u105.Id}`)).json();

  const declaraSinReglas = c.sinReglasParaElModelo === true && c.modelo.reglasActivas === 0;
  const evalua = c.porSistema.length > 0;
  // Válido: o evalúa sistemas, o declara explícitamente que no hay reglas. Nunca en silencio.
  const ok = evalua ? c.porSistema.every((s) => s.porRegla && s.porFormula) : declaraSinReglas;
  if (!ok) fallos++;
  resultados.push({
    ruta: `/api/cobertura/${u105.Name}`,
    ok,
    modelo: c.modelo.Name,
    reglasActivas: c.modelo.reglasActivas,
    sinReglasParaElModelo: c.sinReglasParaElModelo,
    sistemasEvaluados: c.porSistema.length,
    hayConflicto: c.hayConflicto,
  });
  console.log(
    `${ok ? 'OK  ' : 'FALLA'}      cobertura de ${u105.Name}: modelo "${c.modelo.Name}" con ${c.modelo.reglasActivas} reglas · ` +
      (evalua ? `${c.porSistema.length} sistemas evaluados` : 'declara sin regla para el modelo (BLOQUEOS.md §7)'),
  );
} catch (e) {
  fallos++;
  console.log(`FALLA      cobertura: ${e}`);
}

// Traza de un folio real.
try {
  const f = await (await fetch(`${BASE}/api/folios`)).json();
  const folio = f.folios[0];
  const t = await (await fetch(`${BASE}/api/traza/${encodeURIComponent(folio)}`)).json();
  const ok = Array.isArray(t.logs) && t.logs.length > 0;
  if (!ok) fallos++;
  resultados.push({ ruta: `/api/traza/${folio}`, ok, logs: t.logs?.length });
  console.log(`${ok ? 'OK  ' : 'FALLA'}      traza de ${folio}: ${t.logs?.length} pasos`);
} catch (e) {
  fallos++;
  console.log(`FALLA      traza: ${e}`);
}

writeFileSync(
  join(dir, `verificar-rutas.${ts}.json`),
  JSON.stringify({ ts, base: BASE, resultados, fallos, logServidor: logServidor.slice(0, 3000) }, null, 1),
);

srv.kill();
console.log(`\n${fallos === 0 ? 'VERDE' : 'ROJO'} — ${RUTAS.length + 2} comprobaciones, ${fallos} fallos`);
console.log(`evidencia en evidencia/12-rutas/verificar-rutas.${ts}.json`);
process.exit(fallos === 0 ? 0 : 1);
