# Contrato verificado — Agentforce Agent API

**Consultado el 5 de agosto de 2026.** No proviene de memoria de entrenamiento.

Fuentes oficiales:
- <https://developer.salesforce.com/docs/ai/agentforce/guide/agent-api-get-started.html>
- <https://developer.salesforce.com/docs/ai/agentforce/guide/agent-api-examples.html>
- <https://developer.salesforce.com/docs/ai/agentforce/references/agent-api>
- <https://developer.salesforce.com/docs/ai/agentforce/guide/agent-api-lifecycle.html>
- <https://developer.salesforce.com/docs/ai/agentforce/guide/agent-api-troubleshooting.html>
- Colección Postman oficial `salesforce-developers / Agent API`

Estado de verificación contra la org `zapata`: **la ECA está activa y el lifecycle
real del canal Agent API terminó con código `0`.** La evidencia sanitizada y los
límites de lo que esa prueba demuestra están en §7 y §8.

---

## 1. Requisito previo — External Client App

La documentación oficial es explícita: *"you must set up an external client app"* con
**flujo de credenciales de cliente** (client credentials).

Esto sustituye a la Connected App clásica. Sin ella no hay token que la puerta de
enlace acepte.

Estado en la org, confirmado el 5 de agosto:

| Configuración | Resultado |
|---|---|
| External Client App | `Torre Agentforce Zapata`, activa |
| OAuth scopes | `api`, `refresh_token/offline_access`, `chatbot_api`, `sfap_api` |
| Flujos | client credentials + JWT para usuarios nombrados habilitados |
| Run As | `EinsteinServiceAgent`, con API habilitada |

La creación de la app ya está resuelta. El consumer key y el consumer secret no se
copian a este documento ni a ninguna evidencia. En un entorno nuevo, un humano debe
recuperarlos después de la rotación de §0 de `BLOQUEOS.md` y cargarlos directamente
en `.env`/secret store.

---

## 2. Obtener el token

```
POST https://{MY_DOMAIN_URL}/services/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={CONSUMER_KEY}
&client_secret={CONSUMER_SECRET}
```

`MY_DOMAIN_URL` para esta org:
`https://orgfarm-1c6625ec2e-dev-ed.develop.my.salesforce.com`

Respuesta: `access_token`, `instance_url`, `token_type: Bearer`, `issued_at`.

**El flujo client-credentials no emite `refresh_token`.** La renovación es pedir otro
token con las mismas credenciales. El servidor lo hace al recibir 401, y de forma
preventiva antes de que expire; nunca guarda el token en disco ni lo manda al navegador.

La guía oficial vigente exige **los cuatro scopes**, sin omitir el de solicitudes en
segundo plano:

1. `Manage user data via APIs` — `api`
2. `Perform requests at any time` — `refresh_token`, `offline_access`
3. `Access chatbot services` — `chatbot_api`
4. `Access the Salesforce API Platform` — `sfap_api`

El scope `refresh_token/offline_access` sigue siendo requisito de configuración de la
ECA aunque esta implementación renueve `client_credentials` pidiendo un token nuevo,
no guardando un refresh token.

La app necesita además un **usuario de ejecución** asignado (client credentials corre
como ese usuario), y ese usuario debe tener el permiso API y el permission set mínimo
que requieran las operaciones de la Torre, hoy `Zapata_Agente_Servicio`.

---

## 3. Abrir sesión

```
POST https://api.salesforce.com/einstein/ai-agent/v1/agents/{AGENT_ID}/sessions
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json

{
  "externalSessionKey": "{UUID}",
  "instanceConfig": { "endpoint": "https://{MY_DOMAIN_URL}" },
  "streamingCapabilities": { "chunkTypes": ["Text"] },
  "bypassUser": true
}
```

`AGENT_ID` para esta org: **`0XxgK0000022RhJSAU`** (el `BotDefinition.Id` de
`Agente_Postventa_Zapata`, confirmado por SOQL). Es el id que aparece al final de la
URL en la página de detalle del agente en Setup.

