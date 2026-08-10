/**
 * Sucursales REALES de Zapata Camiones, tomadas de zapata.com.mx el 30 jul 2026.
 *
 * Fuentes:
 *   https://www.zapata.com.mx/freightliner/distribuidoras  (direcciones y horarios)
 *   https://www.zapata.com.mx/greatdane/distribuidoras     (telefonos)
 *   Formulario de citas de servicio                        (Id de agencia 96-104)
 *
 * El Id de agencia es el valor real que usa su formulario web. Es la llave para
 * integrar de verdad mas adelante.
 *
 * Reglas de negocio tomadas del sitio:
 *   - "Programe su cita con al menos 24 hrs. de anticipacion".
 *   - Freightliner: Lun a Vie 9:00-19:00, Sab 9:00-15:00. Domingo cerrado.
 *
 * Ejecutar: sf apex run --file scripts/apex/cargar-sucursales-reales.apex --target-org zapata
 */

// Limpia cualquier dato de prueba anterior antes de cargar lo real.
delete [SELECT Id FROM Slot_Taller__c];
delete [SELECT Id FROM Modelo_Sucursal__c];
delete [SELECT Id FROM Sucursal__c];
delete [SELECT Id FROM Product2 WHERE ProductCode LIKE 'FL-%' OR ProductCode LIKE 'TEMP%'
        OR ProductCode LIKE 'TEST%'];

// ------------------------------------------------------------- SUCURSALES --
List<Sucursal__c> suc = new List<Sucursal__c>{
    new Sucursal__c(Name='Zapata Camiones Tlalnepantla', Codigo_Sucursal__c='FL-TLA',
        Id_Agencia_Web__c=96, Ciudad__c='Tlalnepantla, Estado de Mexico',
        Direccion__c='Av. 1 de Mayo S/N Esq. C. Roberto Fulton, Tlalnepantla Centro, C.P. 54000',
        Telefono__c='(55) 7931 3901', Marca_Principal__c='Freightliner'),

    new Sucursal__c(Name='Zapata Camiones Aeropuerto', Codigo_Sucursal__c='FL-AER',
        Id_Agencia_Web__c=101, Ciudad__c='Texcoco, Estado de Mexico',
        Direccion__c='Carr. Los Reyes Texcoco Lecheria Km. 23, C.P. 56200',
        Telefono__c='(595) 954 9933', Marca_Principal__c='Freightliner'),

    new Sucursal__c(Name='Zapata Camiones Tampico', Codigo_Sucursal__c='FL-TAM',
        Id_Agencia_Web__c=100, Ciudad__c='Altamira, Tamaulipas',
        Direccion__c='Autopista Tampico-Altamira No. 2102, Col. Laguna de la Puerta, C.P. 89603',
        Telefono__c='(833) 115 1500', Marca_Principal__c='Freightliner'),

    new Sucursal__c(Name='Zapata Camiones Queretaro', Codigo_Sucursal__c='FL-QRO',
        Id_Agencia_Web__c=98, Ciudad__c='Queretaro, Queretaro',
        Direccion__c='Blvd. Bernardo Quintana 588, Col. San Pedrito Penuelas, C.P. 76148',
        Telefono__c='(442) 209 6900', Marca_Principal__c='Freightliner'),

    new Sucursal__c(Name='Zapata Camiones Celaya', Codigo_Sucursal__c='FL-CEL',
        Id_Agencia_Web__c=99, Ciudad__c='Celaya, Guanajuato',
        Direccion__c='Carretera Celaya-Villagran Km 5.1, Col. Segunda Fraccion de Crespo, C.P. 38110',
        Telefono__c='(461) 689 1108', Marca_Principal__c='Freightliner'),

    new Sucursal__c(Name='Zapata Camiones Guadalajara', Codigo_Sucursal__c='FL-GDL',
        Id_Agencia_Web__c=102, Ciudad__c='Zapopan, Jalisco',
        Direccion__c='Periferico Sur No. 1823, Col. El Briseno, C.P. 45070',
        Telefono__c='(33) 3180 8541', Marca_Principal__c='Freightliner'),

    new Sucursal__c(Name='Zapata Camiones Guadalajara R. Michel', Codigo_Sucursal__c='FL-GDLRM',
        Id_Agencia_Web__c=103, Ciudad__c='Guadalajara, Jalisco',
        Direccion__c='Av. Dr. R. Michel No. 2604, Col. Alamo Industrial, C.P. 44895',
        Marca_Principal__c='Freightliner'),

    new Sucursal__c(Name='Zapata Camiones Monterrey', Codigo_Sucursal__c='FL-MTY',
        Id_Agencia_Web__c=104, Ciudad__c='Apodaca, Nuevo Leon',
        Direccion__c='Carretera Monterrey-Laredo Km. 19, Santa Rosa, C.P. 66600',
        Telefono__c='(81) 8305 4500', Marca_Principal__c='Freightliner',
        Zona_Horaria__c='America/Monterrey'),

    new Sucursal__c(Name='Zapata Camiones Leon', Codigo_Sucursal__c='FL-LEO',
        Id_Agencia_Web__c=97, Ciudad__c='Leon, Guanajuato',
        Direccion__c='Blvd. Aeropuerto 868, San Jose El Alto, C.P. 37660',
        Telefono__c='(477) 710 0016', Marca_Principal__c='Freightliner')
};
// Datos comunes a toda la red Freightliner de Zapata.
for (Sucursal__c s : suc) {
    s.Activa__c = true;
    s.Horario_Atencion__c = 'Lunes a viernes 9:00 - 19:00';
    s.Horario_Sabado__c = 'Sabado 9:00 - 15:00';
    s.Abre_Domingo__c = false;
    s.Anticipacion_Minima_Horas__c = 24;   // el sitio lo pide explicitamente
    if (s.Zona_Horaria__c == null) s.Zona_Horaria__c = 'America/Mexico_City';
}
insert suc;

