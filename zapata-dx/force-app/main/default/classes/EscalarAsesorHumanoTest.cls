/**
 * Pruebas de la accion transaccional que registra el Case en la cola y devuelve
 * un folio durable para seguimiento.
 *
 * SeeAllData=true es intencional: la accion debe resolver la cola real
 * Escalamiento_Postventa y debe poder ejecutarse con la identidad real del agente.
 * Los registros creados por cada prueba se revierten automaticamente.
 */
@IsTest(SeeAllData=true)
private class EscalarAsesorHumanoTest {

    private static User usuarioDelAgente() {
        return [
            SELECT Id, Username
            FROM User
            WHERE Username LIKE 'agente_postventa_zapata@%'
              AND IsActive = true
            LIMIT 1
        ];
    }

    private static Id colaEscalamientoId() {
        return [
            SELECT Id
            FROM Group
            WHERE Type = 'Queue'
              AND DeveloperName = 'Escalamiento_Postventa'
            LIMIT 1
        ].Id;
    }

    private static EscalarAsesorHumano.Solicitud solicitud(
        String correlacion,
        String motivo,
        Boolean riesgo
    ) {
        EscalarAsesorHumano.Solicitud entrada = new EscalarAsesorHumano.Solicitud();
        entrada.correlationId = correlacion;
        entrada.motivo = motivo;
        entrada.riesgoSeguridad = riesgo;
        return entrada;
    }

    private static String contextoTorre(List<Object> turnos) {
        return JSON.serialize(new Map<String, Object>{
            'version' => 1,
            'asunto' => 'Falla de potencia en subida',
            'politicaAplicada' => 'ESCALAMIENTO-HUMANO',
            'turnos' => turnos
        });
    }

    private static Map<String, Object> turno(String autor, String texto) {
        return new Map<String, Object>{
            'autor' => autor,
            'texto' => texto
        };
    }

    private static String repetir(String valor, Integer veces) {
        String resultado = '';
        for (Integer i = 0; i < veces; i++) {
            resultado += valor;
        }
        return resultado;
    }

    @IsTest
    static void creaCasoComentarioYLogEnLaColaReal() {
        String correlacion = 'ESC-TEST-' + String.valueOf(DateTime.now().getTime());
        String motivo = 'El cliente solicita apoyo humano para revisar una inconformidad.';
        EscalarAsesorHumano.Solicitud entrada = solicitud(correlacion, motivo, false);
        entrada.contextoTorreJson = contextoTorre(new List<Object>{
            turno('cliente', 'La unidad pierde potencia en subida.'),
            new Map<String, Object>{
                'autor' => 'agente',
                'texto' => 'El diagnostico automatico no fue concluyente.',
                'fecha' => '2026-08-05T20:40:12Z'
            }
        });
        List<EscalarAsesorHumano.Respuesta> respuestas;

        System.runAs(usuarioDelAgente()) {
            Test.startTest();
            respuestas = EscalarAsesorHumano.escalar(new List<EscalarAsesorHumano.Solicitud>{
                entrada
            });
            Test.stopTest();
        }

        Assert.areEqual(1, respuestas.size());
        Assert.areEqual(true, respuestas[0].escalamientoCreado,
            respuestas[0].mensaje + ' / ' + EscalarAsesorHumano.ultimoErrorPrueba);
        Assert.areEqual(false, respuestas[0].reintento);
        Assert.isNotNull(respuestas[0].caseId);
        Assert.isNotNull(respuestas[0].caseNumber);
        Assert.areEqual(4, respuestas[0].comentariosSembrados.size());

        Case caso = [
            SELECT Id, CaseNumber, OwnerId, Status, Priority,
                   Origin, Subject, Description, Correlation_Id__c, Politica_Aplicada__c
            FROM Case
            WHERE Id = :respuestas[0].caseId
        ];
        Assert.areEqual(colaEscalamientoId(), caso.OwnerId);
        Assert.areEqual('New', caso.Status);
        Assert.areEqual('Medium', caso.Priority);
        Assert.areEqual('Agentforce', caso.Origin);
        Assert.areEqual(correlacion, caso.Correlation_Id__c);
        Assert.areEqual(motivo, caso.Description);
        Assert.areEqual('Falla de potencia en subida', caso.Subject);
        Assert.areEqual('ESCALAMIENTO-HUMANO', caso.Politica_Aplicada__c);
        Assert.areEqual(respuestas[0].caseNumber, caso.CaseNumber);

        List<CaseComment> comentarios = [
            SELECT ParentId, CommentBody, IsPublished
            FROM CaseComment
            WHERE ParentId = :caso.Id
        ];
        Assert.areEqual(4, comentarios.size(), 'Resumen + cabecera de contexto + dos turnos');
        String cuerpos = '';
        for (CaseComment comentario : comentarios) {
            Assert.areEqual(caso.Id, comentario.ParentId);
            Assert.areEqual(false, comentario.IsPublished,
                'El resumen y la transcripcion deben ser internos');
            cuerpos += '\n' + comentario.CommentBody;
        }
        Assert.isTrue(cuerpos.contains(motivo));
        Assert.isTrue(cuerpos.contains('[turno 1/2]'));
        Assert.isTrue(cuerpos.contains('La unidad pierde potencia en subida.'));
        Assert.isTrue(cuerpos.contains('[turno 2/2]'));
        Assert.isTrue(cuerpos.contains('El diagnostico automatico no fue concluyente.'));
        Assert.isTrue(cuerpos.contains('2026-08-05T20:40:12Z'));

        Log_Agente__c log = [
            SELECT Case__c, Related_Record_Id__c, Correlation_Id__c, Session_Key__c,
                   Action_Name__c, Subagent__c, Outcome__c
            FROM Log_Agente__c
            WHERE Correlation_Id__c = :correlacion
              AND Action_Name__c = 'Escalar_Asesor_Humano'
        ];
        Assert.areEqual(caso.Id, log.Case__c);
        Assert.areEqual(String.valueOf(caso.Id), log.Related_Record_Id__c);
        Assert.areEqual(correlacion, log.Session_Key__c);
        Assert.areEqual('Escalamiento', log.Subagent__c);
        Assert.areEqual('SUCCESS', log.Outcome__c);
    }

