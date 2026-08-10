/**
 * Catalogo de sintomas: la raiz del arbol de diagnostico guiado.
 *
 * NO son inventados. Cada uno sale de un articulo ya publicado por el equipo:
 *   "Luces de tablero: significado y accion inmediata"
 *   "Fallas comunes del sistema de frenos de aire"
 *   "Codigos de falla SPN y FMI mas frecuentes"
 *
 * La clasificacion de riesgo sigue lo que esos articulos ya afirman: lo que el
 * articulo manda DETENER la unidad queda como Critico y sin autoservicio; lo que
 * el articulo permite hacer al operador (rellenar, drenar, leer un codigo) queda
 * como autoservicio con sus senales de alerta.
 *
 * El briefing acota el alcance a 8-10 sintomas para que el retriever no se
 * degrade. Son 10: seis criticos y cuatro de autoservicio. Esa mezcla es
 * deliberada: la demo necesita mostrar que el agente resuelve Y que se niega.
 *
 * Ejecutar: sf apex run --file scripts/apex/cargar-sintomas.apex --target-org zapata
 */

delete [SELECT Id FROM Sintoma__c];

Map<String, String> art = new Map<String, String>();
for (Knowledge__kav k : [SELECT Title, KnowledgeArticleId FROM Knowledge__kav
                         WHERE PublishStatus = 'Online']) {
    art.put(k.Title, k.KnowledgeArticleId);
}
String aTablero = art.get('Luces de tablero: significado y accion inmediata');
String aFrenos  = art.get('Fallas comunes del sistema de frenos de aire');
String aCodigos = art.get('Codigos de falla SPN y FMI mas frecuentes');
String aDPF     = art.get('Regeneracion del filtro de particulas (DPF)');
String aAdBlue  = art.get('Sistema de post-tratamiento y AdBlue');

List<Sintoma__c> s = new List<Sintoma__c>();

// ==================== CRITICOS: el articulo manda DETENER la unidad =========

s.add(new Sintoma__c(
    Name = 'Presion de aceite baja',
    Codigo__c = 'SINT_PRESION_ACEITE',
    Sistema__c = 'Tren motriz',
    Nivel_Riesgo__c = 'Critico',
    Autoservicio_Permitido__c = false,
    Preguntas_Descarte__c =
        'Confirma que la unidad este orillada en lugar seguro antes de cualquier otra pregunta.\n'
        + 'Que color tiene el testigo, rojo o ambar?\n'
        + 'El motor sigue encendido en este momento?\n'
        + 'Aparece el codigo SPN 100 con FMI 1 en el tablero?',
    Senales_De_Alerta__c =
        'El articulo es explicito: apagar el motor de inmediato y NO continuar la marcha. '
        + 'El agente no guia ninguna verificacion bajo el cofre. Escala de inmediato y '
        + 'coordina asistencia en carretera.',
    Knowledge_Article_Id__c = aTablero,
    Activo__c = true));

s.add(new Sintoma__c(
    Name = 'Temperatura alta de refrigerante',
    Codigo__c = 'SINT_TEMPERATURA_ALTA',
    Sistema__c = 'Refrigeracion',
    Nivel_Riesgo__c = 'Critico',
    Autoservicio_Permitido__c = false,
    Preguntas_Descarte__c =
        'La unidad ya esta orillada?\n'
        + 'Hace cuanto encendio el testigo?\n'
        + 'Ves vapor o escurrimiento debajo de la unidad?\n'
        + 'Aparece SPN 110 con FMI 0?',
    Senales_De_Alerta__c =
        'El articulo indica orillarse, dejar el motor en marcha minima tres minutos y '
        + 'apagar. NUNCA abrir el tapon del radiador con el motor caliente: hay riesgo '
        + 'de quemadura grave. El agente no guia esa maniobra bajo ninguna circunstancia.',
    Knowledge_Article_Id__c = aTablero,
    Activo__c = true));

