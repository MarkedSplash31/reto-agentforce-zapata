/**
 * Disponibilidad de taller. Un solo lugar donde se decide que franja esta
 * realmente libre.
 *
 * Lo consumen dos cosas distintas:
 *   1. El componente Lightning del calendario visual (metodos @AuraEnabled).
 *   2. La accion Consultar_Disponibilidad del agente (metodo @InvocableMethod).
 *
 * Estan juntos a proposito. Si el Flow reimplementara la regla de "que es una
 * franja disponible", tarde o temprano el calendario y el agente dirian cosas
 * distintas sobre el mismo horario.
 *
 * Consulta en modo usuario: si falta FLS sobre un campo, la query falla en vez
 * de devolver datos que el usuario no deberia ver.
 */
public with sharing class ZapataAgendaController {

    // ==================================================================== //
    //  Vista para el calendario visual                                      //
    // ==================================================================== //

    /** Una franja lista para pintar en el calendario. */
    public class SlotView {
        @AuraEnabled public Id slotId;
        @AuraEnabled public String nombre;
        @AuraEnabled public String sucursal;
        @AuraEnabled public Id sucursalId;
        @AuraEnabled public Datetime inicio;
        @AuraEnabled public Datetime fin;
        @AuraEnabled public String tipoServicio;
        @AuraEnabled public Decimal capacidadTotal;
        @AuraEnabled public Decimal capacidadUsada;
        @AuraEnabled public Decimal cuposLibres;
        @AuraEnabled public Boolean disponible;
        @AuraEnabled public Integer ordenes;
    }

    /** Franjas dentro de un rango. Si sucursalId viene vacio, devuelve todas. */
    @AuraEnabled(cacheable=true)
    public static List<SlotView> getSlots(Datetime desde, Datetime hasta, String sucursalId) {
        List<Slot_Taller__c> slots;
        if (String.isBlank(sucursalId)) {
            slots = [
                SELECT Id, Name, Sucursal__c, Sucursal__r.Name, Inicio__c, Fin__c,
                       Tipo_Servicio__c, Capacidad_Total__c, Capacidad_Usada__c,
                       Cupos_Libres__c, Disponible__c,
                       (SELECT Id FROM Ordenes_Servicio__r)
                FROM Slot_Taller__c
                WHERE Inicio__c >= :desde AND Inicio__c < :hasta
                WITH USER_MODE
                ORDER BY Inicio__c ASC
                LIMIT 500
            ];
        } else {
            Id sucId = (Id) sucursalId;
            slots = [
                SELECT Id, Name, Sucursal__c, Sucursal__r.Name, Inicio__c, Fin__c,
                       Tipo_Servicio__c, Capacidad_Total__c, Capacidad_Usada__c,
                       Cupos_Libres__c, Disponible__c,
                       (SELECT Id FROM Ordenes_Servicio__r)
                FROM Slot_Taller__c
                WHERE Inicio__c >= :desde AND Inicio__c < :hasta
                  AND Sucursal__c = :sucId
                WITH USER_MODE
                ORDER BY Inicio__c ASC
                LIMIT 500
            ];
        }

        List<SlotView> salida = new List<SlotView>();
        for (Slot_Taller__c s : slots) {
            SlotView v = new SlotView();
            v.slotId = s.Id;
            v.nombre = s.Name;
            v.sucursal = s.Sucursal__r != null ? s.Sucursal__r.Name : '';
            v.sucursalId = s.Sucursal__c;
            v.inicio = s.Inicio__c;
            v.fin = s.Fin__c;
            v.tipoServicio = s.Tipo_Servicio__c;
            v.capacidadTotal = s.Capacidad_Total__c;
            v.capacidadUsada = s.Capacidad_Usada__c;
            v.cuposLibres = s.Cupos_Libres__c;
            v.disponible = s.Disponible__c;
            v.ordenes = s.Ordenes_Servicio__r != null ? s.Ordenes_Servicio__r.size() : 0;
            salida.add(v);
        }
        return salida;
    }

    /** Talleres activos, para el filtro del calendario. */
    @AuraEnabled(cacheable=true)
    public static List<Sucursal__c> getSucursales() {
        return [
            SELECT Id, Name, Ciudad__c
            FROM Sucursal__c
            WHERE Activa__c = true
            WITH USER_MODE
            ORDER BY Name ASC
            LIMIT 200
        ];
    }

    // ==================================================================== //
    //  Accion del agente: Consultar_Disponibilidad (plan seccion 8.2)       //
    // ==================================================================== //

    public class Peticion {
        @InvocableVariable(label='Sucursal' description='Nombre o codigo del taller, por ejemplo FL-QRO o Queretaro' required=true)
        public String sucursal;

        @InvocableVariable(label='Codigo del modelo' description='ProductCode del modelo, por ejemplo FL-CASCADIA. Si se envia, se valida que el taller atienda ese modelo')
        public String modeloCodigo;

        @InvocableVariable(label='Sistema reportado' description='Tren motriz, Cabina, Frenos, Refrigeracion o General')
        public String sistema;

        @InvocableVariable(label='Tipo de servicio' description='Diagnostico, Mantenimiento, Garantia o Reparacion mayor')
        public String tipoServicio;

        @InvocableVariable(label='Dias hacia adelante' description='Cuantos dias buscar. Por omision 14')
        public Integer diasAdelante;
    }

    public class Respuesta {
        @InvocableVariable(label='Hay disponibilidad')
        public Boolean hayDisponibilidad;

        @InvocableVariable(label='Mensaje para el usuario' description='Texto listo para mostrar. No contiene identificadores internos')
        public String mensaje;

        @InvocableVariable(label='Motivo del bloqueo' description='Codigo estable para el log: SUCURSAL_NO_ENCONTRADA, SUCURSAL_INACTIVA, MODELO_NO_ATENDIDO, SIN_CUPO')
        public String motivoBloqueo;

        @InvocableVariable(label='Opciones legibles' description='Franjas en texto, para que el agente las ofrezca')
        public List<String> opciones;

        @InvocableVariable(label='Ids de franja' description='Uso interno del Flow. NO mostrar al usuario')
        public List<String> slotIds;
    }

    // format() usa el idioma del usuario que ejecuta, y el agente puede correr con
    // un usuario en ingles. Este texto lo lee el cliente, asi que se fuerza espanol.
    private static final List<String> DIAS = new List<String>{
        'domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'};
    private static final List<String> MESES = new List<String>{
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
        'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'};

    @TestVisible
    private static String enEspanol(Datetime d) {
        // Date.toStartOfWeek() en esta org arranca en domingo, asi que el indice
        // de dia sale de la diferencia contra ese domingo.
        Date dia = d.date();
        Integer indiceDia = Math.mod(dia.toStartOfWeek().daysBetween(dia), 7);
        return DIAS[indiceDia] + ' ' + dia.day() + ' de ' + MESES[dia.month() - 1];
    }

    /**
     * Devuelve las franjas realmente agendables de un taller.
     *
     * Aplica tres compuertas antes de ofrecer nada:
     *   1. La sucursal existe y esta activa.
     *   2. El taller atiende ese modelo y ese sistema (Modelo_Sucursal__c).
     *   3. La franja respeta la anticipacion minima que exige la sucursal
     *      (Zapata pide 24 horas en su propio sitio).
     */
    @InvocableMethod(
        label='Consultar disponibilidad de taller'
        description='Franjas agendables de un taller, validando que atienda el modelo y respetando la anticipacion minima'
        category='Zapata Postventa')
    public static List<Respuesta> consultarDisponibilidad(List<Peticion> peticiones) {
        List<Respuesta> salida = new List<Respuesta>();

        for (Peticion p : peticiones) {
            Respuesta r = new Respuesta();
            r.opciones = new List<String>();
            r.slotIds = new List<String>();
            r.hayDisponibilidad = false;

            // --- Compuerta 1: la sucursal
            String clave = p.sucursal == null ? '' : p.sucursal.trim();
            String comodin = '%' + clave + '%';
            List<Sucursal__c> sucs = [
                SELECT Id, Name, Ciudad__c, Activa__c, Anticipacion_Minima_Horas__c
                FROM Sucursal__c
                WHERE Codigo_Sucursal__c = :clave OR Name LIKE :comodin
                WITH USER_MODE
                LIMIT 2
            ];
            if (sucs.isEmpty()) {
                r.motivoBloqueo = 'SUCURSAL_NO_ENCONTRADA';
                r.mensaje = 'No encontre un taller que coincida con "' + clave +
                            '". Puedo listarte los talleres disponibles.';
                salida.add(r);
                continue;
            }
            Sucursal__c suc = sucs[0];
            if (!suc.Activa__c) {
                r.motivoBloqueo = 'SUCURSAL_INACTIVA';
                r.mensaje = 'El taller ' + suc.Name + ' no esta recibiendo citas en este momento.';
                salida.add(r);
                continue;
            }

            // --- Compuerta 2: ese taller si atiende ese modelo y ese sistema
            if (String.isNotBlank(p.modeloCodigo)) {
                Integer cobertura;
                if (String.isNotBlank(p.sistema)) {
                    cobertura = [
                        SELECT COUNT() FROM Modelo_Sucursal__c
                        WHERE Sucursal__c = :suc.Id AND Activo__c = true
                          AND Modelo__r.ProductCode = :p.modeloCodigo
                          AND Sistemas_Soportados__c = :p.sistema
                        WITH USER_MODE
                    ];
                } else {
                    cobertura = [
                        SELECT COUNT() FROM Modelo_Sucursal__c
                        WHERE Sucursal__c = :suc.Id AND Activo__c = true
                          AND Modelo__r.ProductCode = :p.modeloCodigo
                        WITH USER_MODE
                    ];
                }
                if (cobertura == 0) {
                    r.motivoBloqueo = 'MODELO_NO_ATENDIDO';
                    r.mensaje = 'El taller ' + suc.Name + ' no da servicio a ese modelo' +
                        (String.isNotBlank(p.sistema) ? ' en el sistema ' + p.sistema : '') +
                        '. Puedo buscarte otro taller que si lo atienda.';
                    salida.add(r);
                    continue;
                }
            }

            // --- Compuerta 3: anticipacion minima
            Decimal horas = suc.Anticipacion_Minima_Horas__c == null
                ? 24 : suc.Anticipacion_Minima_Horas__c;
            Datetime desde = System.now().addMinutes((Integer) (horas * 60));
            Integer dias = (p.diasAdelante == null || p.diasAdelante <= 0) ? 14 : p.diasAdelante;
            Datetime hasta = desde.addDays(dias);

            List<Slot_Taller__c> libres;
            if (String.isNotBlank(p.tipoServicio)) {
                libres = [
                    SELECT Id, Inicio__c, Fin__c, Tipo_Servicio__c, Cupos_Libres__c
                    FROM Slot_Taller__c
                    WHERE Sucursal__c = :suc.Id AND Disponible__c = true
                      AND Inicio__c >= :desde AND Inicio__c <= :hasta
                      AND Tipo_Servicio__c = :p.tipoServicio
                    WITH USER_MODE
                    ORDER BY Inicio__c ASC
                    LIMIT 10
                ];
            } else {
                libres = [
                    SELECT Id, Inicio__c, Fin__c, Tipo_Servicio__c, Cupos_Libres__c
                    FROM Slot_Taller__c
                    WHERE Sucursal__c = :suc.Id AND Disponible__c = true
                      AND Inicio__c >= :desde AND Inicio__c <= :hasta
                    WITH USER_MODE
                    ORDER BY Inicio__c ASC
                    LIMIT 10
                ];
            }

            if (libres.isEmpty()) {
                r.motivoBloqueo = 'SIN_CUPO';
                r.mensaje = 'No hay cupo en ' + suc.Name + ' dentro de los proximos ' +
                            dias + ' dias. Recuerda que las citas se agendan con al menos ' +
                            horas.setScale(0) + ' horas de anticipacion.';
                salida.add(r);
                continue;
            }

            for (Slot_Taller__c s : libres) {
                r.opciones.add(enEspanol(s.Inicio__c) + ' de ' + s.Inicio__c.format('HH:mm') +
                               ' a ' + s.Fin__c.format('HH:mm') + ' — ' + s.Tipo_Servicio__c +
                               ' (' + s.Cupos_Libres__c.setScale(0) + ' lugares)');
                r.slotIds.add(s.Id);
            }
            r.hayDisponibilidad = true;
            r.mensaje = 'Tengo ' + libres.size() + ' horarios en ' + suc.Name +
                        (String.isNotBlank(suc.Ciudad__c) ? ' (' + suc.Ciudad__c + ')' : '') + '.';
            salida.add(r);
        }
        return salida;
    }
}
