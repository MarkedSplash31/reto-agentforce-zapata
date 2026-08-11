// Por qué el agente le decía a quien preguntaba por el taller de Guadalajara que su
// unidad no existe.
//
// Encontrado el 11-ago-2026 verificando el turno de agenda contra la org real: a
// «¿Qué horarios tiene disponibles el taller de Guadalajara esta semana?» el agente
// contestó «el número de serie que mencionas para Guadalajara no corresponde a ninguna
// unidad registrada» y se negó a consultar horarios.
//
// La causa estaba en la app, no en el agente. El patrón que detecta un número de serie
// dictado —11 a 17 alfanuméricos sin I, O ni Q— acepta «Guadalajara»: once letras y
// ninguna de las tres excluidas. La app lo buscaba en el padrón, no lo encontraba, y le
// anteponía al agente un «DATO VERIFICADO» diciendo que esa unidad no existe. Es una de
// las nueve sucursales, así que el falso positivo caía en la pregunta más común.
//
// La regla que lo descarta ya existía en Apex (`vinEfectivo` exige al menos un dígito);
// en la app faltaba. Este archivo la fija en los dos sentidos: ningún nombre propio
// pasa por número de serie, y ningún número de serie real se pierde.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// El módulo carga la configuración al importarse y en producción exige proveedor de
// identidad. Aquí sólo se ejercita una función pura, así que se importa con el mismo
// entorno de desarrollo que usan los demás verificadores.
process.env.APP_ENV = 'development';
process.env.APP_AUTH_PROVIDER = 'disabled';
process.env.APP_AUTH_MODE = 'disabled';
const { vinMencionado } = await import('../src/servidor/rutas-publicas.ts');

describe('detección del número de serie dictado por el cliente', () => {
  it('no confunde el nombre de una sucursal con un número de serie', () => {
    // Las nueve sucursales, tal como las escribe un cliente.
    for (const sucursal of [
      'Guadalajara',
      'Monterrey',
      'Querétaro',
      'Puebla',
      'Chihuahua',
      'Hermosillo',
      'Mérida',
      'Aguascalientes',
      'Villahermosa',
    ]) {
      const texto = `¿Qué horarios tiene el taller de ${sucursal} esta semana?`;
      assert.equal(vinMencionado(texto), null, `«${sucursal}» no es un número de serie`);
    }
  });

  it('no confunde palabras corrientes largas con un número de serie', () => {
    for (const texto of [
      'necesito mantenimiento preventivo para mi flotilla',
      'quiero saber sobre la transmisión y el embrague',
      'mi camión se descompuso en la carretera federal',
      '¿cuánto cuesta el servicio de refacciones?',
    ]) {
      assert.equal(vinMencionado(texto), null, texto);
    }
  });

  it('sí reconoce un número de serie dictado', () => {
    assert.equal(
      vinMencionado('¿Qué cubre la garantía de mi unidad 9ZZZZZZZZZZ999999?'),
      '9ZZZZZZZZZZ999999',
    );
    assert.equal(vinMencionado('mi unidad es la 3HAMMAAR8LL123456'), '3HAMMAAR8LL123456');
    assert.equal(vinMencionado('vin 3hammaar8ll123456 por favor'), '3hammaar8ll123456');
  });

  it('encuentra el número de serie aunque una palabra corriente lo preceda', () => {
    // El candidato descartado no puede tapar al bueno: por eso se recorren todos.
    assert.equal(
      vinMencionado('El taller de Guadalajara revisó mi unidad 3HAMMAAR8LL123456'),
      '3HAMMAAR8LL123456',
    );
  });

  it('no se queda con un fragmento cuando el texto no lleva ninguno', () => {
    assert.equal(vinMencionado(''), null);
    assert.equal(vinMencionado('hola'), null);
  });
});