`externalSessionKey` es un UUID que uno provee y **queda en los event logs del
agente**. La Torre lo genera en el servidor con `crypto.randomUUID()`; el navegador
no puede elegirlo. No se afirma que sea el `Correlation_Id__c` de una acción Apex:
esa correlación de negocio requiere evidencia separada del escalamiento (§8).

`bypassUser: true` es lo que corresponde al flujo client-credentials.

Respuesta relevante:

```json
{
  "sessionId": "8e715939-a121-40ec-80e3-a8d1ac89da33",
  "_links": {
    "messages":       { "href": ".../sessions/{id}/messages" },
    "messagesStream": { "href": ".../sessions/{id}/messages/stream" },
    "end":            { "href": ".../sessions/{id}" }
  },
  "messages": [
    { "type": "Inform", "id": "...", "planId": "", "isContentSafe": true,
      "message": "Hi, I'm an AI service assistant. How can I help you?",
      "result": [], "citedReferences": [] }
  ]
}
```

**El servidor debe seguir los `_links` que devuelve la respuesta**, no reconstruir URLs
a mano. Es lo que aísla a la app de un cambio de host. Además valida el sufijo del
path antes de elegirlo: la colección oficial ha mostrado respuestas donde la clave
`messages` apunta a `/messages/stream`. En ese caso ese link sirve para streaming,
pero el envío síncrono usa el endpoint canónico `/messages`; nunca manda una petición
síncrona a `/messages/stream` por confiar sólo en el nombre de la clave.

---

## 4. Mandar un mensaje

### Síncrono

```
POST https://api.salesforce.com/einstein/ai-agent/v1/sessions/{SESSION_ID}/messages
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
Accept: application/json

{ "message": { "sequenceId": {EPOCH_MS}, "type": "Text", "text": "..." }, "variables": [] }
```

### Streaming — el que usa la Torre

```
POST https://api.salesforce.com/einstein/ai-agent/v1/sessions/{SESSION_ID}/messages/stream
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json
Accept: text/event-stream

{ "message": { "sequenceId": {EPOCH_MS_MAYOR}, "type": "Text", "text": "..." }, "variables": [] }
```

`sequenceId` es un número que **incrementa en cada mensaje de la sesión**. La
colección oficial usa un timestamp y la org real rechazó la secuencia artificial
`1, 2`. La Torre inicia el último valor de cada sesión en `0` y genera cada id como
`max(Date.now(), anterior + 1)`: epoch en milisegundos y crecimiento estricto incluso
si dos mensajes salen en el mismo tick. El navegador nunca controla este valor.

Tipos de mensaje de petición: `Text`, `Reply`, `Cancel`, `Transfer`,
`TransferSucceeded`, `Template`. **`Transfer` es el que declara el escalamiento.**

`variables`: variables de contexto y personalizadas. Las derivadas de campos custom
**se nombran sin el sufijo `__c`** — `Conversation_Key__c` se pasa como
`$Context.Conversation_Key`. Casi todas son de sólo lectura y sólo se fijan al abrir
sesión; en `sendMessage` sólo se pueden modificar las editables.

---

## 5. Eventos del streaming (SSE)

Respuesta `text/event-stream`. Eventos confirmados en la documentación:

| Evento | Qué significa | Uso en la Torre |
|---|---|---|
| `ProgressIndicator` | el agente está trabajando | indicador de actividad |
| `TextChunk` | fragmento de texto (`message.formatType: "Text"`) | se concatena en vivo |
| `EndOfTurn` | la respuesta terminó | cierra el turno |
| `Inform` | mensaje completo del agente | mensaje final |
| `SessionEnded` | la sesión terminó | cierra la UI |

Forma de un `TextChunk`:

```json
{ "timestamp": 1736902942425, "originEventId": "...", "traceId": "...",
  "message": { "type": "TextChunk", "id": "...", "message": "…", "formatType": "Text" } }
```

