// Comprueba que SF_CLIENT_ID y SF_CLIENT_SECRET son los de la External Client App
// de ESTA org, y que el endpoint de token los acepta.
//
// No imprime ninguno de los dos valores, ni completos ni parciales: sólo dice si
// coinciden, en qué posición dejan de coincidir y qué respondió Salesforce. Sirve
// para diagnosticar sin que la credencial acabe en la terminal, en un log o en una
// captura de pantalla.
//
// Uso:  node scripts/verificar-credencial.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ALIAS = process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
const APP = process.env.APP_ECA_NAME ?? 'Torre_Agentforce_Zapata';
const LOGIN = process.env.SF_LOGIN_URL ?? 'https://orgfarm-1c6625ec2e-dev-ed.develop.my.salesforce.com';
const TMP = join(process.cwd(), '.eca-verificacion');

const id = process.env.SF_CLIENT_ID ?? '';
const secreto = process.env.SF_CLIENT_SECRET ?? '';

let fallos = 0;
const decir = (ok, texto) => {
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${texto}`);
};

console.log(`Org ${ALIAS} · app ${APP}\n`);

// ── 1. ¿Están cargadas? ──────────────────────────────────────────────────────
decir(Boolean(id), `SF_CLIENT_ID cargada (${id.length} caracteres)`);
decir(Boolean(secreto), `SF_CLIENT_SECRET cargada (${secreto.length} caracteres)`);
if (!id || !secreto) {
  console.log('\nCarga las dos variables antes de continuar.');
  process.exit(1);
}

// ── 2. ¿La clave es la de esta org? ──────────────────────────────────────────
rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, 'force-app'), { recursive: true });
execFileSync('node', ['-e', `require('fs').writeFileSync(process.argv[1], JSON.stringify({packageDirectories:[{path:'force-app',default:true}],namespace:'',sourceApiVersion:'67.0'}))`, join(TMP, 'sfdx-project.json')]);

let claveOrg = '';
try {
  execFileSync(
    'sf',
    ['project', 'retrieve', 'start', '-o', ALIAS, '-m', `"ExtlClntAppGlobalOauthSettings:${APP}_glbloauth"`, '--json'],
    { cwd: TMP, shell: true, stdio: 'pipe', maxBuffer: 8 * 1024 * 1024 },
  );
  const buscar = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        const r = buscar(p);
        if (r) return r;
      } else if (e.name.endsWith('.ecaGlblOauth-meta.xml')) return p;
    }
    return null;
  };
  const ruta = existsSync(TMP) ? buscar(TMP) : null;
  if (ruta) claveOrg = (readFileSync(ruta, 'utf8').match(/<consumerKey>([^<]*)<\/consumerKey>/) ?? [])[1] ?? '';
} catch (e) {
  console.log(`   aviso: no se pudo leer la app desde la org (${String(e).slice(0, 120)})`);
}

if (claveOrg) {
  if (claveOrg === id) {
    decir(true, 'la clave cargada es la de esta org');
  } else {
    let i = 0;
    while (i < Math.min(claveOrg.length, id.length) && claveOrg[i] === id[i]) i++;
    let distintos = 0;
    for (let k = 0; k < Math.max(claveOrg.length, id.length); k++) if (claveOrg[k] !== id[k]) distintos++;
    decir(false, `la clave cargada NO es la de esta org`);
    console.log(`       longitudes: org ${claveOrg.length} · cargada ${id.length}`);
    console.log(`       coinciden los primeros ${i} caracteres; difieren ${distintos} en total`);
    if (distintos > 10) {
      console.log('       Tantas diferencias significan que es la clave de OTRA app u OTRA org,');
      console.log('       no un error de tecleo. Vuelve a copiarla de esta app.');
    }
  }
} else {
  console.log('   (no se pudo comparar contra la org; se continúa con la prueba de token)');
}

// ── 3. ¿El endpoint de token las acepta? ─────────────────────────────────────
const url = `${LOGIN}/services/oauth2/token`;
let respuesta;
try {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secreto }),
  });
  const texto = await r.text();
  let cuerpo = {};
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    cuerpo = { error: 'respuesta_no_json' };
  }
  respuesta = { status: r.status, cuerpo };
} catch (e) {
  respuesta = { status: 0, cuerpo: { error: 'sin_conexion', error_description: String(e).slice(0, 160) } };
}

if (respuesta.status === 200 && respuesta.cuerpo.access_token) {
  decir(true, 'el endpoint de token entregó un token');
} else {
  decir(false, `el endpoint de token respondió ${respuesta.status}`);
  const { error, error_description: desc } = respuesta.cuerpo;
  if (error) console.log(`       ${error}${desc ? ` — ${desc}` : ''}`);
  const pistas = {
    invalid_client_id: 'La clave no existe en esta org. Cópiala de la app correcta.',
    invalid_client: 'El secreto no corresponde a esa clave. Revélalos juntos y cópialos de una vez.',
    invalid_grant: 'Falta el usuario de ejecución (Run As) en las políticas de la app.',
    inactive_user: 'El usuario de ejecución está inactivo o sin acceso a la API.',
    unsupported_grant_type: 'El flujo de credenciales de cliente no está habilitado en la app.',
  };
  if (pistas[error]) console.log(`       ${pistas[error]}`);
}

rmSync(TMP, { recursive: true, force: true });

console.log(`\n${fallos === 0 ? 'VERDE — la credencial sirve para la Agent API' : 'ROJO — corrige lo de arriba antes de seguir'}`);
process.exit(fallos === 0 ? 0 : 1);
