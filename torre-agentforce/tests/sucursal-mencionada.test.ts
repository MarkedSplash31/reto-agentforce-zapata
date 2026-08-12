// Que la pantalla abra la agenda del taller que el cliente nombró, y sólo entonces.
//
// El precedente pesa: `vinMencionado` aceptaba «Guadalajara» como número de serie
// —once letras, ninguna I, O ni Q— y el agente le contestaba a quien preguntaba por
// ese taller que su unidad no existía. Un falso positivo en la pregunta más común
// del cliente. Aquí se comprueba un HECHO contra el catálogo real, no una intención,
// y estas pruebas fijan dónde está el límite.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// El módulo carga la configuración al importarse y en producción exige proveedor de
// identidad. Aquí sólo se ejercita una función pura, así que se importa con el mismo
// entorno de desarrollo que usan los demás verificadores.
process.env.APP_ENV = 'development';
process.env.APP_AUTH_PROVIDER = 'disabled';
process.env.APP_AUTH_MODE = 'disabled';
const { sucursalMencionada } = await import('../src/servidor/rutas-publicas.ts');

/** Las nueve, tal como salen de `/publico/sucursales`. El catálogo guarda las
 *  ciudades SIN acento: quien escribe bien no puede quedarse fuera. */
const RED = [
  { clave: 'FL-AER', ciudad: 'Texcoco, Estado de Mexico', nombre: 'Zapata Camiones Aeropuerto' },
  { clave: 'FL-CEL', ciudad: 'Celaya, Guanajuato', nombre: 'Zapata Camiones Celaya' },
  { clave: 'FL-GDL', ciudad: 'Zapopan, Jalisco', nombre: 'Zapata Camiones Zapopan' },
  { clave: 'FL-GDLRM', ciudad: 'Guadalajara, Jalisco', nombre: 'Zapata Camiones Guadalajara' },
  { clave: 'FL-LEO', ciudad: 'Leon, Guanajuato', nombre: 'Zapata Camiones Leon' },
  { clave: 'FL-MTY', ciudad: 'Apodaca, Nuevo Leon', nombre: 'Zapata Camiones Apodaca' },
  { clave: 'FL-QRO', ciudad: 'Queretaro, Queretaro', nombre: 'Zapata Camiones Queretaro' },
  { clave: 'FL-TAM', ciudad: 'Altamira, Tamaulipas', nombre: 'Zapata Camiones Altamira' },
  { clave: 'FL-TLA', ciudad: 'Tlalnepantla, Estado de Mexico', nombre: 'Zapata Camiones Tlalnepantla' },
];

describe('el taller que el cliente nombró', () => {
  it('reconoce la ciudad aunque el cliente escriba con acento', () => {
    assert.equal(sucursalMencionada('Quiero agendar en Querétaro', RED), 'FL-QRO');
    assert.equal(sucursalMencionada('el taller de Leon por favor', RED), 'FL-LEO');
  });

  it('reconoce el código del taller', () => {
    assert.equal(sucursalMencionada('agenda en FL-MTY', RED), 'FL-MTY');
    assert.equal(sucursalMencionada('prefiero fl-tam', RED), 'FL-TAM');
  });

  it('reconoce el nombre completo del taller', () => {
    assert.equal(sucursalMencionada('Zapata Camiones Zapopan me queda cerca', RED), 'FL-GDL');
  });

  it('no confunde una ciudad con una palabra que la contiene', () => {
    // «leon» dentro de «leonardo» no nombra el taller de León.
    assert.equal(sucursalMencionada('me atendio Leonardo la vez pasada', RED), null);
    assert.equal(sucursalMencionada('la unidad es de la flota Celayanense', RED), null);
  });

  it('no inventa un taller cuando el cliente no nombra ninguno', () => {
    assert.equal(sucursalMencionada('Mi unidad pierde potencia en subida', RED), null);
    assert.equal(sucursalMencionada('', RED), null);
    assert.equal(sucursalMencionada('   ', RED), null);
  });

  it('el código gana sobre la ciudad cuando aparecen los dos', () => {
    // Guadalajara y Zapopan son dos talleres distintos de la misma zona; si el
    // cliente dicta el código, ese código manda.
    assert.equal(sucursalMencionada('en FL-GDLRM, no en Zapopan', RED), 'FL-GDLRM');
  });

  it('no se dispara con un catálogo vacío', () => {
    assert.equal(sucursalMencionada('Querétaro', []), null);
  });
});
