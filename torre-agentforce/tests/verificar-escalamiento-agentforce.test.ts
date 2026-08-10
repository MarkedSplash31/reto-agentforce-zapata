import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const source = readFileSync(
  resolve(process.cwd(), 'scripts', 'verificar-escalamiento-agentforce.ts'),
  'utf8',
);

describe('contrato del verificador mutante de Agentforce', () => {
  it('fija v15 como versión objetivo y elimina supuestos operativos de v10', () => {
    assert.match(source, /const TARGET_AGENT_VERSION = 15;/);
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
