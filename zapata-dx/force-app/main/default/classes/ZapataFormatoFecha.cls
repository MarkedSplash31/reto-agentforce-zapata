/**
 * Convierte la franja de taller en un texto que el operador entiende por telefono:
 * "martes 11 de agosto de 09:00 a 11:00".
 *
 * Vive en su propia clase porque Apex solo admite un @InvocableMethod por clase y
 * ZapataAgendaController ya usa el suyo para Consultar_Disponibilidad.
 *
 * Por que no una formula de Flow: TEXT() sobre un DateTime devuelve GMT, y la org
 * opera en horario de Mexico. Datetime.format() si respeta la zona del usuario que
 * ejecuta, asi que el texto sale correcto sin trucos de resta de horas.
 *
 * El nombre del dia y del mes se arman a mano: format() usa el idioma del usuario
 * que ejecuta, y el usuario del agente puede estar en ingles.
 */
public with sharing class ZapataFormatoFecha {

    public class Peticion {
        @InvocableVariable(label='Inicio de la franja' required=true)
        public Datetime inicio;

        @InvocableVariable(label='Fin de la franja')
        public Datetime fin;
    }

    public class Respuesta {
        @InvocableVariable(label='Texto de la cita en espanol')
        public String texto;
    }

    private static final List<String> DIAS = new List<String>{
        'domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'};
    private static final List<String> MESES = new List<String>{
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
        'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'};

    @InvocableMethod(
        label='Formatear cita en espanol'
        description='Convierte inicio y fin de una franja en un texto legible en espanol de Mexico'
        category='Zapata Postventa')
    public static List<Respuesta> formatear(List<Peticion> peticiones) {
        List<Respuesta> salida = new List<Respuesta>();

        for (Peticion p : peticiones) {
            Respuesta r = new Respuesta();
            if (p == null || p.inicio == null) {
                r.texto = '';
                salida.add(r);
                continue;
            }

            // Date.toStartOfWeek() arranca en domingo en esta org, asi que el indice
            // de dia sale de la diferencia contra ese domingo.
            Date dia = p.inicio.date();
            Integer indiceDia = Math.mod(dia.toStartOfWeek().daysBetween(dia), 7);

            String texto = DIAS[indiceDia] + ' ' + dia.day() + ' de ' + MESES[dia.month() - 1] +
                           ' a las ' + p.inicio.format('HH:mm');
            if (p.fin != null) {
                texto = DIAS[indiceDia] + ' ' + dia.day() + ' de ' + MESES[dia.month() - 1] +
                        ' de ' + p.inicio.format('HH:mm') + ' a ' + p.fin.format('HH:mm');
            }

            r.texto = texto;
            salida.add(r);
        }
        return salida;
    }
}
