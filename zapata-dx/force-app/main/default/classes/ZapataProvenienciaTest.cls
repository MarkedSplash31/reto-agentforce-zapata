@IsTest(SeeAllData=true)
private class ZapataProvenienciaTest {
    @IsTest
    static void conocimientoSinteticoSiempreLlevaAdvertencia() {
        String salida = BuscarConocimientoPostventa.anteponerEstadoFuente(
            'v1.0-sintetica-no-verificada',
            'Contenido útil del artículo'
        );

        Assert.isTrue(salida.startsWith('[FUENTE SINTETICA NO VERIFICADA]'));
        Assert.isTrue(salida.contains('no debe presentarse como oficial ni confirmada'));
        Assert.isTrue(salida.endsWith('Contenido útil del artículo'));
    }

    @IsTest
    static void soloSlotOperacionalVerificadoEsAgendable() {
        Assert.isTrue(ZapataAgendaController.esProcedenciaOperacional('OPERACIONAL_VERIFICADO'));
        Assert.isFalse(ZapataAgendaController.esProcedenciaOperacional('SITIO_WEB_CAPACIDAD_ASUMIDA'));
        Assert.isFalse(ZapataAgendaController.esProcedenciaOperacional(null));
    }

    @IsTest
    static void buscarConocimientoExponeVersionYAdvertencia() {
        Knowledge__kav articulo = [
            SELECT Id FROM Knowledge__kav
            WHERE IsLatestVersion = true AND PublishStatus = 'Online'
            LIMIT 1
        ];
        Test.setFixedSearchResults(new Id[]{ articulo.Id });
        BuscarConocimientoPostventa.Solicitud solicitud =
            new BuscarConocimientoPostventa.Solicitud();
        solicitud.pregunta = 'garantia postventa';

        Test.startTest();
        BuscarConocimientoPostventa.Respuesta respuesta =
            BuscarConocimientoPostventa.buscar(
                new List<BuscarConocimientoPostventa.Solicitud>{ solicitud }
            )[0];
        Test.stopTest();

        Assert.isTrue(respuesta.encontrado);
        Assert.isTrue(respuesta.contenido.startsWith('[FUENTE SINTETICA NO VERIFICADA]'));
        Assert.isNotNull(respuesta.estadoFuente);
        Assert.isNotNull(respuesta.advertenciaFuente);
    }

    @IsTest
    static void buscarConocimientoManejaEntradaInvalidaYSinHallazgos() {
        BuscarConocimientoPostventa.Solicitud invalida =
            new BuscarConocimientoPostventa.Solicitud();
        invalida.pregunta = ' ';
        BuscarConocimientoPostventa.Solicitud inexistente =
            new BuscarConocimientoPostventa.Solicitud();
        inexistente.pregunta = 'zzzz-sin-coincidencia-9f7c2b';

        List<BuscarConocimientoPostventa.Respuesta> respuestas =
            BuscarConocimientoPostventa.buscar(
                new List<BuscarConocimientoPostventa.Solicitud>{ invalida, inexistente }
            );

        Assert.areEqual(false, respuestas[0].encontrado);
        Assert.areEqual(false, respuestas[1].encontrado);
        Assert.isTrue(respuestas[1].contenido.startsWith('[FUENTE SINTETICA NO VERIFICADA]'));
    }