s.add(new Sintoma__c(
    Name = 'Presion de aire baja',
    Codigo__c = 'SINT_PRESION_AIRE_BAJA',
    Sistema__c = 'Frenos',
    Nivel_Riesgo__c = 'Critico',
    Autoservicio_Permitido__c = false,
    Preguntas_Descarte__c =
        'La unidad esta detenida en este momento?\n'
        + 'Que presion marca el manometro?\n'
        + 'Se escucha fuga de aire al aplicar el freno?',
    Senales_De_Alerta__c =
        'El articulo prohibe operar por debajo de 6.2 bar y prohibe mover la unidad '
        + 'hasta restablecer presion. El agente no autoriza el traslado por medios '
        + 'propios ni siquiera una distancia corta. Escala y coordina grua.',
    Knowledge_Article_Id__c = aFrenos,
    Activo__c = true));

s.add(new Sintoma__c(
    Name = 'Luz de paro de motor (STOP)',
    Codigo__c = 'SINT_PARO_MOTOR',
    Sistema__c = 'Tren motriz',
    Nivel_Riesgo__c = 'Critico',
    Autoservicio_Permitido__c = false,
    Preguntas_Descarte__c =
        'La unidad ya esta detenida en lugar seguro?\n'
        + 'El motor se apago solo o sigue encendido?\n'
        + 'Que otros testigos estan encendidos?\n'
        + 'Que codigo SPN y FMI aparece?',
    Senales_De_Alerta__c =
        'El articulo manda detener y solicitar asistencia. El modulo ya decidio que '
        + 'la falla compromete el motor. No hay verificacion que el operador pueda '
        + 'hacer. Escalamiento inmediato.',
    Knowledge_Article_Id__c = aTablero,
    Activo__c = true));

s.add(new Sintoma__c(
    Name = 'Perdida de presion de aire con la unidad estacionada',
    Codigo__c = 'SINT_FUGA_AIRE',
    Sistema__c = 'Frenos',
    Nivel_Riesgo__c = 'Critico',
    Autoservicio_Permitido__c = false,
    Preguntas_Descarte__c =
        'Con el motor apagado y frenos aplicados, cuanta presion pierde por minuto?\n'
        + 'Se escucha por donde escapa el aire?\n'
        + 'El compresor tarda en cargar o no alcanza presion?',
    Senales_De_Alerta__c =
        'Una caida mayor a 0.14 bar por minuto esta fuera de norma segun el articulo '
        + 'y exige ingreso a taller. El agente no guia reparacion de lineas ni valvulas: '
        + 'es sistema neumatico de seguridad.',
    Knowledge_Article_Id__c = aFrenos,
    Activo__c = true));

s.add(new Sintoma__c(
    Name = 'Frenado desigual o la unidad jalonea a un lado',
    Codigo__c = 'SINT_FRENADO_DESIGUAL',
    Sistema__c = 'Frenos',
    Nivel_Riesgo__c = 'Critico',
    Autoservicio_Permitido__c = false,
    Preguntas_Descarte__c =
        'Hacia que lado se va la unidad al frenar?\n'
        + 'Pasa siempre o solo con carga?\n'
        + 'Cuando fue el ultimo ajuste de balatas?',
    Senales_De_Alerta__c =
        'El articulo lo clasifica como riesgo de seguridad con atencion prioritaria. '
        + 'El agente no guia ajuste de balatas ni intervencion en la valvula relay. '
        + 'Deriva a taller con prioridad.',
    Knowledge_Article_Id__c = aFrenos,
    Activo__c = true));

// ============ AUTOSERVICIO: el articulo permite que el operador actue ========

s.add(new Sintoma__c(
    Name = 'Check Engine ambar encendido',
    Codigo__c = 'SINT_CHECK_ENGINE',
    Sistema__c = 'Tren motriz',
    Nivel_Riesgo__c = 'Medio',
    Autoservicio_Permitido__c = true,
    Preguntas_Descarte__c =
        'El testigo es ambar o rojo? Si es rojo, cambia de sintoma.\n'
        + 'La unidad pierde potencia o suena distinto?\n'
        + 'Que codigo SPN y FMI muestra el tablero? Ambos numeros, por favor.\n'
        + 'Desde cuando esta encendido?',
    Senales_De_Alerta__c =
        'DETENER LA GUIA Y ESCALAR si: el testigo cambia a rojo, aparece paro de motor, '
        + 'la unidad pierde potencia de forma marcada, o el codigo es SPN 100 o SPN 110. '
        + 'El autoservicio aqui se limita a LEER el codigo del tablero y reportarlo. '
        + 'El agente no indica ninguna intervencion mecanica. El articulo da un plazo '
        + 'maximo de 72 horas para agendar diagnostico.',
    Knowledge_Article_Id__c = aCodigos,
    Activo__c = true));

