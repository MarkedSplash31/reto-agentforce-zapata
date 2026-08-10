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
  if (actual) return { sesion: actual };
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
    cerrarSesion(ctx.cookies);
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
      for (const m of abierta.mensajesIniciales ?? []) {
        // Evento propio, no `Inform`. El saludo de apertura NO es la respuesta al
        // turno que el cliente acaba de mandar, y darles el mismo nombre hacía
        // imposible distinguirlos desde fuera: cualquier comprobación sobre «lo que
        // contestó el agente» podía estar leyendo en realidad la bienvenida.
        emitir('Bienvenida', { texto: m.texto ?? '', tipo: 'Bienvenida' });
      }
    };

    try {
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
