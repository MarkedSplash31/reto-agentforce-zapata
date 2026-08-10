// Inventario factual del modelo de datos: cuantos registros hay por objeto y que
// porcentaje de cada campo custom viene vacio. Sirve para decidir que objetos estan
// listos para la demo y a cuales les falta poblar informacion.
//
// No estima ni infiere: lee los registros reales y cuenta nulos.

List<String> objetos = new List<String>{
    'Account', 'Asset', 'Product2', 'WorkOrder', 'Case',
    'Sucursal__c', 'Slot_Taller__c', 'Modelo_Sucursal__c',
    'Regla_Cobertura__c', 'Exclusion_Garantia__c', 'Invalidacion_Garantia__c',
    'Parametros_Garantia__c', 'Sintoma__c', 'Sesion_Diagnostico__c',
    'Lectura_Odometro__c', 'Unidad_Varada__c', 'Log_Agente__c',
    'Brecha_Conocimiento__c', 'Cita_Servicio__c', 'Log_Agente_IA__c'
};

for (String obj : objetos) {
    Schema.SObjectType t = Schema.getGlobalDescribe().get(obj);
    if (t == null) { System.debug('##OBJ## ' + obj + ' | NO EXISTE'); continue; }

    Map<String, Schema.SObjectField> campos = t.getDescribe().fields.getMap();
    List<String> customs = new List<String>();
    for (String f : campos.keySet()) {
        Schema.DescribeFieldResult d = campos.get(f).getDescribe();
        // Solo campos custom no calculados: los de formula no se "llenan", se derivan.
        if (d.isCustom() && !d.isCalculated() && d.isAccessible()) customs.add(d.getName());
    }
    customs.sort();

    Integer total;
    try { total = Database.countQuery('SELECT COUNT() FROM ' + obj); }
    catch (Exception e) { System.debug('##OBJ## ' + obj + ' | ERROR ' + e.getMessage().left(60)); continue; }

    if (total == 0) {
        System.debug('##OBJ## ' + obj + ' | 0 registros | ' + customs.size() + ' campos custom | VACIO');
        continue;
    }

    String soql = 'SELECT ' + String.join(customs, ',') + ' FROM ' + obj + ' LIMIT 2000';
    List<SObject> rows;
    try { rows = Database.query(soql); }
    catch (Exception e) { System.debug('##OBJ## ' + obj + ' | ' + total + ' | ERROR ' + e.getMessage().left(70)); continue; }

    List<String> vacios = new List<String>();
    List<String> parciales = new List<String>();
    for (String f : customs) {
        Integer nulos = 0;
        for (SObject r : rows) if (r.get(f) == null) nulos++;
        if (nulos == rows.size()) vacios.add(f);
        else if (nulos > 0) parciales.add(f + '(' + nulos + '/' + rows.size() + ')');
    }

    System.debug('##OBJ## ' + obj + ' | ' + total + ' registros | ' + customs.size() + ' campos custom');
    if (!vacios.isEmpty())    System.debug('##VACIO## ' + obj + ' -> ' + String.join(vacios, ', '));
    if (!parciales.isEmpty()) System.debug('##PARCIAL## ' + obj + ' -> ' + String.join(parciales, ', '));
}
