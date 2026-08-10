import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authHeaders, credential, missingCredentialReason } from '../support/auth.ts';
import { expectJson, expectSalesforceId } from '../support/http.ts';

const RUN_MUTATIONS = process.env.RUN_MUTATING_SF_TESTS === '1';

test('BLOQUEO OPT-IN: escalamiento real es idempotente y deja evidencia 1/1/1', async ({ request }) => {
  test.skip(
    !RUN_MUTATIONS,
    'BLOQUEO EXPLÍCITO: define RUN_MUTATING_SF_TESTS=1 para autorizar un Case QA real y aislado.',
  );
  test.skip(!credential('clientA'), missingCredentialReason('clientA'));
  test.skip(!credential('admin'), missingCredentialReason('admin'));
  test.setTimeout(120_000);

  const operationNonce = randomUUID();
  const payload = {
    operationNonce,
    asunto: `[QA] Idempotencia ${operationNonce}`,
    contexto: 'Prueba aislada autorizada. Usa únicamente el binding CRM del principal de QA.',
    politicaAplicada: 'QA_IDEMPOTENCIA',
    // Vacía a propósito: sin turnos, la apertura siembra únicamente los dos comentarios
    // internos de contexto (resumen y cabecera), nunca un turno inventado.
    transcripcion: [],
  };

  const firstResponse = await request.post('/api/escalamiento/abrir', {
    headers: authHeaders('clientA'),
    data: payload,
  });
  const first = await expectJson(firstResponse, 200, 'primera apertura idempotente');
  expectSalesforceId(first.caseId, 'primer Case.Id');
  expect(first.correlationId).toMatch(/^esc-[0-9a-f]{12}-[0-9a-f-]{36}$/);

  const secondResponse = await request.post('/api/escalamiento/abrir', {
    headers: authHeaders('clientA'),
    data: payload,
  });
  const second = await expectJson(secondResponse, 200, 'reintento idempotente');
  expect(second.correlationId).toBe(first.correlationId);
  expect(second.caseId, 'el reintento debe releer el mismo Case').toBe(first.caseId);
  expect(second.caseNumber).toBe(first.caseNumber);
  expect(second.comentariosSembrados).toEqual(first.comentariosSembrados);

  const conversationResponse = await request.get(`/api/escalamiento/${first.caseId}`, {
    headers: authHeaders('clientA'),
  });
  const conversation = await expectJson(conversationResponse, 200, 'relectura Case+CaseComment');
  expect((conversation.caso as Record<string, unknown>).correlationId).toBe(first.correlationId);
  expect(Array.isArray(conversation.comentarios)).toBe(true);
  // Con transcripción vacía la apertura siembra exactamente resumen + cabecera: dos
  // comentarios internos y ningún turno. Verificado contra Salesforce en
  // scripts/prueba-escalamiento-e2e.mjs, que exige `2 + turnos.length`.
  const openingComments = conversation.comentarios as Array<Record<string, unknown>>;
  expect(openingComments).toHaveLength(2);
  expect(openingComments).toEqual(first.comentariosSembrados.map(expect.anything));
  for (const comment of openingComments) {
    expectSalesforceId(comment.id, 'CaseComment.Id');
    expect(comment.publicado, 'todo comentario de apertura debe ser interno').toBe(false);
  }

  const traceResponse = await request.get(`/api/traza/${encodeURIComponent(first.correlationId as string)}`, {
    headers: authHeaders('admin'),
  });
  const trace = await expectJson(traceResponse, 200, 'relectura de traza idempotente');
  const related = trace.relacionados as Record<string, unknown[]>;
  expect(related.casos, 'un solo Case para el correlationId').toHaveLength(1);
  expect(trace.logs as unknown[], 'un solo Log_Agente__c para la apertura').toHaveLength(1);
  const log = (trace.logs as Array<Record<string, unknown>>)[0]!;
  expect(log.Action_Name__c).toBe('Escalar_Asesor_Humano');
  expect(log.Correlation_Id__c).toBe(first.correlationId);
  expect(log.Case__c).toBe(first.caseId);
});
