// Verificacion operativa de la accion durable de escalamiento.
// Crea un unico caso tecnico real; la segunda llamada debe devolver el mismo Id.
String correlacion = 'VERIFY-ESC-20260805-01';
EscalarAsesorHumano.Solicitud entrada = new EscalarAsesorHumano.Solicitud();
entrada.correlationId = correlacion;
entrada.motivo = 'Verificacion tecnica automatizada de la accion de escalamiento; no corresponde a un caso de cliente.';
entrada.riesgoSeguridad = false;

EscalarAsesorHumano.Respuesta primera = EscalarAsesorHumano.escalar(
    new List<EscalarAsesorHumano.Solicitud>{ entrada }
)[0];
EscalarAsesorHumano.Respuesta segunda = EscalarAsesorHumano.escalar(
    new List<EscalarAsesorHumano.Solicitud>{ entrada }
)[0];

System.debug('##ESCALAMIENTO_VERIFY## creado=' + primera.escalamientoCreado
    + ' caseId=' + primera.caseId
    + ' caseNumber=' + primera.caseNumber
    + ' sameCase=' + (primera.caseId == segunda.caseId)
    + ' retry=' + segunda.reintento);
