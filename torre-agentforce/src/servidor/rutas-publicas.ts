// Rutas del sitio de clientes de Zapata. Sin login.
//
// Todo lo que pasa aquí tiene efecto REAL en Salesforce: el chat va contra el
// Agente Postventa, agendar crea un WorkOrder, reportar una varada crea un
// Unidad_Varada__c, y pedir un asesor abre un Case en la cola con su Log_Agente__c.
//
// El hilo que amarra todo es el `correlationId` de la sesión de visitante: se usa
// como `externalSessionKey` al abrir la sesión del agente, que Salesforce expone
// como `$Context.RoutableId`, que a su vez es lo que la acción de escalamiento
// guarda en `Correlation_Id__c`. Un solo identificador, de la primera pregunta del
// cliente hasta el Case que atiende el asesor.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

import { config } from './config.ts';
import { comoRespuestaHttp, BloqueoDePolitica, HttpRequestError } from './errores.ts';
import * as datos from './datos.ts';
import * as flows from './flows.ts';
import * as escalamiento from './escalamiento.ts';
import * as agente from './agente.ts';
import * as actividad from './actividad.ts';
import {
  crearSesion,
  leerSesion,
  exigirSesion,
  cerrarSesion,
  cabeceraCookie,
  cookieBorrada,
  verificarClaveAdmin,
  accesoAdminConfigurado,
  usuarioAdmin,
  type SesionWeb,
} from './visitante.ts';

/**
 * Cuánto puede esperar una conversación precalentada antes de darla por vieja. 90 s
 * cubre de sobra lo que tarda alguien en leer la pantalla y escribir su primer
 * mensaje, y queda muy por debajo de lo que aguanta una sesión de Agent API sin uso.
 */
const MS_SESION_PRECALENTADA_CADUCA = 90_000;

interface Contexto {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  cookies: string | undefined;
  seguro: boolean;
}

function json(res: ServerResponse, status: number, cuerpo: unknown, cookie?: string): void {
  const cabeceras: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (cookie) cabeceras['Set-Cookie'] = cookie;
  res.writeHead(status, cabeceras);
  res.end(JSON.stringify(cuerpo));
}

async function cuerpo<T>(req: IncomingMessage): Promise<T> {
  const trozos: Buffer[] = [];
  let total = 0;
  for await (const t of req) {
    total += (t as Buffer).length;
    if (total > 64 * 1024) throw new HttpRequestError(413, 'BODY_TOO_LARGE', 'El mensaje es demasiado largo.');
    trozos.push(t as Buffer);
  }
  const texto = Buffer.concat(trozos).toString('utf8');
  if (!texto) return {} as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new HttpRequestError(400, 'INVALID_JSON', 'El cuerpo de la petición no es JSON válido.');
  }
}

function exigirMetodo(req: IncomingMessage, metodo: string): void {
  if ((req.method ?? 'GET') !== metodo) {
    throw new HttpRequestError(405, 'METHOD_NOT_ALLOWED', `Esta ruta sólo acepta ${metodo}.`);
  }
}

/** Garantiza sesión de visitante, creándola si es la primera visita. */
function sesionVisitante(ctx: Contexto): { sesion: SesionWeb; cookie?: string } {
  const actual = leerSesion(ctx.cookies);
  if (actual) {
    // La sesión del asesor nace SIN correlación —la crea `/publico/acceso`, que no es
    // una visita— y sin esto la home del cliente reventaba para él: pedir la apertura
    // de conversación llamaba a `abrirSesion(null)` y el asistente aparecía como no
    // disponible. Le pasaba a cualquier asesor que tocara «Postventa» en la barra.
    if (!actual.correlationId) actual.correlationId = randomUUID();
    return { sesion: actual };
  }
  const nueva = crearSesion('visitante');
  // UUID puro, sin prefijo: la Agent API exige que `externalSessionKey` lo sea, y
  // este mismo valor viaja como $Context.RoutableId y termina en Correlation_Id__c.
  // Un prefijo como "web-" hacía que la apertura de sesión fallara y toda la
  // conversación se reportara como fallo del servicio.
  nueva.correlationId = randomUUID();
  return { sesion: nueva, cookie: cabeceraCookie(nueva, ctx.seguro) };
}

