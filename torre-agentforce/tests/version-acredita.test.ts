// Que una versión que se declara sintética no pinte de verde lo que ella misma niega.
//
// Encontrado el 11-ago-2026 leyendo los artículos reales de la org: los veinte llevan
// `Version_Politica__c = 'v1.0-sintetica-no-verificada'`. La primera versión de
// `listarConocimiento` daba por acreditado cualquier artículo con el campo lleno, así
// que el material de apoyo salía marcado en verde con el texto que dice, literalmente,
// que no está verificado.
//
// El Apex del agente antepone a cada respuesta un aviso de fuente sintética no
// verificada. Esta regla es la misma promesa en la superficie que se lee sin agente.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.APP_ENV = 'development';
process.env.APP_AUTH_PROVIDER = 'disabled';
process.env.APP_AUTH_MODE = 'disabled';
const { versionAcredita } = await import('../src/servidor/datos.ts');

describe('qué versión de política acredita un artículo', () => {
  it('la que traen hoy los veinte artículos de la org NO acredita', () => {
    assert.equal(versionAcredita('v1.0-sintetica-no-verificada'), false);
  });

  it('ninguna variante de «no verificada» acredita', () => {
    for (const v of [
      'SIN_VERSION_NO_VERIFICADA',
      'no verificada',
      'v2 NO-VERIFICADA',
      'borrador sintético',
      'SINTETICA',
    ]) {
      assert.equal(versionAcredita(v), false, `«${v}» no puede acreditar`);
    }
  });

  it('un campo vacío tampoco acredita', () => {
    assert.equal(versionAcredita(null), false);
    assert.equal(versionAcredita(''), false);
    assert.equal(versionAcredita('   '), false);
  });

  it('una versión operacional sí acredita', () => {
    assert.equal(versionAcredita('POL-2026-04'), true);
    assert.equal(versionAcredita('v3.1'), true);
  });
});
