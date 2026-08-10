import { expect, test, type APIRequestContext } from '@playwright/test';
import { authHeaders, credential, missingCredentialReason } from '../support/auth.ts';
import { expectDenied, expectJson } from '../support/http.ts';

type AgentState = Record<string, unknown> & { disponible?: boolean };

async function agentState(request: APIRequestContext): Promise<AgentState> {
  test.skip(!credential('admin'), missingCredentialReason('admin'));
  const response = await request.get('/api/agente/estado', { headers: authHeaders('admin') });
  return (await expectJson(response, 200, 'estado real de Agent API')) as AgentState;
}

function blockerMessage(state: AgentState): string {
  const listed = Array.isArray(state.requisitosFaltantes)
    ? state.requisitosFaltantes.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
  const missing = listed.length
    ? listed.join(', ')
    : 'autenticación Salesforce CLI o External Client App / acceso Agent API';
  const cause = typeof state.causa === 'string' ? state.causa.slice(0, 300) : 'sonda no disponible';
  return `BLOQUEO HUMANO: ${missing}. Sonda real: ${cause}`;
}

function parseSse(raw: string): Array<{ event: string; data: Record<string, unknown> }> {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of raw.replace(/\r\n/g, '\n').split('\n\n')) {
    const lines = block.split('\n');
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const dataRaw = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!event || !dataRaw) continue;
    const data = JSON.parse(dataRaw) as unknown;
    expect(data).not.toBeNull();
    expect(Array.isArray(data)).toBe(false);
    expect(typeof data).toBe('object');
    events.push({ event, data: data as Record<string, unknown> });
  }
  return events;
}

test.describe('Agent API real', () => {
  test('sesión → IDOR → mensaje SSE → cierre con cleanup', async ({ request }) => {
    test.setTimeout(120_000);
    test.skip(!credential('advisor'), missingCredentialReason('advisor'));
    test.skip(!credential('clientA'), missingCredentialReason('clientA'));

    const state = await agentState(request);
    test.skip(
      state.disponible !== true,
      `${blockerMessage(state)} Este skip no aprueba Agent API; ejecuta npm run verificar:agent-api como gate separado.`,
    );

    const spoofedKey = await request.post('/api/agente/sesion', {
      headers: authHeaders('advisor'),
      data: { externalSessionKey: 'elegida-por-el-navegador' },
    });
    await expectDenied(spoofedKey, 400, 'externalSessionKey suplantada');

    const openResponse = await request.post('/api/agente/sesion', {
      headers: authHeaders('advisor'),
      data: {},
    });
    const opened = await expectJson(openResponse, 200, 'abrir sesión Agent API');
    expect(typeof opened.sessionId).toBe('string');
    expect(typeof opened.externalSessionKey).toBe('string');
    expect(opened.externalSessionKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const sessionId = opened.sessionId as string;

    let closed = false;
    try {
      await test.step('otro cliente no puede usar ni cerrar la sesión', async () => {
        const foreignMessage = await request.post('/api/agente/mensaje', {
          headers: authHeaders('clientA'),
          data: { sessionId, texto: 'No debe llegar a Agentforce.' },
        });
        await expectDenied(foreignMessage, 403, 'IDOR mensaje de sesión');

        const foreignClose = await request.post('/api/agente/cerrar', {
          headers: authHeaders('clientA'),
          data: { sessionId, motivo: 'UserRequest' },
        });
        await expectDenied(foreignClose, 403, 'IDOR cierre de sesión');
      });

      await test.step('el dueño recibe un stream SSE completo', async () => {
        const messageResponse = await request.post('/api/agente/mensaje', {
          headers: authHeaders('advisor'),
          data: {
            sessionId,
            texto:
              'Responde con un saludo breve. No ejecutes acciones, no crees registros y no consultes datos de clientes.',
          },
          timeout: 90_000,
        });
        expect(messageResponse.status()).toBe(200);
        expect(messageResponse.headers()['content-type']).toMatch(/^text\/event-stream\b/i);

        const events = parseSse(await messageResponse.text());
        expect(events.some((event) => event.event === 'Error'), 'El stream no debe cerrar con Error').toBe(
          false,
        );
        expect(events.some((event) => event.event === 'Fin'), 'El stream debe cerrar explícitamente').toBe(
          true,
        );
        expect(
          events.some(
            ({ data }) =>
              typeof data.texto === 'string' ||
              (Array.isArray(data.resultados) && data.resultados.length > 0),
          ),
          'Al menos un evento debe exponer texto o resultados mapeados.',
        ).toBe(true);
      });

      const closeResponse = await request.post('/api/agente/cerrar', {
        headers: authHeaders('advisor'),
        data: { sessionId, motivo: 'UserRequest' },
      });
      const closeBody = await expectJson(closeResponse, 200, 'cerrar sesión Agent API');
      expect(closeBody.sessionId).toBe(sessionId);
      expect(closeBody.motivo).toBe('UserRequest');
      closed = true;
    } finally {
      if (!closed) {
        const cleanup = await request.post('/api/agente/cerrar', {
          headers: authHeaders('advisor'),
          data: { sessionId, motivo: 'UserRequest' },
        });
        expect(cleanup.status(), 'cleanup de sesión Agent API').toBe(200);
      }
    }
  });
});