function vista(s: SesionWeb) {
  return {
    rol: s.rol,
    correlationId: s.correlationId,
    tieneEscalamiento: Boolean(s.caseId),
    conversacionAbierta: Boolean(s.agentSessionId),
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function rutasPublicas(ctx: Contexto): Promise<boolean> {
  const { req, res, url } = ctx;
  const p = url.pathname;

  // ── identidad de la visita ────────────────────────────────────────────────
  if (p === '/publico/sesion') {
    const { sesion, cookie } = sesionVisitante(ctx);
    json(res, 200, vista(sesion), cookie);
    return true;
  }

  if (p === '/publico/acceso') {
    exigirMetodo(req, 'POST');
    const b = await cuerpo<{ usuario?: string; clave?: string }>(req);
    if (!accesoAdminConfigurado()) {
      throw new HttpRequestError(
        503,
        'ACCESO_NO_CONFIGURADO',
        'El acceso de asesor no está configurado en este entorno. Define APP_ADMIN_PASS.',
      );
    }
    const usuarioOk = (b.usuario ?? '').trim().toLowerCase() === usuarioAdmin().toLowerCase();
    // Se evalúan las dos aunque la primera falle, para no filtrar cuál falló.
    const claveOk = verificarClaveAdmin(b.clave);
    if (!usuarioOk || !claveOk) {
      throw new HttpRequestError(401, 'CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos.');
    }
    cerrarSesion(ctx.cookies);
    const sesion = crearSesion('admin');
    json(res, 200, vista(sesion), cabeceraCookie(sesion, ctx.seguro));
    return true;
  }

  if (p === '/publico/salir') {
    exigirMetodo(req, 'POST');
    // Si quien sale traía una conversación con el asistente —el asesor la abre al usar
    // su herramienta de consulta— hay que cerrarla en la org. Las sesiones de Agent API
    // no caducan de inmediato y, acumuladas, la org empieza a rechazar las nuevas con
    // 400: es el mismo fallo que ya había costado caro en la conversación del cliente.
    const saliente = leerSesion(ctx.cookies);
    const sesionAgente = saliente?.agentSessionId ?? null;
    cerrarSesion(ctx.cookies);
    if (sesionAgente) {
      try {
        await agente.cerrarSesion(sesionAgente, 'UserRequest');
      } catch {
        // Salir nunca falla por esto: la sesión local ya se destruyó y la de la org
        // caduca sola. Se descarta del registro para no dejarla contada como viva.
        agente.descartarSesion(sesionAgente);
      }
    }
    json(res, 200, { ok: true }, cookieBorrada(ctx.seguro));
    return true;
  }

  // ── catálogo público del sitio ────────────────────────────────────────────
  if (p === '/publico/sucursales') {
    const r = await datos.listarSucursales();
    json(res, 200, {
      sucursales: r.registros.map((s) => ({
        clave: s.Codigo_Sucursal__c,
        nombre: s.Name,
        ciudad: s.Ciudad__c,
        direccion: s.Direccion__c,
        telefono: s.Telefono__c,
        horario: s.Horario_Atencion__c,
        horarioSabado: s.Horario_Sabado__c,
        abreDomingo: s.Abre_Domingo__c,
        anticipacionHoras: s.Anticipacion_Minima_Horas__c,
        marca: s.Marca_Principal__c,
      })),
    });
    return true;
  }

  if (p === '/publico/disponibilidad') {
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');
    if (!desde || !hasta) {
      throw new HttpRequestError(400, 'RANGO_REQUERIDO', 'Indica el rango de fechas.');
    }
    const r = await datos.listarSlots({ desde, hasta }, url.searchParams.get('sucursal') ?? undefined, {
      soloDisponibles: true,
      limite: 200,
    });
    json(res, 200, {
      franjas: r.registros.map((s) => ({
        id: s.Id,
        inicio: s.Inicio__c,
        fin: s.Fin__c,
        tipo: s.Tipo_Servicio__c,
        libres: s.Cupos_Libres__c,
        sucursal: s.Sucursal__r?.Codigo_Sucursal__c ?? null,
      })),
      total: r.total,
    });
    return true;
  }

  // ── garantía por VIN ──────────────────────────────────────────────────────
  if (p === '/publico/garantia') {
    exigirMetodo(req, 'POST');
    const b = await cuerpo<{ vin?: string }>(req);
    const vin = (b.vin ?? '').trim();
    if (vin.length < 6) {
      throw new HttpRequestError(400, 'VIN_INVALIDO', 'Escribe al menos 6 caracteres del número de serie.');
    }
    const encontradas = await datos.listarUnidades({ busqueda: vin });
    const unidad = encontradas.registros[0];
    if (!unidad) {
      json(res, 200, { encontrada: false, mensaje: 'No encontramos ninguna unidad con ese número de serie.' });
      return true;
    }
    const cobertura = await datos.evaluarCobertura(unidad.Id);
    json(res, 200, { encontrada: true, cobertura });
    return true;
  }

  // ── agendar servicio ──────────────────────────────────────────────────────
  if (p === '/publico/taller/agendar') {
    exigirMetodo(req, 'POST');
    const { sesion, cookie } = sesionVisitante(ctx);
    const b = await cuerpo<{
      vin?: string; slotId?: string; sucursalClave?: string; fecha?: string;
      tipoServicio?: string; sintoma?: string;
    }>(req);
    try {
      const r = await flows.crearOrdenServicio({
        vin: String(b.vin ?? ''),
        slotId: String(b.slotId ?? ''),
        sucursalClave: String(b.sucursalClave ?? ''),
        fechaDeseada: String(b.fecha ?? ''),
        tipoServicio: b.tipoServicio as never,
        sintoma: String(b.sintoma ?? ''),
        correlationId: sesion.correlationId!,
        sessionKey: sesion.correlationId!,
      });
      json(res, 200, { ok: true, ...r }, cookie);
    } catch (e) {
      if (e instanceof BloqueoDePolitica) {
        json(res, 200, { ok: false, ...e.aJSON() }, cookie);
        return true;
      }
      throw e;
    }
    return true;
  }

  // ── asistencia en carretera ───────────────────────────────────────────────
  if (p === '/publico/carretera/reportar') {
    exigirMetodo(req, 'POST');
    const { sesion, cookie } = sesionVisitante(ctx);
    const b = await cuerpo<Record<string, unknown>>(req);
    try {
      const r = await flows.crearReporteUnidadVarada({
        vin: String(b.vin ?? ''),
        carretera: String(b.carretera ?? ''),
        kilometro: b.kilometro === undefined || b.kilometro === '' ? undefined : Number(b.kilometro),
        sentido: b.sentido as never,
        referencia: String(b.referencia ?? ''),
        descripcionFalla: String(b.descripcionFalla ?? ''),
        codigosTablero: String(b.codigosTablero ?? ''),
        carga: b.carga as never,
        fueraDeCarril: Boolean(b.fueraDeCarril),
        intermitentes: Boolean(b.intermitentes),
        sucursalClave: String(b.sucursalClave ?? ''),
        correlationId: sesion.correlationId!,
        sessionKey: sesion.correlationId!,
      });
      json(res, 200, { ok: true, ...r }, cookie);
    } catch (e) {
      if (e instanceof BloqueoDePolitica) {
        json(res, 200, { ok: false, ...e.aJSON() }, cookie);
        return true;
      }
      throw e;
    }
    return true;
  }

  // ── conversación con el agente ────────────────────────────────────────────
  if (p === '/publico/agente/estado') {
    const est = await agente.estadoAgentAPI();
    json(res, 200, est);
    return true;
  }

  // Precalienta la conversación al cargar la página, no al mandar el primer mensaje.
  //
  // Antes el navegador preguntaba por `/publico/agente/estado` —que ABRE Y CIERRA una
  // sesión real sólo para sondear— y despues, al mandar el primer mensaje, se pagaba
  // otra vez: abrir sesión, 2.5 s de propagación y, si la org contestaba 400, la
  // escalera de 3+6+12 s. Medido contra la org: hasta ~50 s con el cliente mirando una
  // pantalla quieta, y una sesión desperdiciada por sondeo, que es justo lo que hace
  // que la org empiece a rechazar las nuevas.
  //
  // Ahora la apertura ES la comprobación de disponibilidad: se abre la sesión de la
  // visita mientras la persona lee la pantalla y escribe, y para cuando manda su
  // mensaje la sesión ya está propagada. No se gasta ninguna sesión de más.
  if (p === '/publico/agente/abrir') {
    exigirMetodo(req, 'POST');
    const { sesion, cookie } = sesionVisitante(ctx);

    if (sesion.agentSessionId) {
      json(res, 200, { disponible: true, causa: null, bienvenida: null, reusada: true }, cookie);
      return true;
    }

    const requisitos = await agente.estadoAgentAPI({ sondear: false });
    if (!requisitos.disponible) {
      // Falta configuración: decirlo aquí evita abrir una sesión que no puede existir.
      json(res, 200, { disponible: false, causa: requisitos.causa, bienvenida: null }, cookie);
      return true;
    }

    try {
      const abierta = await agente.abrirSesion(sesion.correlationId!);
      sesion.agentSessionId = abierta.sessionId;
      const bienvenida = (abierta.mensajesIniciales ?? []).map((m) => m.texto ?? '').filter(Boolean)[0] ?? null;
      if (bienvenida) sesion.saludado = true;
      json(res, 200, { disponible: true, causa: null, bienvenida }, cookie);
    } catch (e) {
      // La apertura falló de verdad contra la org. Se responde 200 con la causa en vez
      // de un error HTTP: la página sigue siendo útil —una persona sí puede atender— y
      // un 5xx aquí sólo la dejaría rota al cargar.
      const cuerpo = comoRespuestaHttp(e).cuerpo as { mensaje?: string };
      json(res, 200, { disponible: false, causa: cuerpo.mensaje ?? null, bienvenida: null }, cookie);
    }
    return true;
  }

  if (p === '/publico/agente/mensaje') {
    exigirMetodo(req, 'POST');
    const { sesion, cookie } = sesionVisitante(ctx);
    const b = await cuerpo<{ texto?: string }>(req);
    const texto = (b.texto ?? '').trim();
    if (!texto) throw new HttpRequestError(400, 'MENSAJE_VACIO', 'Escribe tu mensaje.');

    if (cookie) res.setHeader('Set-Cookie', cookie);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const emitir = (tipo: string, dato: unknown) =>
      res.write(`event: ${tipo}\ndata: ${JSON.stringify(dato)}\n\n`);

    /** Abre la conversación con el agente si la visita todavía no tiene una. */
    const abrirSiHaceFalta = async (): Promise<void> => {
      if (sesion.agentSessionId) return;
      // La clave externa ES la correlación de la visita: así el agente, sus Flows y
      // su acción de escalamiento escriben todos bajo el mismo hilo en Salesforce.
      const abierta = await agente.abrirSesion(sesion.correlationId!);
      sesion.agentSessionId = abierta.sessionId;
      // El saludo se manda UNA vez por visita. Cuando la primera sesión nace
      // inservible se descarta y se abre otra, y esa segunda trae otra bienvenida
      // idéntica: sin esta guarda el cliente veía dos saludos seguidos —tres con el
      // que la propia página pinta— antes de leer una sola respuesta.
      if (sesion.saludado) return;
      for (const m of abierta.mensajesIniciales ?? []) {
        // Evento propio, no `Inform`. El saludo de apertura NO es la respuesta al
        // turno que el cliente acaba de mandar, y darles el mismo nombre hacía
        // imposible distinguirlos desde fuera: cualquier comprobación sobre «lo que
        // contestó el agente» podía estar leyendo en realidad la bienvenida.
        emitir('Bienvenida', { texto: m.texto ?? '', tipo: 'Bienvenida' });
        sesion.saludado = true;
      }
    };

    /**
     * Lo que el agente hizo de verdad en este turno, releído de Salesforce.
     *
     * La Agent API no lo dice: `message.result` llega vacío por contrato, así que
     * tanto el apoyo visual como el cambio a asesor estaban colgados de un arreglo
     * que nunca traía nada. La fuente buena es `Log_Agente__c`, que las acciones
     * escriben con esta misma correlación. Si el agente escaló, aquí se entera el
     * servidor —no el navegador leyendo texto— y la ventana cambia de interlocutor.
     */
    const emitirActividadReal = async (): Promise<void> => {
      const registros = await actividad.actividadDeCorrelacion(
        sesion.correlationId!,
        sesion.actividadVista,
      );
      let casoEnLaTraza: { caseId: string; caseNumber: string } | null = null;
      for (const a of registros) {
        sesion.actividadVista.add(a.folio);
        emitir('Actividad', a);
        // La acción de escalamiento deja su Case en la propia traza, ya resuelto a
        // folio. Aprovecharlo ahorra una SOQL por turno: antes se leía la actividad y
        // acto seguido se volvía a preguntar por el Case de la misma correlación.
        if (a.detalle?.clase === 'caso' && a.registroId) {
          casoEnLaTraza = { caseId: a.registroId, caseNumber: a.detalle.folio };
        }
      }

      if (sesion.caseId) return;
      // Sólo si la traza no lo trajo se pregunta directamente. Pasa cuando el caso se
      // abrió en un turno anterior a los que esta visita ya vio.
      const abierto =
        casoEnLaTraza ?? (await escalamiento.escalamientoDeCorrelacion(sesion.correlationId!));
      if (!abierto) return;
      // El agente decidió que esto le toca a una persona. La conversación pasa a ser
      // del asesor sin que el cliente cambie de pantalla ni repita nada.
      sesion.caseId = abierto.caseId;
      emitir('Escalado', {
        caseId: abierto.caseId,
        caseNumber: abierto.caseNumber,
        correlationId: sesion.correlationId,
        origen: 'agente',
      });
    };

    try {
      // Una sesión precalentada que lleva rato esperando puede haber caducado del lado
      // de Salesforce. Cambiarla ANTES de mandar cuesta una apertura; mandarle el turno
      // y fallar cuesta el turno del cliente y, si el reintento tampoco prende, la
      // conversación entera. Sólo aplica a sesiones que nunca cursaron un turno.
      if (
        sesion.agentSessionId &&
        agente.sesionEnvejecidaSinUso(sesion.agentSessionId, MS_SESION_PRECALENTADA_CADUCA)
      ) {
        agente.descartarSesion(sesion.agentSessionId);
        sesion.agentSessionId = null;
      }
      await abrirSiHaceFalta();
      let emitido = 0;
      try {
        for await (const ev of agente.enviarMensajeStream(sesion.agentSessionId!, texto)) {
          emitido++;
          emitir(ev.tipo, ev);
        }
      } catch (e) {
        // Salesforce entrega de vez en cuando una sesión que nunca acepta un mensaje:
        // contesta 400 al primer turno y a todos los siguientes, así que la visita se
        // queda con una conversación muerta y el cliente sólo ve errores. Cuando pasa
        // eso —sesión sin ningún turno bueno, fallo de contrato, y nada emitido aún—
        // se descarta y se abre otra UNA vez. No se reabre una sesión que sí llegó a
        // funcionar: ahí reabrir perdería el hilo de la conversación en curso.
        const reabrible =
          emitido === 0 &&
          e instanceof agente.ErrorAgentAPI &&
          e.clase === 'peticion_invalida' &&
          !agente.sesionTuvoTurnoExitoso(sesion.agentSessionId!);
        if (!reabrible) throw e;

        console.warn(
          JSON.stringify({
            event: 'agente_sesion_inservible',
            accion: 'se descarta y se abre otra',
            clase: e.clase,
          }),
        );
        agente.descartarSesion(sesion.agentSessionId!);
        sesion.agentSessionId = null;
        await abrirSiHaceFalta();
        for await (const ev of agente.enviarMensajeStream(sesion.agentSessionId!, texto)) {
          emitir(ev.tipo, ev);
        }
      }
      // Después del turno, no antes: las acciones se registran mientras el agente
      // responde, así que preguntarle a la org antes de que el flujo termine leería
      // una foto vieja.
      try {
        await emitirActividadReal();
      } catch (e) {
        // Que no se pueda releer la traza no invalida la respuesta que el cliente ya
        // leyó. Se avisa en el log del servidor y la conversación sigue.
        console.warn(
          JSON.stringify({
            event: 'actividad_no_releida',
            motivo: e instanceof Error ? e.message : String(e),
          }),
        );
      }
      emitir('Fin', { correlationId: sesion.correlationId });
    } catch (e) {
      // El fallo viaja por el mismo canal: si se cerrara callado, el cliente se
      // quedaría mirando un "escribiendo…" eterno.
      const r = comoRespuestaHttp(e);
      emitir('Error', r.cuerpo);
    } finally {
      res.end();
    }
    return true;
  }

  if (p === '/publico/agente/cerrar') {
    exigirMetodo(req, 'POST');
    const { sesion, cookie } = sesionVisitante(ctx);
    const sessionId = sesion.agentSessionId;
    if (!sessionId) {
      json(res, 200, { cerrada: false, motivo: 'no habia conversacion abierta' }, cookie);
      return true;
    }
    // La visita se olvida de la sesión pase lo que pase: si Salesforce no confirmara
    // el cierre, insistir dejaría al cliente atado a una conversación que ya no
    // puede usar. La sesión caduca sola del lado de la org.
    sesion.agentSessionId = null;
    try {
      await agente.cerrarSesion(sessionId, 'UserRequest');
      json(res, 200, { cerrada: true }, cookie);
    } catch {
      agente.descartarSesion(sessionId);
      json(res, 200, { cerrada: false, motivo: 'la organizacion no confirmo el cierre' }, cookie);
    }
    return true;
  }

  // ── escalamiento: el cliente pide un asesor ───────────────────────────────
  if (p === '/publico/asesor/abrir') {
    exigirMetodo(req, 'POST');
    const { sesion, cookie } = sesionVisitante(ctx);
    const b = await cuerpo<{ asunto?: string; mensaje?: string; turnos?: Array<{ autor: string; texto: string }> }>(req);

    if (sesion.caseId) {
      // Ya tiene conversación abierta: se devuelve la misma, no se abre otra.
      json(res, 200, { caseId: sesion.caseId, correlationId: sesion.correlationId, reusada: true }, cookie);
      return true;
    }

    // El agente pudo haber escalado por su cuenta durante la conversación, con la
    // misma correlación y su propio motivo. Insistir en abrir otro chocaría con la
    // idempotencia de Apex y devolvería un error donde en realidad hay un éxito: el
    // cliente YA tiene un caso con un asesor. Se reconoce y se adopta.
    const yaAbierto = await escalamiento.escalamientoDeCorrelacion(sesion.correlationId!);
    if (yaAbierto) {
      sesion.caseId = yaAbierto.caseId;
      json(
        res,
        200,
        {
          caseId: yaAbierto.caseId,
          caseNumber: yaAbierto.caseNumber,
          correlationId: sesion.correlationId,
          reusada: true,
          abiertoPor: 'agente',
        },
        cookie,
      );
      return true;
    }

    const mensaje = (b.mensaje ?? '').trim();
    if (!mensaje) throw new HttpRequestError(400, 'MOTIVO_REQUERIDO', 'Cuéntanos brevemente qué necesitas.');

    const turnos = Array.isArray(b.turnos)
      ? b.turnos
          .filter((t) => t && typeof t.texto === 'string' && t.texto.trim())
          .slice(-40)
          .map((t) => ({ autor: t.autor === 'agente' ? 'agente' : 'cliente', texto: String(t.texto).slice(0, 4000) }))
      : [];

    const abierto = await escalamiento.abrirEscalamiento({
      correlationId: sesion.correlationId!,
      asunto: (b.asunto ?? 'Un cliente pidió hablar con un asesor').slice(0, 240),
      contexto: mensaje,
      politicaAplicada: 'K_ESCALAMIENTO_CLIENTE',
      transcripcion: turnos.length ? turnos : [{ autor: 'cliente', texto: mensaje }],
    } as never);

    sesion.caseId = abierto.caseId;
    json(res, 200, { ...abierto, reusada: false }, cookie);
    return true;
  }

  if (p === '/publico/asesor/conversacion') {
    const sesion = exigirSesion(ctx.cookies);
    if (!sesion.caseId) {
      json(res, 200, { abierta: false, comentarios: [] });
      return true;
    }
    // Vista del cliente: sólo lo publicado. Las notas internas del expediente
    // —resumen para el asesor, contexto estructurado y transcripción— las inserta
    // Apex con IsPublished=false a propósito y no cruzan a esta superficie.
    const conv = await escalamiento.conversacion(sesion.caseId, { soloPublicados: true });
    json(res, 200, { abierta: true, ...conv });
    return true;
  }

  if (p === '/publico/asesor/responder') {
    exigirMetodo(req, 'POST');
    const sesion = exigirSesion(ctx.cookies);
    if (!sesion.caseId) {
      throw new HttpRequestError(409, 'SIN_CONVERSACION', 'Todavía no has abierto una conversación con un asesor.');
    }
    const b = await cuerpo<{ cuerpo?: string }>(req);
    // El caseId sale de la sesión del servidor, nunca del cuerpo: un visitante no
    // puede escribir en el caso de otro aunque conozca su Id.
    const comentarios = await escalamiento.responder({
      caseId: sesion.caseId,
      cuerpo: String(b.cuerpo ?? ''),
      autor: 'cliente',
    });
    json(res, 200, { comentarios });
    return true;
  }

  if (p === '/publico/asesor/stream') {
    const sesion = exigirSesion(ctx.cookies);
    if (!sesion.caseId) {
      throw new HttpRequestError(409, 'SIN_CONVERSACION', 'No hay conversación que seguir.');
    }
    abrirSse(res);
    const cancelar = escalamiento.suscribirComentarios(sesion.caseId, (ev) => {
      res.write(`event: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`);
    });
    const latido = setInterval(() => res.write(': latido\n\n'), 20_000);
    res.on('close', () => {
      clearInterval(latido);
      cancelar();
    });
    return true;
  }

  // ── panel del asesor (exige haber entrado) ────────────────────────────────
  if (p === '/publico/panel/bandeja') {
    exigirSesion(ctx.cookies, 'admin');
    json(res, 200, { casos: await escalamiento.bandejaAsesor() });
    return true;
  }

  if (p.startsWith('/publico/panel/caso/')) {
    exigirSesion(ctx.cookies, 'admin');
    const resto = p.slice('/publico/panel/caso/'.length);
    const [caseId, sufijo] = resto.split('/');
    if (!caseId) throw new HttpRequestError(400, 'CASO_REQUERIDO', 'Falta el identificador del caso.');

    if (sufijo === 'stream') {
      abrirSse(res);
      const cancelar = escalamiento.suscribirComentarios(caseId, (ev) => {
        res.write(`event: ${ev.tipo}\ndata: ${JSON.stringify(ev)}\n\n`);
      });
      const latido = setInterval(() => res.write(': latido\n\n'), 20_000);
      res.on('close', () => {
        clearInterval(latido);
        cancelar();
      });
      return true;
    }

    // ── el asesor le pregunta al asistente ──────────────────────────────────
    //
    // Un asesor que atiende un escalamiento necesita los mismos datos que el agente
    // sabe consultar —cobertura por VIN, franjas del taller, la base de conocimiento—
    // y hasta ahora no tenía forma de pedirlos sin salirse del panel.
    //
    // La consulta es PRIVADA: corre en una sesión de Agent API propia del asesor, con
    // su propia correlación, y no escribe nada en el expediente del cliente. El
    // cliente no ve esta pregunta ni esta respuesta; sólo verá lo que el asesor
    // decida escribirle. Correlación separada a propósito: si el asistente decidiera
    // escalar durante la consulta, abriría un caso del asesor, nunca tocaría el del
    // cliente ni lo reasignaría.
    if (sufijo === 'consultar') {
      exigirMetodo(req, 'POST');
      const sesionAsesor = exigirSesion(ctx.cookies, 'admin');
      const b = await cuerpo<{ pregunta?: string }>(req);
      const pregunta = (b.pregunta ?? '').trim();
      if (!pregunta) {
        throw new HttpRequestError(400, 'PREGUNTA_VACIA', 'Escribe qué quieres consultarle al asistente.');
      }

      if (!sesionAsesor.correlationId) sesionAsesor.correlationId = randomUUID();

      const abrirConsulta = async (): Promise<string> => {
        if (sesionAsesor.agentSessionId) return sesionAsesor.agentSessionId;
        const abierta = await agente.abrirSesion(sesionAsesor.correlationId!);
        sesionAsesor.agentSessionId = abierta.sessionId;
        return abierta.sessionId;
      };

      let respuesta: string;
      try {
        respuesta = (await agente.enviarMensajeSync(await abrirConsulta(), pregunta)).texto;
      } catch (e) {
        // Misma cura que en la conversación del cliente: Salesforce entrega de vez en
        // cuando una sesión que nunca acepta un mensaje. Se descarta y se abre otra
        // una sola vez, en lugar de devolverle un error al asesor que tiene enfrente
        // a un cliente esperando.
        const reabrible =
          e instanceof agente.ErrorAgentAPI &&
          e.clase === 'peticion_invalida' &&
          !agente.sesionTuvoTurnoExitoso(sesionAsesor.agentSessionId!);
        if (!reabrible) throw e;
        agente.descartarSesion(sesionAsesor.agentSessionId!);
        sesionAsesor.agentSessionId = null;
        respuesta = (await agente.enviarMensajeSync(await abrirConsulta(), pregunta)).texto;
      }

      // Lo que el asistente ejecutó para contestar, releído de la org igual que en la
      // conversación del cliente. Al asesor le importa saber si la respuesta salió de
      // una consulta real o de la base de conocimiento sintética.
      let ejecutado: actividad.ActividadAgente[] = [];
      try {
        ejecutado = await actividad.actividadDeCorrelacion(
          sesionAsesor.correlationId,
          sesionAsesor.actividadVista,
        );
        for (const a of ejecutado) sesionAsesor.actividadVista.add(a.folio);
      } catch {
        // La traza es informativa; su ausencia no invalida la respuesta.
      }

      json(res, 200, { respuesta, actividad: ejecutado });
      return true;
    }

    if (sufijo === 'responder') {
      exigirMetodo(req, 'POST');
      const b = await cuerpo<{ cuerpo?: string }>(req);
      const comentarios = await escalamiento.responder({
        caseId,
        cuerpo: String(b.cuerpo ?? ''),
        autor: 'asesor',
      });
      json(res, 200, { comentarios });
      return true;
    }

    json(res, 200, await escalamiento.conversacion(caseId));
    return true;
  }

  return false;
}

function abrirSse(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}
