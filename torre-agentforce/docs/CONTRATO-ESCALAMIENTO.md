# Contrato verificado — escalamiento a humano

Actualizado el **5 de agosto de 2026 (CDT) / 6 de agosto UTC** contra la org
`zapata`. Evidencia sanitizada: `evidencia/15-escalamiento-apex/` y
`evidencia/16-agentforce-v10/`.

## Decisión de canal

La org no tiene `MessagingChannel` ni `EmbeddedServiceConfig`, y no hay presencia o
routing configurados para sostener una transferencia de Messaging. El contrato
operable es **Case + CaseComment** sobre la cola real
`Escalamiento_Postventa` (`00GgK00000BMTaVUAX`). No se muestra ni se promete un
“asesor conectado” inexistente.

La versión activa v10 de `Agente Postventa Zapata` ya no usa `@utils.escalate`.
Ejecuta la acción Apex invocable `Crear_Escalamiento_Asesor`, respaldada por
`EscalarAsesorHumano`.

## Escritura atómica desde Agentforce

La acción recibe un folio de correlación, motivo, riesgo, referencias opcionales y un
resumen del agente. La Torre puede enriquecer la misma operación con el contexto
estructurado completo. Apex hace en una sola transacción:

1. bloquea y consulta por llave de idempotencia, sin distinguir mayúsculas;
2. crea un `Case` con `Origin=Agentforce`, `Status=New` y dueño igual a la cola;
3. escribe un comentario interno de resumen, un encabezado de contexto y cada turno
   suministrado como `CaseComment` interno (`IsPublished=false`);
4. crea `Log_Agente__c` con la misma correlación y el `Case` relacionado;
5. devuelve los Ids y relee el estado. Si falla una pieza, se revierte todo.

El texto de cada turno se limita y valida. El contrato admite como máximo 200
peticiones, 40 turnos, 50,000 caracteres por contexto y 250,000 caracteres
agregados. Una repetición idéntica devuelve el mismo Case y los mismos comentarios;
contenido distinto con la misma llave devuelve `IDEMPOTENCY_CONFLICT` (HTTP 409 en
la Torre). El único enriquecimiento permitido es pasar una vez del resumen creado
por Agentforce al contexto completo de la Torre.

## Contexto, privacidad y conversación posterior

La semilla del escalamiento es **interna**. Esto evita publicar una transcripción de
soporte potencialmente sensible en un portal. Los comentarios que cliente y rol
asesor agreguen después conservan su visibilidad explícita y se vuelven a leer desde
Salesforce; no se guardan como fuente paralela en memoria.

La Torre expone `GET /api/escalamiento/:caseId/stream`. El servidor consulta
`CaseComment`, emite por SSE sólo Ids nuevos y revalida autorización/ownership cada
30 segundos. Un comentario se emite únicamente después de que Salesforce confirmó
su escritura. La entrega es de baja latencia por sondeo; no es Messaging ni una
garantía de escala masiva.

El rol `asesor` de la aplicación es una autorización de la Torre. Los comentarios
siguen atribuidos en Salesforce al usuario integrador, no a una identidad humana
individual. Ese límite permanece explícito en `BLOQUEOS.md`.

## Evidencia histórica: Preview v8

Esta evidencia preservada demuestra la transacción Apex y su cardinalidad en
Preview v8; **no se presenta como una prueba de Agent API v10**:

| Registro | Resultado |
|---|---|
| `Case` | `500gK00001CP3MfQAL`, folio `00001052`, cola real, `Origin=Agentforce`, `Status=New` |
| `CaseComment` semilla | `00agK00000EmwODQAZ`, interno |
| `Log_Agente__c` | `a02gK00000NpWbhQAF`, acción `Escalar_Asesor_Humano`, `Outcome=SUCCESS` |
| Correlación | `PREVIEW-V8-20260805-03` |
| Cardinalidad | 1 Case / 1 comentario semilla / 1 log |

