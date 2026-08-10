// Un registro real de cada objeto del modelo, con sus campos poblados.
// Sirve para ver "como se ve" cada objeto sin inventar datos de ejemplo.

Map<String, String> consultas = new Map<String, String>{
  'Sucursal__c'            => 'SELECT Name, Codigo_Sucursal__c, Ciudad__c, Activa__c, Anticipacion_Minima_Horas__c, Marca_Principal__c, Horario_Atencion__c, Zona_Horaria__c FROM Sucursal__c WHERE Codigo_Sucursal__c = \'FL-QRO\'',
  'Slot_Taller__c'         => 'SELECT Name, Sucursal__r.Codigo_Sucursal__c, Inicio__c, Fin__c, Tipo_Servicio__c, Capacidad_Total__c, Capacidad_Usada__c, Cupos_Libres__c, Disponible__c FROM Slot_Taller__c WHERE Capacidad_Usada__c > 0 LIMIT 1',
  'Asset'                  => 'SELECT Name, SerialNumber, Account.Name, Product2.ProductCode, Status, Unidad_Verificada__c, Odometro__c, Tipo_Unidad__c, Garantia_Vigente__c, Estado_Garantia_Basica__c, InstallDate FROM Asset WHERE SerialNumber = \'3HAMMAAR8LL123456\'',
  'Product2'               => 'SELECT Name, ProductCode, Marca__c, Tipo_Unidad__c, Anio_Modelo__c FROM Product2 WHERE Anio_Modelo__c != null LIMIT 1',
  'Modelo_Sucursal__c'     => 'SELECT Name, Sucursal__r.Codigo_Sucursal__c, Modelo__r.ProductCode, Sistemas_Soportados__c, Activo__c FROM Modelo_Sucursal__c LIMIT 1',
  'Regla_Cobertura__c'     => 'SELECT Name, Sistema__c, Meses_Limite__c, Km_Limite__c, Activa__c, Version__c, KnowledgeArticleId__c FROM Regla_Cobertura__c LIMIT 1',
  'Exclusion_Garantia__c'  => 'SELECT Name, Descripcion__c, Aplica_A__c FROM Exclusion_Garantia__c LIMIT 1',
  'Parametros_Garantia__c' => 'SELECT Name FROM Parametros_Garantia__c LIMIT 1',
  'Sintoma__c'             => 'SELECT Name, Sistema__c, Severidad__c FROM Sintoma__c LIMIT 1',
  'Lectura_Odometro__c'    => 'SELECT Name, Asset__r.SerialNumber, Kilometraje__c, Fecha_Lectura__c, Fuente__c, Verificada__c FROM Lectura_Odometro__c LIMIT 1',
  'WorkOrder'              => 'SELECT WorkOrderNumber, Status, StartDate, EndDate, Subject, Sintoma_Reportado__c, Asset.SerialNumber, Account.Name, Sucursal__r.Codigo_Sucursal__c, Slot_Taller__r.Name, Tipo_Cita__c, Origen_Atencion__c, Idempotency_Key__c, Correlation_Id__c FROM WorkOrder WHERE Correlation_Id__c != null LIMIT 1',
  'Unidad_Varada__c'       => 'SELECT Name, Estado__c, Prioridad__c, Fecha_Reporte__c, Carretera__c, Kilometro__c, Sentido__c, Referencia_Ubicacion__c, Descripcion_Falla__c, Codigos_Falla_Tablero__c, Carga__c, VIN_Reportado__c, Asset__r.Name, Sucursal_Apoyo__r.Codigo_Sucursal__c, Fuera_De_Carril__c, Intermitentes_Encendidas__c, Correlation_Id__c FROM Unidad_Varada__c WHERE Asset__c != null ORDER BY CreatedDate DESC LIMIT 1',
  'Case'                   => 'SELECT CaseNumber, Status, Priority, Origin, Subject, Description, Politica_Aplicada__c, Asset__r.Name, WorkOrder__r.WorkOrderNumber, Correlation_Id__c FROM Case WHERE Correlation_Id__c != null ORDER BY CreatedDate DESC LIMIT 1',
  'Log_Agente__c'          => 'SELECT Name, Action_Name__c, Subagent__c, Outcome__c, Guardrail_Triggered__c, Error_Code__c, Related_Record_Id__c, WorkOrder__c, Unidad_Varada__c, Unit_Verified__c, Actor__c, Correlation_Id__c, Timestamp__c FROM Log_Agente__c WHERE Guardrail_Triggered__c != null ORDER BY CreatedDate DESC LIMIT 1'
};

for (String obj : new List<String>(consultas.keySet())) {
    List<SObject> rows;
    try { rows = Database.query(consultas.get(obj)); }
    catch (Exception e) { System.debug('##EJ## ' + obj + ' :: ERROR ' + e.getMessage().left(90)); continue; }
    if (rows.isEmpty()) { System.debug('##EJ## ' + obj + ' :: SIN REGISTROS'); continue; }

    Map<String, Object> m = rows[0].getPopulatedFieldsAsMap();
    List<String> partes = new List<String>();
    for (String k : m.keySet()) {
        if (k == 'Id' || k == 'attributes') continue;
        Object v = m.get(k);
        if (v instanceof SObject) {
            Map<String, Object> sub = ((SObject) v).getPopulatedFieldsAsMap();
            for (String sk : sub.keySet()) if (sk != 'Id') partes.add(k + '.' + sk + '=' + sub.get(sk));
        } else {
            partes.add(k + '=' + v);
        }
    }
    System.debug('##EJ## ' + obj + ' :: ' + String.join(partes, ' | '));
}