s.add(new Sintoma__c(
    Name = 'Filtro de particulas saturado',
    Codigo__c = 'SINT_DPF_SATURADO',
    Sistema__c = 'Tren motriz',
    Nivel_Riesgo__c = 'Medio',
    Autoservicio_Permitido__c = true,
    Preguntas_Descarte__c =
        'Aparece el testigo de filtro de particulas?\n'
        + 'Aparece SPN 3251 con FMI 0?\n'
        + 'Que tipo de ruta hace la unidad, urbana de arranque y pare o carretera?\n'
        + 'Se intento una regeneracion antes?',
    Senales_De_Alerta__c =
        'DETENER LA GUIA Y ESCALAR si: se enciende ademas el testigo de paro de motor, '
        + 'la unidad entra en modo de potencia reducida, o la regeneracion falla dos '
        + 'veces seguidas. La regeneracion se hace segun el procedimiento del articulo, '
        + 'con la unidad estacionada en area ventilada y despejada: el escape alcanza '
        + 'temperaturas muy altas.',
    Knowledge_Article_Id__c = aDPF != null ? aDPF : aTablero,
    Activo__c = true));

s.add(new Sintoma__c(
    Name = 'Nivel bajo de AdBlue',
    Codigo__c = 'SINT_ADBLUE_BAJO',
    Sistema__c = 'Tren motriz',
    Nivel_Riesgo__c = 'Bajo',
    Autoservicio_Permitido__c = true,
    Preguntas_Descarte__c =
        'Que nivel marca el indicador de AdBlue?\n'
        + 'Aparece SPN 1761 con FMI 17?\n'
        + 'La unidad ya entro en potencia reducida?\n'
        + 'Tienes AdBlue disponible para rellenar?',
    Senales_De_Alerta__c =
        'DETENER LA GUIA Y ESCALAR si: el tanque ya se vacio por completo y la unidad '
        + 'entro en modo de arranque limitado, o si el testigo sigue encendido despues '
        + 'de rellenar. Rellenar es una operacion no invasiva y el operador la puede '
        + 'hacer. Nunca sugerir puentear ni suprimir el sistema de post-tratamiento: '
        + 'el articulo de invalidacion lo marca como causa de cancelacion de garantia.',
    Knowledge_Article_Id__c = aAdBlue != null ? aAdBlue : aTablero,
    Activo__c = true));

s.add(new Sintoma__c(
    Name = 'Agua en los tanques de aire',
    Codigo__c = 'SINT_AGUA_TANQUES',
    Sistema__c = 'Frenos',
    Nivel_Riesgo__c = 'Bajo',
    Autoservicio_Permitido__c = true,
    Preguntas_Descarte__c =
        'Sale agua al abrir la valvula de drenado?\n'
        + 'Cada cuanto drenas los tanques?\n'
        + 'Cuando se cambio el cartucho secador por ultima vez?\n'
        + 'La unidad esta detenida y con freno de estacionamiento aplicado?',
    Senales_De_Alerta__c =
        'DETENER LA GUIA Y ESCALAR si: la unidad no esta estacionada con freno aplicado, '
        + 'si sale mucha agua de forma constante, o si ademas hay perdida de presion. '
        + 'Drenar tanques es rutina diaria del operador segun el articulo. El agente '
        + 'guia solo eso y programa el cambio del cartucho secador en taller.',
    Knowledge_Article_Id__c = aFrenos,
    Activo__c = true));

insert s;

Integer criticos = [SELECT COUNT() FROM Sintoma__c WHERE Nivel_Riesgo__c = 'Critico'];
Integer auto = [SELECT COUNT() FROM Sintoma__c WHERE Autoservicio_Permitido__c = true];
System.debug(LoggingLevel.ERROR, '=== CATALOGO DE SINTOMAS ===');
System.debug(LoggingLevel.ERROR, 'Total: ' + s.size());
System.debug(LoggingLevel.ERROR, 'Criticos (el agente se niega a guiar): ' + criticos);
System.debug(LoggingLevel.ERROR, 'Con autoservicio permitido: ' + auto);
System.debug(LoggingLevel.ERROR, 'Todos derivados de articulos ya publicados.');