    @IsTest
    static void agendaExponeProcedenciaYBloqueaSeed() {
        Sucursal__c sucursal = [
            SELECT Id, Codigo_Sucursal__c FROM Sucursal__c WHERE Activa__c = true LIMIT 1
        ];
        Datetime desde = System.now().addDays(-180);
        Datetime hasta = System.now().addDays(365);

        Test.startTest();
        List<ZapataAgendaController.SlotView> todos =
            ZapataAgendaController.getSlots(desde, hasta, null);
        List<ZapataAgendaController.SlotView> porSucursal =
            ZapataAgendaController.getSlots(desde, hasta, String.valueOf(sucursal.Id));
        List<Sucursal__c> sucursales = ZapataAgendaController.getSucursales();

        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = sucursal.Codigo_Sucursal__c;
        p.diasAdelante = 365;
        ZapataAgendaController.Respuesta agenda =
            ZapataAgendaController.consultarDisponibilidad(
                new List<ZapataAgendaController.Peticion>{ p }
            )[0];

        ZapataAgendaController.Peticion noExiste = new ZapataAgendaController.Peticion();
        noExiste.sucursal = 'SUCURSAL-QUE-NO-EXISTE';
        ZapataAgendaController.Respuesta ausente =
            ZapataAgendaController.consultarDisponibilidad(
                new List<ZapataAgendaController.Peticion>{ noExiste }
            )[0];
        Test.stopTest();

        Assert.isFalse(todos.isEmpty());
        Assert.isFalse(porSucursal.isEmpty());
        Assert.isFalse(sucursales.isEmpty());
        // Una franja con capacidad asumida se RECONOCE pero no se ofrece.
        //
        // Hubo una version intermedia que si la ofrecia, etiquetada «sujeto a
        // confirmacion del taller», para no dejar fuera a ocho de las nueve sucursales.
        // La intencion era buena y no se sostuvo: el Flow `Crear_Orden_Servicio` rechaza
        // esas franjas con SLOT_NO_VERIFICADO, y el agente perdia la etiqueta al
        // redactar. Un cliente elegia la opcion 3 y se enteraba al final.
        //
        // Lo que se fija ahora es el invariante que importa: la accion nunca devuelve
        // una opcion que el alta vaya a rechazar. Y para no dejar al cliente a ciegas,
        // el mensaje dice que el horario existe y quien lo confirma.
        Assert.areEqual(false, agenda.hayDisponibilidad);
        Assert.areEqual('SLOTS_NO_VERIFICADOS', agenda.motivoBloqueo);
        Assert.areEqual('SITIO_WEB_CAPACIDAD_ASUMIDA', agenda.estadoProcedencia);
        Assert.areEqual(0, agenda.opciones.size(),
            'ni una sola opcion: el agente no puede listar lo que no recibe');
        Assert.isTrue(
            agenda.mensaje.contains('publica'),
            'debe reconocer que el horario existe, no negar el taller: ' + agenda.mensaje
        );
        Assert.isTrue(
            agenda.mensaje.contains('cupo no esta confirmado'),
            'y decir por que no puede apartarlo: ' + agenda.mensaje
        );
        Assert.areEqual('SUCURSAL_NO_ENCONTRADA', ausente.motivoBloqueo);
        // La vista de franjas refleja la procedencia de CADA una, en vez de dar por
        // hecho que ninguna esta verificada. La version anterior exigia
        // `disponible == false` para todas, lo que solo era cierto mientras la org no
        // tuviera ni una franja operacional; en cuanto Queretaro tuvo las suyas, la
        // prueba pasaba o fallaba segun los datos y no segun el codigo.
        for (ZapataAgendaController.SlotView slot : todos) {
            // La garantia va en un solo sentido: sin procedencia operacional NUNCA se
            // marca reservable. Al reves no aplica, porque una franja verificada puede
            // estar llena y entonces tampoco lo esta. Afirmar la equivalencia hacia los
            // dos lados hacia depender la prueba de cuantos cupos quedaran ese dia.
            if (!ZapataAgendaController.esProcedenciaOperacional(slot.procedencia)) {
                Assert.areEqual(
                    false,
                    slot.disponible,
                    'sin procedencia operacional no puede presentarse como reservable'
                );
                Assert.isNotNull(
                    slot.advertenciaProveniencia,
                    'una franja no verificada debe venir con su advertencia'
                );
            }
        }
    }

