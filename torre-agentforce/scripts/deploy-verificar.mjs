import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
const errores = [];

async function texto(ruta) {
  return readFile(resolve(raiz, ruta), 'utf8');
}

async function existe(ruta) {
  try {
    return (await stat(resolve(raiz, ruta))).isFile();
  } catch {
    return false;
  }
}

function exigir(condicion, mensaje) {
  if (!condicion) errores.push(mensaje);
}

for (const ruta of [
  'Dockerfile',
  '.gitignore',
  '.dockerignore',
  'render.yaml',
  '.env.example',
  'docs/DESPLIEGUE.md',
  'docs/DATOS-Y-PROVENIENCIA.md',
  'docs/EVIDENCIA-SANITIZADA.md',
]) {
  exigir(await existe(ruta), `falta ${ruta}`);
}

const dockerfile = await texto('Dockerfile');
exigir(/FROM \$\{NODE_IMAGE\} AS verify/.test(dockerfile), 'Dockerfile no tiene etapa verify');
exigir(/sha256:[a-f0-9]{64}/.test(dockerfile), 'imagen base no está fijada por digest');
exigir(/RUN npm run build:frontend[\s\\]*&& test -s publico\/js\/vendor\/mermaid\.min\.js[\s\\]*&& npm run typecheck/.test(dockerfile), 'la imagen no construye/verifica CSS y Mermaid locales antes de typecheck');
exigir(/npm run typecheck/.test(dockerfile), 'la imagen no queda gated por typecheck');
exigir(/USER node/.test(dockerfile), 'runtime no declara usuario no-root');
exigir(/HEALTHCHECK/.test(dockerfile), 'Dockerfile no declara HEALTHCHECK');

const ignore = await texto('.dockerignore');
for (const entrada of ['.env', 'node_modules', 'evidencia', '.metadata-org']) {
  exigir(ignore.split(/\r?\n/).includes(entrada), `.dockerignore no excluye ${entrada}`);
}

const gitignore = await texto('.gitignore');
const lineasGitignore = new Set(gitignore.split(/\r?\n/));
for (const entrada of [
  '.env',
  '.env.*',
  '!.env.example',
  '.metadata-org/',
  'evidencia/',
  'output/',
  'test-results/',
  'playwright-report/',
  'blob-report/',
  '*-success-records.csv',
  '*-failed-records.csv',
]) {
  exigir(lineasGitignore.has(entrada), `.gitignore no excluye ${entrada}`);
}

