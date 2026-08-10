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
  faltantes.push('SF_CLIENT_SECRET — sin él el asistente no habla y todo pasa directo a una persona');
}
if (!process.env.APP_ADMIN_PASS || process.env.APP_ADMIN_PASS.length < 8) {
  faltantes.push('APP_ADMIN_PASS (mínimo 8) — sin ella no se entra al panel de asesor');
}

if (faltantes.length) {
  console.log('\n  Falta lo siguiente:');
  for (const f of faltantes) console.log('   · ' + f);
  console.log('  El sitio levanta igual; cada pieza dirá qué le falta.\n');
}

await import('../src/servidor/index.ts');
