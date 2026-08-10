/**
 * Datos semilla del Reto Agentforce - Corporacion Zapata.
 *
 * IMPORTANTE: todos los datos son SINTETICOS. Los nombres de modelo y sucursal
 * no representan el catalogo real de Zapata. El plan (seccion 7.1) exige
 * ejemplos sinteticos y prohibe presentar promesas reales no confirmadas.
 *
 * Es idempotente: si detecta que ya hay sucursales semilla, no hace nada.
 *
 * Ejecutar:  sf apex run --file scripts/apex/seed-datos.apex --target-org zapata
 */

if ([SELECT COUNT() FROM Sucursal__c WHERE Codigo_Sucursal__c LIKE 'ZP-%'] > 0) {
    System.debug(LoggingLevel.ERROR, 'Semilla ya aplicada. No se hace nada.');
} else {

// ---------------------------------------------------------------- MODELOS --
// Product2 = modelo o linea de unidad (plan 6.1)
List<Product2> modelos = new List<Product2>{
    new Product2(Name='ZP-500 Tractocamion',  ProductCode='ZP500', IsActive=true,
                 Family='Pesado',   Description='Tractocamion de arrastre, linea pesada.'),
    new Product2(Name='ZP-350 Torton',        ProductCode='ZP350', IsActive=true,
                 Family='Pesado',   Description='Chasis torton para carga consolidada.'),
    new Product2(Name='ZP-220 Rabon',         ProductCode='ZP220', IsActive=true,
                 Family='Mediano',  Description='Rabon de distribucion regional.'),
    new Product2(Name='ZP-120 Ligero',        ProductCode='ZP120', IsActive=true,
                 Family='Ligero',   Description='Unidad ligera de reparto urbano.')
};
insert modelos;
Map<String, Id> modeloPorCodigo = new Map<String, Id>();
for (Product2 p : modelos) modeloPorCodigo.put(p.ProductCode, p.Id);

// ------------------------------------------------------------- SUCURSALES --
List<Sucursal__c> sucursales = new List<Sucursal__c>{
    new Sucursal__c(Name='Zapata Queretaro Norte', Codigo_Sucursal__c='ZP-QRO',
        Ciudad__c='Queretaro',        Activa__c=true,
        Zona_Horaria__c='America/Mexico_City', Direccion__c='Carretera 57 Km 12, Queretaro'),
    new Sucursal__c(Name='Zapata San Luis Potosi', Codigo_Sucursal__c='ZP-SLP',
        Ciudad__c='San Luis Potosi',  Activa__c=true,
        Zona_Horaria__c='America/Mexico_City', Direccion__c='Eje 140 Zona Industrial, SLP'),
    new Sucursal__c(Name='Zapata Leon',            Codigo_Sucursal__c='ZP-LEO',
        Ciudad__c='Leon',             Activa__c=true,
        Zona_Horaria__c='America/Mexico_City', Direccion__c='Blvd. Aeropuerto 900, Leon'),
    new Sucursal__c(Name='Zapata Aguascalientes',  Codigo_Sucursal__c='ZP-AGS',
        Ciudad__c='Aguascalientes',   Activa__c=true,
        Zona_Horaria__c='America/Mexico_City', Direccion__c='Av. Siglo XXI 401, Aguascalientes'),
    new Sucursal__c(Name='Zapata Celaya',          Codigo_Sucursal__c='ZP-CEL',
        Ciudad__c='Celaya',           Activa__c=false,  // inactiva a proposito: prueba negativa
        Zona_Horaria__c='America/Mexico_City', Direccion__c='Libramiento Nte. 220, Celaya')
};
insert sucursales;
Map<String, Id> sucPorCodigo = new Map<String, Id>();
for (Sucursal__c s : sucursales) sucPorCodigo.put(s.Codigo_Sucursal__c, s.Id);

// ------------------------------------------- MODELOS ATENDIDOS POR SUCURSAL --
// Cada sucursal atiende un subconjunto distinto. Esto permite la prueba negativa
// "esa sucursal no da servicio a ese modelo".
Map<String, List<String>> cobertura = new Map<String, List<String>>{
    'ZP-QRO' => new List<String>{'ZP500','ZP350','ZP220','ZP120'},  // servicio completo
    'ZP-SLP' => new List<String>{'ZP500','ZP350'},                  // solo pesado
    'ZP-LEO' => new List<String>{'ZP350','ZP220','ZP120'},          // sin tractocamion
    'ZP-AGS' => new List<String>{'ZP220','ZP120'},                  // ligero y mediano
    'ZP-CEL' => new List<String>{'ZP500'}                           // sucursal inactiva
};
Map<String, String> nivelPorSuc = new Map<String, String>{
    'ZP-QRO'=>'Servicio completo', 'ZP-SLP'=>'Servicio completo',
    'ZP-LEO'=>'Mantenimiento',     'ZP-AGS'=>'Diagnostico', 'ZP-CEL'=>'Mantenimiento'
};
List<String> sistemas = new List<String>{'Tren motriz','Cabina','Frenos','Refrigeracion','General'};

List<Modelo_Sucursal__c> junction = new List<Modelo_Sucursal__c>();
for (String cod : cobertura.keySet()) {
    for (String mc : cobertura.get(cod)) {
        for (String sis : sistemas) {
            // La sucursal de diagnostico no repara tren motriz ni frenos.
            if (nivelPorSuc.get(cod) == 'Diagnostico' &&
                (sis == 'Tren motriz' || sis == 'Frenos')) continue;
            junction.add(new Modelo_Sucursal__c(
                Sucursal__c = sucPorCodigo.get(cod),
                Modelo__c   = modeloPorCodigo.get(mc),
                Activo__c   = (cod != 'ZP-CEL'),
                Nivel_Servicio__c = nivelPorSuc.get(cod),
                Sistemas_Soportados__c = sis,
                Capacidad_Diaria__c = (mc == 'ZP500') ? 4 : 6));
        }
    }
}
insert junction;

// ------------------------------------------------------ REGLAS DE COBERTURA --
// Decision determinista por modelo y sistema (plan 6.4).
List<Regla_Cobertura__c> reglas = new List<Regla_Cobertura__c>();
Map<String, List<Integer>> limites = new Map<String, List<Integer>>{
    //                    meses,  km
    'ZP500:Tren motriz'  => new List<Integer>{60, 800000},
    'ZP500:Frenos'       => new List<Integer>{24, 200000},
    'ZP500:Cabina'       => new List<Integer>{36, 300000},
    'ZP500:Refrigeracion'=> new List<Integer>{36, 400000},
    'ZP500:General'      => new List<Integer>{24, 200000},
    'ZP350:Tren motriz'  => new List<Integer>{48, 600000},
    'ZP350:Frenos'       => new List<Integer>{24, 150000},
    'ZP350:General'      => new List<Integer>{24, 150000},
    'ZP220:Tren motriz'  => new List<Integer>{36, 300000},
    'ZP220:General'      => new List<Integer>{24, 120000},
    'ZP120:Tren motriz'  => new List<Integer>{36, 200000},
    'ZP120:General'      => new List<Integer>{24, 100000}
};
for (String k : limites.keySet()) {
    List<String> partes = k.split(':');
    List<Integer> v = limites.get(k);
    reglas.add(new Regla_Cobertura__c(
        Modelo__c      = modeloPorCodigo.get(partes[0]),
        Sistema__c     = partes[1],
        Meses_Limite__c= v[0],
        Km_Limite__c   = v[1],
        Activa__c      = true,
        Version__c     = 'v1.0',
        Vigencia_Odometro_Dias__c = 90,
        Knowledge_Article_Id__c = (partes[1] == 'Tren motriz')
            ? 'K_GARANTIA_TREN_MOTRIZ' : 'K_EXCLUSIONES_GARANTIA'));
}
insert reglas;

// -------------------------------------------------------- CUENTAS Y FLOTAS --
List<Account> cuentas = new List<Account>{
    new Account(Name='Transportes del Bajio SA de CV', AccountNumber='FLT-001',
                BillingCity='Queretaro', BillingCountry='Mexico', Phone='4420000001'),
    new Account(Name='Logistica Altiplano SA de CV',   AccountNumber='FLT-002',
                BillingCity='San Luis Potosi', BillingCountry='Mexico', Phone='4440000002'),
    new Account(Name='Fletes Guanajuato SA de CV',     AccountNumber='FLT-003',
                BillingCity='Leon', BillingCountry='Mexico', Phone='4770000003')
};
insert cuentas;

List<Contact> contactos = new List<Contact>{
    new Contact(FirstName='Ana',    LastName='Delgado', AccountId=cuentas[0].Id,
                Title='Jefa de mantenimiento', Email='ana.delgado@example.com'),
    new Contact(FirstName='Ruben',  LastName='Ochoa',   AccountId=cuentas[1].Id,
                Title='Coordinador de flota',  Email='ruben.ochoa@example.com'),
    new Contact(FirstName='Marisol',LastName='Prieto',  AccountId=cuentas[2].Id,
                Title='Gerente de operacion',  Email='marisol.prieto@example.com')
};
insert contactos;

// ------------------------------------------------------------------ ASSETS --
// SerialNumber = VIN (plan 6.1). VINs sinteticos de 17 caracteres.
List<Asset> unidades = new List<Asset>{
    // Dentro de garantia, odometro vigente -> CUBIERTO
    new Asset(Name='Unidad QRO-1001', SerialNumber='3ZPAAA500KX000101',
              AccountId=cuentas[0].Id, ContactId=contactos[0].Id,
              Product2Id=modeloPorCodigo.get('ZP500'), Status='Installed',
              InstallDate=Date.today().addMonths(-18)),
    // Excede kilometraje -> NO_CUBIERTO
    new Asset(Name='Unidad QRO-1002', SerialNumber='3ZPAAA500KX000102',
              AccountId=cuentas[0].Id, ContactId=contactos[0].Id,
              Product2Id=modeloPorCodigo.get('ZP500'), Status='Installed',
              InstallDate=Date.today().addMonths(-30)),
    // Excede meses -> NO_CUBIERTO
    new Asset(Name='Unidad SLP-2001', SerialNumber='3ZPAAA350KX000201',
              AccountId=cuentas[1].Id, ContactId=contactos[1].Id,
              Product2Id=modeloPorCodigo.get('ZP350'), Status='Installed',
              InstallDate=Date.today().addMonths(-62)),
    // Sin lectura de odometro -> REQUIERE_DATO
    new Asset(Name='Unidad LEO-3001', SerialNumber='3ZPAAA220KX000301',
              AccountId=cuentas[2].Id, ContactId=contactos[2].Id,
              Product2Id=modeloPorCodigo.get('ZP220'), Status='Installed',
              InstallDate=Date.today().addMonths(-10)),
    // Lectura caducada (mas de 90 dias) -> REQUIERE_DATO
    new Asset(Name='Unidad LEO-3002', SerialNumber='3ZPAAA120KX000302',
              AccountId=cuentas[2].Id, ContactId=contactos[2].Id,
              Product2Id=modeloPorCodigo.get('ZP120'), Status='Installed',
              InstallDate=Date.today().addMonths(-8))
};
insert unidades;

// ------------------------------------------------------ LECTURAS DE ODOMETRO --
List<Lectura_Odometro__c> lecturas = new List<Lectura_Odometro__c>{
    new Lectura_Odometro__c(Asset__c=unidades[0].Id, Kilometraje__c=310000,
        Fecha_Lectura__c=Date.today().addDays(-12), Fuente__c='Verificado',
        Verificada__c=true, Correlation_Id__c='SEED-0001'),
    new Lectura_Odometro__c(Asset__c=unidades[1].Id, Kilometraje__c=915000,
        Fecha_Lectura__c=Date.today().addDays(-5),  Fuente__c='Verificado',
        Verificada__c=true, Correlation_Id__c='SEED-0002'),
    new Lectura_Odometro__c(Asset__c=unidades[2].Id, Kilometraje__c=430000,
        Fecha_Lectura__c=Date.today().addDays(-20), Fuente__c='Verificado',
        Verificada__c=true, Correlation_Id__c='SEED-0003'),
    // unidades[3] a proposito SIN lectura -> REQUIERE_DATO
    new Lectura_Odometro__c(Asset__c=unidades[4].Id, Kilometraje__c=64000,
        Fecha_Lectura__c=Date.today().addDays(-140), Fuente__c='Declarado',
        Verificada__c=false, Correlation_Id__c='SEED-0005')
};
insert lecturas;

// El Flow record-triggered estampara esto en produccion; aqui se siembra directo
// para que la demo tenga estado inicial coherente.
unidades[0].Ultimo_Odometro_Verificado__c = 310000;
unidades[0].Fecha_Odometro_Verificado__c  = Date.today().addDays(-12);
unidades[0].Unidad_Verificada__c = false;
unidades[1].Ultimo_Odometro_Verificado__c = 915000;
unidades[1].Fecha_Odometro_Verificado__c  = Date.today().addDays(-5);
unidades[2].Ultimo_Odometro_Verificado__c = 430000;
unidades[2].Fecha_Odometro_Verificado__c  = Date.today().addDays(-20);
unidades[4].Ultimo_Odometro_Verificado__c = 64000;
unidades[4].Fecha_Odometro_Verificado__c  = Date.today().addDays(-140); // caducada
update unidades;

// ------------------------------------------------------------------ SLOTS --
// 14 dias habiles hacia adelante, 3 franjas por dia, por sucursal activa.
List<Slot_Taller__c> slots = new List<Slot_Taller__c>();
List<String> tipos = new List<String>{'Diagnostico','Mantenimiento','Garantia'};
for (Sucursal__c s : sucursales) {
    if (!s.Activa__c) continue;
    for (Integer d = 1; d <= 14; d++) {
        Date dia = Date.today().addDays(d);
        DateTime probe = DateTime.newInstance(dia, Time.newInstance(12,0,0,0));
        String dow = probe.format('EEE');
        if (dow == 'Sat' || dow == 'Sun') continue;     // taller cerrado
        Integer[] horas = new Integer[]{8, 11, 15};
        for (Integer i = 0; i < 3; i++) {
            slots.add(new Slot_Taller__c(
                Sucursal__c        = s.Id,
                Inicio__c          = DateTime.newInstance(dia, Time.newInstance(horas[i],0,0,0)),
                Fin__c             = DateTime.newInstance(dia, Time.newInstance(horas[i]+2,0,0,0)),
                Capacidad_Total__c = 3,
                Capacidad_Usada__c = Math.mod(d + i, 4) == 0 ? 3 : 0,  // algunos llenos
                Tipo_Servicio__c   = tipos[i]));
        }
    }
}
insert slots;

System.debug(LoggingLevel.ERROR, '=== SEMILLA APLICADA ===');
System.debug(LoggingLevel.ERROR, 'Modelos: '        + modelos.size());
System.debug(LoggingLevel.ERROR, 'Sucursales: '     + sucursales.size());
System.debug(LoggingLevel.ERROR, 'Modelo-Sucursal: '+ junction.size());
System.debug(LoggingLevel.ERROR, 'Reglas: '         + reglas.size());
System.debug(LoggingLevel.ERROR, 'Cuentas: '        + cuentas.size());
System.debug(LoggingLevel.ERROR, 'Unidades: '       + unidades.size());
System.debug(LoggingLevel.ERROR, 'Lecturas: '       + lecturas.size());
System.debug(LoggingLevel.ERROR, 'Slots: '          + slots.size());
}
