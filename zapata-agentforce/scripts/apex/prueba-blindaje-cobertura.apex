Savepoint sp = Database.setSavepoint();
List<String> r = new List<String>();
Product2 m = new Product2(Name='T', ProductCode='T-BLIND', IsActive=true); insert m;
Account a = new Account(Name='T'); insert a;

// CASO 1: todo fresco -> debe poder citar CUBIERTO
Asset ok = new Asset(Name='Fresco', SerialNumber='BLIND0000000000A', AccountId=a.Id,
  Product2Id=m.Id, Status='Installed', InstallDate=Date.today().addMonths(-18),
  Ultimo_Odometro_Verificado__c=300000, Fecha_Odometro_Verificado__c=Date.today().addDays(-5),
  Estado_Cobertura__c='CUBIERTO', Fecha_Ultima_Evaluacion__c=System.now().addDays(-2));
insert ok;

// CASO 2: dice CUBIERTO pero la evaluacion es de hace 60 dias
Asset viejo = new Asset(Name='Evaluacion vieja', SerialNumber='BLIND0000000000B', AccountId=a.Id,
  Product2Id=m.Id, Status='Installed', InstallDate=Date.today().addMonths(-18),
  Ultimo_Odometro_Verificado__c=300000, Fecha_Odometro_Verificado__c=Date.today().addDays(-5),
  Estado_Cobertura__c='CUBIERTO', Fecha_Ultima_Evaluacion__c=System.now().addDays(-60));
insert viejo;

// CASO 3: dice CUBIERTO pero el odometro se leyo DESPUES de evaluar
Asset despues = new Asset(Name='Odometro posterior', SerialNumber='BLIND0000000000C', AccountId=a.Id,
  Product2Id=m.Id, Status='Installed', InstallDate=Date.today().addMonths(-18),
  Ultimo_Odometro_Verificado__c=300000, Fecha_Odometro_Verificado__c=Date.today().addDays(-1),
  Estado_Cobertura__c='CUBIERTO', Fecha_Ultima_Evaluacion__c=System.now().addDays(-10));
insert despues;

// CASO 4: dice CUBIERTO pero el odometro caduco
Asset cad = new Asset(Name='Odometro caducado', SerialNumber='BLIND0000000000D', AccountId=a.Id,
  Product2Id=m.Id, Status='Installed', InstallDate=Date.today().addMonths(-18),
  Ultimo_Odometro_Verificado__c=300000, Fecha_Odometro_Verificado__c=Date.today().addDays(-200),
  Estado_Cobertura__c='CUBIERTO', Fecha_Ultima_Evaluacion__c=System.now().addDays(-1));
insert cad;

for (Asset x : [SELECT Name, Estado_Cobertura__c, Meses_Desde_Instalacion__c,
                Evaluacion_Vigente__c, Cobertura_Citable__c FROM Asset
                WHERE SerialNumber LIKE 'BLIND%' ORDER BY Name]) {
    r.add(x.Name + ' | guardado=' + x.Estado_Cobertura__c
          + ' | meses=' + x.Meses_Desde_Instalacion__c
          + ' | vigente=' + x.Evaluacion_Vigente__c
          + ' | CITABLE=' + x.Cobertura_Citable__c);
}
Database.rollback(sp);
for (String s : r) System.debug(LoggingLevel.ERROR, s);
