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
        Assert.areEqual(false, agenda.hayDisponibilidad);
        Assert.areEqual('SLOTS_NO_VERIFICADOS', agenda.motivoBloqueo);
        Assert.areEqual('SITIO_WEB_CAPACIDAD_ASUMIDA', agenda.estadoProcedencia);
        Assert.areEqual('SUCURSAL_NO_ENCONTRADA', ausente.motivoBloqueo);
        for (ZapataAgendaController.SlotView slot : todos) {
            Assert.areEqual(false, slot.disponible);
            Assert.isNotNull(slot.advertenciaProveniencia);
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

        Assert.areEqual('SLOTS_NO_VERIFICADOS', respuestas[0].motivoBloqueo);
        Assert.areEqual('SLOTS_NO_VERIFICADOS', respuestas[1].motivoBloqueo);
        Assert.areEqual('MODELO_NO_ATENDIDO', respuestas[2].motivoBloqueo);
    }

    @IsTest
    static void validacionImpideMoverFechaConSlotNoVerificado() {
        WorkOrder orden = [
            SELECT Id, StartDate, EndDate, Slot_Taller__c,
                   Slot_Taller__r.Procedencia__c
            FROM WorkOrder
            WHERE Slot_Taller__c != null
              AND Slot_Taller__r.Procedencia__c != 'OPERACIONAL_VERIFICADO'
            LIMIT 1
        ];
        orden.StartDate = orden.StartDate.addDays(1);

        try {
            update orden;
            Assert.fail('La regla debio impedir reprogramar sobre capacidad asumida');
        } catch (DmlException e) {
            Assert.isTrue(e.getMessage().contains('SLOT_NO_VERIFICADO'));
        }
    }
}
