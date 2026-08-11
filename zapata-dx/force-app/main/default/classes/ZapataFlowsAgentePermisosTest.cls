/**
 * El riesgo de la seccion 18 del Plan Final: "accion con permisos de admin pero no de
 * agente". Que un Flow funcione desde Setup no prueba nada; lo que decide es si el
 * usuario que ejecuta el agente puede escribir.
 *
 * Por eso estas pruebas corren dentro de System.runAs con el usuario real del agente y
 * no con el administrador que despliega. Las pruebas de agenda comprueban ahora el
 * bloqueo seguro: el seed no contiene ninguna franja OPERACIONAL_VERIFICADO.
 *
 * SeeAllData=true a proposito: se valida contra el seed real de la org (VIN, talleres y
 * franjas). Un set de datos fabricado en el test probaria el Flow, no los permisos ni
 * los datos con los que se va a grabar la demo. Todo lo que escriben estas pruebas se
 * revierte al terminar.
 */
@IsTest(SeeAllData=true)
private class ZapataFlowsAgentePermisosTest {

    private static final String VIN_VERIFICADO = '3HAMMAAR8LL123456';
    /** Unidad 102. La prueba le fija ella misma el estado que necesita, no lo asume. */
    private static final String VIN_SIN_VERIFICAR = '3HAMMAAR8LL123457';

    private static User usuarioDelAgente() {
        return [SELECT Id, Username FROM User
                WHERE Username LIKE 'agente_postventa_zapata@%' AND IsActive = true
                LIMIT 1];
    }

    @IsTest
    static void elAgenteNoReservaSinSlotOperacionalExplicito() {
        String corr = 'PERMTEST-CREAR';
        Flow.Interview.Crear_Orden_Servicio f;
        Integer antes = [SELECT COUNT() FROM WorkOrder];
        // Todo el seed quedo correctamente no verificado. Para aislar la compuerta
        // de slot, habilitamos esta unidad solo dentro de la transaccion del test;
        // Salesforce revierte el cambio al finalizar.
        Asset unidadSoloParaTest = [
            SELECT Id, Unidad_Verificada__c FROM Asset WHERE SerialNumber = :VIN_VERIFICADO LIMIT 1
        ];
        unidadSoloParaTest.Unidad_Verificada__c = true;
        update unidadSoloParaTest;

        System.runAs(usuarioDelAgente()) {
            f = new Flow.Interview.Crear_Orden_Servicio(new Map<String, Object>{
                'varVIN' => VIN_VERIFICADO,
                'varSucursalClave' => 'FL-QRO',
                'varSintoma' => 'Prueba de permisos del agente',
                'varFechaDeseada' => Date.today().addDays(4),
                'varIdempotencyKey' => corr + '-WO',
                'varCorrelationId' => corr});
            f.start();
        }

        Assert.areEqual(false, f.getVariableValue('varCreada'));
        Assert.areEqual('SLOT_VERIFICADO_REQUERIDO', f.getVariableValue('varMotivoBloqueo'));
        Assert.areEqual(antes, [SELECT COUNT() FROM WorkOrder],
            'Un horario aproximado o derivado nunca debe crear una orden');
        Assert.areEqual(1, [SELECT COUNT() FROM Log_Agente__c WHERE Correlation_Id__c = :corr],
            'Toda accion ejecutada deja exactamente un log');
    }

    @IsTest
    static void elAgenteNoReprogramaSinSlotOperacionalExplicito() {
        String corr = 'PERMTEST-REPROG';
        Flow.Interview.Reprogramar_Orden_Servicio mover;
        WorkOrder existente = [SELECT WorkOrderNumber, StartDate FROM WorkOrder LIMIT 1];

        System.runAs(usuarioDelAgente()) {
            mover = new Flow.Interview.Reprogramar_Orden_Servicio(new Map<String, Object>{
                'varFolio' => existente.WorkOrderNumber,
                'varNuevaFecha' => Date.today().addDays(9),
                'varMotivo' => 'Prueba de permisos del agente',
                'varCorrelationId' => corr});
            mover.start();
        }

        Assert.areEqual(false, mover.getVariableValue('varReprogramada'));
        String motivo = (String) mover.getVariableValue('varMotivoBloqueo');
        Assert.isTrue(
            motivo == 'SLOT_VERIFICADO_REQUERIDO' || motivo == 'VENTANA_RESTRINGIDA',
            'Una politica previa puede bloquear por ventana; ninguna ruta debe mutar sin slot verificado. Motivo: ' + motivo
        );
        WorkOrder despues = [SELECT StartDate FROM WorkOrder WHERE Id = :existente.Id];
        Assert.areEqual(existente.StartDate, despues.StartDate,
            'Sin una franja verificada la cita tiene que permanecer sin cambios');
    }

