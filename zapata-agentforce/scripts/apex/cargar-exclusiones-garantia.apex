/**
 * Exclusiones y garantia extendida, tomadas literal de los articulos publicados.
 *
 * Fuentes:
 *   "Cobertura de garantia basica por componente"  -> partes de desgaste
 *   "Garantia extendida de tren motriz"            -> 60 meses / 750,000 km
 *
 * Los sinonimos importan: el operador dice "pastillas", no "balatas". Sin ellos
 * el agente no reconoce la pieza y termina diciendo que si esta cubierta.
 *
 * Ejecutar: sf apex run --file scripts/apex/cargar-exclusiones-garantia.apex --target-org zapata
 */

delete [SELECT Id FROM Exclusion_Garantia__c];

Map<String, String> arts = new Map<String, String>();
for (Knowledge__kav k : [SELECT Title, KnowledgeArticleId FROM Knowledge__kav
                         WHERE PublishStatus = 'Online']) {
    arts.put(k.Title, k.KnowledgeArticleId);
}
String artBasica  = arts.get('Cobertura de garantia basica por componente');
String artExt     = arts.get('Garantia extendida de tren motriz');

// nombre | sinonimos | sistema | motivo
List<List<String>> partes = new List<List<String>>{
    new List<String>{'Llantas', 'llanta, neumatico, neumaticos, caucho, goma',
                     'Chasis y estructura', 'Desgaste normal'},
    new List<String>{'Balatas', 'balata, pastillas, pastillas de freno, zapatas, ferodo',
                     'Frenos', 'Desgaste normal'},
    new List<String>{'Discos de freno', 'disco, discos, rotores, tambores',
                     'Frenos', 'Desgaste normal'},
    new List<String>{'Filtros', 'filtro, filtro de aire, filtro de aceite, filtro de combustible, filtro de gasolina',
                     'General', 'Consumible de mantenimiento'},
    new List<String>{'Aceites y lubricantes', 'aceite, lubricante, grasa, refrigerante, anticongelante',
                     'General', 'Consumible de mantenimiento'},
    new List<String>{'Plumas limpiaparabrisas', 'plumas, limpiaparabrisas, wipers, escobillas',
                     'Cabina', 'Desgaste normal'},
    new List<String>{'Focos y lamparas', 'foco, focos, lampara, lamparas, bombillas, luces',
                     'Electrico y electronica', 'Desgaste normal'},
    new List<String>{'Bandas', 'banda, bandas, correa, correas, poly-v',
                     'General', 'Desgaste normal'},
    new List<String>{'Disco de embrague', 'clutch, embrague, disco de clutch, croche',
                     'Tren motriz', 'Desgaste normal'}
};

List<Exclusion_Garantia__c> exc = new List<Exclusion_Garantia__c>();
for (List<String> p : partes) {
    exc.add(new Exclusion_Garantia__c(
        Name = p[0], Sinonimos__c = p[1], Sistema__c = p[2], Motivo__c = p[3],
        Activa__c = true,
        Knowledge_Article_Id__c = artBasica != null ? artBasica : 'K_GARANTIA_BASICA'));
}
insert exc;

// ---------------------------------------------- GARANTIA EXTENDIDA ---------
// Es otra regla, no un caso especial escondido en codigo.
delete [SELECT Id FROM Regla_Cobertura__c WHERE Es_Extendida__c = true];

List<Regla_Cobertura__c> ext = new List<Regla_Cobertura__c>();
for (Product2 m : [SELECT Id, ProductCode FROM Product2 WHERE ProductCode LIKE 'FL-%' AND IsActive = true]) {
    ext.add(new Regla_Cobertura__c(
        Modelo__c        = m.Id,
        Sistema__c       = 'Tren motriz',
        Meses_Limite__c  = 60,
        Km_Limite__c     = 750000,
        Sin_Limite_Km__c = false,
        Es_Extendida__c  = true,
        Deducible__c     = 3500,
        Activa__c        = true,
        Version__c       = 'v1.0-extendida',
        Vigencia_Odometro_Dias__c = 90,
        Clave_Unica__c   = m.ProductCode + '|Tren motriz|EXTENDIDA',
        Knowledge_Article_Id__c   = artExt != null ? artExt : 'K_GARANTIA_EXTENDIDA'));
}
insert ext;

System.debug(LoggingLevel.ERROR, '=== CARGADO ===');
System.debug(LoggingLevel.ERROR, 'Exclusiones: ' + exc.size());
System.debug(LoggingLevel.ERROR, 'Reglas extendidas: ' + ext.size() + ' (60 meses / 750,000 km, deducible 3,500)');
System.debug(LoggingLevel.ERROR, 'Reglas totales: ' + [SELECT COUNT() FROM Regla_Cobertura__c]);
