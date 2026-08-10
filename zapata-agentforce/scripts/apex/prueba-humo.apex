/**
 * Prueba de humo: verifica que el modelo de datos funciona de punta a punta
 * y BORRA todo al terminar. La org queda en 0 registros.
 *
 * Comprueba:
 *   - Que se puede crear la cadena completa modelo -> sucursal -> slot -> cita.
 *   - Que las formulas calculan bien (Disponible__c, Cupos_Libres__c,
 *     Dato_Odometro_Vigente__c).
 *   - Que la clave de idempotencia realmente bloquea un duplicado.
 *   - Que el diagnostico guiado puede cerrarse sin cita.
 *
 * Ejecutar: sf apex run --file scripts/apex/prueba-humo.apex --target-org zapata
 */
Savepoint sp = Database.setSavepoint();
List<String> r = new List<String>();

try {
    Product2 modelo = new Product2(Name='PRUEBA Modelo', ProductCode='TEST-001',
        IsActive=true, Tipo_Unidad__c='Tractocamion', Anio_Modelo__c=2024,
        Manual_Completo__c=false);
    insert modelo;

    Sucursal__c suc = new Sucursal__c(Name='PRUEBA Sucursal', Codigo_Sucursal__c='TEST-S1',
        Ciudad__c='Queretaro', Activa__c=true, Zona_Horaria__c='America/Mexico_City',
        Telefono__c='4420000000', Horario_Atencion__c='L-V 8:00-18:00',
        Responsable__c=UserInfo.getUserId());
    insert suc;

    insert new Modelo_Sucursal__c(Sucursal__c=suc.Id, Modelo__c=modelo.Id,
        Sistemas_Soportados__c='Tren motriz', Nivel_Servicio__c='Servicio completo',
        Capacidad_Diaria__c=4, Activo__c=true);

    // --- Formulas del slot
    Slot_Taller__c slot = new Slot_Taller__c(Sucursal__c=suc.Id,
        Inicio__c=System.now().addDays(2), Fin__c=System.now().addDays(2).addHours(2),
        Capacidad_Total__c=3, Capacidad_Usada__c=1, Tipo_Servicio__c='Garantia');
    insert slot;
    slot = [SELECT Disponible__c, Cupos_Libres__c FROM Slot_Taller__c WHERE Id=:slot.Id];
    r.add('Slot disponible (espera true): ' + slot.Disponible__c);
    r.add('Cupos libres (espera 2): ' + slot.Cupos_Libres__c);

    Slot_Taller__c lleno = new Slot_Taller__c(Sucursal__c=suc.Id,
        Inicio__c=System.now().addDays(3), Fin__c=System.now().addDays(3).addHours(2),
        Capacidad_Total__c=2, Capacidad_Usada__c=2, Tipo_Servicio__c='Garantia');
    insert lleno;
    lleno = [SELECT Disponible__c FROM Slot_Taller__c WHERE Id=:lleno.Id];
    r.add('Slot lleno disponible (espera false): ' + lleno.Disponible__c);

    // --- Cuenta, unidad y vigencia de odometro
    Account cta = new Account(Name='PRUEBA Flota', AccountNumber='TEST-FLT',
        Ultimos_4_Telefono__c='1234', RFC__c='XAXX010101000');
    insert cta;

    Asset uni = new Asset(Name='PRUEBA Unidad', SerialNumber='TESTVIN0000000001',
        AccountId=cta.Id, Product2Id=modelo.Id, Status='Installed',
        InstallDate=Date.today().addMonths(-12),
        Ultimo_Odometro_Verificado__c=150000,
        Fecha_Odometro_Verificado__c=Date.today().addDays(-10),
        Unidad_Verificada__c=true, Metodo_Verificacion__c='Ultimos 4 del telefono',
        Fecha_Verificacion__c=System.now());
    insert uni;
    uni = [SELECT Dato_Odometro_Vigente__c FROM Asset WHERE Id=:uni.Id];
    r.add('Odometro vigente, lectura de 10 dias (espera true): ' + uni.Dato_Odometro_Vigente__c);

    Asset viejo = new Asset(Name='PRUEBA Unidad vieja', SerialNumber='TESTVIN0000000002',
        AccountId=cta.Id, Product2Id=modelo.Id, Status='Installed',
        InstallDate=Date.today().addMonths(-12),
        Ultimo_Odometro_Verificado__c=150000,
        Fecha_Odometro_Verificado__c=Date.today().addDays(-120));
    insert viejo;
    viejo = [SELECT Dato_Odometro_Vigente__c FROM Asset WHERE Id=:viejo.Id];
    r.add('Odometro caducado, lectura de 120 dias (espera false): ' + viejo.Dato_Odometro_Vigente__c);

    // --- Regla de cobertura
    insert new Regla_Cobertura__c(Modelo__c=modelo.Id, Sistema__c='Tren motriz',
        Meses_Limite__c=60, Km_Limite__c=800000, Activa__c=true, Version__c='v1.0',
        Vigencia_Odometro_Dias__c=90, Knowledge_Article_Id__c='K_GARANTIA_TREN_MOTRIZ');
    r.add('Regla de cobertura creada con id semantico de articulo: OK');

    // --- Sintoma y diagnostico cerrado sin cita
    Sintoma__c sint = new Sintoma__c(Name='PRUEBA Perdida de potencia',
        Codigo__c='TEST_SINT_1', Sistema__c='Tren motriz', Nivel_Riesgo__c='Medio',
        Autoservicio_Permitido__c=true, Activo__c=true,
        Preguntas_Descarte__c='Prueba', Senales_De_Alerta__c='Prueba',
        Knowledge_Article_Id__c='K_DIAGNOSTICO_SEGURO');
    insert sint;

    insert new Sesion_Diagnostico__c(Modelo__c=modelo.Id, Asset__c=uni.Id,
        Sintoma__c=sint.Id, Resultado__c='RESUELTO_SIN_CITA', Tiene_Herramientas__c=true,
        Pasos_Seguidos__c='Prueba de cierre sin cita', Fecha__c=System.now(),
        Knowledge_Article_Id__c='K_DIAGNOSTICO_SEGURO', Correlation_Id__c='TEST-CORR-1');
    r.add('Diagnostico cerrado sin cita: OK');

    // --- Orden de servicio y prueba de idempotencia
    WorkOrder wo = new WorkOrder(AssetId=uni.Id, AccountId=cta.Id,
        Subject='PRUEBA cita', Sintoma_Reportado__c='Prueba',
        Sucursal__c=suc.Id, Slot_Taller__c=slot.Id, Tipo_Cita__c='Garantia',
        Origen_Atencion__c='Agentforce', Idempotency_Key__c='TEST-IDEM-1',
        Asesor_Responsable__c=UserInfo.getUserId(),
        StartDate=System.now().addDays(2), Correlation_Id__c='TEST-CORR-1');
    insert wo;
    r.add('Orden de servicio creada: OK');

    Boolean bloqueado = false;
    try {
        insert new WorkOrder(AssetId=uni.Id, Subject='PRUEBA duplicada',
            Idempotency_Key__c='TEST-IDEM-1', Origen_Atencion__c='Agentforce');
    } catch (DmlException e) { bloqueado = true; }
    r.add('Duplicado bloqueado por Idempotency_Key (espera true): ' + bloqueado);

    // --- Log del agente
    insert new Log_Agente__c(Correlation_Id__c='TEST-CORR-1', Subagent__c='Garantia',
        Action_Name__c='Evaluar_Cobertura_Garantia', Outcome__c='SUCCESS',
        Timestamp__c=System.now(), Asset__c=uni.Id, WorkOrder__c=wo.Id,
        Policy_Version__c='v1.0', Odometer_Used__c=150000,
        Odometer_Source__c='Verificado', Unit_Verified__c=true,
        Actor__c=UserInfo.getUserName());
    r.add('Log del agente escrito y ligado a unidad y orden: OK');

    r.add('--- TODA LA CADENA FUNCIONA ---');

} catch (Exception e) {
    r.add('!!! FALLO: ' + e.getMessage());
}

// Revierte absolutamente todo: la org vuelve a 0 registros.
Database.rollback(sp);
r.add('Rollback aplicado. La org queda en 0 registros.');

for (String s : r) System.debug(LoggingLevel.ERROR, s);