La versión probada en Preview fue v8. Salesforce compiló, validó y activó v10, pero
la activación por sí sola no demuestra que el lifecycle conversacional v10 ejecute
el escalamiento.

La clase `EscalarAsesorHumanoTest` pasó 13/13 pruebas con 93.04% de cobertura en el
deploy `0AfgK00000PdpNgSAJ`. Incluye reintento idéntico, conflicto por contenido,
enriquecimiento único, límites, comentarios manuales y rollback. La prueba negativa
del endpoint devolvió `INVALID_TOWER_CONTEXT` y dejó 0 Cases / 0 Logs.

## Resultado real: Agent API v10

El 6 de agosto de 2026 UTC se ejecutó una conversación controlada mediante la Torre,
con rol `asesor`, contra el `BotDefinition` real. Antes de abrirla se comprobó en la
org que v10 estaba `Active`, que la cola configurada existía y que Client Credentials
podía leer Case y Log. El mensaje se etiquetó `PRUEBA_TECNICA_AUTORIZADA`, no usó PII
ni identidad, contacto, cuenta, unidad, VIN, placa o vehículo inventados, y exigió la
confirmación previa definida por el agente.

La sesión fue reconocida, pero el primer turno terminó sin `EndOfTurn`
(`TURN_WITHOUT_END`). El cleanup se intentó y la API local devolvió HTTP 400
`INVALID_REQUEST`; por tanto, la evidencia conserva `sessionClosed=false` y no
inventa un cierre exitoso. No se envió el turno de confirmación y no hubo reintento.

La consulta CRM posterior, independiente y de sólo lectura, confirmó:

| Comprobación v10 | Resultado real |
|---|---|
| Case en cola con `Origin=Agentforce` | 17 → 17 (delta 0) |
| Log SUCCESS de `Escalar_Asesor_Humano` | 5 → 5 (delta 0) |
| Case reciente con marcador técnico | 0 |
| CaseComment nuevo correlacionable | 0, porque no se creó Case |
| Cardinalidad requerida 1 / ≥1 / 1 | **No demostrada** |

En consecuencia, el escalamiento por Agent API v10 **no está aceptado end-to-end**.
La transacción histórica Preview sigue siendo válida, pero no sustituye esta falla de
lifecycle. No se borró ningún registro CRM.

Evidencia sanitizada y separada:

- `evidencia/16-agentforce-v10/escalamiento-agent-api.20260806T051818Z.json`
- `evidencia/16-agentforce-v10/escalamiento-agent-api.20260806T051818Z.postmortem.json`

Ambos artefactos contienen sólo estados, conteos, booleanos y hashes; no guardan
transcript, payload, tokens, PII ni los Ids crudos de la ejecución. El verificador se
ejecuta con un gate de sintaxis previo:

```powershell
npm run verificar:escalamiento-agentforce
```

Verificación operativa independiente:

```sql
SELECT Id, CaseNumber, Status, Origin, OwnerId, Correlation_Id__c
FROM Case WHERE Correlation_Id__c = '<folio>'

SELECT Id, ParentId, IsPublished, CreatedDate
FROM CaseComment WHERE ParentId = '<caseId>' ORDER BY CreatedDate

SELECT Id, Correlation_Id__c, Action_Name__c, Outcome__c, Case__c
FROM Log_Agente__c WHERE Correlation_Id__c = '<folio>'
```

## Límites que no se disfrazan

- No es Messaging for In-App and Web ni una transferencia síncrona.
- La identidad del asesor no es individual hasta integrar SSO/OIDC y propagación de
  actor verificable.
- El sondeo SSE es adecuado para una evaluación controlada y una sola réplica; para
  escala horizontal se requiere estado compartido/afinidad y un canal de eventos.
- Los registros son efectos reales en Salesforce sobre un escenario de prueba. No
  demuestran que el caso pertenezca a un cliente productivo de Zapata.
