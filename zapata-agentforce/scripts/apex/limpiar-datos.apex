/**
 * Borra TODOS los datos de demostracion para dejar la org limpia.
 *
 * Alcance del borrado:
 *   - Todos los registros de los objetos custom del proyecto (quedan en 0).
 *   - Los registros semilla que este proyecto creo en objetos estandar,
 *     identificados por marcadores propios (AccountNumber FLT-*, ProductCode ZP*,
 *     SerialNumber 3ZPAAA*).
 *
 * NO toca los datos de ejemplo que Salesforce trae de fabrica en la org
 * (Edge Communications, GenePoint, United Oil & Gas, etc.).
 *
 * Ejecutar: sf apex run --file scripts/apex/limpiar-datos.apex --target-org zapata
 */

// Orden inverso a las dependencias para no chocar con lookups.
delete [SELECT Id FROM Log_Agente__c];
delete [SELECT Id FROM Brecha_Conocimiento__c];
delete [SELECT Id FROM Lectura_Odometro__c];
delete [SELECT Id FROM Slot_Taller__c];
delete [SELECT Id FROM Modelo_Sucursal__c];
delete [SELECT Id FROM Regla_Cobertura__c];
delete [SELECT Id FROM Sucursal__c];

// Ordenes y casos creados por el proyecto (los identifica el origen del agente).
delete [SELECT Id FROM WorkOrder WHERE Origen_Atencion__c = 'Agentforce'];

// Semilla en objetos estandar: solo lo que creo este proyecto.
delete [SELECT Id FROM Asset WHERE SerialNumber LIKE '3ZPAAA%'];
delete [SELECT Id FROM Contact WHERE Account.AccountNumber LIKE 'FLT-%'];
delete [SELECT Id FROM Account WHERE AccountNumber LIKE 'FLT-%'];
delete [SELECT Id FROM Product2 WHERE ProductCode LIKE 'ZP%'];

System.debug(LoggingLevel.ERROR, '=== ORG LIMPIA ===');
System.debug(LoggingLevel.ERROR, 'Sucursal__c: '        + [SELECT COUNT() FROM Sucursal__c]);
System.debug(LoggingLevel.ERROR, 'Modelo_Sucursal__c: ' + [SELECT COUNT() FROM Modelo_Sucursal__c]);
System.debug(LoggingLevel.ERROR, 'Slot_Taller__c: '     + [SELECT COUNT() FROM Slot_Taller__c]);
System.debug(LoggingLevel.ERROR, 'Regla_Cobertura__c: ' + [SELECT COUNT() FROM Regla_Cobertura__c]);
System.debug(LoggingLevel.ERROR, 'Lectura_Odometro__c: '+ [SELECT COUNT() FROM Lectura_Odometro__c]);
System.debug(LoggingLevel.ERROR, 'Log_Agente__c: '      + [SELECT COUNT() FROM Log_Agente__c]);
System.debug(LoggingLevel.ERROR, 'Asset: '              + [SELECT COUNT() FROM Asset]);
System.debug(LoggingLevel.ERROR, 'Product2: '           + [SELECT COUNT() FROM Product2]);
System.debug(LoggingLevel.ERROR, 'Account (quedan los de fabrica): ' + [SELECT COUNT() FROM Account]);
