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

/**
 * Un número de serie tal como lo teclea un cliente: 11 a 17 alfanuméricos, sin I, O
 * ni Q, que el estándar de VIN excluye para no confundirlas con 1 y 0.
 *
 * Se busca cada candidato, no sólo el primero: la letra que lo descarta —que lleve al
 * menos un dígito— sólo se puede aplicar candidato por candidato.
 */
const POSIBLES_VIN = /\b[A-HJ-NPR-Z0-9]{11,17}\b/gi;

/**
 * El número de serie que el cliente dictó, o `null` si no dictó ninguno.
 *
 * El dígito obligatorio no es un adorno. Sin él, «Guadalajara» —once letras, ninguna
 * I, O ni Q— pasa por número de serie, la app lo busca en el padrón, no lo encuentra y
 * el agente le contesta a quien preguntó por el taller de Guadalajara que su unidad no
 * existe. Es una de las nueve sucursales, así que el falso positivo caía justo en la
 * pregunta más común. Un nombre propio no lleva dígitos; un número de serie sí.
 *
 * Es la misma regla que ya aplicaba `BuscarConocimientoPostventa.vinEfectivo` en Apex;
 * aquí faltaba.
 */
export function vinMencionado(texto: string): string | null {
  for (const [candidato] of texto.matchAll(POSIBLES_VIN)) {
    if (/[0-9]/.test(candidato)) return candidato;
  }
  return null;
}

/** Sin acentos y en minúsculas, igual que hace `ZapataAgendaController` en Apex. */
function plegar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * El taller que el cliente nombró, o `null`.
 *
 * Mismo criterio que `vinMencionado`: no se adivina una intención, se comprueba un
 * HECHO contra el catálogo real de la org. Que alguien escriba «Querétaro» y que
 * Querétaro sea uno de los nueve talleres es un dato, no una interpretación.
 *
 * Se cotejan el código, la ciudad y el nombre, plegando acentos —el catálogo guarda
 * «Queretaro» sin acento y quien escribe bien no puede quedarse fuera; ese defecto ya
 * costó que ningún cliente pudiera agendar en Querétaro—. La ciudad exige límite de
 * palabra para que «leon» no se dispare dentro de «leonardo».
 */
