// Tres variantes del reporte de unidad varada:
//   A) datos completos y seguridad confirmada
//   B) sin VIN y sin kilometro: debe crearse igual
//   C) seguridad NO confirmada: debe crearse, devolver aviso y dejar guardrail en el log
Integer antes = [SELECT COUNT() FROM Unidad_Varada__c];

// --- A
String cA = 'DRYRUN-04A-' + Datetime.now().getTime();
Flow.Interview.Crear_Reporte_Unidad_Varada fA = new Flow.Interview.Crear_Reporte_Unidad_Varada(
    new Map<String, Object>{
        'varFueraDeCarril' => true, 'varIntermitentes' => true,
        'varCarretera' => 'Mexico-Queretaro 57D', 'varKilometro' => 120,
        'varSentido' => 'Norte', 'varReferencia' => 'Despues de la caseta de Palmillas',
        'varVIN' => '3HAMMAAR8LL123456',
        'varDescripcionFalla' => 'Perdida de presion de aire y la unidad no libera frenos',
        'varCodigosTablero' => 'SPN 520192 FMI 3, luz roja de frenos',
        'varCarga' => 'Cargada', 'varSucursalClave' => 'FL-QRO',
        'varCorrelationId' => cA, 'varSessionKey' => 'SES-04A'});
fA.start();
System.debug('##RES## A reportada=' + fA.getVariableValue('varReportada')
    + ' folio=' + fA.getVariableValue('varFolio')
    + ' unidadIdent=' + fA.getVariableValue('varUnidadIdentificada')
    + ' aviso=' + fA.getVariableValue('varAvisoSeguridad')
    + ' motivo=' + fA.getVariableValue('varMotivoBloqueo'));

// --- B
String cB = 'DRYRUN-04B-' + Datetime.now().getTime();
Flow.Interview.Crear_Reporte_Unidad_Varada fB = new Flow.Interview.Crear_Reporte_Unidad_Varada(
    new Map<String, Object>{
        'varFueraDeCarril' => true, 'varIntermitentes' => true,
        'varCarretera' => 'Autopista del Sol 95D',
        'varDescripcionFalla' => 'Se apago y no arranca',
        'varCorrelationId' => cB});
fB.start();
System.debug('##RES## B reportada=' + fB.getVariableValue('varReportada')
    + ' folio=' + fB.getVariableValue('varFolio')
    + ' unidadIdent=' + fB.getVariableValue('varUnidadIdentificada')
    + ' motivo=' + fB.getVariableValue('varMotivoBloqueo'));

// --- C
String cC = 'DRYRUN-04C-' + Datetime.now().getTime();
Flow.Interview.Crear_Reporte_Unidad_Varada fC = new Flow.Interview.Crear_Reporte_Unidad_Varada(
    new Map<String, Object>{
        'varFueraDeCarril' => false, 'varIntermitentes' => false,
        'varCarretera' => 'Mexico-Puebla 150D', 'varKilometro' => 45,
        'varDescripcionFalla' => 'Reventon de llanta trasera',
        'varCorrelationId' => cC});
fC.start();
System.debug('##RES## C reportada=' + fC.getVariableValue('varReportada')
    + ' folio=' + fC.getVariableValue('varFolio')
    + ' aviso=' + fC.getVariableValue('varAvisoSeguridad'));

// --- D: sin carretera, debe bloquear sin escribir
String cD = 'DRYRUN-04D-' + Datetime.now().getTime();
Flow.Interview.Crear_Reporte_Unidad_Varada fD = new Flow.Interview.Crear_Reporte_Unidad_Varada(
    new Map<String, Object>{
        'varFueraDeCarril' => true, 'varIntermitentes' => true,
        'varDescripcionFalla' => 'Algo suena raro', 'varCorrelationId' => cD});
fD.start();
System.debug('##RES## D reportada=' + fD.getVariableValue('varReportada')
    + ' motivo=' + fD.getVariableValue('varMotivoBloqueo'));

Integer despues = [SELECT COUNT() FROM Unidad_Varada__c];
System.debug('##CUENTA## Unidad_Varada antes=' + antes + ' despues=' + despues + ' (esperado +3)');

for (Unidad_Varada__c u : [SELECT Name, Estado__c, Prioridad__c, Carretera__c, Kilometro__c,
                                  Asset__c, VIN_Reportado__c, Sucursal_Apoyo__c,
                                  Fuera_De_Carril__c, Intermitentes_Encendidas__c, Fecha_Reporte__c
                           FROM Unidad_Varada__c WHERE Correlation_Id__c LIKE 'DRYRUN-04%'
                           ORDER BY Name]) {
    System.debug('##VAR## ' + u.Name + ' / ' + u.Estado__c + ' / ' + u.Prioridad__c
        + ' / ' + u.Carretera__c + ' km' + u.Kilometro__c + ' / asset=' + u.Asset__c
        + ' / suc=' + u.Sucursal_Apoyo__c + ' / seguro=' + u.Fuera_De_Carril__c + u.Intermitentes_Encendidas__c);
}

for (Log_Agente__c l : [SELECT Correlation_Id__c, Action_Name__c, Outcome__c, Subagent__c,
                               Guardrail_Triggered__c, Error_Code__c, Unidad_Varada__c, Asset__c
                        FROM Log_Agente__c WHERE Correlation_Id__c LIKE 'DRYRUN-04%'
                        ORDER BY Timestamp__c]) {
    System.debug('##LOG## ' + l.Correlation_Id__c.right(4) + ' / ' + l.Outcome__c
        + ' / sub=' + l.Subagent__c + ' / guard=' + l.Guardrail_Triggered__c
        + ' / err=' + l.Error_Code__c + ' / varada=' + l.Unidad_Varada__c);
}
