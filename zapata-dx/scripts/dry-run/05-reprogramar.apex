// T12 reprogramacion valida, T13 ventana restringida, orden cerrada y folio inexistente.
// Invariante que se prueba: el folio de salida es el mismo y COUNT(WorkOrder) no sube.

// ---------- A) T12: crear una orden a +5 dias y moverla a +8 dias
String cA = 'DRYRUN-05A-' + Datetime.now().getTime();
Flow.Interview.Crear_Orden_Servicio crear = new Flow.Interview.Crear_Orden_Servicio(
    new Map<String, Object>{
        'varVIN' => '3HAMMAAR8LL123456', 'varSucursalClave' => 'FL-QRO',
        'varTipoServicio' => 'Diagnostico', 'varSintoma' => 'Revision programada',
        'varFechaDeseada' => Date.today().addDays(5),
        'varIdempotencyKey' => cA + '-WO', 'varCorrelationId' => cA});
crear.start();
String folio = (String) crear.getVariableValue('varFolio');
System.debug('##SETUP## orden creada folio=' + folio + ' cita=' + crear.getVariableValue('varCitaTexto'));

WorkOrder woAntes = [SELECT Id, StartDate, Slot_Taller__c, Description FROM WorkOrder WHERE WorkOrderNumber = :folio];
Id slotViejo = woAntes.Slot_Taller__c;
Decimal cupoViejoAntes = [SELECT Capacidad_Usada__c FROM Slot_Taller__c WHERE Id = :slotViejo].Capacidad_Usada__c;
Integer totalAntes = [SELECT COUNT() FROM WorkOrder];

Flow.Interview.Reprogramar_Orden_Servicio rep = new Flow.Interview.Reprogramar_Orden_Servicio(
    new Map<String, Object>{
        'varFolio' => folio, 'varNuevaFecha' => Date.today().addDays(8),
        'varMotivo' => 'Al operador le cambiaron la ruta esa semana',
        'varCorrelationId' => cA, 'varSessionKey' => 'SES-05A'});
rep.start();

Integer totalDespues = [SELECT COUNT() FROM WorkOrder];
WorkOrder woDespues = [SELECT Id, StartDate, Slot_Taller__c, Description FROM WorkOrder WHERE WorkOrderNumber = :folio];
Decimal cupoViejoDespues = [SELECT Capacidad_Usada__c FROM Slot_Taller__c WHERE Id = :slotViejo].Capacidad_Usada__c;
Decimal cupoNuevo = [SELECT Capacidad_Usada__c FROM Slot_Taller__c WHERE Id = :woDespues.Slot_Taller__c].Capacidad_Usada__c;

System.debug('##RES## A reprogramada=' + rep.getVariableValue('varReprogramada')
    + ' | folioEntrada=' + folio + ' | folioSalida=' + rep.getVariableValue('varFolioSalida')
    + ' | motivo=' + rep.getVariableValue('varMotivoBloqueo'));
System.debug('##RES## A antes=' + rep.getVariableValue('varAntes') + ' | despues=' + rep.getVariableValue('varDespues'));
System.debug('##MSG## A ' + rep.getVariableValue('varMensaje'));
System.debug('##CUPOS## slot viejo ' + cupoViejoAntes + '->' + cupoViejoDespues
    + ' | slot nuevo=' + cupoNuevo + ' | cambio de slot=' + (slotViejo != woDespues.Slot_Taller__c));
System.debug('##DESC## ' + woDespues.Description);
System.debug('##VEREDICTO## A ' + (folio == (String) rep.getVariableValue('varFolioSalida')
    && totalAntes == totalDespues && woAntes.StartDate != woDespues.StartDate
    ? 'OK mismo registro, fecha movida, cero alta nueva'
    : 'FALLA total ' + totalAntes + '->' + totalDespues));

// ---------- B) T13: orden cuya cita ya cae dentro de la ventana restringida
String cB = 'DRYRUN-05B-' + Datetime.now().getTime();
Asset uni = [SELECT Id, AccountId FROM Asset WHERE SerialNumber = '3HAMMAAR8LL123456' LIMIT 1];
Slot_Taller__c slotB = [SELECT Id, Inicio__c, Fin__c, Sucursal__c FROM Slot_Taller__c
                        WHERE Sucursal__r.Codigo_Sucursal__c = 'FL-QRO' AND Disponible__c = true
                        ORDER BY Inicio__c ASC LIMIT 1];