    @IsTest
    static void agendaRecorreCompuertasDeModeloSistemaYTipo() {
        Modelo_Sucursal__c cobertura = [
            SELECT Sucursal__r.Codigo_Sucursal__c, Modelo__r.ProductCode,
                   Sistemas_Soportados__c
            FROM Modelo_Sucursal__c
            WHERE Activo__c = true AND Sucursal__r.Activa__c = true
            LIMIT 1
        ];

        ZapataAgendaController.Peticion conModelo = new ZapataAgendaController.Peticion();
        conModelo.sucursal = cobertura.Sucursal__r.Codigo_Sucursal__c;
        conModelo.modeloCodigo = cobertura.Modelo__r.ProductCode;
        conModelo.diasAdelante = 365;

        ZapataAgendaController.Peticion conSistema = new ZapataAgendaController.Peticion();
        conSistema.sucursal = cobertura.Sucursal__r.Codigo_Sucursal__c;
        conSistema.modeloCodigo = cobertura.Modelo__r.ProductCode;
        conSistema.sistema = cobertura.Sistemas_Soportados__c;
        conSistema.tipoServicio = 'Diagnostico';
        conSistema.diasAdelante = 365;

        ZapataAgendaController.Peticion noAtendido = new ZapataAgendaController.Peticion();
        noAtendido.sucursal = cobertura.Sucursal__r.Codigo_Sucursal__c;
        noAtendido.modeloCodigo = 'MODELO-INEXISTENTE';

        List<ZapataAgendaController.Respuesta> respuestas =
            ZapataAgendaController.consultarDisponibilidad(
                new List<ZapataAgendaController.Peticion>{ conModelo, conSistema, noAtendido }
            );

        // Esta prueba toma la PRIMERA cobertura que haya en la org, asi que no puede
        // afirmar si esa sucursal tiene cupo confirmado o no: depende de los datos del
        // dia. Afirmarlo la hacia fallar sin defecto en cuanto la agenda cambiaba.
        //
        // Lo que si vale siempre es el invariante: o hay disponibilidad y entonces las
        // opciones son apartables, o no la hay y entonces NO llega ni una opcion. Nunca
        // una lista que el alta va a rechazar.
        for (ZapataAgendaController.Respuesta r : new List<ZapataAgendaController.Respuesta>{
            respuestas[0], respuestas[1]
        }) {
            if (r.hayDisponibilidad == true) {
                Assert.areEqual('OPERACIONAL_VERIFICADO', r.estadoProcedencia,
                    'si ofrece, lo ofrecido tiene que ser apartable');
                Assert.isTrue(r.opciones.size() > 0, 'con disponibilidad hay opciones');
            } else {
                Assert.areEqual(0, r.opciones.size(),
                    'sin disponibilidad no puede llegar ninguna opcion: ' + r.mensaje);
                Assert.isTrue(
                    r.motivoBloqueo == 'SLOTS_NO_VERIFICADOS' || r.motivoBloqueo == 'SIN_CUPO',
                    'el bloqueo tiene que decir cual de las dos cosas pasa: ' + r.motivoBloqueo
                );
            }
        }
        // Lo que SI sigue bloqueando es que el taller no atienda ese modelo: eso es un
        // hecho del catalogo, no una laguna de datos. Y como MODELO-INEXISTENTE no esta
        // en NINGUNA sucursal, el bloqueo lo distingue para no ofrecer una busqueda que
        // no puede terminar bien.
        Assert.areEqual('MODELO_FUERA_DE_RED', respuestas[2].motivoBloqueo);
    }

    /**
     * Lo que la regla bloquea hoy, y lo que dejo de bloquear.
     *
     * Nacio exigiendo OPERACIONAL_VERIFICADO y con eso dejaba fuera a ocho de las nueve
     * sucursales: su horario esta publicado en zapata.com.mx, lo que nadie ha verificado
     * es el cupo por franja. El 11-ago-2026 se acoto a lo pertinente —bloquear solo si no
     * se sabe de donde salio el horario— y esta prueba seguia afirmando la regla vieja:
     * fallaba sin defecto alguno. Ahora fija las dos mitades, que es lo que hace que la
     * relajacion no se convierta en ausencia de control.
     */
    @IsTest
    static void reprogramarSobreCapacidadAsumidaSiSePermite() {
        WorkOrder orden = [
            SELECT Id, StartDate, EndDate, Slot_Taller__c,
                   Slot_Taller__r.Procedencia__c
            FROM WorkOrder
            WHERE Slot_Taller__c != null
              AND Slot_Taller__r.Procedencia__c != null
              AND Slot_Taller__r.Procedencia__c != 'OPERACIONAL_VERIFICADO'
            LIMIT 1
        ];
        orden.StartDate = orden.StartDate.addDays(1);

        // Cupo por confirmar no es lo mismo que horario sin procedencia: al cliente se le
        // dice que la franja queda sujeta a confirmacion del taller, y se agenda.
        update orden;
        Assert.areEqual(
            orden.StartDate,
            [SELECT StartDate FROM WorkOrder WHERE Id = :orden.Id].StartDate,
            'Con procedencia registrada la reprogramacion debe pasar'
        );
    }

    @IsTest
    static void validacionImpideMoverFechaConSlotSinProcedencia() {
        WorkOrder orden = [
            SELECT Id, StartDate, EndDate, Slot_Taller__c
            FROM WorkOrder
            WHERE Slot_Taller__c != null
            LIMIT 1
        ];

        // Se borra la procedencia de la franja SOLO dentro de esta transaccion: es la
        // condicion que la regla debe seguir bloqueando. Salesforce lo revierte al salir.
        Slot_Taller__c franja = [
            SELECT Id, Procedencia__c FROM Slot_Taller__c WHERE Id = :orden.Slot_Taller__c
        ];
        franja.Procedencia__c = null;
        update franja;

        orden.StartDate = orden.StartDate.addDays(1);
        try {
            update orden;
            Assert.fail('Sin procedencia registrada la regla debio impedir reprogramar');
        } catch (DmlException e) {
            Assert.isTrue(
                e.getMessage().contains('SLOT_SIN_PROCEDENCIA'),
                'Debe fallar por procedencia ausente: ' + e.getMessage()
            );
        }
    }
}