La Torre conserva `planId`, `traceId`, `message.result` y `citedReferences` cuando
Salesforce los publica. Que esos campos vengan vacíos no demuestra que no se haya
ejecutado una acción. El nombre de la acción, del tópico o del subagente se comprueba
con **Export Session Tracing Data** o con el **Testing API** (`actionsSequence`), no se
inventa a partir del texto de un `ProgressIndicator`.

---

## 6. Cerrar sesión

```
DELETE https://api.salesforce.com/einstein/ai-agent/v1/sessions/{SESSION_ID}
Authorization: Bearer {ACCESS_TOKEN}
x-session-end-reason: UserRequest
```

Respuesta: `{ "messages": [ { "type": "SessionEnded", "reason": "ClientRequest" } ], "_links": {...} }`

**El header `x-session-end-reason` es obligatorio.**

La guía oficial clasifica `HTTP 400` como petición inválida, `HTTP 423` como otra
petición todavía en curso y `HTTP 429` como límite de solicitudes. Por ello la Torre
**nunca reintenta un 400**, tenga o no cuerpo: cualquier reintento ocultaría un fallo
semántico.

Una serie aislada contra la org real mostró una ventana de propagación después de
`Start Session`: sin espera, el primer `POST /messages/stream` podía responder 400
vacío incluso sin concurrencia; esperando como mínimo `1000 ms` antes de la primera
operación, cinco ciclos secuenciales terminaron 5/5 con `EndOfTurn` y
`SessionEnded`, sin reintentos. El cliente aplica esa espera una sola vez, antes del
primer mensaje síncrono, streaming o cierre; después hace una única petición y deja
visible cualquier error real.

Los fallos persistibles conservan sólo operación, status, `errorCode` y una huella
SHA-256 truncada del `x-request-id`; no almacenan el request id, cuerpo o texto
upstream. La sesión local se elimina únicamente después de recibir `SessionEnded`;
si Salesforce no confirma, permanece registrada y readiness queda roja.

---

## 7. Ejecución real confirmada

Evidencia sanitizada: `evidencia/01-agent-api/ciclo-completo.20260806T044651Z.json`.
El archivo se valida con `JSON.parse` antes de escribirse y no contiene tokens,
payloads, textos, UUID, sessionId, traceId, planId ni ids de Salesforce.

Con la ECA local y `SF_TOKEN_PROVIDER=client_credentials` se ejecutó el lifecycle
completo contra la org real:

| Paso | Resultado real |
|---|---|
| sonda readiness (abrir + cerrar) | `HTTP 200`, cierre confirmado |
| abrir sesión | `HTTP 200`, mensaje inicial `Inform` |
| mensaje streaming | `TextChunk` + `Inform` + `EndOfTurn`; hubo plan y trace |
| mensaje síncrono | `HTTP 200`, un `Inform` |
| cerrar sesión | `HTTP 200`, `SessionEnded` |
| control sin Authorization | `HTTP 404` con cuerpo vacío |

El gate terminó en código `0`: **el transporte y el lifecycle Agent API están
operativos contra Salesforce real**. El token ordinario del CLI sigue prohibido para
esta API; REST/SOQL puede usarlo en desarrollo, pero Agent API exige la ECA.

Además, una serie controlada y sin otras llamadas concurrentes ejecutó cinco ciclos
secuenciales completos. Con la ventana inicial de `1000 ms`, el resultado fue 5/5;
no hubo `423` ni `429`, y no se reintentó ningún `400`.

---

## 8. Lo que aún requiere evidencia semántica

El lifecycle ya está comprobado. Aún debe demostrarse por separado, sin inferirlo del
mero transporte:

- que el `planId` observado se correlacione con el subagente esperado en la traza
- que una conversación por Agent API ejecute `Crear_Escalamiento_Asesor` cuando
  corresponda y produzca Case + CaseComment + Log_Agente__c correlacionados

El cliente del servidor está escrito contra este contrato y **falla ruidosamente** si
la respuesta no encaja: nunca degrada a un texto inventado.
