// Arranque del sitio de postventa de Zapata.
//
// Pone los valores por omisión de desarrollo y deja que el entorno mande.
//
// La CLAVE de consumidor se resuelve sola leyéndola de la org: no es un secreto y
// transcribirla a mano sólo produce `invalid_client_id`. El SECRETO sí lo pone una
// persona; sin él, el sitio levanta igual y dice en pantalla qué le falta, en vez
// de fingir que el asistente funciona.

import { claveDeConsumidorDesdeLaOrg } from './clave-consumidor.mjs';

const PREDETERMINADOS = {
  APP_ENV: 'development',
  APP_AUTH_PROVIDER: 'disabled',
  APP_AUTH_MODE: 'disabled',
  PORT: '3000',
  APP_ADMIN_USER: 'asesor',
  // Mismo valor por omisión que `config.ts`. Hace falta también aquí porque este
  // arranque comprueba la sesión del CLI ANTES de que la configuración se cargue, y
  // sin él el aviso salía diciendo «la org "undefined"» y proponía
  // `sf org login web --alias undefined`, que no es una instrucción, es una pista falsa.
  SF_CLI_ORG_ALIAS: 'zapata',
};

for (const [clave, valor] of Object.entries(PREDETERMINADOS)) {
  if (!process.env[clave]) process.env[clave] = valor;
}

// Si hay secreto, la intención es hablar con el agente: se usa client_credentials.
if (!process.env.SF_TOKEN_PROVIDER) {
  process.env.SF_TOKEN_PROVIDER = process.env.SF_CLIENT_SECRET ? 'client_credentials' : 'cli';
}

if (process.env.SF_CLIENT_SECRET && !process.env.SF_CLIENT_ID) {
  const { clave, motivo } = claveDeConsumidorDesdeLaOrg();
  if (clave) {
    process.env.SF_CLIENT_ID = clave;
    console.log(`\n  Clave de consumidor tomada de la org (${clave.length} caracteres). No hace falta escribirla.`);
  } else {
    console.log(`\n  No se pudo leer la clave de consumidor de la org: ${motivo}`);
    console.log('  Cárgala a mano en SF_CLIENT_ID si el asistente no abre sesión.');
  }
}

const faltantes = [];
if (process.env.SF_TOKEN_PROVIDER === 'client_credentials') {
  if (!process.env.SF_CLIENT_SECRET) faltantes.push('SF_CLIENT_SECRET — sin él el asistente no abre sesión');
  if (!process.env.SF_CLIENT_ID) faltantes.push('SF_CLIENT_ID — no se pudo resolver desde la org');
} else {
  // Antes aquí se afirmaba que sin `SF_CLIENT_SECRET` «el asistente no habla y todo
  // pasa directo a una persona». Es FALSO, y comprobado el 11-ago-2026 clonando el
  // repositorio en limpio: sin ningún secreto, con el proveedor `cli`, el agente abrió
  // sesión y contestó. La Agent API se alcanza con el JWT de
  // `/agentforce/bootstrap/nameduser`, que sale de cualquier sesión válida de la org —
  // es lo mismo que hace `sf agent preview` por dentro.
  //
  // Lo que sí hace falta con este proveedor es tener el CLI autenticado. Si no lo
  // está, el fallo aparece al primer mensaje y no al arrancar, así que se comprueba
  // aquí: un aviso ahora vale más que un error dentro de la conversación.
  const alias = process.env.SF_CLI_ORG_ALIAS;
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('sf', ['org', 'display', '-o', alias, '--json'], {
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    console.log(`\n  Proveedor CLI: la org «${alias}» responde. El asistente funciona sin secreto.`);
  } catch {
    faltantes.push(
      `Salesforce CLI sin sesión para la org «${alias}» — el asistente no podrá abrir ` +
        `conversación. Corre: sf org login web --alias ${alias}`,
    );
  }
}
// El panel de asesor ya no exige configurar nada para verse: fuera de producción rige
// una credencial de demo fija, la misma para cualquiera que clone el repositorio.
// Definir APP_ADMIN_PASS sigue ganando. Se anuncia por consola —que sólo ve quien
// levantó el servidor— y no en la pantalla de acceso, que en un despliegue quedaría
// regalándole la entrada a cualquier visitante.
const { CLAVE_DEMO_ASESOR } = await import('../src/servidor/visitante.ts');
if (!process.env.APP_ADMIN_PASS || process.env.APP_ADMIN_PASS.length < 8) {
  console.log('\n  Panel de asesor — credencial de DEMO (no es un secreto):');
  console.log(`   · usuario     ${process.env.APP_ADMIN_USER}`);
  console.log(`   · contraseña  ${CLAVE_DEMO_ASESOR}`);
  console.log('   Define APP_ADMIN_PASS para sustituirla. En producción es obligatoria.');
}

if (faltantes.length) {
  console.log('\n  Falta lo siguiente:');
  for (const f of faltantes) console.log('   · ' + f);
  console.log('  El sitio levanta igual; cada pieza dirá qué le falta.\n');
}

await import('../src/servidor/index.ts');
