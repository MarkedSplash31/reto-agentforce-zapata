// T15: la misma solicitud dos veces. Espera un solo WorkOrder y el mismo folio.
String corr = 'DRYRUN-02-' + Datetime.now().getTime();
String clave = corr + '-WO';

Map<String, Object> p = new Map<String, Object>{
    'varVIN' => '3HAMMAAR8LL123456',
    'varSucursalClave' => 'FL-QRO',
    'varTipoServicio' => 'Mantenimiento',
    'varSintoma' => 'Servicio preventivo',
    'varIdempotencyKey' => clave,
    'varCorrelationId' => corr
};

Integer antes = [SELECT COUNT() FROM WorkOrder];

Flow.Interview.Crear_Orden_Servicio f1 = new Flow.Interview.Crear_Orden_Servicio(p.clone());
f1.start();
String folio1 = (String) f1.getVariableValue('varFolio');

Flow.Interview.Crear_Orden_Servicio f2 = new Flow.Interview.Crear_Orden_Servicio(p.clone());
f2.start();
String folio2 = (String) f2.getVariableValue('varFolio');

Integer despues = [SELECT COUNT() FROM WorkOrder];

System.debug('##RES## folio1=' + folio1 + ' | folio2=' + folio2
    + ' | motivo2=' + f2.getVariableValue('varMotivoBloqueo')
    + ' | creada2=' + f2.getVariableValue('varCreada'));
System.debug('##CUENTA## WorkOrder antes=' + antes + ' despues=' + despues + ' (esperado +1)');
System.debug('##VEREDICTO## ' + (folio1 == folio2 && despues == antes + 1
    ? 'OK sin duplicado' : 'FALLA idempotencia'));

for (Log_Agente__c l : [SELECT Outcome__c, Guardrail_Triggered__c
                        FROM Log_Agente__c WHERE Correlation_Id__c = :corr ORDER BY Timestamp__c]) {
    System.debug('##LOG## ' + l.Outcome__c + ' / guard=' + l.Guardrail_Triggered__c);
}