    @IsTest
    static void reintentoDevuelveElMismoCasoSinDuplicarNada() {
        String correlacion = 'ESC-IDEM-' + String.valueOf(DateTime.now().getTime());
        EscalarAsesorHumano.Solicitud entrada = solicitud(
            correlacion,
            'El cliente pide hablar con una persona.',
            false
        );
        entrada.contextoTorreJson = contextoTorre(new List<Object>{
            turno('cliente', 'Necesito que una persona revise el caso.'),
            turno('agente', 'Voy a transferir el contexto completo.')
        });
        List<EscalarAsesorHumano.Respuesta> primera;
        List<EscalarAsesorHumano.Respuesta> segunda;

        System.runAs(usuarioDelAgente()) {
            primera = EscalarAsesorHumano.escalar(
                new List<EscalarAsesorHumano.Solicitud>{ entrada }
            );
        }
        CaseComment comentarioManual = new CaseComment(
            ParentId = primera[0].caseId,
            CommentBody = 'Nota interna manual posterior, no pertenece a la semilla.',
            IsPublished = false
        );
        insert comentarioManual;
        System.runAs(usuarioDelAgente()) {
            segunda = EscalarAsesorHumano.escalar(
                new List<EscalarAsesorHumano.Solicitud>{ entrada }
            );
        }

        Assert.areEqual(primera[0].caseId, segunda[0].caseId);
        Assert.areEqual(true, segunda[0].escalamientoCreado);
        Assert.areEqual(true, segunda[0].reintento);
        Assert.areEqual(primera[0].comentariosSembrados, segunda[0].comentariosSembrados);
        Assert.areEqual(false,
            segunda[0].comentariosSembrados.contains(String.valueOf(comentarioManual.Id)),
            'Una nota interna manual no debe contaminar los ids semilla');
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM Case
            WHERE Correlation_Id__c = :correlacion
              AND Origin = 'Agentforce'
        ]);
        Assert.areEqual(5, [
            SELECT COUNT()
            FROM CaseComment
            WHERE ParentId = :primera[0].caseId
        ]);
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM Log_Agente__c
            WHERE Correlation_Id__c = :correlacion
              AND Action_Name__c = 'Escalar_Asesor_Humano'
        ]);
    }

    @IsTest
    static void riesgoDeSeguridadProducePrioridadAlta() {
        String correlacion = 'ESC-RIESGO-' + String.valueOf(DateTime.now().getTime());

        List<EscalarAsesorHumano.Respuesta> respuestas = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{
                solicitud(correlacion, 'Existe un riesgo de seguridad reportado.', true)
            }
        );

        Case caso = [SELECT Priority FROM Case WHERE Id = :respuestas[0].caseId];
        Assert.areEqual('High', caso.Priority);
    }

    @IsTest
    static void rechazaEntradaIncompletaSinEscribir() {
        List<EscalarAsesorHumano.Respuesta> respuestas = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{ solicitud('', '   ', false) }
        );

        Assert.areEqual(false, respuestas[0].escalamientoCreado);
        Assert.areEqual('INVALID_INPUT', respuestas[0].codigoError);
        Assert.isNull(respuestas[0].caseId);
    }

    @IsTest
    static void rechazaUnIdQueNoEsDeContacto() {
        String correlacion = 'ESC-CONTACT-' + String.valueOf(DateTime.now().getTime());
        EscalarAsesorHumano.Solicitud entrada = solicitud(
            correlacion,
            'El cliente solicita apoyo humano.',
            false
        );
        entrada.contactId = colaEscalamientoId();

        List<EscalarAsesorHumano.Respuesta> respuestas = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{ entrada }
        );

        Assert.areEqual(false, respuestas[0].escalamientoCreado);
        Assert.areEqual('INVALID_CONTACT', respuestas[0].codigoError);
        Assert.areEqual(0, [SELECT COUNT() FROM Case WHERE Correlation_Id__c = :correlacion]);
    }

    @IsTest
    static void rechazaContextoTorreInvalidoSinEscribir() {
        String prefijo = 'ESC-CONTEXT-' + String.valueOf(DateTime.now().getTime());
        EscalarAsesorHumano.Solicitud jsonMalformado = solicitud(
            prefijo + '-1', 'Resumen valido.', false
        );
        jsonMalformado.contextoTorreJson = '{no-es-json';

        EscalarAsesorHumano.Solicitud campoDesconocido = solicitud(
            prefijo + '-2', 'Resumen valido.', false
        );
        campoDesconocido.contextoTorreJson = '{"version":1,"asunto":"Caso",' +
            '"politicaAplicada":"POLITICA","turnos":[],"secreto":"no"}';

        EscalarAsesorHumano.Solicitud turnoDemasiadoLargo = solicitud(
            prefijo + '-3', 'Resumen valido.', false
        );
        turnoDemasiadoLargo.contextoTorreJson = contextoTorre(new List<Object>{
            turno('cliente', repetir('x', 3501))
        });

        EscalarAsesorHumano.Solicitud idRelacionadoInvalido = solicitud(
            prefijo + '-4', 'Resumen valido.', false
        );
        idRelacionadoInvalido.contextoTorreJson = JSON.serialize(new Map<String, Object>{
            'version' => 1,
            'asunto' => 'Caso',
            'politicaAplicada' => 'POLITICA',
            'assetId' => colaEscalamientoId(),
            'turnos' => new List<Object>()
        });

        List<Object> demasiadosTurnos = new List<Object>();
        for (Integer i = 0; i < 41; i++) {
            demasiadosTurnos.add(turno('cliente', 'turno ' + i));
        }
        EscalarAsesorHumano.Solicitud cantidadTurnosInvalida = solicitud(
            prefijo + '-5', 'Resumen valido.', false
        );
        cantidadTurnosInvalida.contextoTorreJson = contextoTorre(demasiadosTurnos);

        List<EscalarAsesorHumano.Respuesta> respuestas = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{
                jsonMalformado,
                campoDesconocido,
                turnoDemasiadoLargo,
                idRelacionadoInvalido,
                cantidadTurnosInvalida
            }
        );

        Assert.areEqual(5, respuestas.size());
        for (EscalarAsesorHumano.Respuesta respuesta : respuestas) {
            Assert.areEqual(false, respuesta.escalamientoCreado);
            Assert.areEqual('INVALID_TOWER_CONTEXT', respuesta.codigoError);
            Assert.isNull(respuesta.caseId);
        }
        Assert.areEqual(0, [
            SELECT COUNT()
            FROM Case
            WHERE Correlation_Id__c LIKE :(prefijo + '%')
        ]);
    }

    @IsTest
    static void rechazaReusoDeLlaveConContenidoDistinto() {
        String correlacion = 'ESC-CONFLICT-' + String.valueOf(DateTime.now().getTime());
        EscalarAsesorHumano.Solicitud primeraEntrada = solicitud(
            correlacion, 'Resumen estable.', false
        );
        primeraEntrada.contextoTorreJson = contextoTorre(new List<Object>{
            turno('cliente', 'Contenido original completo.')
        });
        EscalarAsesorHumano.Solicitud segundaEntrada = solicitud(
            correlacion, 'Resumen estable.', false
        );
        segundaEntrada.contextoTorreJson = contextoTorre(new List<Object>{
            turno('cliente', 'Contenido diferente que no debe sobrescribir.')
        });

        List<EscalarAsesorHumano.Respuesta> primera = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{ primeraEntrada }
        );
        List<EscalarAsesorHumano.Respuesta> segunda = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{ segundaEntrada }
        );

        Assert.areEqual(true, primera[0].escalamientoCreado);
        Assert.areEqual(false, segunda[0].escalamientoCreado);
        Assert.areEqual('IDEMPOTENCY_CONFLICT', segunda[0].codigoError);
        Assert.isNull(segunda[0].caseId);
        Assert.areEqual(1, [SELECT COUNT() FROM Case WHERE Correlation_Id__c = :correlacion]);
        Assert.areEqual(3, [
            SELECT COUNT()
            FROM CaseComment
            WHERE ParentId = :primera[0].caseId
        ]);
        Assert.areEqual(0, [
            SELECT COUNT()
            FROM CaseComment
            WHERE ParentId = :primera[0].caseId
              AND CommentBody LIKE '%Contenido diferente%'
        ]);
    }

    @IsTest
    static void enriqueceUnaSolaVezElResumenCreadoPorAgentforce() {
        String correlacion = 'ESC-ENRICH-' + String.valueOf(DateTime.now().getTime());
        EscalarAsesorHumano.Solicitud entrada = solicitud(
            correlacion, 'El cliente pide apoyo humano.', false
        );
        List<EscalarAsesorHumano.Respuesta> soloResumen = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{ entrada }
        );

        entrada.contextoTorreJson = contextoTorre(new List<Object>{
            turno('cliente', 'Turno completo del cliente.'),
            turno('agente', 'Turno completo del agente.')
        });
        List<EscalarAsesorHumano.Respuesta> enriquecido = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{ entrada }
        );
        List<EscalarAsesorHumano.Respuesta> reintento = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{ entrada }
        );

        Assert.areEqual(soloResumen[0].caseId, enriquecido[0].caseId);
        Assert.areEqual(true, enriquecido[0].escalamientoCreado);
        Assert.areEqual(true, enriquecido[0].reintento);
        Assert.areEqual(4, enriquecido[0].comentariosSembrados.size());
        Assert.areEqual(enriquecido[0].comentariosSembrados, reintento[0].comentariosSembrados);
        Case caso = [
            SELECT Subject, Politica_Aplicada__c
            FROM Case
            WHERE Id = :enriquecido[0].caseId
        ];
        Assert.areEqual('Falla de potencia en subida', caso.Subject);
        Assert.areEqual('ESCALAMIENTO-HUMANO', caso.Politica_Aplicada__c);
        Assert.areEqual(4, [
            SELECT COUNT()
            FROM CaseComment
            WHERE ParentId = :enriquecido[0].caseId
        ]);
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM Log_Agente__c
            WHERE Correlation_Id__c = :correlacion
        ]);
    }

    @IsTest
    static void deduplicaLaMismaClaveDentroDeUnLote() {
        String correlacion = 'ESC-BULK-' + String.valueOf(DateTime.now().getTime());

        List<EscalarAsesorHumano.Respuesta> respuestas = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{
                solicitud(correlacion, 'Copia identica del mismo escalamiento.', false),
                solicitud(correlacion, 'Copia identica del mismo escalamiento.', false)
            }
        );

        Assert.areEqual(2, respuestas.size());
        Assert.areEqual(respuestas[0].caseId, respuestas[1].caseId);
        Assert.areEqual(false, respuestas[0].reintento);
        Assert.areEqual(true, respuestas[1].reintento);
        Assert.areEqual(1, [SELECT COUNT() FROM Case WHERE Correlation_Id__c = :correlacion]);
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM CaseComment
            WHERE ParentId = :respuestas[0].caseId
        ]);
    }

    @IsTest
    static void deduplicaCorrelationSinDistinguirMayusculasEnElMismoLote() {
        String base = 'ESC-CASE-' + String.valueOf(DateTime.now().getTime());

        List<EscalarAsesorHumano.Respuesta> respuestas = EscalarAsesorHumano.escalar(
            new List<EscalarAsesorHumano.Solicitud>{
                solicitud(base.toUpperCase(), 'Mismo contenido canonico.', false),
                solicitud(base.toLowerCase(), 'Mismo contenido canonico.', false)
            }
        );

        Assert.areEqual(2, respuestas.size());
        Assert.areEqual(true, respuestas[0].escalamientoCreado);
        Assert.areEqual(true, respuestas[1].escalamientoCreado);
        Assert.areEqual(respuestas[0].caseId, respuestas[1].caseId);
        Assert.areEqual(false, respuestas[0].reintento);
        Assert.areEqual(true, respuestas[1].reintento);
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM Case
            WHERE Correlation_Id__c = :base
        ]);
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM CaseComment
            WHERE ParentId = :respuestas[0].caseId
        ]);
        Assert.areEqual(1, [
            SELECT COUNT()
            FROM Log_Agente__c
            WHERE Case__c = :respuestas[0].caseId
        ]);
    }

    @IsTest
    static void revierteTodosLosRegistrosSiFallaLaTransaccion() {
        String correlacion = 'ESC-ROLLBACK-' + String.valueOf(DateTime.now().getTime());
        EscalarAsesorHumano.forzarFalloDespuesDeComentario = true;
        EscalarAsesorHumano.Solicitud entrada = solicitud(
            correlacion, 'Prueba controlada de rollback.', false
        );
        entrada.contextoTorreJson = contextoTorre(new List<Object>{
            turno('cliente', 'Primer turno que debe revertirse.'),
            turno('agente', 'Segundo turno que debe revertirse.')
        });

        List<EscalarAsesorHumano.Respuesta> respuestas;
        try {
            respuestas = EscalarAsesorHumano.escalar(
                new List<EscalarAsesorHumano.Solicitud>{
                    entrada
                }
            );
        } finally {
            EscalarAsesorHumano.forzarFalloDespuesDeComentario = false;
        }

        Assert.areEqual(false, respuestas[0].escalamientoCreado);
        Assert.areEqual('PERSISTENCE_ERROR', respuestas[0].codigoError);
        Assert.areEqual(0, [SELECT COUNT() FROM Case WHERE Correlation_Id__c = :correlacion]);
        Assert.areEqual(0, [
            SELECT COUNT()
            FROM Log_Agente__c
            WHERE Correlation_Id__c = :correlacion
        ]);
    }

    @IsTest
    static void rechazaLoteMayorAlMaximoSinEscribir() {
        List<EscalarAsesorHumano.Solicitud> entradas =
            new List<EscalarAsesorHumano.Solicitud>();
        for (Integer i = 0; i < 201; i++) {
            entradas.add(solicitud('ESC-MAX-' + i, 'Resumen valido.', false));
        }

        List<EscalarAsesorHumano.Respuesta> respuestas = EscalarAsesorHumano.escalar(entradas);

        Assert.areEqual(201, respuestas.size());
        for (EscalarAsesorHumano.Respuesta respuesta : respuestas) {
            Assert.areEqual(false, respuesta.escalamientoCreado);
            Assert.areEqual('INVALID_INPUT', respuesta.codigoError);
        }
        Assert.areEqual(0, [
            SELECT COUNT()
            FROM Case
            WHERE Correlation_Id__c LIKE 'ESC-MAX-%'
        ]);
    }

    @IsTest
    static void limitaElContextoAgregadoDelLote() {
        String prefijo = 'ESC-HEAP-' + String.valueOf(DateTime.now().getTime());
        List<Object> turnosGrandes = new List<Object>();
        String textoGrande = repetir('x', 3500);
        for (Integer i = 0; i < 13; i++) {
            turnosGrandes.add(turno('cliente', textoGrande));
        }
        String contextoGrande = contextoTorre(turnosGrandes);
        List<EscalarAsesorHumano.Solicitud> entradas =
            new List<EscalarAsesorHumano.Solicitud>();
        for (Integer i = 0; i < 6; i++) {
            EscalarAsesorHumano.Solicitud entrada = solicitud(
                prefijo + '-' + i,
                'Resumen valido.',
                false
            );
            entrada.contextoTorreJson = contextoGrande;
            entradas.add(entrada);
        }

        List<EscalarAsesorHumano.Respuesta> respuestas = EscalarAsesorHumano.escalar(entradas);

        Assert.areEqual(6, respuestas.size());
        for (Integer i = 0; i < 5; i++) {
            Assert.areEqual(true, respuestas[i].escalamientoCreado);
        }
        Assert.areEqual(false, respuestas[5].escalamientoCreado);
        Assert.areEqual('INVALID_TOWER_CONTEXT', respuestas[5].codigoError);
        Assert.areEqual(5, [
            SELECT COUNT()
            FROM Case
            WHERE Correlation_Id__c LIKE :(prefijo + '%')
        ]);
    }
}
