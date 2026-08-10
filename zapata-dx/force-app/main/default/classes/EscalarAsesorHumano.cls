/**
 * Accion Agentforce/Torre que registra un escalamiento durable en la cola de
 * postventa y devuelve el folio del Case. No afirma una transferencia en vivo.
 *
 * El Log_Agente__c con Idempotency_Key__c unico funciona como compuerta. Caso,
 * resumen, transcripcion interna y log se escriben en una sola transaccion;
 * cualquier fallo revierte el conjunto completo. Las altas corren en USER_MODE. La unica elevacion es la
 * actualizacion final de los dos campos de enlace del log recien creado: el objeto
 * es append-only para el agente y por eso no se concede permiso general de Update.
 */
public inherited sharing class EscalarAsesorHumano {

    private static final String QUEUE_DEVELOPER_NAME = 'Escalamiento_Postventa';
    private static final String ACTION_NAME = 'Escalar_Asesor_Humano';
    private static final Integer MAX_CORRELATION_LENGTH = 64;
    private static final Integer MAX_REASON_LENGTH = 3500;
    private static final Integer MAX_TOWER_CONTEXT_LENGTH = 50000;
    private static final Integer MAX_BATCH_CONTEXT_LENGTH = 250000;
    private static final Integer MAX_REQUESTS = 200;
    private static final Integer MAX_SUBJECT_LENGTH = 255;
    private static final Integer MAX_POLICY_LENGTH = 40;
    private static final Integer MAX_TURNS = 40;
    private static final Integer MAX_TURN_AUTHOR_LENGTH = 80;
    private static final Integer MAX_TURN_TEXT_LENGTH = 3500;
    private static final Integer MAX_TURN_DATE_LENGTH = 64;
    private static final Integer MAX_COMMENT_LENGTH = 4000;

    @TestVisible
    private static Boolean forzarFalloDespuesDeComentario = false;
    @TestVisible
    private static String ultimoErrorPrueba;

    public class Solicitud {
        @InvocableVariable(
            label='Motivo del escalamiento'
            description='Resumen fiel, en una linea, de por que el cliente necesita un asesor. No agregues datos que el cliente no haya dicho.'
            required=true)
        public String motivo;

        @InvocableVariable(
            label='Correlation Id'
            description='Identificador estable de la conversacion. Usa RoutableId y conserva el mismo valor en cada reintento.'
            required=true)
        public String correlationId;

        @InvocableVariable(
            label='Contact Id'
            description='ContactId vinculado a la sesion, si existe. No inventes ni pidas este identificador al cliente.')
        public String contactId;

        @InvocableVariable(
            label='Hay riesgo de seguridad'
            description='Verdadero solo cuando la conversacion contiene un riesgo de seguridad explicito.')
        public Boolean riesgoSeguridad;

        @InvocableVariable(
            label='Contexto estructurado de la Torre'
            description='JSON v1 opcional enviado solo por la Torre. Incluye asunto, politica, vinculos y turnos completos. Agentforce debe omitirlo.')
        public String contextoTorreJson;
    }

    private class ContextoTorre {
        public Integer version;
        public String asunto;
        public String politicaAplicada;
        public String assetId;
        public String workOrderId;
        public List<TurnoTorre> turnos;
    }

    private class TurnoTorre {
        public String autor;
        public String texto;
        public String fecha;
    }

    public class Respuesta {
        @InvocableVariable(label='Escalamiento registrado')
        public Boolean escalamientoCreado;

        @InvocableVariable(label='Es un reintento idempotente')
        public Boolean reintento;

        @InvocableVariable(label='Case Id')
        public Id caseId;

        @InvocableVariable(label='Numero de caso')
        public String caseNumber;

        @InvocableVariable(label='Mensaje para el cliente')
        public String mensaje;

        @InvocableVariable(label='Codigo de error')
        public String codigoError;

        @InvocableVariable(label='Ids de comentarios internos sembrados')
        public List<String> comentariosSembrados;
    }

    private class Estado {
        String correlationId;
        String motivo;
        Id contactId;
        Boolean riesgoSeguridad;
        ContextoTorre contextoTorre;
        String idempotencyKey;
        Log_Agente__c gate;
        Boolean creado;
        Boolean enriquecer = false;
        Boolean conflicto = false;
        Id caseId;
        String coreFingerprint;
        String contextFingerprint;
        List<String> comentariosSembrados = new List<String>();
        List<Integer> posiciones = new List<Integer>();
    }

    @InvocableMethod(
        label='Crear escalamiento a asesor humano'
        description='Registra Case, contexto interno y Log; devuelve folio. La misma llave con contenido distinto da IDEMPOTENCY_CONFLICT, salvo enriquecer una vez un resumen Agentforce con contexto Torre.')
    public static List<Respuesta> escalar(List<Solicitud> solicitudes) {
        List<Respuesta> respuestas = new List<Respuesta>();
        if (solicitudes == null) {
            return respuestas;
        }
        if (solicitudes.size() > MAX_REQUESTS) {
            for (Integer i = 0; i < solicitudes.size(); i++) {
                Respuesta respuesta = nuevaRespuesta();
                marcarError(respuesta, 'INVALID_INPUT',
                    'El lote excede el maximo de solicitudes permitido.');
                respuestas.add(respuesta);
            }
            return respuestas;
        }

        Map<String, Estado> estadosPorClave = new Map<String, Estado>();
        Integer longitudContextoLote = 0;
        for (Integer i = 0; i < solicitudes.size(); i++) {
            Respuesta respuesta = nuevaRespuesta();
            respuestas.add(respuesta);

            Solicitud solicitud = solicitudes[i];
            String correlacion = normalizar(solicitud == null ? null : solicitud.correlationId);
            String motivo = normalizar(solicitud == null ? null : solicitud.motivo);

            if (String.isBlank(correlacion) || String.isBlank(motivo)
                || correlacion.length() > MAX_CORRELATION_LENGTH
                || motivo.length() > MAX_REASON_LENGTH) {
                marcarError(respuesta, 'INVALID_INPUT',
                    'Necesito un motivo y el identificador de la conversacion para registrar el escalamiento.');
                continue;
            }

            Id contactId;
            try {
                contactId = idContacto(solicitud.contactId);
            } catch (IllegalArgumentException e) {
                marcarError(respuesta, 'INVALID_CONTACT',
                    'No pude vincular el contacto de la sesion. Intentemos el escalamiento de nuevo.');
                continue;
            }

            ContextoTorre contextoTorre;
            try {
                if (solicitud.contextoTorreJson != null) {
                    longitudContextoLote += solicitud.contextoTorreJson.length();
                    if (longitudContextoLote > MAX_BATCH_CONTEXT_LENGTH) {
                        throw new IllegalArgumentException('Tower context batch too large');
                    }
                }
                contextoTorre = contextoTorre(solicitud.contextoTorreJson);
            } catch (IllegalArgumentException e) {
                marcarError(respuesta, 'INVALID_TOWER_CONTEXT',
                    'El contexto de la conversacion no tiene un formato seguro para el escalamiento.');
                continue;
            }

            // Idempotency_Key__c es unique case-insensitive. La clave en memoria debe
            // aplicar la misma canonizacion para no tratar dos variantes como estados
            // distintos dentro del mismo lote invocable.
            String clave = 'escalar:' + correlacion.toLowerCase();
            String coreFingerprint = fingerprintCore(
                motivo,
                contactId,
                solicitud.riesgoSeguridad == true
            );
            String contextFingerprint = fingerprintContexto(contextoTorre);
            Estado estado = estadosPorClave.get(clave);
            if (estado == null) {
                estado = new Estado();
                estado.correlationId = correlacion;
                estado.motivo = motivo;
                estado.contactId = contactId;
                estado.riesgoSeguridad = solicitud.riesgoSeguridad == true;
                estado.contextoTorre = contextoTorre;
                estado.idempotencyKey = clave;
                estado.coreFingerprint = coreFingerprint;
                estado.contextFingerprint = contextFingerprint;
                estadosPorClave.put(clave, estado);
            } else if (estado.coreFingerprint != coreFingerprint
                || (estado.contextFingerprint != null && contextFingerprint != null
                    && estado.contextFingerprint != contextFingerprint)) {
                marcarError(respuesta, 'IDEMPOTENCY_CONFLICT',
                    'La llave de conversacion ya se uso con un contexto diferente.');
                continue;
            } else if (estado.contextFingerprint == null && contextFingerprint != null) {
                // Enriquecimiento monotónico dentro del mismo lote: la variante con
                // contexto completo gana sobre la entrada de solo resumen.
                estado.contextoTorre = contextoTorre;
                estado.contextFingerprint = contextFingerprint;
            }
            estado.posiciones.add(i);
        }

        if (estadosPorClave.isEmpty()) {
            return respuestas;
        }

        List<Group> colas = [
            SELECT Id
            FROM Group
            WHERE Type = 'Queue'
              AND DeveloperName = :QUEUE_DEVELOPER_NAME
              AND Id IN (
                  SELECT QueueId
                  FROM QueueSobject
                  WHERE SobjectType = 'Case'
              )
            LIMIT 1
        ];
        if (colas.isEmpty()) {
            for (Estado estado : estadosPorClave.values()) {
                marcarEstadoError(respuestas, estado, 'QUEUE_NOT_CONFIGURED',
                    'El equipo de asesores no esta disponible en este momento. Intentemos de nuevo mas tarde.');
            }
            return respuestas;
        }

        Savepoint puntoRestauracion = Database.setSavepoint();
        try {
            List<Estado> estados = estadosPorClave.values();
            List<Log_Agente__c> gates = new List<Log_Agente__c>();
            for (Estado estado : estados) {
                estado.gate = new Log_Agente__c(
                    Idempotency_Key__c = estado.idempotencyKey,
                    Correlation_Id__c = estado.correlationId,
                    Session_Key__c = estado.correlationId,
                    Action_Name__c = ACTION_NAME,
                    Subagent__c = 'Escalamiento',
                    Outcome__c = 'SUCCESS',
                    Timestamp__c = System.now(),
                    Actor__c = 'Agentforce'
                );
                gates.add(estado.gate);
            }

            Database.SaveResult[] gatesResultado = Database.insert(
                gates,
                false,
                AccessLevel.USER_MODE
            );

            Set<String> clavesExistentes = new Set<String>();
            for (Integer i = 0; i < estados.size(); i++) {
                Database.SaveResult resultado = gatesResultado[i];
                estados[i].creado = resultado.isSuccess();
                if (resultado.isSuccess()) {
                    estados[i].gate.Id = resultado.getId();
                    continue;
                }

                Boolean esDuplicado = false;
                for (Database.Error error : resultado.getErrors()) {
                    if (error.getStatusCode() == StatusCode.DUPLICATE_VALUE) {
                        esDuplicado = true;
                    }
                }
                if (!esDuplicado) {
                    throw new EscalamientoException('Could not create idempotency gate');
                }
                clavesExistentes.add(estados[i].idempotencyKey);
            }

            Map<String, Log_Agente__c> logsPorClave = new Map<String, Log_Agente__c>();
            if (!clavesExistentes.isEmpty()) {
                for (Log_Agente__c existente : [
                    SELECT Id, Idempotency_Key__c, Case__c
                    FROM Log_Agente__c
                    WHERE Idempotency_Key__c IN :clavesExistentes
                    WITH USER_MODE
                    FOR UPDATE
                ]) {
                    logsPorClave.put(existente.Idempotency_Key__c.toLowerCase(), existente);
                }
            }

            Set<Id> casosExistentesIds = new Set<Id>();
            for (Estado estado : estados) {
                if (!estado.creado) {
                    Log_Agente__c existente = logsPorClave.get(
                        estado.idempotencyKey.toLowerCase()
                    );
                    if (existente == null || existente.Case__c == null) {
                        throw new EscalamientoException('Idempotency gate without Case');
                    }
                    estado.gate.Id = existente.Id;
                    estado.caseId = existente.Case__c;
                    casosExistentesIds.add(estado.caseId);
                }
            }

            Map<Id, Case> casosExistentes = new Map<Id, Case>();
            if (!casosExistentesIds.isEmpty()) {
                casosExistentes = new Map<Id, Case>([
                    SELECT Id, CaseNumber, Description, Priority, ContactId,
                           Subject, Politica_Aplicada__c, Asset__c, WorkOrder__c
                    FROM Case
                    WHERE Id IN :casosExistentesIds
                    WITH USER_MODE
                ]);
            }

            Map<Id, String> corePersistido = new Map<Id, String>();
            Map<Id, String> contextoPersistido = new Map<Id, String>();
            Map<Id, Boolean> contextoLegacy = new Map<Id, Boolean>();
            Map<Id, List<String>> semillasPersistidas = new Map<Id, List<String>>();
            if (!casosExistentesIds.isEmpty()) {
                for (CaseComment comentario : [
                    SELECT Id, ParentId, CommentBody
                    FROM CaseComment
                    WHERE ParentId IN :casosExistentesIds
                      AND IsPublished = false
                    WITH USER_MODE
                    ORDER BY CreatedDate ASC, Id ASC
                ]) {
                    if (!esComentarioSemilla(comentario.CommentBody)) {
                        continue;
                    }
                    if (!semillasPersistidas.containsKey(comentario.ParentId)) {
                        semillasPersistidas.put(comentario.ParentId, new List<String>());
                    }
                    semillasPersistidas.get(comentario.ParentId).add(
                        String.valueOf(comentario.Id)
                    );
                    String core = extraerFingerprint(
                        comentario.CommentBody,
                        '^\\[escalamiento:v1 core=([0-9a-f]{64})\\]'
                    );
                    if (core != null) {
                        corePersistido.put(comentario.ParentId, core);
                    }
                    String huellaContexto = extraerFingerprint(
                        comentario.CommentBody,
                        '^\\[contexto-torre:v1 fingerprint=([0-9a-f]{64})\\]'
                    );
                    if (huellaContexto != null) {
                        contextoPersistido.put(comentario.ParentId, huellaContexto);
                    } else if (comentario.CommentBody != null
                        && comentario.CommentBody.startsWith('[turno ')) {
                        contextoLegacy.put(comentario.ParentId, true);
                    }
                }
            }

            for (Estado estado : estados) {
                if (estado.creado) {
                    continue;
                }
                Case casoExistente = casosExistentes.get(estado.caseId);
                List<String> semillas = semillasPersistidas.get(estado.caseId);
                if (casoExistente == null || semillas == null || semillas.isEmpty()) {
                    throw new EscalamientoException('Durable escalation is incomplete');
                }
                estado.comentariosSembrados = semillas;
                String coreExistente = corePersistido.get(estado.caseId);
                if (coreExistente == null) {
                    coreExistente = fingerprintCore(
                        normalizar(casoExistente.Description),
                        casoExistente.ContactId,
                        casoExistente.Priority == 'High'
                    );
                }
                if (coreExistente != estado.coreFingerprint) {
                    marcarEstadoConflicto(respuestas, estado);
                    continue;
                }

                String contextoExistente = contextoPersistido.get(estado.caseId);
                if (contextoExistente == null && contextoLegacy.get(estado.caseId) == true) {
                    contextoExistente = 'legacy-unknown';
                }
                if (estado.contextFingerprint == null) {
                    continue;
                }
                if (contextoExistente == null) {
                    estado.enriquecer = true;
                } else if (contextoExistente != estado.contextFingerprint) {
                    marcarEstadoConflicto(respuestas, estado);
                }
            }

            List<Case> casosNuevos = new List<Case>();
            List<Estado> estadosNuevos = new List<Estado>();
            for (Estado estado : estados) {
                if (!estado.creado || estado.conflicto) {
                    continue;
                }

                Case caso = new Case(
                    OwnerId = colas[0].Id,
                    Status = 'New',
                    Origin = 'Agentforce',
                    Priority = estado.riesgoSeguridad ? 'High' : 'Medium',
                    Subject = estado.contextoTorre == null
                        ? 'Escalamiento solicitado desde Agentforce'
                        : estado.contextoTorre.asunto,
                    Description = estado.motivo,
                    Correlation_Id__c = estado.correlationId
                );
                if (estado.contactId != null) {
                    caso.ContactId = estado.contactId;
                }
                if (estado.contextoTorre != null) {
                    caso.Politica_Aplicada__c = estado.contextoTorre.politicaAplicada;
                    caso.Asset__c = idRelacionado(
                        estado.contextoTorre.assetId,
                        Asset.SObjectType
                    );
                    caso.WorkOrder__c = idRelacionado(
                        estado.contextoTorre.workOrderId,
                        WorkOrder.SObjectType
                    );
                }
                casosNuevos.add(caso);
                estadosNuevos.add(estado);
            }

            if (!casosNuevos.isEmpty()) {
                Database.insert(casosNuevos, true, AccessLevel.USER_MODE);
            }

            List<Case> casosAEnriquecer = new List<Case>();
            for (Estado estado : estados) {
                if (!estado.enriquecer || estado.conflicto) {
                    continue;
                }
                casosAEnriquecer.add(new Case(
                    Id = estado.caseId,
                    Subject = estado.contextoTorre.asunto,
                    Politica_Aplicada__c = estado.contextoTorre.politicaAplicada,
                    Asset__c = idRelacionado(estado.contextoTorre.assetId, Asset.SObjectType),
                    WorkOrder__c = idRelacionado(
                        estado.contextoTorre.workOrderId,
                        WorkOrder.SObjectType
                    )
                ));
            }
            if (!casosAEnriquecer.isEmpty()) {
                Database.update(casosAEnriquecer, true, AccessLevel.USER_MODE);
            }

            List<CaseComment> comentarios = new List<CaseComment>();
            List<Estado> estadosConComentarios = new List<Estado>();
            List<Integer> cantidadesComentarios = new List<Integer>();
            for (Integer i = 0; i < estadosNuevos.size(); i++) {
                Estado estado = estadosNuevos[i];
                estado.caseId = casosNuevos[i].Id;
                comentarios.add(new CaseComment(
                    ParentId = estado.caseId,
                    CommentBody = comentarioResumen(estado),
                    IsPublished = false
                ));
                Integer cantidad = 1;
                if (estado.contextoTorre != null) {
                    comentarios.add(new CaseComment(
                        ParentId = estado.caseId,
                        CommentBody = comentarioContexto(estado),
                        IsPublished = false
                    ));
                    cantidad++;
                    Integer totalTurnos = estado.contextoTorre.turnos.size();
                    for (Integer turnoIndice = 0; turnoIndice < totalTurnos; turnoIndice++) {
                        comentarios.add(new CaseComment(
                            ParentId = estado.caseId,
                            CommentBody = comentarioTurno(
                                estado.contextoTorre.turnos[turnoIndice],
                                turnoIndice + 1,
                                totalTurnos,
                                estado.contextFingerprint
                            ),
                            IsPublished = false
                        ));
                        cantidad++;
                    }
                }
                estadosConComentarios.add(estado);
                cantidadesComentarios.add(cantidad);
            }
            for (Estado estado : estados) {
                if (!estado.enriquecer || estado.conflicto) {
                    continue;
                }
                comentarios.add(new CaseComment(
                    ParentId = estado.caseId,
                    CommentBody = comentarioContexto(estado),
                    IsPublished = false
                ));
                Integer cantidad = 1;
                Integer totalTurnos = estado.contextoTorre.turnos.size();
                for (Integer turnoIndice = 0; turnoIndice < totalTurnos; turnoIndice++) {
                    comentarios.add(new CaseComment(
                        ParentId = estado.caseId,
                        CommentBody = comentarioTurno(
                            estado.contextoTorre.turnos[turnoIndice],
                            turnoIndice + 1,
                            totalTurnos,
                            estado.contextFingerprint
                        ),
                        IsPublished = false
                    ));
                    cantidad++;
                }
                estadosConComentarios.add(estado);
                cantidadesComentarios.add(cantidad);
            }
            if (!comentarios.isEmpty()) {
                Database.insert(comentarios, true, AccessLevel.USER_MODE);
            }

            Integer indiceComentario = 0;
            for (Integer estadoIndice = 0;
                estadoIndice < estadosConComentarios.size();
                estadoIndice++) {
                Estado estado = estadosConComentarios[estadoIndice];
                Integer cantidad = cantidadesComentarios[estadoIndice];
                for (Integer i = 0; i < cantidad; i++) {
                    estado.comentariosSembrados.add(
                        String.valueOf(comentarios[indiceComentario].Id)
                    );
                    indiceComentario++;
                }
            }

            if (forzarFalloDespuesDeComentario) {
                throw new EscalamientoException('Controlled rollback');
            }

            List<Log_Agente__c> logsACompletar = new List<Log_Agente__c>();
            for (Estado estado : estadosNuevos) {
                logsACompletar.add(new Log_Agente__c(
                    Id = estado.gate.Id,
                    Case__c = estado.caseId,
                    Related_Record_Id__c = String.valueOf(estado.caseId)
                ));
            }
            if (!logsACompletar.isEmpty()) {
                Database.update(logsACompletar, true, AccessLevel.SYSTEM_MODE);
            }

            Set<Id> caseIds = new Set<Id>();
            for (Estado estado : estados) {
                if (!estado.conflicto) {
                    caseIds.add(estado.caseId);
                }
            }
            Map<Id, Case> casosPorId = new Map<Id, Case>([
                SELECT Id, CaseNumber
                FROM Case
                WHERE Id IN :caseIds
                WITH USER_MODE
            ]);

            for (Estado estado : estados) {
                if (estado.conflicto) {
                    continue;
                }
                Case caso = casosPorId.get(estado.caseId);
                if (caso == null) {
                    throw new EscalamientoException('Case not visible after creation');
                }
                estado.comentariosSembrados.sort();
                for (Integer posicion : estado.posiciones) {
                    Respuesta respuesta = respuestas[posicion];
                    respuesta.escalamientoCreado = true;
                    respuesta.reintento = !estado.creado || posicion != estado.posiciones[0];
                    respuesta.caseId = caso.Id;
                    respuesta.caseNumber = caso.CaseNumber;
                    respuesta.mensaje = 'Tu caso ' + caso.CaseNumber
                        + ' quedo registrado con el equipo de asesores.';
                    respuesta.codigoError = null;
                    respuesta.comentariosSembrados = new List<String>(
                        estado.comentariosSembrados
                    );
                }
            }
        } catch (Exception e) {
            Database.rollback(puntoRestauracion);
            if (Test.isRunningTest()) {
                ultimoErrorPrueba = e.getMessage();
            }
            System.debug(LoggingLevel.ERROR,
                'Fallo transaccional en EscalarAsesorHumano: ' + e.getTypeName());
            for (Estado estado : estadosPorClave.values()) {
                marcarEstadoError(respuestas, estado, 'PERSISTENCE_ERROR',
                    'No pude registrar el escalamiento. Intentemos de nuevo en un momento.');
            }
        }

        return respuestas;
    }

    private static Respuesta nuevaRespuesta() {
        Respuesta respuesta = new Respuesta();
        respuesta.escalamientoCreado = false;
        respuesta.reintento = false;
        respuesta.comentariosSembrados = new List<String>();
        return respuesta;
    }

    private static void marcarEstadoError(
        List<Respuesta> respuestas,
        Estado estado,
        String codigo,
        String mensaje
    ) {
        for (Integer posicion : estado.posiciones) {
            marcarError(respuestas[posicion], codigo, mensaje);
        }
    }

    private static void marcarEstadoConflicto(
        List<Respuesta> respuestas,
        Estado estado
    ) {
        estado.conflicto = true;
        marcarEstadoError(
            respuestas,
            estado,
            'IDEMPOTENCY_CONFLICT',
            'La llave de conversacion ya se uso con un contexto diferente.'
        );
    }

    private static void marcarError(Respuesta respuesta, String codigo, String mensaje) {
        respuesta.escalamientoCreado = false;
        respuesta.reintento = false;
        respuesta.caseId = null;
        respuesta.caseNumber = null;
        respuesta.comentariosSembrados = new List<String>();
        respuesta.codigoError = codigo;
        respuesta.mensaje = mensaje;
    }

    private static String normalizar(String valor) {
        if (String.isBlank(valor)) {
            return '';
        }
        return valor.replaceAll('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', ' ')
            .replaceAll('\\s+', ' ')
            .trim();
    }

    private static Id idContacto(String valor) {
        if (String.isBlank(valor)) {
            return null;
        }
        try {
            Id idValor = Id.valueOf(valor.trim());
            if (idValor.getSObjectType() != Contact.SObjectType) {
                throw new IllegalArgumentException('Not a Contact Id');
            }
            return idValor;
        } catch (Exception e) {
            throw new IllegalArgumentException('Invalid Contact Id');
        }
    }

    private static ContextoTorre contextoTorre(String valor) {
        if (String.isBlank(valor)) {
            return null;
        }
        if (valor.length() > MAX_TOWER_CONTEXT_LENGTH) {
            throw new IllegalArgumentException('Tower context too large');
        }

        ContextoTorre contexto;
        try {
            contexto = (ContextoTorre) JSON.deserializeStrict(valor, ContextoTorre.class);
        } catch (Exception e) {
            throw new IllegalArgumentException('Malformed tower context');
        }
        if (contexto == null || contexto.version != 1) {
            throw new IllegalArgumentException('Unsupported tower context version');
        }
        validarTexto(contexto.asunto, MAX_SUBJECT_LENGTH, 'subject');
        validarTexto(contexto.politicaAplicada, MAX_POLICY_LENGTH, 'policy');
        contexto.assetId = idRelacionadoTexto(contexto.assetId, Asset.SObjectType);
        contexto.workOrderId = idRelacionadoTexto(contexto.workOrderId, WorkOrder.SObjectType);
        if (contexto.turnos == null || contexto.turnos.size() > MAX_TURNS) {
            throw new IllegalArgumentException('Invalid turn count');
        }

        for (TurnoTorre turno : contexto.turnos) {
            if (turno == null) {
                throw new IllegalArgumentException('Null turn');
            }
            validarTexto(turno.autor, MAX_TURN_AUTHOR_LENGTH, 'author');
            validarTexto(turno.texto, MAX_TURN_TEXT_LENGTH, 'text');
            if (turno.fecha != null) {
                validarTexto(turno.fecha, MAX_TURN_DATE_LENGTH, 'date');
                if (!Pattern.compile(
                    '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})$'
                ).matcher(turno.fecha).matches()) {
                    throw new IllegalArgumentException('Date is not ISO 8601');
                }
            }
        }
        return contexto;
    }

    private static void validarTexto(String valor, Integer limite, String campo) {
        if (String.isBlank(valor) || valor.length() > limite
            || Pattern.compile('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]')
                .matcher(valor).find()) {
            throw new IllegalArgumentException('Invalid ' + campo);
        }
    }

    private static String idRelacionadoTexto(String valor, Schema.SObjectType tipoEsperado) {
        Id relacionado = idRelacionado(valor, tipoEsperado);
        return relacionado == null ? null : String.valueOf(relacionado);
    }

    private static Id idRelacionado(String valor, Schema.SObjectType tipoEsperado) {
        if (String.isBlank(valor)) {
            return null;
        }
        try {
            Id idValor = Id.valueOf(valor.trim());
            if (idValor.getSObjectType() != tipoEsperado) {
                throw new IllegalArgumentException('Unexpected related record type');
            }
            return idValor;
        } catch (Exception e) {
            throw new IllegalArgumentException('Invalid related record Id');
        }
    }

    private static String fingerprintCore(String motivo, Id contactId, Boolean riesgo) {
        return digest(
            'core-v1|' + parte(motivo)
            + parte(contactId == null ? null : String.valueOf(contactId))
            + parte(riesgo == true ? 'true' : 'false')
        );
    }

    private static String fingerprintContexto(ContextoTorre contexto) {
        if (contexto == null) {
            return null;
        }
        String material = 'tower-v1|'
            + parte(contexto.asunto)
            + parte(contexto.politicaAplicada)
            + parte(contexto.assetId)
            + parte(contexto.workOrderId);
        for (TurnoTorre turno : contexto.turnos) {
            material += parte(turno.autor) + parte(turno.texto) + parte(turno.fecha);
        }
        return digest(material);
    }

    private static String parte(String valor) {
        return valor == null ? '-1:' : String.valueOf(valor.length()) + ':' + valor;
    }

    private static String digest(String material) {
        return EncodingUtil.convertToHex(
            Crypto.generateDigest('SHA-256', Blob.valueOf(material))
        ).toLowerCase();
    }

    private static String comentarioResumen(Estado estado) {
        String cuerpo = '[escalamiento:v1 core=' + estado.coreFingerprint + ']\n'
            + 'Resumen para el asesor:\n' + estado.motivo;
        validarLongitudComentario(cuerpo);
        return cuerpo;
    }

    private static String comentarioContexto(Estado estado) {
        ContextoTorre contexto = estado.contextoTorre;
        String cuerpo = '[contexto-torre:v1 fingerprint=' + estado.contextFingerprint + ']\n'
            + 'Asunto: ' + contexto.asunto + '\n'
            + 'Politica: ' + contexto.politicaAplicada;
        if (contexto.assetId != null) {
            cuerpo += '\nAssetId: ' + contexto.assetId;
        }
        if (contexto.workOrderId != null) {
            cuerpo += '\nWorkOrderId: ' + contexto.workOrderId;
        }
        validarLongitudComentario(cuerpo);
        return cuerpo;
    }

    private static String comentarioTurno(
        TurnoTorre turno,
        Integer posicion,
        Integer total,
        String contextFingerprint
    ) {
        String cuerpo = '[turno ' + posicion + '/' + total + ']\n'
            + 'Contexto: ' + contextFingerprint + '\nAutor: ' + turno.autor;
        if (turno.fecha != null) {
            cuerpo += '\nFecha: ' + turno.fecha;
        }
        cuerpo += '\n\n' + turno.texto;
        validarLongitudComentario(cuerpo);
        return cuerpo;
    }

    private static void validarLongitudComentario(String cuerpo) {
        if (cuerpo.length() > MAX_COMMENT_LENGTH) {
            throw new EscalamientoException('Comment exceeds Salesforce limit');
        }
    }

    private static String extraerFingerprint(String cuerpo, String expresion) {
        if (cuerpo == null) {
            return null;
        }
        Matcher matcher = Pattern.compile(expresion).matcher(cuerpo);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static Boolean esComentarioSemilla(String cuerpo) {
        if (cuerpo == null) {
            return false;
        }
        return cuerpo.startsWith('[escalamiento:v1 core=')
            || cuerpo.startsWith('[contexto-torre:v1 fingerprint=')
            || cuerpo.startsWith('Resumen para el asesor:\n')
            || Pattern.compile('^\\[turno \\d+/\\d+\\]\\nAutor:')
                .matcher(cuerpo).find()
            || Pattern.compile('^\\[turno \\d+/\\d+\\]\\nContexto:')
                .matcher(cuerpo).find();
    }

    private class EscalamientoException extends Exception {}
}
