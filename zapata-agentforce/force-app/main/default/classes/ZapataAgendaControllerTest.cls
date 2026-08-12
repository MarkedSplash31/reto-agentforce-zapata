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
        // La procedencia es parte de la condicion, no un adorno: el calendario marca
        // agendable solo la franja cuya capacidad esta verificada operacionalmente. La
        // prueba nacio antes de esa compuerta y no la fijaba, asi que fallaba sin que
        // existiera defecto. Se declara explicitamente.
        insert new Slot_Taller__c(Sucursal__c=s.Id, Inicio__c=base, Fin__c=base.addHours(2),
            Capacidad_Total__c=3, Capacidad_Usada__c=1, Tipo_Servicio__c='Garantia',
            Procedencia__c='OPERACIONAL_VERIFICADO');
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
        System.assertEquals(true, r[0].disponible, 'Con cupo, sucursal activa y capacidad verificada debe estar disponible');
        System.assertEquals(null, r[0].advertenciaProveniencia, 'Verificada no lleva advertencia');
        System.assertEquals('Taller prueba', r[0].sucursal);
    }

    /**
     * La otra mitad de la compuerta: con el horario publicado pero el cupo sin verificar,
     * el calendario no la ofrece como agendable y dice por que. Sin esta prueba, relajar
     * la condicion de arriba pasaria inadvertido.
     */
    @isTest
    static void capacidadAsumidaNoSeOfreceComoAgendable() {
        Sucursal__c s = new Sucursal__c(Name='Taller supuesto', Codigo_Sucursal__c='TST-2',
            Activa__c=true, Zona_Horaria__c='America/Mexico_City');
        insert s;

        Datetime base = Datetime.now().addDays(1);
        insert new Slot_Taller__c(Sucursal__c=s.Id, Inicio__c=base, Fin__c=base.addHours(2),
            Capacidad_Total__c=3, Capacidad_Usada__c=0, Tipo_Servicio__c='Garantia',
            Procedencia__c='SITIO_WEB_CAPACIDAD_ASUMIDA');

        Test.startTest();
        List<ZapataAgendaController.SlotView> r =
            ZapataAgendaController.getSlots(base.addHours(-2), base.addDays(7), s.Id);
        Test.stopTest();

        System.assertEquals(1, r.size(), 'La franja debe listarse aunque no sea agendable');
        System.assertEquals(false, r[0].disponible, 'Cupo asumido no se ofrece como agendable');
        System.assertNotEquals(null, r[0].advertenciaProveniencia,
            'Debe decir por que no es agendable, no callarlo');
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
                Tipo_Servicio__c='Garantia',
                // La procedencia es parte de la condicion, igual que en `getSlots`: la
                // accion del agente solo ofrece lo que el alta acepta. Este arnes nacio
                // cuando la compuerta vivia solo en el calendario visual y por eso no la
                // declaraba; sin ella, un taller "con agenda" no ofrece nada.
                Procedencia__c='OPERACIONAL_VERIFICADO'));
        }
        insert slots;
        return s;
    }

    /** Un taller con horario publicado cuyo cupo nadie confirmo. */
    private static Sucursal__c tallerSinCupoConfirmado(String codigo, String nombre) {
        Sucursal__c s = new Sucursal__c(Name=nombre, Codigo_Sucursal__c=codigo,
            Activa__c=true, Anticipacion_Minima_Horas__c=24,
            Zona_Horaria__c='America/Mexico_City');
        insert s;
        List<Slot_Taller__c> slots = new List<Slot_Taller__c>();
        for (Integer d = 2; d <= 5; d++) {
            Datetime ini = System.now().addDays(d);
            slots.add(new Slot_Taller__c(Sucursal__c=s.Id, Inicio__c=ini,
                Fin__c=ini.addHours(2), Capacidad_Total__c=3, Capacidad_Usada__c=0,
                Tipo_Servicio__c='Garantia',
                Procedencia__c='SITIO_WEB_CAPACIDAD_ASUMIDA'));
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
        // MOD-NO no esta dado de alta en NINGUNA sucursal, asi que el bloqueo distingue:
        // ofrecer "otro taller que si lo atienda" seria mandar al cliente a buscar en
        // vano. Es lo que pasaba con el T680, nueve de las quince unidades de la flota.
        System.assertEquals('MODELO_FUERA_DE_RED', r.motivoBloqueo);
        System.assert(r.mensaje.contains('asesor'),
            'Sin ningun taller en la red, lo honesto es pasar con una persona: ' + r.mensaje);
    }

    /**
     * El mismo bloqueo, pero con el modelo dado de alta en OTRA sucursal. Aqui si existe
     * la alternativa, y ofrecerla es correcto. Sin este caso, la comprobacion de arriba
     * se podria satisfacer negando siempre.
     */
    @isTest
    static void ofreceOtroTallerSoloSiLoHay() {
        Sucursal__c pedido = tallerConAgenda('TST-D6', 'Taller Pedido');
        Sucursal__c otro = tallerConAgenda('TST-D7', 'Taller Con Ese Modelo');
        Product2 mod = new Product2(Name='Buscado', ProductCode='MOD-OTRO', IsActive=true);
        insert mod;
        insert new Modelo_Sucursal__c(Sucursal__c=otro.Id, Modelo__c=mod.Id,
            Sistemas_Soportados__c='Tren motriz', Nivel_Servicio__c='Servicio completo',
            Activo__c=true);
        // El taller pedido atiende otro modelo distinto, para que la compuerta se active.
        Product2 suyo = new Product2(Name='Suyo', ProductCode='MOD-SUYO', IsActive=true);
        insert suyo;
        insert new Modelo_Sucursal__c(Sucursal__c=pedido.Id, Modelo__c=suyo.Id,
            Sistemas_Soportados__c='Tren motriz', Nivel_Servicio__c='Servicio completo',
            Activo__c=true);

        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = 'TST-D6';
        p.modeloCodigo = 'MOD-OTRO';

        Test.startTest();
        ZapataAgendaController.Respuesta r = correr(p);
        Test.stopTest();

        System.assertEquals('MODELO_NO_ATENDIDO', r.motivoBloqueo,
            'Existiendo otra sucursal con ese modelo, la alternativa es real');
        System.assert(r.mensaje.contains('otro taller'), r.mensaje);
    }

    /**
     * El defecto que este arnes no cubria: la accion ofrecia franjas cuyo cupo nadie
     * confirmo, y el Flow `Crear_Orden_Servicio` despues las rechaza con
     * SLOT_NO_VERIFICADO. El cliente elegia una y se enteraba al final.
     *
     * Lo que se fija no es solo el codigo de bloqueo: es que NO haya opciones. Una
     * salvedad en el texto se pierde cuando el agente redacta; una lista vacia no.
     */
    @isTest
    static void noOfreceFranjasQueElAltaVaARechazar() {
        tallerSinCupoConfirmado('TST-D8', 'Taller Sin Confirmar');
        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = 'TST-D8';

        Test.startTest();
        ZapataAgendaController.Respuesta r = correr(p);
        Test.stopTest();

        System.assertEquals(false, r.hayDisponibilidad, 'Sin cupo confirmado no hay que ofrecer');
        System.assertEquals(0, r.opciones.size(),
            'Ni una sola opcion: el agente no puede listar lo que no recibe');
        System.assertEquals(0, r.slotIds.size());
        System.assertEquals('SLOTS_NO_VERIFICADOS', r.motivoBloqueo);
        System.assertEquals('SITIO_WEB_CAPACIDAD_ASUMIDA', r.estadoProcedencia);
        System.assert(r.mensaje.contains('publica'),
            'Debe reconocer que el horario existe, no negar el taller: ' + r.mensaje);
    }

    /**
     * Y cerrar un taller no puede dejar al cliente a ciegas: si otra sucursal si puede
     * apartar hoy, se dice. Sin esto vuelve el callejon de ir probando una por una.
     */
    @isTest
    static void aldecirQueNoOfreceDondeSiSePuede() {
        tallerConAgenda('TST-D9', 'Taller Con Cupo');
        tallerSinCupoConfirmado('TST-DA', 'Taller Sin Cupo');

        ZapataAgendaController.Peticion p = new ZapataAgendaController.Peticion();
        p.sucursal = 'TST-DA';

        Test.startTest();
        ZapataAgendaController.Respuesta r = correr(p);
        Test.stopTest();

        System.assert(r.mensaje.contains('Taller Con Cupo'),
            'Debe nombrar donde si se puede apartar hoy: ' + r.mensaje);
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