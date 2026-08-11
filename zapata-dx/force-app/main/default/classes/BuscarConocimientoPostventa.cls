/**
 * BuscarConocimientoPostventa
 * Hackaton IA Agentica - Agente de postventa de camiones
 *
 * Accion invocable que busca en los Knowledge Articles publicados y devuelve
 * el contenido al Agente de Agentforce junto con su estado de fuente.
 *
 * Sustituye a la accion estandar "Answer Questions with Knowledge" cuando no
 * hay Data Library disponible. Es deterministica: el agente cita textualmente
 * el articulo, lo que favorece el criterio de Precision de informacion.
 *
 * Estrategia de busqueda en dos pasos:
 *   1. SOSL sobre los articulos publicados (busqueda de texto completo)
 *   2. Si SOSL no devuelve nada, SOQL con LIKE sobre Titulo y Resumen
 */
public with sharing class BuscarConocimientoPostventa {

    private static final Integer MAX_ARTICULOS = 3;
    private static final Integer MAX_CARACTERES = 4000;
    private static final String VERSION_SINTETICA = 'v1.0-sintetica-no-verificada';
    private static final String AVISO_SINTETICO =
        '[FUENTE SINTETICA NO VERIFICADA] Material de apoyo del reto; ' +
        'no debe presentarse como oficial ni confirmada. Verifica la politica vigente ' +
        'con una fuente operacional antes de tomar una decision.';

    public class Solicitud {
        @InvocableVariable(
            label='Pregunta o tema de consulta'
            description='Texto de la consulta del cliente. Ej: garantia turbo, servicio 40000 km, unidad varada'
            required=true)
        public String pregunta;

        @InvocableVariable(
            label='VIN mencionado por el cliente'
            description='Numero de serie que el cliente dicto, si lo dicto. La accion comprueba si esa unidad existe en el padron para que el agente no presente la poliza general como si fuera su cobertura.'
            required=false)
        public String vin;
    }

    public class Respuesta {
        @InvocableVariable(label='Contenido de los articulos')
        public String contenido;

        @InvocableVariable(label='Titulos consultados')
        public String titulos;

        @InvocableVariable(label='Se encontro informacion')
        public Boolean encontrado;

        @InvocableVariable(label='Estado de la fuente')
        public String estadoFuente;

        @InvocableVariable(label='Advertencia de procedencia')
        public String advertenciaFuente;

        @InvocableVariable(
            label='Unidad encontrada en el padron'
            description='Verdadero solo si el VIN dictado existe como Asset. Si es falso, el material que sigue es la poliza general y NO la cobertura de esa unidad.')
        public Boolean unidadEncontrada;

        @InvocableVariable(
            label='Aviso sobre la unidad'
            description='Texto obligatorio cuando el VIN no existe. Debe decirse ANTES del contenido.')
        public String avisoUnidad;
    }

    @InvocableMethod(
        label='Buscar en base de conocimiento de postventa'
        description='Busca material sintetico no verificado de postventa y devuelve su contenido con una advertencia obligatoria. Sirve como apoyo, no como fuente oficial ni confirmada. Verifica antes de decidir; si no hay informacion, dilo y ofrece escalar.')
    public static List<Respuesta> buscar(List<Solicitud> solicitudes) {

        List<Respuesta> resultados = new List<Respuesta>();

        for (Solicitud s : solicitudes) {
            Respuesta r = new Respuesta();
            r.encontrado = false;
            r.contenido  = '';
            r.titulos    = '';
            r.estadoFuente = VERSION_SINTETICA;
            r.advertenciaFuente = AVISO_SINTETICO;

            // Si el cliente dicto un numero de serie, se comprueba ANTES de responder.
            //
            // Sin esto el agente contestaba con la poliza general ante un VIN que no
            // existe y jamas aclaraba que esa unidad no aparece: quien se equivocaba de
            // digito podia leer el resultado como la cobertura de su camion. El material
            // es correcto y va marcado como no verificado, pero callar que la unidad no
            // existe convierte una respuesta cierta en una respuesta enganosa.
            resolverUnidad(s.vin, r);

            String termino = limpiar(s.pregunta);

            if (String.isBlank(termino) || termino.length() < 2) {
                r.contenido = 'No se recibio un termino de busqueda valido.';
                resultados.add(r);
                continue;
            }

            List<Knowledge__kav> encontrados = new List<Knowledge__kav>();

            // ---------- Paso 1: SOSL ----------
            try {
                String sosl = 'FIND \'' + String.escapeSingleQuotes(termino) + '\' IN ALL FIELDS ' +
                              'RETURNING Knowledge__kav(Id, Title, Summary, Contenido__c, Version_Politica__c ' +
                              'WHERE PublishStatus = \'Online\' AND IsLatestVersion = true ' +
                              'LIMIT ' + MAX_ARTICULOS + ')';
                List<List<SObject>> busqueda = Search.query(sosl);
                if (!busqueda.isEmpty()) {
                    encontrados = (List<Knowledge__kav>) busqueda[0];
                }
            } catch (Exception e) {
                System.debug('SOSL fallo, se usara SOQL: ' + e.getMessage());
            }

            // ---------- Paso 2: SOQL de respaldo ----------
            if (encontrados.isEmpty()) {
                String patron = '%' + termino + '%';
                encontrados = [
                    SELECT Id, Title, Summary, Contenido__c, Version_Politica__c
                    FROM Knowledge__kav
                    WHERE PublishStatus = 'Online'
                      AND IsLatestVersion = true
                      AND (Title LIKE :patron OR Summary LIKE :patron)
                    LIMIT 3
                ];
            }

            // ---------- Armado de la respuesta ----------
            if (encontrados.isEmpty()) {
                r.contenido = AVISO_SINTETICO + '\n\n' +
                              'No se encontro material de apoyo sobre ese tema. ' +
                              'Informa al cliente que no tienes informacion verificada y ofrece escalar a un asesor humano.';
                resultados.add(r);
                continue;
            }

            List<String> partes  = new List<String>();
            List<String> nombres = new List<String>();

            for (Knowledge__kav a : encontrados) {
                nombres.add(a.Title);
                String version = String.isBlank(a.Version_Politica__c)
                    ? 'SIN_VERSION_NO_VERIFICADA' : a.Version_Politica__c;
                partes.add(anteponerEstadoFuente(
                    version,
                    '--- MATERIAL: ' + a.Title + ' ---\n' + quitarHtml(a.Contenido__c)
                ));
            }

            String texto = String.join(partes, '\n\n');
            if (texto.length() > MAX_CARACTERES) {
                texto = texto.substring(0, MAX_CARACTERES) + '...';
            }

            r.contenido  = texto;
            r.titulos    = String.join(nombres, ', ');
            r.encontrado = true;
            resultados.add(r);
        }

        return resultados;
    }

    /** Mantiene util el texto, pero hace imposible omitir su estado no verificado. */
    @TestVisible
    static String anteponerEstadoFuente(String version, String contenido) {
        String estado = String.isBlank(version) ? 'SIN_VERSION_NO_VERIFICADA' : version.trim();
        return AVISO_SINTETICO + '\nESTADO_FUENTE: ' + estado + '\n\n' +
            (contenido == null ? '' : contenido);
    }

    /** Quita caracteres que rompen SOSL y normaliza espacios. */
    /**
     * Comprueba el VIN contra el padron de unidades. No bloquea la busqueda: el
     * conocimiento general sigue sirviendo. Lo que hace es obligar a que la respuesta
     * diga si esa unidad existe, para que la poliza no se lea como su cobertura.
     */
    private static void resolverUnidad(String vinCrudo, Respuesta r) {
        String vin = vinCrudo == null ? '' : vinCrudo.trim();
        if (String.isBlank(vin)) {
            // No se dicto ninguna unidad: no hay nada que afirmar ni que negar.
            r.unidadEncontrada = null;
            r.avisoUnidad = null;
            return;
        }

        List<Asset> unidades = [
            SELECT Id, Name, SerialNumber
            FROM Asset
            WHERE SerialNumber = :vin
            WITH USER_MODE
            LIMIT 1
        ];

        if (unidades.isEmpty()) {
            r.unidadEncontrada = false;
            r.avisoUnidad =
                'El numero de serie ' + vin + ' no aparece en el padron de unidades de ' +
                'Zapata. Lo que sigue es material general de postventa y NO la cobertura ' +
                'de esa unidad. Pide al cliente que verifique el numero o escala con un asesor.';
        } else {
            r.unidadEncontrada = true;
            r.avisoUnidad = null;
        }
    }

    private static String limpiar(String entrada) {
        if (String.isBlank(entrada)) return '';
        String salida = entrada.replaceAll('[?¿!¡*&|{}\\[\\]()^~:\\\\"\'+-]', ' ');
        salida = salida.replaceAll('\\s+', ' ').trim();
        return salida;
    }

    /** Convierte el HTML del articulo en texto plano legible para el LLM. */
    private static String quitarHtml(String html) {
        if (String.isBlank(html)) return '';
        String texto = html;
        texto = texto.replaceAll('(?i)</(p|div|h[1-6])>', '\n');
        texto = texto.replaceAll('(?i)<li[^>]*>', '\n- ');
        texto = texto.replaceAll('(?i)</(ul|ol)>', '\n');
        texto = texto.replaceAll('<[^>]+>', '');
        texto = texto.replace('&nbsp;', ' ')
                     .replace('&amp;', '&')
                     .replace('&lt;', '<')
                     .replace('&gt;', '>')
                     .replace('&#124;', '|');
        texto = texto.replaceAll('\n{3,}', '\n\n');
        return texto.trim();
    }
}
