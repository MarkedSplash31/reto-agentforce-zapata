// Comprueba que `suscribirComentarios` sobrevive a una caída de red REAL.
//
// No se simula el fallo ni se parchea nada: el proceso padre lanza este script con
// SF_LOGIN_URL apuntando a un puerto donde no hay nada escuchando, así que `fetch`
// devuelve ECONNREFUSED de verdad y `sf.ts` lo convierte en un ErrorSalesforce real.
// Es la reproducción más barata del escenario que el contrato exige aguantar.
//
//   node --experimental-strip-types scripts/prueba-sondeo-red-caida.ts <caseId>
//
// Imprime una sola línea JSON en stdout para que el padre la incorpore a su evidencia.

import { suscribirComentarios, type EventoComentarios } from '../src/servidor/escalamiento.ts';

const caseId = process.argv[2];
if (typeof caseId !== 'string' || caseId === '') {
  throw new Error('falta el caseId como primer argumento');
}

const eventos: EventoComentarios[] = [];
const cancelar = suscribirComentarios(caseId, (e) => eventos.push(e), { intervaloMs: 800 });

// 9 s dan para varias rondas incluso contando lo que tarda el CLI en soltar el token
// en la primera (spawn de `sf`, ~3 s); a partir de ahí el token está en caché y cada
// ronda falla rápido contra el puerto muerto.
await new Promise((r) => setTimeout(r, 9000));
const antesDeCancelar = eventos.length;
cancelar();
await new Promise((r) => setTimeout(r, 2500));

const errores = eventos.filter(
  (e): e is Extract<EventoComentarios, { tipo: 'error' }> => e.tipo === 'error',
);

process.stdout.write(
  JSON.stringify({
    loginUrl: process.env.SF_LOGIN_URL,
    totalEventos: eventos.length,
    errores: errores.length,
    comentarios: eventos.filter((e) => e.tipo === 'comentario').length,
    eventosAntesDeCancelar: antesDeCancelar,
    eventosDespuesDeCancelar: eventos.length,
    mensajes: errores.map((e) => e.mensaje),
    fallosSeguidos: errores.map((e) => e.fallosSeguidos),
    muestra: errores[0] ?? null,
  }) + '\n',
);
