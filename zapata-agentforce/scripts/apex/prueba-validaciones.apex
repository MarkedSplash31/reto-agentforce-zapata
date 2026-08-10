Savepoint sp = Database.setSavepoint();
List<String> r = new List<String>();
Sucursal__c s = new Sucursal__c(Name='T', Codigo_Sucursal__c='T1', Activa__c=true);
insert s;

Boolean b1=false;
try { insert new Slot_Taller__c(Sucursal__c=s.Id, Inicio__c=System.now().addDays(2),
    Fin__c=System.now().addDays(1), Capacidad_Total__c=2); } catch(Exception e){ b1=true; }
r.add('Slot con fin antes que inicio -> bloqueado: ' + b1);

Boolean b2=false;
try { insert new Slot_Taller__c(Sucursal__c=s.Id, Inicio__c=System.now().addDays(1),
    Fin__c=System.now().addDays(1).addHours(2), Capacidad_Total__c=2, Capacidad_Usada__c=5); }
catch(Exception e){ b2=true; }
r.add('Cupos usados > capacidad -> bloqueado: ' + b2);

Boolean b3=false;
try { insert new Sintoma__c(Name='T', Codigo__c='T1', Sistema__c='Frenos',
    Nivel_Riesgo__c='Critico', Autoservicio_Permitido__c=true,
    Senales_De_Alerta__c='x'); } catch(Exception e){ b3=true; }
r.add('Sintoma critico con autoservicio -> bloqueado: ' + b3);

Boolean b4=false;
try { insert new Lectura_Odometro__c(Kilometraje__c=100, Fecha_Lectura__c=Date.today().addDays(5),
    Fuente__c='Declarado'); } catch(Exception e){ b4=true; }
r.add('Lectura con fecha futura -> bloqueado: ' + b4);

Boolean b5=false;
try { insert new Lectura_Odometro__c(Kilometraje__c=100, Fecha_Lectura__c=Date.today(),
    Fuente__c='Declarado', Verificada__c=true); } catch(Exception e){ b5=true; }
r.add('Lectura declarada marcada verificada -> bloqueado: ' + b5);

Boolean b6=false;
try { insert new Sesion_Diagnostico__c(Resultado__c='RESUELTO_SIN_CITA'); }
catch(Exception e){ b6=true; }
r.add('Cierre sin cita sin pasos ni fuente -> bloqueado: ' + b6);

Database.rollback(sp);
for (String x : r) System.debug(LoggingLevel.ERROR, x);
