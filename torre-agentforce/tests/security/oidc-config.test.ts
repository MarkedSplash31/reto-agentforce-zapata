import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { describe, it } from 'node:test';

async function importConfig(overrides: Record<string, string>): Promise<{ code: number | null; stderr: string }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: 'production',
    NODE_ENV: 'production',
    APP_AUTH_PROVIDER: 'oidc',
    APP_AUTH_MODE: 'required',
    SF_TOKEN_PROVIDER: 'client_credentials',
    SF_LOGIN_URL: 'https://orgfarm-1c6625ec2e-dev-ed.develop.my.salesforce.com',
    SF_CLIENT_ID: '',
    SF_CLIENT_SECRET: '',
    APP_EXTERNAL_ORIGIN: '',
    APP_OIDC_CALLBACK_URL: '',
    APP_OIDC_ADMIN_PERMISSION_SETS: '',
    APP_OIDC_ADVISOR_PERMISSION_SETS: '',
    SF_OIDC_SCOPES: '',
    SF_OIDC_EXPECTED_ISSUERS: 'https://orgfarm-1c6625ec2e-dev-ed.develop.my.salesforce.com',
    SF_OIDC_ALLOWED_HOSTS: 'orgfarm-1c6625ec2e-dev-ed.develop.my.salesforce.com',
    ...overrides,
  };
  delete env.APP_AUTH_CREDENTIALS_JSON;
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '-e', "import('./src/servidor/config.ts')"],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  return { code, stderr };
}

const credentials = {
  SF_CLIENT_ID: 'oidc-config-client',
  SF_CLIENT_SECRET: 'oidc-config-secret-value',
};
const external = {
  ...credentials,
  APP_EXTERNAL_ORIGIN: 'https://torre.example.test',
  APP_OIDC_CALLBACK_URL: 'https://torre.example.test/auth/salesforce/callback',
  APP_OIDC_ADMIN_PERMISSION_SETS: 'Torre_Agentforce_Admin',
  APP_OIDC_ADVISOR_PERMISSION_SETS: 'Torre_Agentforce_Asesor',
};

describe('configuracion de produccion OIDC', () => {
  it('falla con causa exacta si faltan credenciales BFF', async () => {
    const result = await importConfig({ SF_CLIENT_ID: '', SF_CLIENT_SECRET: '' });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /APP_AUTH_PROVIDER=oidc exige SF_CLIENT_ID y SF_CLIENT_SECRET/);
  });

  it('falla si origin o callback externo no fueron fijados', async () => {
    const missingOrigin = await importConfig(credentials);
    assert.notEqual(missingOrigin.code, 0);
    assert.match(missingOrigin.stderr, /Falta la variable de entorno APP_EXTERNAL_ORIGIN/);

    const missingCallback = await importConfig({
      ...credentials,
      APP_EXTERNAL_ORIGIN: 'https://torre.example.test',
    });
    assert.notEqual(missingCallback.code, 0);
    assert.match(missingCallback.stderr, /Falta la variable de entorno APP_OIDC_CALLBACK_URL/);

    const wrongRoute = await importConfig({
      ...external,
      APP_OIDC_CALLBACK_URL: 'https://torre.example.test/callback-inventado',
      SF_OIDC_SCOPES: 'openid,api,refresh_token,chatbot_api,sfap_api',
    });
    assert.notEqual(wrongRoute.code, 0);
    assert.match(wrongRoute.stderr, /terminar exactamente en \/auth\/salesforce\/callback/);
  });

  it('exige declarar openid de forma explicita antes del deploy', async () => {
    const absent = await importConfig(external);
    assert.notEqual(absent.code, 0);
    assert.match(absent.stderr, /SF_OIDC_SCOPES explicito.*openid/);

    const missingOpenid = await importConfig({
      ...external,
      SF_OIDC_SCOPES: 'api,refresh_token,chatbot_api,sfap_api',
    });
    assert.notEqual(missingOpenid.code, 0);
    assert.match(missingOpenid.stderr, /SF_OIDC_SCOPES debe incluir openid/);
  });

  it('acepta solo el contrato completo con Permission Sets reales', async () => {
    const result = await importConfig({
      ...external,
      SF_OIDC_SCOPES: 'openid,api,refresh_token,chatbot_api,sfap_api',
    });
    assert.equal(result.code, 0, result.stderr);
  });
});
