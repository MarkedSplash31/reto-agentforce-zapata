// Caso feliz: VIN verificado + taller activo + hay cupo.
// Espera: varCreada=true, folio, cupo de la franja +1, un log SUCCESS.
String corr = 'DRYRUN-01-' + Datetime.now().getTime();

Map<String, Object> p = new Map<String, Object>{
    'varVIN' => '3HAMMAAR8LL123456',
    'varSucursalClave' => 'FL-QRO',
    'varTipoServicio' => 'Garantia',
    'varSintoma' => 'Perdida de potencia en subida y silbido al acelerar',
    'varIdempotencyKey' => corr + '-WO',
    'varCorrelationId' => corr,
    'varSessionKey' => 'SES-01'
};

Flow.Interview.Crear_Orden_Servicio f = new Flow.Interview.Crear_Orden_Servicio(p);
f.start();

System.debug('##RES## creada=' + f.getVariableValue('varCreada')
    + ' | folio=' + f.getVariableValue('varFolio')
    + ' | motivo=' + f.getVariableValue('varMotivoBloqueo')
    + ' | cita=' + f.getVariableValue('varCitaTexto'));
System.debug('##MSG## ' + f.getVariableValue('varMensaje'));

for (Log_Agente__c l : [SELECT Action_Name__c, Outcome__c, Subagent__c, Related_Record_Id__c,
                               WorkOrder__c, Guardrail_Triggered__c, Error_Code__c
                        FROM Log_Agente__c WHERE Correlation_Id__c = :corr]) {
    System.debug('##LOG## ' + l.Action_Name__c + ' / ' + l.Outcome__c + ' / sub=' + l.Subagent__c
        + ' / rel=' + l.Related_Record_Id__c + ' / wo=' + l.WorkOrder__c
        + ' / guard=' + l.Guardrail_Triggered__c + ' / err=' + l.Error_Code__c);
}

for (WorkOrder w : [SELECT WorkOrderNumber, Status, StartDate, EndDate, Sucursal__c, Slot_Taller__c,
                           Slot_Taller__r.Capacidad_Usada__c, Slot_Taller__r.Capacidad_Total__c,
                           Tipo_Cita__c, Origen_Atencion__c, AssetId, AccountId
                    FROM WorkOrder WHERE Correlation_Id__c = :corr]) {
    System.debug('##WO## ' + w.WorkOrderNumber + ' / ' + w.Status + ' / ' + w.StartDate
        + ' -> ' + w.EndDate + ' / tipo=' + w.Tipo_Cita__c + ' / origen=' + w.Origen_Atencion__c
        + ' / cupo=' + w.Slot_Taller__r.Capacidad_Usada__c + '/' + w.Slot_Taller__r.Capacidad_Total__c
        + ' / asset=' + w.AssetId + ' / cuenta=' + w.AccountId);
}
