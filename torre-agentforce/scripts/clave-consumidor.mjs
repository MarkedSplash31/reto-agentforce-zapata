// Resuelve la CLAVE de consumidor de la External Client App leyéndola de la org.
//
// La clave no es un secreto: viaja en la metadata y se recupera con el CLI ya
// autenticado. El SECRETO sí lo es, y ése nunca se lee de aquí: lo pone una persona.
//
// Esto existe porque transcribir 85 caracteres a mano es una fuente de errores
// tonta y cara: una clave equivocada da `invalid_client_id`, que parece un problema
// de permisos y no lo es.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function claveDeConsumidorDesdeLaOrg(opciones = {}) {
  const alias = opciones.alias ?? process.env.SF_CLI_ORG_ALIAS ?? 'zapata';
  const app = opciones.app ?? process.env.APP_ECA_NAME ?? 'Torre_Agentforce_Zapata';
  const tmp = join(process.cwd(), '.eca-clave');

  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, 'force-app'), { recursive: true });
  writeFileSync(
    join(tmp, 'sfdx-project.json'),
    JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], namespace: '', sourceApiVersion: '67.0' }),
  );

  try {
    execFileSync(
      'sf',
      ['project', 'retrieve', 'start', '-o', alias, '-m', `"ExtlClntAppGlobalOauthSettings:${app}_glbloauth"`, '--json'],
      { cwd: tmp, shell: true, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 },
    );

    const buscar = (dir) => {
      if (!existsSync(dir)) return null;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          const r = buscar(p);
          if (r) return r;
        } else if (e.name.endsWith('.ecaGlblOauth-meta.xml')) return p;
      }
      return null;
    };

    const ruta = buscar(tmp);
    if (!ruta) return { clave: null, motivo: 'la org no devolvió la configuración OAuth de la app' };
    const clave = (readFileSync(ruta, 'utf8').match(/<consumerKey>([^<]*)<\/consumerKey>/) ?? [])[1] ?? null;
    return clave
      ? { clave, motivo: null }
      : { clave: null, motivo: 'la configuración recuperada no trae clave de consumidor' };
  } catch (e) {
    return { clave: null, motivo: `no se pudo leer de la org: ${String(e).slice(0, 140)}` };
  } finally {
    // En Windows el CLI puede seguir sujetando la carpeta un instante: si no se deja
    // borrar, se ignora. Perder un temporal no justifica tumbar el arranque.
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      /* queda para la siguiente corrida */
    }
  }
}
