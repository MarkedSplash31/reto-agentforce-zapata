/**
 * Pruebas del controlador del calendario de agenda.
 * No dependen de datos previos: crean lo suyo y lo dejan en el rollback del test.
 */
@isTest
private class ZapataAgendaControllerTest {

    @isTest
    static void devuelveSlotsDelRango() {
        Sucursal__c s = new Sucursal__c(Name='Taller prueba', Codigo_Sucursal__c='TST-1',
            Activa__c=true, Zona_Horaria__c='America/Mexico_City');
        insert s;

        Datetime base = Datetime.now().addDays(1);
        insert new Slot_Taller__c(Sucursal__c=s.Id, Inicio__c=base, Fin__c=base.addHours(2),
            Capacidad_Total__c=3, Capacidad_Usada__c=1, Tipo_Servicio__c='Garantia');
        // Fuera del rango que se va a consultar
        insert new Slot_Taller__c(Sucursal__c=s.Id, Inicio__c=base.addDays(20),
            Fin__c=base.addDays(20).addHours(2), Capacidad_Total__c=3,
            Tipo_Servicio__c='Diagnostico');

        Test.startTest();
        List<ZapataAgendaController.SlotView> r =
            ZapataAgendaController.getSlots(base.addHours(-2), base.addDays(7), null);
        Test.stopTest();

        System.assertEquals(1, r.size(), 'Solo debe traer la franja dentro del rango');
        System.assertEquals(2, r[0].cuposLibres, 'Tres de capacidad menos uno usado');
        System.assertEquals(true, r[0].disponible, 'Con cupo y sucursal activa debe estar disponible');
        System.assertEquals('Taller prueba', r[0].sucursal);
    }

    @isTest
    static void filtraPorSucursal() {
        Sucursal__c a = new Sucursal__c(Name='Taller A', Codigo_Sucursal__c='TST-A', Activa__c=true);
        Sucursal__c b = new Sucursal__c(Name='Taller B', Codigo_Sucursal__c='TST-B', Activa__c=true);
        insert new List<Sucursal__c>{ a, b };

        Datetime base = Datetime.now().addDays(1);
        insert new List<Slot_Taller__c>{
            new Slot_Taller__c(Sucursal__c=a.Id, Inicio__c=base, Fin__c=base.addHours(2),
                Capacidad_Total__c=2, Tipo_Servicio__c='Garantia'),
            new Slot_Taller__c(Sucursal__c=b.Id, Inicio__c=base, Fin__c=base.addHours(2),
                Capacidad_Total__c=2, Tipo_Servicio__c='Garantia')
        };

        Test.startTest();
        List<ZapataAgendaController.SlotView> r =
            ZapataAgendaController.getSlots(base.addHours(-2), base.addDays(7), a.Id);
        Test.stopTest();

        System.assertEquals(1, r.size(), 'Debe traer solo las franjas del taller filtrado');
        System.assertEquals('Taller A', r[0].sucursal);
    }

    @isTest
    static void listaSoloSucursalesActivas() {
        insert new List<Sucursal__c>{
            new Sucursal__c(Name='Activa', Codigo_Sucursal__c='TST-ON', Activa__c=true),
            new Sucursal__c(Name='Inactiva', Codigo_Sucursal__c='TST-OFF', Activa__c=false)
        };

        Test.startTest();
        List<Sucursal__c> r = ZapataAgendaController.getSucursales();
        Test.stopTest();

        System.assertEquals(1, r.size(), 'Una sucursal inactiva no se debe ofrecer para agendar');
        System.assertEquals('Activa', r[0].Name);
    }

    // ================================================================== //
    //  Accion del agente: Consultar_Disponibilidad                        //
    // ================================================================== //

    private static Sucursal__c tallerConAgenda(String codigo, String nombre) {
        Sucursal__c s = new Sucursal__c(Name=nombre, Codigo_Sucursal__c=codigo,
            Activa__c=true, Anticipacion_Minima_Horas__c=24,
            Zona_Horaria__c='America/Mexico_City');
        insert s;
        List<Slot_Taller__c> slots = new List<Slot_Taller__c>();
        for (Integer d = 2; d <= 5; d++) {
            Datetime ini = System.now().addDays(d);
            slots.add(new Slot_Taller__c(Sucursal__c=s.Id, Inicio__c=ini,
                Fin__c=ini.addHours(2), Capacidad_Total__c=3, Capacidad_Usada__c=0,
                Tipo_Servicio__c='Garantia'));
        }
        insert slots;
        return s;
    }