WorkOrder woB = new WorkOrder(
    AssetId = uni.Id, AccountId = uni.AccountId, Subject = 'Cita inminente de prueba',
    StartDate = Datetime.now().addHours(3), EndDate = Datetime.now().addHours(5),
    Status = 'New', Slot_Taller__c = slotB.Id, Sucursal__c = slotB.Sucursal__c,
    Idempotency_Key__c = cB + '-WO', Correlation_Id__c = cB, Origen_Atencion__c = 'Agentforce');
insert woB;
// Se relee de la base a proposito: Salesforce trunca el DateTime a segundos al guardar,
// asi que comparar contra el valor en memoria daria un falso negativo por milisegundos.
WorkOrder woBLeido = [SELECT WorkOrderNumber, StartDate FROM WorkOrder WHERE Id = :woB.Id];
String folioB = woBLeido.WorkOrderNumber;
Datetime inicioB = woBLeido.StartDate;

Flow.Interview.Reprogramar_Orden_Servicio repB = new Flow.Interview.Reprogramar_Orden_Servicio(
    new Map<String, Object>{
        'varFolio' => folioB, 'varNuevaFecha' => Date.today().addDays(6),
        'varMotivo' => 'El cliente pide moverla a la semana que entra',
        'varCorrelationId' => cB});
repB.start();

WorkOrder woBDespues = [SELECT StartDate FROM WorkOrder WHERE Id = :woB.Id];
System.debug('##RES## B reprogramada=' + repB.getVariableValue('varReprogramada')
    + ' | motivo=' + repB.getVariableValue('varMotivoBloqueo')
    + ' | caso=' + repB.getVariableValue('varCasoCreado'));
System.debug('##MSG## B ' + repB.getVariableValue('varMensaje'));
System.debug('##VEREDICTO## B ' + (woBDespues.StartDate == inicioB
    && repB.getVariableValue('varCasoCreado') != null
    ? 'OK fecha intacta y caso levantado' : 'FALLA movio la fecha o no levanto caso'));

// ---------- C) orden cerrada
update new WorkOrder(Id = woB.Id, Status = 'Closed');
String cC = 'DRYRUN-05C-' + Datetime.now().getTime();
Flow.Interview.Reprogramar_Orden_Servicio repC = new Flow.Interview.Reprogramar_Orden_Servicio(
    new Map<String, Object>{
        'varFolio' => folioB, 'varNuevaFecha' => Date.today().addDays(9),
        'varMotivo' => 'Intento sobre una orden cerrada', 'varCorrelationId' => cC});
repC.start();
System.debug('##RES## C motivo=' + repC.getVariableValue('varMotivoBloqueo')
    + ' reprogramada=' + repC.getVariableValue('varReprogramada'));

// ---------- D) folio inexistente
String cD = 'DRYRUN-05D-' + Datetime.now().getTime();
Flow.Interview.Reprogramar_Orden_Servicio repD = new Flow.Interview.Reprogramar_Orden_Servicio(
    new Map<String, Object>{
        'varFolio' => '99999999', 'varNuevaFecha' => Date.today().addDays(9),
        'varMotivo' => 'Folio que no existe', 'varCorrelationId' => cD});
repD.start();
System.debug('##RES## D motivo=' + repD.getVariableValue('varMotivoBloqueo')
    + ' reprogramada=' + repD.getVariableValue('varReprogramada'));

for (Log_Agente__c l : [SELECT Correlation_Id__c, Action_Name__c, Outcome__c, Guardrail_Triggered__c,
                               Error_Code__c, WorkOrder__c, Case__c, Policy_Version__c
                        FROM Log_Agente__c WHERE Correlation_Id__c LIKE 'DRYRUN-05%'
                        ORDER BY Timestamp__c]) {
    System.debug('##LOG## ' + l.Correlation_Id__c.left(11) + ' / ' + l.Action_Name__c + ' / ' + l.Outcome__c
        + ' / guard=' + l.Guardrail_Triggered__c + ' / err=' + l.Error_Code__c
        + ' / wo=' + l.WorkOrder__c + ' / case=' + l.Case__c + ' / pol=' + l.Policy_Version__c);
}