    @IsTest
    static void elAgentePuedeLevantarReporteDeUnidadVarada() {
        String corr = 'PERMTEST-VARADA';
        Flow.Interview.Crear_Reporte_Unidad_Varada f;

        System.runAs(usuarioDelAgente()) {
            f = new Flow.Interview.Crear_Reporte_Unidad_Varada(new Map<String, Object>{
                'varFueraDeCarril' => true, 'varIntermitentes' => true,
                'varCarretera' => 'Mexico-Queretaro 57D', 'varKilometro' => 120,
                'varSentido' => 'Norte', 'varVIN' => VIN_VERIFICADO,
                'varDescripcionFalla' => 'Prueba de permisos del agente',
                'varSucursalClave' => 'FL-QRO', 'varCorrelationId' => corr});
            f.start();
        }

        Assert.areEqual(true, f.getVariableValue('varReportada'),
            'El agente no pudo levantar el reporte. Motivo: ' + f.getVariableValue('varMotivoBloqueo')
            + ' / ' + f.getVariableValue('varMensaje'));
        Assert.isNotNull(f.getVariableValue('varFolio'),
            'El subagente no puede cerrar la conversacion sin entregar folio');
        Assert.areEqual(true, f.getVariableValue('varUnidadIdentificada'),
            'Con un VIN valido el reporte debe quedar ligado a la unidad');
        String folio = (String) f.getVariableValue('varFolio');
        Assert.areEqual('TRANSACCIONAL_CAPTURADO_EN_FLUJO',
            [SELECT Procedencia__c FROM Unidad_Varada__c WHERE Name = :folio].Procedencia__c);
    }

    @IsTest
    static void elAgenteNoPuedeAgendarSobreUnidadSinVerificar() {
        String corr = 'PERMTEST-GATE';
        Flow.Interview.Crear_Orden_Servicio f;
        Integer antes = [SELECT COUNT() FROM WorkOrder];

        // La prueba no puede dar por hecho el valor del seed. Nacio cuando ninguna
        // unidad estaba verificada y se apoyaba en que la Unidad 102 siguiera asi; el
        // 11-ago-2026, al habilitar el agendamiento en las nueve sucursales, el seed
        // quedo con todas verificadas y la compuerta dejo de dispararse: la prueba
        // fallaba sin que existiera defecto, y peor, habria dejado de vigilar el gate
        // sin avisar. Ahora fija la condicion que quiere probar dentro de la propia
        // transaccion —igual que su hermana hace al reves—, y Salesforce la revierte.
        Asset unidadSoloParaTest = [
            SELECT Id, Unidad_Verificada__c FROM Asset
            WHERE SerialNumber = :VIN_SIN_VERIFICAR LIMIT 1
        ];
        unidadSoloParaTest.Unidad_Verificada__c = false;
        update unidadSoloParaTest;

        System.runAs(usuarioDelAgente()) {
            f = new Flow.Interview.Crear_Orden_Servicio(new Map<String, Object>{
                'varVIN' => VIN_SIN_VERIFICAR,
                'varSucursalClave' => 'FL-QRO',
                'varSintoma' => 'Intento sobre unidad sin verificar',
                'varIdempotencyKey' => corr + '-WO', 'varCorrelationId' => corr});
            f.start();
        }

        Assert.areEqual('UNIDAD_NO_VERIFICADA', f.getVariableValue('varMotivoBloqueo'),
            'El gate de unidad no verificada debe bloquear antes de intentar reservar');
        Assert.areEqual(antes, [SELECT COUNT() FROM WorkOrder],
            'Umbral del plan: cero mutaciones con Unidad_Verificada=false');
    }
}
