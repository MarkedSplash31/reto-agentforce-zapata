/**
 * Carga Regla_Cobertura__c a partir del articulo publicado
 * "Cobertura de garantia basica por componente".
 *
 * IMPORTANTE: los numeros NO son la poliza real de Zapata. Salen del articulo
 * sintetico que redacto el equipo. Se cargan aqui para que la tabla de reglas y
 * el articulo digan EXACTAMENTE lo mismo: si el agente cita el articulo, el
 * veredicto tiene que coincidir con lo que el articulo afirma.
 *
 * Cuando Zapata entregue sus polizas reales, se editan estos registros. No hay
 * que volver a desplegar nada.
 *
 * Ejecutar: sf apex run --file scripts/apex/cargar-reglas-cobertura.apex --target-org zapata
 */

delete [SELECT Id FROM Regla_Cobertura__c];

// El articulo que respalda cada regla. El agente lo cita al dar el veredicto.
List<Knowledge__kav> arts = [SELECT KnowledgeArticleId FROM Knowledge__kav
    WHERE PublishStatus = 'Online'
      AND Title = 'Cobertura de garantia basica por componente' LIMIT 1];
String articulo = arts.isEmpty() ? 'K_GARANTIA_BASICA' : arts[0].KnowledgeArticleId;

List<Product2> modelos = [SELECT Id, ProductCode FROM Product2
    WHERE ProductCode LIKE 'FL-%' AND IsActive = true];

// sistema => { meses, km, sinLimiteKm }
// Tomado literal del articulo. Lo que el articulo no dice, no se inventa.
List<List<Object>> cobertura = new List<List<Object>>{
    new List<Object>{ 'Tren motriz',             24, 250000, false },
    new List<Object>{ 'Electrico y electronica', 24, 200000, false },
    new List<Object>{ 'Cabina',                  36,      0, true  },
    new List<Object>{ 'Chasis y estructura',     36,      0, true  },
    new List<Object>{ 'Corrosion',               60,      0, true  },
    // El articulo abre con "la garantia basica cubre 24 meses o 250,000 km" y
    // luego lista las excepciones. Los sistemas que NO aparecen en esa lista
    // caen en la regla general. Sin estas tres, una falla de frenos o del
    // sistema de enfriamiento no encuentra regla y la accion no puede decidir.
    new List<Object>{ 'Frenos',                  24, 250000, false },
    new List<Object>{ 'Refrigeracion',           24, 250000, false },
    new List<Object>{ 'General',                 24, 250000, false }
};

List<Regla_Cobertura__c> reglas = new List<Regla_Cobertura__c>();
for (Product2 m : modelos) {
    for (List<Object> c : cobertura) {
        Boolean sinLimite = (Boolean) c[3];
        reglas.add(new Regla_Cobertura__c(
            Modelo__c        = m.Id,
            Sistema__c       = (String) c[0],
            Meses_Limite__c  = (Integer) c[1],
            // El campo exige un valor mayor que cero. Cuando no hay limite real
            // se marca Sin_Limite_Km__c y la accion ignora este numero.
            Km_Limite__c     = sinLimite ? 999999999 : (Integer) c[2],
            Sin_Limite_Km__c = sinLimite,
            Activa__c        = true,
            Version__c       = 'v1.0-sintetica',
            Vigencia_Odometro_Dias__c = 90,
            Clave_Unica__c   = m.ProductCode + '|' + (String) c[0] + '|BASICA',
            Knowledge_Article_Id__c   = articulo));
    }
}
insert reglas;

System.debug(LoggingLevel.ERROR, '=== REGLAS DE COBERTURA CARGADAS ===');
System.debug(LoggingLevel.ERROR, 'Modelos: ' + modelos.size());
System.debug(LoggingLevel.ERROR, 'Reglas: ' + reglas.size());
System.debug(LoggingLevel.ERROR, 'Articulo citado: ' + articulo);
System.debug(LoggingLevel.ERROR, 'Version: v1.0-sintetica  <- NO es la poliza real de Zapata');
