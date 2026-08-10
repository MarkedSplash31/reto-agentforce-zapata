// T09 VIN invalido, gate de unidad no verificada, taller inexistente y anticipacion insuficiente.
// En los cuatro se espera cero WorkOrder nuevo y un log con codigo estable.
Integer antes = [SELECT COUNT() FROM WorkOrder];

Map<String, Object> base = new Map<String, Object>{
    'varSucursalClave' => 'FL-QRO',
    'varSintoma' => 'Ruido en el diferencial',
    'varTipoServicio' => 'Diagnostico'
};

// --- T09: VIN que no existe
String c1 = 'DRYRUN-03A-' + Datetime.now().getTime();
Map<String, Object> p1 = base.clone();
p1.putAll(new Map<String, Object>{
    'varVIN' => 'XXXXXXXXXXXXXXXXX', 'varIdempotencyKey' => c1 + '-WO', 'varCorrelationId' => c1});
Flow.Interview.Crear_Orden_Servicio f1 = new Flow.Interview.Crear_Orden_Servicio(p1);
f1.start();
System.debug('##RES## T09 vin-malo motivo=' + f1.getVariableValue('varMotivoBloqueo')
    + ' creada=' + f1.getVariableValue('varCreada'));

// --- Gate: unidad existente pero sin verificar (Unidad 102)
String c2 = 'DRYRUN-03B-' + Datetime.now().getTime();
Map<String, Object> p2 = base.clone();
p2.putAll(new Map<String, Object>{
    'varVIN' => '3HAMMAAR8LL123457', 'varIdempotencyKey' => c2 + '-WO', 'varCorrelationId' => c2});
Flow.Interview.Crear_Orden_Servicio f2 = new Flow.Interview.Crear_Orden_Servicio(p2);
f2.start();
System.debug('##RES## gate no-verificada motivo=' + f2.getVariableValue('varMotivoBloqueo')
    + ' creada=' + f2.getVariableValue('varCreada'));

// --- Taller que no existe
String c3 = 'DRYRUN-03C-' + Datetime.now().getTime();
Map<String, Object> p3 = base.clone();
p3.putAll(new Map<String, Object>{
    'varVIN' => '3HAMMAAR8LL123456', 'varSucursalClave' => 'FL-NOEXISTE',
    'varIdempotencyKey' => c3 + '-WO', 'varCorrelationId' => c3});
Flow.Interview.Crear_Orden_Servicio f3 = new Flow.Interview.Crear_Orden_Servicio(p3);
f3.start();
System.debug('##RES## taller-inexistente motivo=' + f3.getVariableValue('varMotivoBloqueo')
    + ' creada=' + f3.getVariableValue('varCreada'));

// --- Fecha dentro de la anticipacion minima (dentro de 2 horas)
String c4 = 'DRYRUN-03D-' + Datetime.now().getTime();
Map<String, Object> p4 = base.clone();
p4.putAll(new Map<String, Object>{
    'varVIN' => '3HAMMAAR8LL123456', 'varFechaDeseada' => Date.today(),
    'varIdempotencyKey' => c4 + '-WO', 'varCorrelationId' => c4});
Flow.Interview.Crear_Orden_Servicio f4 = new Flow.Interview.Crear_Orden_Servicio(p4);
f4.start();
System.debug('##RES## anticipacion motivo=' + f4.getVariableValue('varMotivoBloqueo')
    + ' creada=' + f4.getVariableValue('varCreada'));

Integer despues = [SELECT COUNT() FROM WorkOrder];
System.debug('##CUENTA## WorkOrder antes=' + antes + ' despues=' + despues + ' (esperado igual)');
System.debug('##VEREDICTO## ' + (antes == despues ? 'OK cero mutacion' : 'FALLA escribio algo'));

for (Log_Agente__c l : [SELECT Correlation_Id__c, Outcome__c, Error_Code__c, Guardrail_Triggered__c
                        FROM Log_Agente__c WHERE Correlation_Id__c LIKE 'DRYRUN-03%'
                        ORDER BY Timestamp__c]) {
    System.debug('##LOG## ' + l.Correlation_Id__c + ' / ' + l.Outcome__c
        + ' / err=' + l.Error_Code__c + ' / guard=' + l.Guardrail_Triggered__c);
}
