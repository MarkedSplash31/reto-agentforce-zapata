import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.APP_ENV = 'development';
process.env.APP_AUTH_MODE = 'disabled';
process.env.SF_TOKEN_PROVIDER = 'client_credentials';
process.env.SF_CLIENT_ID = 'client-id-de-prueba';
process.env.SF_CLIENT_SECRET = 'client-secret-de-prueba';
process.env.SF_LOGIN_URL = 'https://example.my.salesforce.com';
process.env.SF_API_VERSION = 'v67.0';

test('abre y reintenta mediante Apex con el contexto completo siempre interno', async (t) => {
  const fetchOriginal = globalThis.fetch;
  const llamadasAccion: Array<Record<string, unknown>> = [];
  const turnos = [
    { autor: 'cliente', texto: 'La unidad pierde potencia en subida.' },
    {
      autor: 'agente',
      texto: 'El diagnostico automatico no fue concluyente.',
      fecha: '2026-08-05T20:40:12Z',
    },
    { autor: 'cliente', texto: 'Prefiero hablar con una persona.' },
  ];
  const idsComentarios = [
    '00agK00000TEST1QAA',
    '00agK00000TEST2QAA',
    '00agK00000TEST3QAA',
    '00agK00000TEST4QAA',
    '00agK00000TEST5QAA',
  ];
  let nombreAccion = 'EscalarAsesorHumano';
  let exitoAccion = true;
  let salidaAccion: Record<string, unknown> = {
    escalamientoCreado: true,
    reintento: false,
    caseId: '500gK00001TEST1QAA',
    caseNumber: '00009999',
    mensaje: 'Caso registrado.',
    codigoError: null,
    comentariosSembrados: idsComentarios,
  };

  globalThis.fetch = async (entrada, init) => {
    const url = String(entrada);

    if (url.endsWith('/services/oauth2/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'token-de-prueba',
          instance_url: 'https://example.my.salesforce.com',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.endsWith('/services/data/v67.0/actions/custom/apex/EscalarAsesorHumano')) {
      assert.equal(init?.method, 'POST');
      const cuerpo = JSON.parse(String(init?.body)) as {
        inputs: Array<Record<string, unknown>>;
      };
      llamadasAccion.push(cuerpo);
      assert.deepEqual(
        Object.keys(cuerpo.inputs[0] ?? {}).sort(),
        ['contextoTorreJson', 'correlationId', 'motivo', 'riesgoSeguridad'],
      );
      assert.equal(
        cuerpo.inputs[0]?.motivo,
        'El cliente solicita que una persona revise su inconformidad.',
      );
      assert.equal(cuerpo.inputs[0]?.correlationId, 'NODE-APEX-IDEMPOTENTE-01');
      assert.equal(cuerpo.inputs[0]?.riesgoSeguridad, false);
      assert.deepEqual(JSON.parse(String(cuerpo.inputs[0]?.contextoTorreJson)), {
        version: 1,
        asunto: 'Inconformidad',
        politicaAplicada: 'ESCALAMIENTO-HUMANO',
        turnos,
      });

      const reintento = llamadasAccion.length > 1;
      salidaAccion = { ...salidaAccion, reintento };
      return new Response(
        JSON.stringify([
          {
            actionName: nombreAccion,
            isSuccess: exitoAccion,
            errors: exitoAccion ? null : [{ statusCode: 'APEX_ERROR' }],
            outputValues: salidaAccion,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    throw new Error(`Peticion inesperada en la prueba: ${url}`);
  };

  t.after(async () => {
    globalThis.fetch = fetchOriginal;
    const { _reiniciarProveedor } = await import('../src/servidor/auth.ts');
    _reiniciarProveedor();
  });

  const { abrirEscalamiento } = await import('../src/servidor/escalamiento.ts');
  const entrada = {
    correlationId: 'NODE-APEX-IDEMPOTENTE-01',
    asunto: 'Inconformidad',
    contexto: 'El cliente solicita que una persona revise su inconformidad.',
    politicaAplicada: 'ESCALAMIENTO-HUMANO',
    transcripcion: turnos,
  };

  const primera = await abrirEscalamiento(entrada);
  const segunda = await abrirEscalamiento(entrada);

  assert.deepEqual(primera, {
    caseId: '500gK00001TEST1QAA',
    caseNumber: '00009999',
    correlationId: 'NODE-APEX-IDEMPOTENTE-01',
    comentariosSembrados: idsComentarios,
  });
  assert.deepEqual(segunda, primera);
  assert.equal(llamadasAccion.length, 2);

  await assert.rejects(
    abrirEscalamiento({ ...entrada, contexto: 'x'.repeat(3501) }),
    /contexto admite 3500 caracteres/,
  );
  await assert.rejects(
    abrirEscalamiento({ ...entrada, transcripcion: [{ autor: 'cliente', texto: 'x'.repeat(3501) }] }),
    /turno 1.*3500 caracteres/,
  );
  await assert.rejects(
    abrirEscalamiento({
      ...entrada,
      transcripcion: Array.from({ length: 41 }, (_, i) => ({
        autor: 'cliente',
        texto: `turno ${i + 1}`,
      })),
    }),
    /maximo 40 turnos/,
  );
  await assert.rejects(
    abrirEscalamiento({
      ...entrada,
      transcripcion: [{ autor: 'cliente', texto: 'contenido', secreto: true }],
    } as never),
    /campos no permitidos/,
  );
  assert.equal(llamadasAccion.length, 2, 'ninguna entrada invalida debe llegar a Salesforce');

  salidaAccion = { escalamientoCreado: false, codigoError: 'IDEMPOTENCY_CONFLICT' };
  await assert.rejects(abrirEscalamiento(entrada), /contenido diferente/);

  salidaAccion = { escalamientoCreado: false, codigoError: 'PERSISTENCE_ERROR' };
  await assert.rejects(abrirEscalamiento(entrada), /no confirmo un escalamiento durable/);

  exitoAccion = false;
  await assert.rejects(abrirEscalamiento(entrada), /fallo antes de completar la transaccion/);

  exitoAccion = true;
  nombreAccion = 'Accion_Inesperada';
  await assert.rejects(abrirEscalamiento(entrada), /accion inesperada/);
});