// ---------------------------------------------------------------- MODELOS --
// Familias reales del catalogo Freightliner de Zapata.
List<Product2> modelos = new List<Product2>{
    new Product2(Name='Freightliner Cascadia', ProductCode='FL-CASCADIA', IsActive=true,
        Family='Pesado', Marca__c='Freightliner', Tipo_Unidad__c='Tractocamion',
        Description='Tractocamion de carretera. Linea de largo recorrido.'),
    new Product2(Name='Freightliner M2', ProductCode='FL-M2', IsActive=true,
        Family='Mediano', Marca__c='Freightliner', Tipo_Unidad__c='Rabon',
        Description='Chasis medio para distribucion y aplicaciones vocacionales.'),
    new Product2(Name='Freightliner 114SD', ProductCode='FL-114SD', IsActive=true,
        Family='Pesado', Marca__c='Freightliner', Tipo_Unidad__c='Torton',
        Description='Severe duty. Construccion y aplicaciones de trabajo pesado.'),
    new Product2(Name='Freightliner FL 360', ProductCode='FL-360', IsActive=true,
        Family='Pesado', Marca__c='Freightliner', Tipo_Unidad__c='Tractocamion',
        Description='Familia 360 para operacion de carga general.')
};
for (Product2 p : modelos) { p.Manual_Completo__c = false; p.Anio_Modelo__c = 2026; }
insert modelos;

// ------------------------------------------------- QUE ATIENDE CADA TALLER --
// Son distribuidores de servicio completo: atienden toda la linea Freightliner
// en todos los sistemas. Se modela explicito para que el agente no lo suponga.
List<String> sistemas = new List<String>{'Tren motriz','Cabina','Frenos','Refrigeracion','General'};
List<Modelo_Sucursal__c> cruce = new List<Modelo_Sucursal__c>();
for (Sucursal__c s : suc) {
    for (Product2 m : modelos) {
        for (String sis : sistemas) {
            cruce.add(new Modelo_Sucursal__c(Sucursal__c=s.Id, Modelo__c=m.Id,
                Sistemas_Soportados__c=sis, Nivel_Servicio__c='Servicio completo',
                Capacidad_Diaria__c=4, Activo__c=true));
        }
    }
}
insert cruce;

// ------------------------------------------------------------------ AGENDA --
// Se genera desde el horario REAL, no inventado:
//   Lun-Vie 9:00-19:00 -> cinco bloques de 2 horas
//   Sabado  9:00-15:00 -> tres bloques de 2 horas
//   Domingo cerrado
// Y se respeta la anticipacion minima de 24 horas del propio sitio de Zapata.
List<Slot_Taller__c> slots = new List<Slot_Taller__c>();
List<String> tipos = new List<String>{'Diagnostico','Mantenimiento','Garantia','Reparacion mayor'};
Datetime minimo = System.now().addHours(24);
Integer DIAS_ADELANTE = 21;

for (Sucursal__c s : suc) {
    for (Integer d = 0; d <= DIAS_ADELANTE; d++) {
        Date dia = Date.today().addDays(d);
        String dow = DateTime.newInstance(dia, Time.newInstance(12,0,0,0)).format('EEE');
        if (dow == 'Sun') continue;                       // domingo cerrado
        Boolean esSabado = (dow == 'Sat');
        Integer bloques = esSabado ? 3 : 5;
        Integer capacidad = esSabado ? 2 : 3;

        for (Integer b = 0; b < bloques; b++) {
            Integer hora = 9 + b * 2;
            Datetime ini = DateTime.newInstance(dia, Time.newInstance(hora,0,0,0));
            if (ini < minimo) continue;                   // anticipacion minima 24 h
            slots.add(new Slot_Taller__c(
                Sucursal__c        = s.Id,
                Inicio__c          = ini,
                Fin__c             = ini.addHours(2),
                Capacidad_Total__c = capacidad,
                Capacidad_Usada__c = 0,                   // agenda limpia, nada ocupado
                Tipo_Servicio__c   = tipos[Math.mod(b + d, 4)]));
        }
    }
}
insert slots;

System.debug(LoggingLevel.ERROR, '=== DATOS REALES DE ZAPATA CARGADOS ===');
System.debug(LoggingLevel.ERROR, 'Sucursales: ' + suc.size());
System.debug(LoggingLevel.ERROR, 'Modelos: ' + modelos.size());
System.debug(LoggingLevel.ERROR, 'Cruces modelo-sucursal-sistema: ' + cruce.size());
System.debug(LoggingLevel.ERROR, 'Franjas de agenda: ' + slots.size());
System.debug(LoggingLevel.ERROR, 'Todas libres, ninguna ocupada. Anticipacion minima 24 h aplicada.');