export function sucursalMencionada(
  texto: string,
  sucursales: ReadonlyArray<{ clave?: string | null; ciudad?: string | null; nombre?: string | null }>,
): string | null {
  const plano = plegar(texto ?? '');
  if (!plano.trim()) return null;

  const nombra = (valor: string): boolean => {
    const v = valor.trim();
    if (v.length < 4) return false;
    // Límite de palabra propio: `\b` trata el guion como frontera y `fl-gdl` casaría
    // dentro de `fl-gdlrm`. Aquí la frontera son los caracteres que no forman parte
    // de un código ni de un nombre.
    const escapado = v.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9-])${escapado}([^a-z0-9-]|$)`).test(plano);
  };

  // Los códigos, del más largo al más corto: si el cliente dicta `FL-GDLRM`, ese
  // gana sobre `FL-GDL`, que es prefijo suyo y designa otro taller.
  const porCodigo = [...sucursales]
    .filter((s) => (s.clave ?? '').trim().length >= 4)
    .sort((a, b) => (b.clave ?? '').length - (a.clave ?? '').length);
  for (const s of porCodigo) {
    if (nombra(plegar(s.clave ?? ''))) return s.clave ?? null;
  }

  for (const s of sucursales) {
    // `Ciudad__c` viene como «Queretaro, Queretaro» o «Apodaca, Nuevo Leon»: lo que
    // el cliente escribe es la ciudad, no la cadena entera con su estado.
    const ciudad = plegar(s.ciudad ?? '').split(',')[0] ?? '';
    if (nombra(ciudad)) return s.clave ?? null;
  }

  for (const s of sucursales) {
    if (nombra(plegar(s.nombre ?? ''))) return s.clave ?? null;
  }
  return null;
}

/**
 * El catálogo de talleres, releído como mucho una vez por minuto.
 *
 * Cada turno de conversación lo consultaría si no: son nueve filas que no cambian
 * entre mensajes, y la cuota diaria de API de la org es finita —agotarla deja al
 * sitio sin catálogo, sin cobertura y sin disponibilidad—.
 */
const MS_CATALOGO_FRESCO = 60_000;
let catalogoTalleres: { en: number; lista: Array<{ clave: string | null; ciudad: string | null; nombre: string }> } | null =
  null;

async function talleres(): Promise<Array<{ clave: string | null; ciudad: string | null; nombre: string }>> {
  if (catalogoTalleres && Date.now() - catalogoTalleres.en < MS_CATALOGO_FRESCO) return catalogoTalleres.lista;
  const r = await datos.listarSucursales();
  const lista = r.registros.map((s) => ({
    clave: s.Codigo_Sucursal__c,
    ciudad: s.Ciudad__c,
    nombre: s.Name,
  }));
  catalogoTalleres = { en: Date.now(), lista };
  return lista;
}

/**
 * Antepone al mensaje del cliente lo que la ORG dice sobre el número de serie que
 * mencionó, si mencionó alguno.
 *
 * El hecho lo aporta Salesforce —se busca el `Asset`—; la app sólo lo consulta a
 * tiempo. Nada aquí afirma nada por su cuenta: si la unidad existe no se añade una
 * sola palabra, y si no existe se dice exactamente eso.
 */
async function conAvisoDeUnidad(texto: string): Promise<string> {
  const vin = vinMencionado(texto);
  if (!vin) return texto;
  try {
    const encontradas = await datos.listarUnidades({ busqueda: vin });
    if (encontradas.registros.length > 0) return texto;
  } catch {
    // Si la org no responde no se inventa un veredicto: el turno sigue tal cual.
    return texto;
  }
  return (
    `[DATO VERIFICADO EN EL PADRON DE ZAPATA: el numero de serie ${vin} NO corresponde a ` +
    `ninguna unidad registrada. Diselo al cliente ANTES de cualquier otra cosa y no ` +
    `presentes la poliza general como si fuera la cobertura de esa unidad.]\n\n${texto}`
  );
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

    // Si la visita traía un escalamiento, hay que preguntar por él ANTES de decir
    // que sigue vigente. Nada liberaba nunca `caseId`: una vez escalado, cada
    // recarga devolvía al cliente con el asesor para siempre, incluso después de
    // que ese asesor cerrara el caso —y un caso cerrado ya no aparece en su
    // bandeja, así que el cliente seguía escribiéndole a nadie—.
    let escalamiento_: { caseNumber: string; estado: string | null } | null = null;
    let recienCerrado = false;
    if (sesion.caseId) {
      try {
        const estado = await escalamiento.estadoDeCaso(sesion.caseId);
        if (!estado || estado.cerrado) {
          sesion.caseId = null;
          recienCerrado = Boolean(estado?.cerrado);
          if (estado) escalamiento_ = { caseNumber: estado.caseNumber, estado: estado.estado };
        } else {
          escalamiento_ = { caseNumber: estado.caseNumber, estado: estado.estado };
        }
      } catch {
        // Si la org no contesta no se suelta el caso: soltarlo por un fallo de red
        // mandaría al cliente con el asistente teniendo una persona asignada.
      }
    }

    json(res, 200, { ...vista(sesion), escalamiento: escalamiento_, escalamientoCerrado: recienCerrado }, cookie);
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

  // ── el material de apoyo, legible sin conversación ────────────────────────
  //
  // Es el MISMO material que el agente cita. Hasta ahora sólo salía por su boca,
  // recortado dentro de una respuesta; quien quería leer qué dice sobre su modelo
  // tenía que negociarlo por chat. La marca de fuente viaja con cada artículo: el
  // Apex antepone un aviso de material sintético no verificado y esta ruta no lo
  // borra, porque presentarlo como manual oficial sería la mentira que ese aviso
  // existe para impedir.
  if (p === '/publico/manuales') {
    const r = await datos.listarConocimiento(url.searchParams.get('busca') ?? undefined);
    json(res, 200, {
      articulos: r.registros,
      total: r.total,
      aviso:
        'Material de apoyo del reto. No es documentación oficial de Zapata: no debe ' +
        'tomarse como confirmada sin verificarla con una fuente operacional.',
    });
    return true;
  }

  // ── qué cubre cada modelo, sin pedir número de serie ──────────────────────
  //
  // La cobertura de una unidad concreta necesita su VIN: depende de su odómetro y
  // de su antigüedad. La póliza del MODELO no. Es la misma para toda la línea, y
  // quien está considerando un camión —o quiere saber qué le tocaba al suyo— tiene
  // derecho a leerla sin demostrar que posee uno. Sale de `Regla_Cobertura__c`,
  // las mismas reglas con las que se evalúa una unidad.
  //
  // Se publica una proyección, no el catálogo administrativo. La comparación
  // contra los parámetros base —dónde la póliza y la fórmula se contradicen— es un
  // hallazgo de auditoría interna y se queda en `/api/politicas`.
  if (p === '/publico/modelos') {
    const catalogo = await datos.catalogoDePoliticas();
    interface SistemaPublico {
      sistema: string;
      mesesLimite: number | null;
      kmLimite: number | null;
      sinLimiteKm: boolean;
      esExtendida: boolean;
    }
    const porModelo = new Map<string, SistemaPublico[]>();
    for (const entrada of catalogo.entradas) {
      for (const modelo of entrada.modelos) {
        const sistemas = porModelo.get(modelo) ?? [];
        sistemas.push({
          sistema: entrada.sistema,
          mesesLimite: entrada.mesesLimite,
          kmLimite: entrada.kmLimite,
          sinLimiteKm: entrada.sinLimiteKm,
          esExtendida: entrada.esExtendida,
        });
        porModelo.set(modelo, sistemas);
      }
    }
    const modelos = [...porModelo.entries()]
      .map(([nombre, sistemas]) => ({
        nombre,
        sistemas: sistemas.sort(
          (a, b) => Number(a.esExtendida) - Number(b.esExtendida) || a.sistema.localeCompare(b.sistema),
        ),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    // Hoy los cuatro modelos comparten regla, sistema por sistema. Un selector que
    // deja elegir modelo y siempre contesta lo mismo insinúa una comparación que no
    // existe: quien la usa cree estar comparando y no aprende nada. Se dice.
    const firma = (m: (typeof modelos)[number]) =>
      m.sistemas
        .map((s) => `${s.sistema}|${s.mesesLimite}|${s.kmLimite}|${s.sinLimiteKm}|${s.esExtendida}`)
        .join('·');
    const mismaPolizaParaTodos = modelos.length > 1 && new Set(modelos.map(firma)).size === 1;

    json(res, 200, {
      base: catalogo.parametros
        ? { meses: catalogo.parametros.Meses_Base__c, km: catalogo.parametros.Km_Base__c }
        : null,
      mismaPolizaParaTodos,
      modelos,
    });
    return true;
  }

  if (p === '/publico/disponibilidad') {
    const desde = url.searchParams.get('desde');
    const hasta = url.searchParams.get('hasta');
    if (!desde || !hasta) {
      throw new HttpRequestError(400, 'RANGO_REQUERIDO', 'Indica el rango de fechas.');
    }
    // Se piden TODAS y se parten aquí, en vez de dejar que el SOQL descarte las que
    // no son agendables.
    //
    // Con `soloDisponibles` la respuesta era una lista vacía para ocho de los nueve
    // talleres, y la pantalla decía «este taller no tiene franjas libres». Es falso:
    // tienen 38 cada uno, con cupo. Lo que no tienen es procedencia verificada, así
    // que no se pueden apartar —y el guardrail es correcto: la validation rule de
    // WorkOrder rechaza una franja sin procedencia acreditada—. Pero un taller lleno
    // y un taller cuya capacidad nadie ha confirmado no se pueden ver igual.
    const r = await datos.listarSlots({ desde, hasta }, url.searchParams.get('sucursal') ?? undefined, {
      limite: 400,
    });
    const agendables = r.registros.filter((s) => s.agendable);
    const sinCupo = r.registros.filter((s) => s.Disponible__c === false).length;
    const noVerificadas = r.registros.filter((s) => s.Disponible__c !== false && !s.agendable).length;

    json(res, 200, {
      franjas: agendables.map((s) => ({
        id: s.Id,
        inicio: s.Inicio__c,
        fin: s.Fin__c,
        tipo: s.Tipo_Servicio__c,
        libres: s.Cupos_Libres__c,
        sucursal: s.Sucursal__r?.Codigo_Sucursal__c ?? null,
      })),
      total: agendables.length,
      /** Lo que existe pero no se puede ofrecer, y por qué. */
      noOfrecidas: {
        sinCupo,
        noVerificadas,
        motivo: noVerificadas
          ? 'Este taller tiene horarios en el catálogo, pero su capacidad no está confirmada con el taller, así que no se pueden apartar desde aquí.'
          : null,
      },
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

    // La compuerta de modelo, ANTES de invocar el Flow.
    //
    // El agente no ofrece un taller que no atiende el modelo de la unidad: la
    // comprueba `ZapataAgendaController`. El Flow que crea la orden NO la aplica, así
    // que esta ruta —que llega directo a él— podía registrar una cita imposible. Pasó:
    // la orden 00000072 quedó para un T680 en un taller que no atiende ese modelo.
    // Un guardrail que sólo cubre uno de los dos caminos no es un guardrail.
    const vinPedido = String(b.vin ?? '').trim();
    const clavePedida = String(b.sucursalClave ?? '').trim();
    if (vinPedido && clavePedida) {
      const encontradas = await datos.listarUnidades({ busqueda: vinPedido });
      const unidad = encontradas.registros[0];
      if (unidad?.Product2Id) {
        const atienden = await datos.talleresDelModelo(unidad.Product2Id);
        if (!atienden.includes(clavePedida)) {
          json(
            res,
            200,
            {
              ok: false,
              bloqueado: true,
              motivo: 'MODELO_NO_ATENDIDO',
              mensaje:
                `Ese taller no da servicio al modelo de tu unidad` +
                (atienden.length
                  ? `. Sí lo atienden: ${atienden.join(', ')}.`
                  : `, y hoy no hay ningún taller de la red dado de alta para ese modelo. Un asesor puede revisarlo contigo.`),
              talleresQueAtienden: atienden,
            },
            sesionVisitante(ctx).cookie,
          );
          return true;
        }
      }
    }

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

    // Si el cliente dictó un número de serie, se comprueba contra la org ANTES de
    // pasarle el turno al agente, y el resultado viaja con el mensaje.
    //
    // Por qué aquí y no en la instrucción del agente: se intentó seis veces que el
    // planner mandara el VIN a la acción de conocimiento —declararlo en el esquema,
    // pedirlo en la instrucción, marcarlo `is_user_input`, extraerlo del texto en
    // Apex, incrustar el aviso en el contenido— y en las seis siguió contestando la
    // póliza general sin decir que esa unidad no existe. Quien se equivoca de un
    // dígito lee esa póliza como si fuera su cobertura.
    //
    // Esto no es un dato inventado ni escrito a mano: la respuesta sale de consultar
    // `Asset` en Salesforce. Lo único que hace la app es preguntarlo a tiempo y
    // ponérselo delante al agente, en vez de confiar en que se acuerde de preguntarlo.
    const textoParaElAgente = await conAvisoDeUnidad(texto);

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
        for await (const ev of agente.enviarMensajeStream(sesion.agentSessionId!, textoParaElAgente)) {
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
        for await (const ev of agente.enviarMensajeStream(sesion.agentSessionId!, textoParaElAgente)) {
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
      // Si el cliente nombró un taller del catálogo, la pantalla abre su agenda.
      //
      // Por qué aquí y no esperando a que el agente lo diga: `Consultar_disponibilidad`
      // no escribe en `Log_Agente__c`, así que cuando el agente sólo consulta no hay
      // traza que releer y su respuesta se queda en prosa —una lista dictada de la que
      // el cliente tiene que contestar «la opción 5»—. Esto no adivina una intención:
      // comprueba un hecho contra el catálogo real, igual que se comprueba un VIN.
      try {
        const taller = sucursalMencionada(texto, await talleres());
        if (taller) {
          // Si además dictó un número de serie, se comprueba contra la org si ese
          // taller atiende su modelo, y el veredicto viaja con la capacidad.
          //
          // Hace falta porque el agente se equivoca aquí, y en la cara del cliente:
          // ante una falla eléctrica contestó «El taller de Querétaro no atiende el
          // modelo Freightliner Cascadia», que es FALSO —ese taller tiene cinco filas
          // activas para ese modelo—. Lo que no existe es una fila para el sistema
          // eléctrico, porque ese valor no está en la lista de sistemas de las
          // sucursales. Un cliente que se cree esa frase se va pensando que su camión
          // no se atiende en ningún lado.
          let atiendeTuModelo: boolean | null = null;
          const vinDicho = vinMencionado(texto);
          if (vinDicho) {
            const encontradas = await datos.listarUnidades({ busqueda: vinDicho });
            const modeloId = encontradas.registros[0]?.Product2Id;
            if (modeloId) {
              atiendeTuModelo = (await datos.talleresDelModelo(modeloId)).includes(taller);
            }
          }
          emitir('Capacidad', { capacidad: 'agenda', sucursal: taller, atiendeTuModelo });
        }
      } catch {
        // El catálogo no contestó. La conversación no se interrumpe por esto: la
        // agenda sigue estando a un clic desde el espacio de trabajo.
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
      // Ya tiene conversación abierta: se devuelve la misma, no se abre otra. Pero si
      // la abrió el AGENTE, el expediente se quedó sin la conversación —sólo el sobre
      // de escalamiento— y el asesor tendría que preguntarle al cliente lo que ya
      // contó. La app sí la tiene: se siembra, una sola vez por visita.
      let contextoSembrado = 0;
      if (!sesion.contextoSembrado && Array.isArray(b.turnos) && b.turnos.length) {
        try {
          contextoSembrado = await escalamiento.sembrarContextoDeVisita(sesion.caseId, b.turnos);
          sesion.contextoSembrado = true;
        } catch {
          // Que no se pueda sembrar no rompe la conversación: el cliente ya está con
          // una persona y el asesor tiene el expediente, aunque más pobre.
        }
      }
      json(
        res,
        200,
        { caseId: sesion.caseId, correlationId: sesion.correlationId, reusada: true, contextoSembrado },
        cookie,
      );
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

    // ── el expediente completo de la conversación escalada ──────────────────
    //
    // Hasta ahora el asesor abría un caso y sólo veía TEXTO: los mensajes y el
    // contexto que Apex sembró. Todo lo demás que ocurrió bajo esa misma
    // conversación —la unidad de la que se habló, la orden que se creó, el reporte
    // de carretera, qué subagente ejecutó qué y con qué resultado— existe en la org
    // colgado del mismo `Correlation_Id__c` y no llegaba a su pantalla. Tenía que
    // deducirlo leyendo, o preguntárselo al cliente que ya lo había contado.
    //
    // Es la misma traza que audita el reto, proyectada para quien atiende.
    if (sufijo === 'contexto') {
      exigirSesion(ctx.cookies, 'admin');
      const conv = await escalamiento.conversacion(caseId);
      const correlationId = conv.caso.correlationId;
      if (!correlationId) {
        json(res, 200, { correlationId: null, hay: false, motivo: 'El caso no trae correlación.' });
        return true;
      }

      const t = await datos.traza(correlationId);
      const unidades = [
        ...new Set(
          t.logs
            .map((l) => l.Asset__r?.SerialNumber)
            .filter((v): v is string => Boolean(v)),
        ),
      ];

      json(res, 200, {
        correlationId,
        hay: t.existe,
        unidades,
        ordenes: t.relacionados.ordenes.map((o) => ({
          folio: o.WorkOrderNumber,
          estado: o.Status,
          inicio: o.StartDate,
          sucursal: o.Sucursal__r?.Codigo_Sucursal__c ?? null,
          sintoma: o.Sintoma_Reportado__c ?? null,
        })),
        varadas: t.relacionados.varadas.map((v) => ({
          folio: v.Name,
          carretera: v.Carretera__c,
          kilometro: v.Kilometro__c,
          estado: v.Estado__c,
          prioridad: v.Prioridad__c,
          // El asesor tiene que ver esto antes de mandar auxilio: el agente pierde a
          // veces las respuestas de seguridad y un reporte que dice «no está fuera
          // del carril» cambia por completo cómo se atiende.
          fueraDeCarril: v.Fuera_De_Carril__c ?? null,
          intermitentes: v.Intermitentes_Encendidas__c ?? null,
        })),
        acciones: t.logs.map((l) => ({
          folio: l.Name,
          subagente: l.Subagent__c,
          accion: l.Action_Name__c,
          resultado: l.Outcome__c,
          guardrail: l.Guardrail_Triggered__c ?? null,
          creadoEn: l.Timestamp__c ?? l.CreatedDate,
        })),
        resumen: t.resumen,
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