    private static ZapataAgendaController.Respuesta correr(ZapataAgendaController.Peticion p) {
        return ZapataAgendaController.consultarDisponibilidad(
            new List<ZapataAgendaController.Peticion>{ p }).get(0);
    }

    @isTest
    static void ofreceHorariosCuandoHayCupo() {
        tallerConAgenda('TST-D1', 'Taller Disponibilidad');
        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = 'TST-D1';

        Test.startTest();
        ZapataAgendaController.Respuesta r = correr(p);
        Test.stopTest();

        System.assertEquals(true, r.hayDisponibilidad, 'Con cupo debe ofrecer horarios');
        System.assertEquals(4, r.opciones.size(), 'Cuatro franjas creadas, cuatro ofrecidas');
        System.assertEquals(4, r.slotIds.size());
        System.assert(!r.opciones[0].contains(r.slotIds[0]),
            'El texto visible NUNCA debe llevar el Id interno de la franja');
    }

    @isTest
    static void bloqueaSucursalInexistente() {
        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = 'Taller que no existe';

        Test.startTest();
        ZapataAgendaController.Respuesta r = correr(p);
        Test.stopTest();

        System.assertEquals(false, r.hayDisponibilidad);
        System.assertEquals('SUCURSAL_NO_ENCONTRADA', r.motivoBloqueo);
    }

    @isTest
    static void bloqueaSucursalInactiva() {
        Sucursal__c s = tallerConAgenda('TST-D2', 'Taller Cerrado');
        s.Activa__c = false;
        update s;

        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = 'TST-D2';

        Test.startTest();
        ZapataAgendaController.Respuesta r = correr(p);
        Test.stopTest();

        System.assertEquals(false, r.hayDisponibilidad);
        System.assertEquals('SUCURSAL_INACTIVA', r.motivoBloqueo);
    }

    @isTest
    static void bloqueaModeloQueElTallerNoAtiende() {
        Sucursal__c s = tallerConAgenda('TST-D3', 'Taller Parcial');
        Product2 atendido = new Product2(Name='Atendido', ProductCode='MOD-SI', IsActive=true);
        Product2 otro = new Product2(Name='No atendido', ProductCode='MOD-NO', IsActive=true);
        insert new List<Product2>{ atendido, otro };
        insert new Modelo_Sucursal__c(Sucursal__c=s.Id, Modelo__c=atendido.Id,
            Sistemas_Soportados__c='Tren motriz', Nivel_Servicio__c='Servicio completo',
            Activo__c=true);

        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = 'TST-D3';
        p.modeloCodigo = 'MOD-NO';

        Test.startTest();
        ZapataAgendaController.Respuesta r = correr(p);
        Test.stopTest();

        System.assertEquals(false, r.hayDisponibilidad,
            'No debe ofrecer cita de un modelo que el taller no atiende');
        System.assertEquals('MODELO_NO_ATENDIDO', r.motivoBloqueo);
    }

    @isTest
    static void respetaLaAnticipacionMinima() {
        Sucursal__c s = new Sucursal__c(Name='Taller Anticipacion',
            Codigo_Sucursal__c='TST-D4', Activa__c=true, Anticipacion_Minima_Horas__c=24);
        insert s;
        // Franja dentro de las proximas 3 horas: no debe ofrecerse.
        Datetime pronto = System.now().addHours(3);
        insert new Slot_Taller__c(Sucursal__c=s.Id, Inicio__c=pronto,
            Fin__c=pronto.addHours(2), Capacidad_Total__c=3, Tipo_Servicio__c='Garantia');

        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = 'TST-D4';

        Test.startTest();
        ZapataAgendaController.Respuesta r = correr(p);
        Test.stopTest();

        System.assertEquals(false, r.hayDisponibilidad,
            'Una franja a 3 horas viola la anticipacion minima de 24 h');
        System.assertEquals('SIN_CUPO', r.motivoBloqueo);
    }

    @isTest
    static void filtraPorTipoDeServicio() {
        tallerConAgenda('TST-D5', 'Taller Tipos');
        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = 'TST-D5';
        p.tipoServicio = 'Mantenimiento';   // las franjas creadas son de Garantia

        Test.startTest();
        ZapataAgendaController.Respuesta r = correr(p);
        Test.stopTest();

        System.assertEquals(false, r.hayDisponibilidad,
            'No hay franjas de Mantenimiento, solo de Garantia');
    }
}