const render = await texto('render.yaml');
exigir(/autoDeployTrigger:\s*["']off["']/.test(render), 'Render debe requerir despliegue manual');
exigir(!/^\s*rootDir:/m.test(render), 'el Blueprint del repo dedicado no debe conservar un rootDir de monorepo');
exigir(/^\s*dockerfilePath:\s*\.\/Dockerfile\s*$/m.test(render), 'dockerfilePath debe ser relativo a la raíz del repo dedicado');
exigir(/^\s*dockerContext:\s*\.\s*$/m.test(render), 'dockerContext debe ser la raíz del repo dedicado');
exigir(/^\s*numInstances:\s*1\s*$/m.test(render), 'Render debe fijar una sola réplica mientras el estado sea in-memory');
exigir(/^\s*healthCheckPath:\s*\/salud\s*$/m.test(render), 'Render debe usar el liveness público /salud');
exigir(!/^\s*disk:/m.test(render), 'el servicio stateless no debe adjuntar un disco que rompa deploys zero-downtime');
exigir(!/^\s*- key:\s*PORT\s*$/m.test(render), 'Render debe inyectar PORT; no se debe fijar en el Blueprint');
exigir(/APP_AUTH_PROVIDER\s*\n\s*value:\s*oidc/.test(render), 'Render debe usar OIDC como proveedor de identidad');
exigir(/APP_AUTH_MODE\s*\n\s*value:\s*required/.test(render), 'Render debe exigir autenticación');
exigir(/APP_BUILD_ID\s*\n\s*sync:\s*false/.test(render), 'Render debe exigir un identificador de build por release');
exigir(!/^\s*- key:\s*APP_AUTH_CREDENTIALS_JSON\s*$/m.test(render), 'Render no debe conservar credenciales locales cuando usa OIDC');
exigir(/APP_EXTERNAL_ORIGIN\s*\n\s*sync:\s*false/.test(render), 'el origin público debe capturarse fuera del repo');
exigir(/APP_OIDC_CALLBACK_URL\s*\n\s*sync:\s*false/.test(render), 'el callback OIDC debe capturarse fuera del repo');
exigir(/APP_OIDC_ADMIN_PERMISSION_SETS\s*\n\s*value:\s*Torre_Agentforce_Admin\s*(?:#.*)?$/m.test(render), 'el rol admin debe mapear exactamente Torre_Agentforce_Admin');
exigir(/APP_OIDC_ADVISOR_PERMISSION_SETS\s*\n\s*value:\s*Torre_Agentforce_Asesor\s*(?:#.*)?$/m.test(render), 'el rol asesor debe mapear exactamente Torre_Agentforce_Asesor');
exigir(/APP_CORS_ORIGINS\s*\n\s*sync:\s*false/.test(render), 'los origins custom deben capturarse fuera del repo y conservarse en Render');
exigir(/APP_TRUST_PROXY\s*\n\s*value:\s*["']{2}/.test(render), 'Render debe ignorar X-Forwarded-For hasta confirmar el proxy');
exigir(
  /SF_OIDC_EXPECTED_ISSUERS\s*\n\s*value:\s*https:\/\/orgfarm-1c6625ec2e-dev-ed\.develop\.my\.salesforce\.com\s*(?:#.*)?$/m.test(render),
  'el issuer OIDC debe coincidir exactamente con el issuer descubierto en la org',
);
const scopesOidc = /SF_OIDC_SCOPES\s*\n\s*value:\s*([^\r\n#]+)/.exec(render)?.[1]
  ?.trim()
  .replace(/^["']|["']$/g, '')
  .split(',')
  .map((scope) => scope.trim())
  .filter(Boolean) ?? [];
exigir(scopesOidc.includes('openid'), 'SF_OIDC_SCOPES debe incluir openid');
exigir(/SF_CLIENT_ID\s*\n\s*sync:\s*false/.test(render), 'SF_CLIENT_ID no está marcado secreto');
exigir(/SF_CLIENT_SECRET\s*\n\s*sync:\s*false/.test(render), 'SF_CLIENT_SECRET no está marcado secreto');
exigir(!/SF_CLIENT_SECRET\s*\n\s*value:/.test(render), 'SF_CLIENT_SECRET no debe tener valor versionado');
exigir(/SF_CASE_QUEUE_ID\s*\n\s*value:\s*00G[A-Za-z0-9]{12,15}/.test(render), 'Render no fija una Queue válida para autorización de Cases');

const contrato = await texto('docs/CONTRATO-AGENT-API.md');
for (const scope of ['api', 'refresh_token', 'offline_access', 'chatbot_api', 'sfap_api']) {
  exigir(contrato.includes(scope), `falta scope oficial en contrato: ${scope}`);
}

const paquete = JSON.parse(await texto('package.json'));
exigir(typeof paquete.scripts?.['build:css'] === 'string', 'package.json no declara build:css');
exigir(typeof paquete.scripts?.['build:frontend'] === 'string', 'package.json no declara build:frontend');

const paginaInicio = await texto('publico/index.html');
exigir(
  !/pedir\(['"]\/salud['"]\)[\s\S]{0,300}s\.dependencias/.test(paginaInicio),
  'la portada trata /salud como readiness; debe usar /api/admin/salud para dependencias',
);

const seguridadHttp = await texto('src/servidor/http-security.ts');
exigir(
  seguridadHttp.includes('RENDER_EXTERNAL_URL') && seguridadHttp.includes("env.RENDER !== 'true'"),
  'CORS no reconoce de forma fail-closed el origin HTTPS que Render inyecta',
);
exigir(
  !/x-forwarded-proto/i.test(seguridadHttp),
  'CORS no debe confiar en X-Forwarded-Proto controlable desde la petición',
);
for (const directiva of [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
]) {
  exigir(seguridadHttp.includes(directiva), `CSP no conserva la directiva requerida: ${directiva}`);
}
exigir(!seguridadHttp.includes("'unsafe-inline'"), "CSP no debe permitir 'unsafe-inline'");
exigir(!seguridadHttp.includes("'unsafe-eval'"), "CSP no debe permitir 'unsafe-eval'");

async function archivosWeb(dir) {
  const resultado = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = resolve(dir, entrada.name);
    if (entrada.isDirectory()) resultado.push(...(await archivosWeb(ruta)));
    else if (/\.(?:html|js|css)$/i.test(entrada.name)) resultado.push(ruta);
  }
  return resultado;
}

const externosProhibidos = /cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net/i;
for (const ruta of await archivosWeb(resolve(raiz, 'publico'))) {
  const contenido = await readFile(ruta, 'utf8');
  exigir(!externosProhibidos.test(contenido), `asset externo prohibido en ${ruta.slice(raiz.length + 1)}`);
}

if (errores.length) {
  console.error('VERIFICACIÓN DE DESPLIEGUE: FAIL');
  for (const error of errores) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('VERIFICACIÓN DE DESPLIEGUE: PASS');
  console.log('Docker, repo dedicado, réplica única, CORS Render, exclusiones y secretos: conformes.');
}
