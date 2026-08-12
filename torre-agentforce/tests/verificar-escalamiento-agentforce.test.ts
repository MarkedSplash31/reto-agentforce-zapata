import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const source = readFileSync(
  resolve(process.cwd(), 'scripts', 'verificar-escalamiento-agentforce.ts'),
  'utf8',
);

describe('contrato del verificador mutante de Agentforce', () => {
  it('lee de la org qué versión del agente está activa, en vez de fijarla', () => {
    // La versión objetivo estuvo clavada en 15 y se quedó atrás: al publicarse la v27
    // este gate salía en rojo con TARGET_AGENT_VERSION_OR_QUEUE_NOT_VERIFIED, que se
    // lee como «el escalamiento está roto» cuando lo único desactualizado era un
    // número. Lo que hay que fijar no es la versión, es que se pregunte.
    assert.doesNotMatch(source, /const TARGET_AGENT_VERSION\s*=\s*\d+/);
    assert.match(source, /function versionActivaDelAgente\(\): number \| null/);
    assert.match(source, /filter\(\(v\) => v\.Status === 'Active'\)/);
    assert.match(source, /activas\.length === 1/);
    assert.match(source, /16-agentforce-v15/);
    assert.doesNotMatch(source, /Version10|V10|v10/);
  });

  it('verifica la correlación CRM contra el externalSessionKey generado por el servidor', () => {
    assert.match(source, /openedBody\.externalSessionKey/);
    assert.match(
      source,
      /caseCorrelationMatchesExternalSessionKey:\s*selected\.Correlation_Id__c === externalSessionKey/,
    );
    assert.match(
      source,
      /Correlation_Id__c = '\$\{lit\(externalSessionKey\)\}'/,
    );
    assert.match(
      source,
      /logUsesServerRoutableIdCorrelation:\s*logs\.records\[0\]\?\.Correlation_Id__c === externalSessionKey/,
    );
  });

  it('mantiene la mutación explícita, sin borrar CRM, y siempre intenta cerrar sesión', () => {
    assert.match(source, /authorizedMutation: true/);
    assert.match(source, /crmRecordsDeleted: false/);
    assert.match(source, /finally\s*\{/);
    assert.match(source, /\/api\/agente\/cerrar/);
    assert.doesNotMatch(source, /DELETE FROM|borrarCase|eliminarCase/i);
  });
});
