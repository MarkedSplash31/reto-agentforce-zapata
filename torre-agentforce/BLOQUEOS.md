# Bloqueos — decisiones y pasos humanos pendientes

Última actualización: **7 de agosto de 2026**.

Nada de lo bloqueado se sustituye con un mock. «La petición llegó a una org real» no
convierte la semilla sintética en dato real de negocio; la proveniencia completa está
en `docs/DATOS-Y-PROVENIENCIA.md`.

## Lo que dejó de estar bloqueado el 7 de agosto de 2026

La conversación con el agente **funciona de punta a punta desde la web app**, con el
agente `Agente Postventa Zapata` **v18 activo** en la org y el proveedor de token
`client_credentials`. Dos corridas limpias consecutivas de `npm run verificar:e2e`
dieron **0 fallas, 0 avisos y 0 bloqueados**, releyendo cada folio de Salesforce.

Cinco causas raíz se encontraron y se corrigieron. Ninguna era la que se creía:

1. **La Agent API sí acepta el token de client_credentials directamente.** El 404
   histórico era de una clave de consumidor que no pertenecía a esta app, no del
   método. El rodeo por `/agentforce/bootstrap/nameduser` es el camino del CLI —
   local— y era justo lo que rompía la credencial buena: ese endpoint devuelve una
   página HTML de login cuando el token no trae scope `web`. Ver `auth.ts`.
2. **Ningún cliente podía agendar en Querétaro.** El catálogo guarda «Queretaro» sin
   acento y `SOQL LIKE` distingue el acento, así que el único taller con franjas
   verificadas resultaba inexistente para quien escribiera bien. Resuelto plegando
   acentos en `ZapataAgendaController`, que además devuelve el código canónico.
3. **El agente adivinaba el modelo de la unidad.** Con eso, la compuerta de cobertura
   del taller bloqueaba o dejaba pasar según lo inventado. Ahora se deriva del VIN
   contra el `Asset` registrado y el planner tiene prohibido llenar `modeloCodigo`.
4. **La correlación se perdía si el planner la escribía.** Sin mapeo declarativo llegó
   a guardar la palabra literal `RoutableId` y hasta UUIDs inventados. Las entradas de
   correlación vuelven a estar mapeadas a `@variables.RoutableId`; el detalle de las
   dos alternativas cerradas está en `agente.ts`.
5. **Una sesión de Agent API podía nacer inservible** y la visita se quedaba con una
   conversación muerta. Ahora se descarta y se abre otra una vez.

Además, cuatro defectos que nadie había mirado:

- la ruta pública de conversación devolvía **los comentarios internos** del expediente
  —los que Apex marca `IsPublished=false`, con Ids de Salesforce y huellas—;
- `keepAliveTimeout` en los 5 s de fábrica provocaba **ECONNRESET intermitentes**;
- la app **nunca cerraba las sesiones de Agentforce**. Se acumulaban y, pasadas unas
  cuantas, la org empezaba a rechazar las nuevas con 400. Los reintentos lo tapaban.
  Ahora hay `POST /publico/agente/cerrar` y el reintento del primer turno insiste
  sobre la misma sesión con esperas crecientes en vez de quemar una por intento;
- el saludo de apertura y las respuestas del agente viajaban **con el mismo nombre de
  evento** (`Inform`), así que desde fuera no había forma de distinguir lo que el
  agente contestó de lo que dijo al saludar. Ahora el saludo es `Bienvenida`.

Los dos primeros con prueba de regresión en
`tests/security/superficie-cliente.test.ts`.

### Un fallo de guardrail que sólo aparece preguntándole al agente por su fuente

Preguntado «¿de dónde sacaste eso y está verificado?» sin haber ejecutado antes la
búsqueda, el agente improvisaba: *«proviene de los sistemas oficiales de postventa de
Zapata … verificados por el equipo especializado»*. Es exactamente lo que su
instrucción le prohíbe afirmar, y no aparecía en ninguna prueba que sólo mirara
registros creados. Corregido en la v19 y fijado con la comprobación
`conocimiento · no presume una verificación que no le consta`.

## 0. Rotar la contraseña expuesta en el chat

**Severidad: crítica e inmediata. Bloquea publicación y aceptación de producción.**

El usuario informó que una contraseña apareció en el chat. No se copiará, repetirá,
probará, guardará ni transformará en ningún archivo. Tampoco se usará para completar
`.env` o un secret store.

El dueño de la credencial debe:

1. cambiarla inmediatamente en el proveedor de identidad autoritativo;
2. revocar sesiones y tokens vigentes asociados, no sólo cambiar el texto de la contraseña;
3. si se reutilizó en otro sistema, rotarla allí también con valores distintos;
4. reautenticar Salesforce CLI y Chrome **después** de la rotación;
5. revisar el chat, historial de terminal, logs y gestores de secretos para confirmar
   que nadie la copió a otra superficie; si existe una copia, retirarla según la
   política de la plataforma sin volver a pegar el valor;
6. confirmar sólo «rotación y reautenticación completadas», nunca la contraseña nueva.

Durante esta auditoría se usaron las sesiones OAuth de CLI y Chrome que ya estaban
abiertas; la contraseña expuesta no se probó ni se usó. Por ello los Ids y resultados
obtenidos demuestran efectos técnicos en la org, pero siguen siendo evidencia
**provisional** hasta rotar la contraseña, revocar las sesiones y repetir los gates
críticos con una sesión limpia. No se hizo publicación cloud.

## 1. Credenciales locales y lifecycle de Agent API — RESUELTO

**Estado al 7 de agosto de 2026: el criterio de salida se cumplió.**

`npm run verificar:agent-api` termina en **VERDE** contra la org: obtiene token, abre
sesión, manda un mensaje en streaming, manda uno síncrono y cierra confirmando
`SessionEnded`. Evidencia sanitizada en `evidencia/01-agent-api/`.

El par consumidor está custodiado sólo en `.env` local, que está en `.gitignore`. Lo
que queda por hacer sigue siendo humano y de despliegue: inyectarlo en el almacén de
secretos del hosting (§6), nunca versionarlo.

Lo que sigue describe el estado histórico y las vías que se descartaron; se conserva
porque explica por qué el diagnóstico costó tanto.

### Hechos confirmados

- La External Client App **`Torre Agentforce Zapata` ya existe y está activa**.
- Tiene los cuatro scopes oficiales: `api`, `refresh_token/offline_access`,
  `chatbot_api` y `sfap_api`.
- Tiene habilitados client credentials y emisión JWT para usuarios nombrados.
- Su usuario **Run As** es `EinsteinServiceAgent`, con API habilitada.
- El token del Salesforce CLI sí ejecuta SOQL/REST contra la org.
- Antes de crear la ECA, Agent API respondió HTTP 404 con cuerpo vacío con agent id
  real, id distinto, token CLI, token inválido y sin header; TLS/DNS funcionaron. Es
  evidencia histórica, no el resultado del flujo client credentials actual.

La creación/configuración de la ECA **ya no es un bloqueo**. Falta custodiar sus
credenciales fuera del chat y ejecutar el lifecycle completo. El 404 histórico no
demostró una causa raíz única; si reaparece con un token de esta ECA, se debe revisar
tipo/activación/licenciamiento del agente y escalar a Salesforce.

El agente `Agente Postventa Zapata` **v10 está activo** y pasó la validación de
activación. Esto elimina la versión del agente como bloqueo, pero no demuestra el
lifecycle de Agent API sin un token emitido para la ECA.

### Pasos humanos indispensables

Basados en la guía oficial vigente:
[Get Started with the Agent API](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-api-get-started.html).

1. Completar primero la rotación y reautenticación de §0.
2. En **Configuración → External Client Apps → Torre Agentforce Zapata → Clave y
   secreto de consumidor**, revelar el par sólo en la sesión reautenticada.
3. Pegarlo localmente en `.env` o en el secret store aprobado como `SF_CLIENT_ID` y
   `SF_CLIENT_SECRET`. No pegarlo en chat, ticket, evidencia, historial de terminal ni
   repo.
4. Ejecutar el lifecycle de Agent API y conservar únicamente evidencia sanitizada.

La configuración no secreta de la ECA quedó recuperada al proyecto DX y pasó
check-only (`0AfgK00000PdvHoSAJ`). La metadata global que contiene el consumer key se
excluyó deliberadamente del repo; la reproducibilidad no justifica versionar una
credencial.

### Criterio de salida

```bash
npm run verificar:agent-api
```

Debe obtener token, abrir sesión, mandar un mensaje y cerrar la sesión. Sólo se puede
marcar verde con respuesta exitosa y evidencia sanitizada; el contrato local o un
servidor loopback no sustituyen esta prueba.

## 2. OIDC corporativo implementado; faltan callback y scope externos

**Severidad: bloqueante para publicar con identidad corporativa.**

El BFF OIDC ya implementa Authorization Code + PKCE, validación RS256/JWKS,
issuer/audience/nonce, sesión opaca, cookie `HttpOnly`/`Secure`/`SameSite=Lax`,
Origin+CSRF, rotación y logout. El rol y los bindings se leen desde la org; el
navegador no los elige. `APP_AUTH_PROVIDER=static` sólo funciona como QA explícito y
no se consulta cuando el proveedor es `oidc`.

Pasos humanos exactos antes del deploy:

1. crear el servicio de hosting y copiar su origin HTTPS real en
   `APP_EXTERNAL_ORIGIN`;
2. registrar exactamente `<APP_EXTERNAL_ORIGIN>/auth/salesforce/callback` en la
   External Client App y copiar esa URL en `APP_OIDC_CALLBACK_URL`;
3. agregar el scope `openid` junto con `api`, `refresh_token`, `chatbot_api` y
   `sfap_api`; no declarar el gate verde hasta confirmar la configuración externa;
4. mantener `Torre_Agentforce_Admin` asignado sólo a Gabriel y asignar
   `Torre_Agentforce_Asesor` únicamente a cada asesor autorizado;
5. inyectar `SF_CLIENT_ID` y `SF_CLIENT_SECRET` en el secret store y ejecutar login,
   `/auth/session`, refresh, logout y una operación RBAC contra el dominio publicado.

El issuer real confirmado por discovery es
`https://orgfarm-1c6625ec2e-dev-ed.develop.my.salesforce.com`. El servidor falla al
arrancar si faltan callback, origin, `openid`, mapeos o secretos; no cae a Bearer.

## 3. Messaging for In-App and Web no existe

**Severidad: media. No bloquea la alternativa `Case` + `CaseComment`.**

La org tiene 0 `MessagingChannel` y 0 `EmbeddedServiceConfig`; además la acción
La versión activa del agente usa la acción Apex `Crear_Escalamiento_Asesor`; la Torre
usa la misma cola `Escalamiento_Postventa`, relee `Case`/`CaseComment` y correlaciona
el log. Es una escritura **SF-O** en la Developer Edition, no Messaging y no evidencia
de que un asesor real atendió.

Habilitar Messaging sólo es indispensable si el alcance exige ese canal específico.
En ese caso hacen falta canal, despliegue web, routing, presencia, permisos y licencia;
no se deben crear como efecto colateral de esta app.

## 4. El Permission Set de asesor aún no está asignado

**Severidad: alta para auditoría de producción.**

`Torre_Agentforce_Asesor` existe pero no tiene asignaciones. OIDC autentica individuos,
pero nadie obtiene rol `asesor` hasta que un administrador asigne ese Permission Set.

Después de asignarlo, el BFF podrá probar qué usuario abrió la sesión y qué rol tiene.
Las escrituras CRM actuales siguen ejecutándose con la credencial de servicio, por lo
que `CaseComment.CreatedById` será el usuario integrador. Si la auditoría exige que el
autor Salesforce sea el asesor humano, esa escritura debe migrarse al access token
named-user y validarse con permisos mínimos antes de retirar este bloqueo.

## 5. Datos ausentes o sintéticos

**Severidad: alta para cualquier afirmación de negocio.**

| Dataset/campo | Clasificación | Consecuencia |
|---|---|---|
| `Asset`, cuentas, VIN, odómetros | **GEN** semilla | No representan flota ni clientes reales |
| `Regla_Cobertura__c`, `Parametros_Garantia__c` | **GEN** | No son póliza real de Zapata |
| `Sucursal__c` dirección/horario/teléfono | **WEB** | Observación pública con fecha; no confirmación interna |
| `Modelo_Sucursal__c` y capacidad | **GEN/asumido** | No se conoce qué atiende ni cuántos cupos tiene cada taller |
| `Slot_Taller__c` horario | **WEB+GEN**; al 7-ago-2026, 673 `SITIO_WEB_CAPACIDAD_ASUMIDA` y 56 `OPERACIONAL_VERIFICADO`, todas las verificadas en FL-QRO | Sólo Querétaro puede ofrecer cupo; los demás talleres devuelven `SLOTS_NO_VERIFICADOS`, que es la respuesta correcta |
| `Capacidad_Total__c` | **GEN/asumido** | 3 entre semana y 2 sábado, sin fuente interna |
| `Lectura_Odometro__c` | 1 registro **GEN** | No existe una serie histórica utilizable |
| `Account.RFC__c`, `Ultimos_4_Telefono__c` | vacíos | No hay segundo factor para verificar unidad |
| `Sesion_Diagnostico__c` | 0 filas | No hay historial de diagnóstico guiado |
| `Asset` | 15/15 `SEED_SINTETICO_NO_VERIFICADO`; 14/15 con `Unidad_Verificada__c=true` desde una carga posterior | Ninguno puede presentarse como unidad real de un cliente, aunque la bandera de verificación esté puesta |
| `Asset.Product2Id` | 6/15 reapuntados el 7-ago-2026 al modelo que indica su propio VIN | Corrige una contradicción interna de la semilla, no la vuelve real. Ver §7 |

Los registros creados por Flows, incluidos `WorkOrder`, `Unidad_Varada__c`, `Case`,
`CaseComment` y `Log_Agente__c`, sí son efectos **SF-O** reales en la org, pero sus
escenarios y sujetos son sintéticos. Ver detalle campo por campo en
`docs/DATOS-Y-PROVENIENCIA.md`.

## 6. Despliegue production-grade incompleto

**Severidad: alta. El contenedor es reproducible; la operación de producción no está lista.**

Ya existen `Dockerfile`, `.dockerignore`, `render.yaml` y el runbook
`docs/DESPLIEGUE.md`. Faltan estas salidas:

- §1: credenciales ECA custodiadas y lifecycle verificado;
- §2: aceptación o sustitución del proveedor de tokens estáticos;
- `/api/admin/salud` con `ok=true`, consultado con rol admin;
- decisión de una sola réplica o afinidad/estado compartido para sesiones en memoria;
- métricas/alertas suficientes y prueba de rollback;
- aprobación humana del plan de hosting y cualquier costo.

La app debe tener egress HTTPS al My Domain y `api.salesforce.com`. `SF_LOGIN_URL`
usa el My Domain, no `login.salesforce.com`. El proveedor `cli` es sólo local: la
imagen de producción no lleva el Salesforce CLI.

## 7. Cobertura por unidad: la contradicción del catálogo, resuelta a medias

**Severidad: alta para la pantalla Cobertura. El defecto (2) se corrigió; el (1) sigue
siendo una decisión de negocio y no se toca.**

Hay dos defectos distintos:

1. Las 36 reglas activas vienen del artículo sintético del equipo, versión
   `v1.0-sintetica`; no son la póliza real de Zapata. **Sigue abierto**: cargar la
   póliza confirmada es una decisión de negocio y legal, no de ingeniería.
2. Los 15 Asset sintéticos apuntaban a `Tractocamion Clase 8 - Serie T680`, mientras
   los talleres declaran cobertura de cuatro familias Freightliner. La intersección
   era vacía, así que **ninguna unidad podía agendar en ningún taller**.
   **Corregido el 7-ago-2026** con `scripts/corregir-semilla-modelos.mjs`: seis de
   esas unidades tienen WMI Freightliner en su propio VIN (`1FUJ…`, `3AKJ…`), o sea
   que la semilla se contradecía a sí misma, y se reapuntaron al modelo que su número
   de serie indica. Las otras nueve —WMI Hino, Kenworth y Volvo— se dejaron intactas
   a propósito: que un taller Freightliner responda `MODELO_NO_ATENDIDO` ante ellas es
   una respuesta correcta y conviene poder demostrarla. Nada cambió de procedencia:
   las quince siguen siendo `SEED_SINTETICO_NO_VERIFICADO`. Esto vuelve la semilla
   coherente, no la vuelve real.

La pantalla puede demostrar que el software detecta una contradicción de **modelo de
demo** y un catálogo sin regla aplicable. No puede demostrar cobertura real de una
unidad ni una contradicción de política real de Zapata.

La salida correcta requiere dos decisiones humanas independientes:

- reemplazar la semilla por una flota sintética coherente o por datos autorizados;
- cargar pólizas confirmadas por negocio/legal, con versión y fuente citable.

No se debe «arreglar» reapuntando unidades o inventando reglas sólo para poner la
pantalla en verde. Hasta recibir ambos insumos, el estado debe permanecer
`SIN_REGLA_PARA_EL_MODELO`/`REQUIERE_DATO` y mostrar la etiqueta **sintético**.

---

## 8. El par consumidor de la ECA — RESUELTO

**Estado al 7 de agosto de 2026: la conversación y los cuatro subagentes funcionan.**

El par consumidor está cargado y sirve. Y el diagnóstico de esta sección resultó
equivocado en su conclusión principal: el problema no era sólo *tener* el secreto,
sino que el servidor mandaba ese token por el camino del CLI. La Agent API lo acepta
**directamente** en `Authorization: Bearer` — comprobado con HTTP 200 y `sessionId`
real contra `api.salesforce.com`.

Las cinco vías «descartadas» que se listan abajo siguen siendo ciertas como hechos,
pero la conclusión que se sacó de ellas —«el secreto sólo se obtiene revelándolo en
Setup, y sin él no hay conversación»— escondía que, una vez revelado, faltaba además
dejar de canjearlo por un JWT que no le correspondía.

Lo que sigue se conserva como registro de lo que se probó.

### Estado

La External Client App `Torre Agentforce Zapata` **está bien configurada**, verificado
recuperando su metadata el 6 de agosto de 2026:

| Ajuste | Valor en la org |
|---|---|
| `isClientCredentialsFlowEnabled` | `true` |
| `clientCredentialsFlowUser` | `agente_postventa_zapata@…` |
| `commaSeparatedOauthScopes` | `Api, RefreshToken, Chatbot, SFApiPlatform` |
| `isConsumerSecretOptional` | `true` |
| `ipRelaxationPolicyType` | `Enforce` |

No falta configuración. Falta **el valor** de la clave y el secreto.

### El par que se probó no es de esta app

Comparando carácter por carácter contra el `consumerKey` recuperado de la org:
**57 de 85 caracteres difieren**; sólo coinciden los primeros 27, que son el prefijo
`3MVG9…` que comparten todas las claves de Salesforce. No es un error de tecleo: es la
clave de otra aplicación o de otra org. El endpoint de token responde en consecuencia:

```
HTTP 400  {"error":"invalid_client_id","error_description":"client identifier invalid"}
```

### Cinco vías descartadas con evidencia

Para que nadie repita el camino:

1. **Token del CLI (`PlatformCLI`)** → `HTTP 404` con cuerpo vacío en la Agent API.
   Reprobado el 6 de agosto, ya con la ECA creada: el gateway sigue sin enrutarlo.

   > **Corregido el 11 de agosto de 2026: esta conclusión era falsa.** Clonando el
   > repositorio en limpio, **sin `.env` y sin ningún secreto**, con
   > `SF_TOKEN_PROVIDER=cli` el agente abrió sesión y contestó en español a varias
   > preguntas seguidas. La Agent API se alcanza con el JWT de
   > `/agentforce/bootstrap/nameduser`, que se obtiene de cualquier sesión válida de la
   > org: es lo mismo que hace `sf agent preview` por dentro. El 404 de agosto venía de
   > mandar el token por una ruta que no correspondía, no del token.
   >
   > Consecuencia práctica: **para ver el reto funcionando no hace falta el par
   > consumidor.** Basta `sf org login web --alias zapata`. El secreto sigue siendo
   > indispensable donde no hay CLI —el contenedor de producción no lo lleva—, y ahí el
   > proveedor es `client_credentials`.
2. **Metadata de la ECA** → `ExtlClntAppGlobalOauthSettings` trae `consumerKey` pero
   **no** `consumerSecret`. Salesforce no lo exporta.
3. **Tooling API** → `ConnectedApplication` devuelve 0 filas y su describe no expone
   ningún campo de credencial.
4. **Flujo de código de autorización** → `isCodeCredFlowEnabled: false` en esta app.
5. **JWT de usuario nombrado** → habilitado, pero exigiría subir un certificado a la
   app; más pasos humanos que revelar el secreto.

**Conclusión: el secreto sólo se obtiene revelándolo en Setup.** No hay ruta técnica
que lo evite, y por política tampoco se transcribe en el chat, en un log ni en el repo.

### El paso humano, exacto

Confirmar arriba a la derecha que la org es `zapatacompany` —una clave de otra org da
exactamente este error— y entrar a:

**Configuración → Aplicaciones → Aplicaciones de cliente externas →
`Torre Agentforce Zapata` → Configuración → API → Clave y secreto de consumidor →
Revelar**

```powershell
$env:SF_CLIENT_ID     = "<clave revelada>"
$env:SF_CLIENT_SECRET = "<secreto revelado>"
npm run verificar:credencial     # compara contra la org sin imprimir los valores
npm run sitio
$env:CONFIRM_E2E_MUTACIONES = "1"
npm run verificar:e2e            # ejercita los 4 subagentes y relee Salesforce
```

Si aparece un error distinto de `invalid_client_id`, el siguiente sospechoso es
`ipRelaxationPolicyType: Enforce`: hay que relajar la restricción de IP en las
políticas de la app.

### Qué queda probado mientras tanto

`npm run verificar:e2e` con el proveedor `cli` da **0 fallas** y 5 pasos bloqueados.
Lo verde está releído de Salesforce, no supuesto:

- sesión de cliente sin cuenta, con su folio de visita
- 9 talleres reales del catálogo
- escalamiento: Case `00001065`, origen `Agentforce`, cola *Escalamiento Postventa*
- el folio de la visita **coincide** con el `Correlation_Id__c` del caso
- 5 mensajes de contexto en el expediente del asesor
- traza `LOG-00000172`, subagente Escalamiento, resultado SUCCESS

Es decir: **la cadena de la web app a Zapata Postventa está probada.** Lo único sin
ejercitar es la puerta conversacional.

---

## 9. La cuota diaria de API de la org — se libera sola, pero hay que reconocerla

**Estado: activo el 11 de agosto de 2026.** No es un defecto del código y no se
arregla desde el repositorio: la Developer Edition tiene un tope de llamadas a la
API REST por ventana de 24 horas, y esta org lo agotó.

### Cómo se ve

`sf org display -o zapata` lo dice en `connectedStatus`:

```
"connectedStatus": "TotalRequests Limit exceeded."
```

Cualquier consulta responde igual:

```
REQUEST_LIMIT_EXCEEDED: TotalRequests Limit exceeded.
```

En la web app se traduce a **HTTP 503 `CUOTA_API_AGOTADA`** y la portada lo pinta
con su causa. Antes salía como 502 «no fue posible completar la operación con el
servicio externo» —o, si el tope llegaba pidiendo el token, como 503 «credencial
no válida», que mandaba a revisar secretos que estaban bien—.

### Qué deja de funcionar y qué no

La cuota es de la **API REST**. La Agent API entra por otra puerta y no la consume:

| Sigue funcionando | Devuelve 503 mientras dure |
|---|---|
| La conversación con el asistente | La red de talleres (`/publico/sucursales`) |
| Agendar, reprogramar, reportar varada | La cobertura por VIN (`/publico/garantia`) |
| El escalamiento a un asesor | La disponibilidad (`/publico/disponibilidad`) |

Comprobado con la org en su tope: la cita **00000070** se creó desde la web app
—mantenimiento, viernes 14 de agosto, Querétaro— mientras el catálogo de talleres
respondía 503.

### Efecto en las pruebas

Con la cuota agotada, dos aserciones de `tests/e2e/sitio-cliente.spec.ts` fallan
**correctamente**: la red de talleres no carga, y eso es justo lo que comprueban.
No hay que tocarlas; es la señal de que la org no está respondiendo, no un defecto
que corregir.

### Qué la consume

Cada carga de la portada abre una sesión real del agente —decisión deliberada,
documentada en `rutas-publicas.ts`, para no cobrarle al cliente la propagación en
su primer mensaje— y `verificar:e2e`, `verificar:diseno` y la suite de Playwright
consultan la org de verdad. Recargar la página muchas veces mientras se trabaja en
el frontend cuesta cuota.

Ninguna comprobación de la interfaz es gratis del todo: cargar `/` abre una sesión
del agente, así que `verificar:diseno` y las pruebas de Playwright también cuestan.
Lo que sí evita gasto de más son las dos pruebas de layout de
`sitio-cliente.spec.ts`, que abortan la ruta del turno a propósito para no consumir
una conversación por corrida, y trabajar sobre una pestaña ya abierta en vez de
recargar.

`npm run verificar:diseno` corre en cualquier clon: el auditor viene dentro del
repositorio, en `scripts/auditar-sistema.mjs`. Antes se buscaba en la skill
`zapata-design`, fuera del repositorio, y el comando sólo funcionaba en la máquina
donde esa skill existe. Necesita los navegadores de Playwright una vez:
`npm run test:e2e:install`.

---

## 10. Las acciones de CONSULTA del agente no dejan traza, y por eso la pantalla no reacciona

**Estado: abierto el 11 de agosto de 2026.** No se puede cerrar desde este
repositorio: es un cambio en la org y hoy la cuota diaria de API está agotada.

### El síntoma

Un cliente pide horarios y el agente se los **dicta**:

```
1. Jueves 13 de agosto de 09:00 a 11:00 — Garantía
2. Jueves 13 de agosto de 11:00 a 13:00 — Reparación mayor
…
Por favor indícame el número de la opción que prefieres.
```

Contestar «el 5» no es escoger una cita: es deletrearla. Lo mismo al preguntar por
material de apoyo — la respuesta llega en prosa y la plataforma no enseña nada.

### La causa

El escenario reacciona a `Log_Agente__c`, que es la única fuente autoritativa de lo
que el agente ejecutó: la Agent API entrega `message.result` vacío por contrato.
Pero **sólo escriben esa traza los tres Flows de escritura y `EscalarAsesorHumano`**.

| Acción | ¿Escribe `Log_Agente__c`? |
|---|---|
| `Crear_Orden_Servicio` | sí |
| `Crear_Reporte_Unidad_Varada` | sí |
| `Reprogramar_Orden_Servicio` | sí |
| `Escalar_Asesor_Humano` | sí |
| `Consultar_disponibilidad` (`ZapataAgendaController`) | **no** |
| `Buscar_Conocimiento` (`BuscarConocimientoPostventa`) | **no** |

Cuando el agente sólo consulta, el servidor no tiene nada que releer, así que no
emite `Actividad` y la interfaz no se entera. La conversación se queda con todo.

### El cambio

Que las dos acciones de consulta registren su ejecución en `Log_Agente__c` con el
`Correlation_Id__c` de la conversación, igual que hacen las de escritura. El
permission set del agente ya tiene creación sobre el objeto, así que no hace falta
tocar permisos.

El lado de la aplicación **ya está listo**: `inicio.js` abre el calendario cuando la
traza reporta una consulta de disponibilidad, y el material de apoyo cuando reporta
una de conocimiento. Hasta que la org las registre, ese código queda inerte y las
dos capacidades se abren sólo cuando el cliente las pide.

### El síntoma está resuelto; la traza sigue incompleta

**La lista dictada ya no ocurre.** El servidor comprueba contra el catálogo real si
el cliente nombró un taller —`sucursalMencionada`, mismo criterio que el que detecta
un número de serie: un HECHO contra la org, no una intención adivinada— y emite un
evento `Capacidad`. La pantalla abre la agenda de ESE taller, cargada, con sus
franjas y sus tipos de servicio.

Verificado tecleando en el sitio contra la org: a «Quiero agendar un servicio en el
taller de Querétaro para mi unidad», el agente pide el VIN en la conversación y el
calendario de Querétaro aparece con 31 franjas y cinco tipos de servicio, sin que el
cliente lo pida. `tests/sucursal-mencionada.test.ts` fija los límites de la
detección, incluidos los dos falsos positivos que encontró: «Leonardo» no nombra el
taller de León, y `FL-GDLRM` no puede resolverse como `FL-GDL`, que es prefijo suyo
y designa otro taller.

Las tres capacidades siguen además a un clic desde la portada y desde el espacio de
trabajo, sin depender del agente.

**Lo que sigue abierto es la auditoría, no la experiencia.** El expediente que ve el
asesor enseña lo que el agente ESCRIBIÓ —órdenes, reportes, casos, con su subagente
y su resultado— pero no lo que consultó, porque esas dos acciones no dejan traza.
Cerrarlo exige tocar el bundle del agente: añadir la entrada de correlación a las
dos acciones, regenerar los esquemas de sus GenAiFunction —que no se regeneran si
sólo cambian los `.json`, hay que tocar también el `.genAiFunction-meta.xml`— y
republicar y activar una versión nueva. No se hizo en la misma sesión en la que el
agente está atendiendo citas reales: republicarlo tiene precedentes de costar horas
en este proyecto, y la experiencia que motivaba el cambio ya no depende de él.

---

## 11. El agente pierde a veces las respuestas de seguridad de una unidad varada

**Estado: abierto el 12 de agosto de 2026.** Es del agente, no de la aplicación, y no
se puede cerrar desde este repositorio.

### Lo observado

El mismo guion, tecleado en el sitio dos veces con las mismas palabras:

| Reporte | Fuera del carril | Intermitentes |
|---|---|---|
| `VAR-000063` | true | true |
| `VAR-000064` | **false** | **false** |

En las dos corridas el cliente dijo, literalmente, *«Sí, está fuera del carril de
circulación y con las intermitentes encendidas»*, y en las dos el asistente confirmó
en pantalla el protocolo de seguridad antes de registrar. En la segunda, el Flow
recibió los dos campos en falso.

Es el defecto más peligroso encontrado: quien lee el reporte para mandar auxilio ve
una unidad que **no** está fuera del carril y **sin** intermitentes. La consecuencia
no es una pantalla fea.

### Lo que se hizo mientras tanto

No se puede arreglar desde la web app —el valor lo manda el agente al Flow—, pero sí
se puede dejar de perder en silencio:

- la tarjeta del cliente muestra ahora **cómo quedaron registradas** las dos
  respuestas, y cuando alguna está en «No» le dice que lo corrija ahí mismo, porque
  es lo que verá quien vaya a auxiliarlo;
- el expediente del asesor las muestra también, antes de despachar.

El único que sabe la verdad es quien está parado en la carretera. Enseñárselo es lo
que convierte una pérdida silenciosa en algo corregible.

### Lo que falta

Que la acción del agente conserve las dos respuestas. Vive en el bundle
`Agente_Postventa_Zapata` y en las entradas del Flow `Crear_Reporte_Unidad_Varada`;
exige republicar y activar una versión nueva del agente.

---

## 12. La póliza cubre sistemas que ninguna agencia declara atender

**Estado: abierto el 12 de agosto de 2026.** Es un hueco de DATOS en la organización;
la aplicación ya lo esquiva, pero conviene cerrarlo en la org.

### La asimetría

| Sistemas con regla de cobertura | ¿Alguna sucursal lo declara? |
|---|---|
| Tren motriz · Cabina · Frenos · Refrigeracion · General | sí, las nueve |
| **Electrico y electronica** | **no, ninguna** |
| **Chasis y estructura** | **no, ninguna** |
| **Corrosion** | **no, ninguna** |

`Modelo_Sucursal__c` tiene 180 filas —9 sucursales × 4 modelos × 5 sistemas— y su
picklist `Sistemas_Soportados__c` no incluye los tres de arriba. `Regla_Cobertura__c`
sí los cubre: eléctrico a 24 meses / 200,000 km en los cuatro modelos.

### Lo que provoca

La compuerta de `ZapataAgendaController` cruza modelo **y sistema**. Con una falla
eléctrica, el agente puede contestar —y contestó, tecleando en el sitio—:

> El taller Zapata Camiones Querétaro no atiende el modelo Freightliner Cascadia
> para fallas eléctricas.

Es **falso**: Querétaro tiene cinco filas activas para ese modelo. Lo que no existe es
una fila para el sistema eléctrico. Un cliente que se cree esa frase entiende que su
camión no se atiende en ningún lado, y como ninguna de las nueve declara ese sistema,
buscar otro taller tampoco lo resolvería.

No es determinista: la misma frase, cuatro corridas, dio dos veces horarios y una vez
la negación.

### Lo que hace la aplicación mientras tanto

- La agenda de la página **no cruza sistema**, sólo modelo y sucursal —que es la
  compuerta que el Flow respeta—, así que la cita eléctrica sí se puede apartar.
  Comprobado: órdenes 00000074, 00000076 y 00000078, todas por falla eléctrica.
- Cuando el cliente nombra un taller y dicta su número de serie, el servidor comprueba
  contra la org si ese taller atiende su modelo y la pantalla lo afirma: *«Comprobado
  en el sistema de Zapata: Querétaro sí atiende el modelo de tu unidad»*. Así una
  negación equivocada del agente no queda como última palabra.

### Lo que falta

Decidir en la organización si las nueve sucursales atienden eléctrico, chasis y
corrosión y, en su caso, dar de alta esas filas. No se hizo desde aquí: afirmar que
un taller presta un servicio es un hecho operativo del negocio, no algo que se pueda
deducir de que la póliza lo cubra.

---

## 13. El calendario de la agenda caduca el 20 de agosto de 2026

**Impacto: alto, con fecha.** No es un defecto: es que la semilla se acaba.

Las 729 franjas de `Slot_Taller__c` van del 31 de julio al **20 de agosto de 2026**.
Pasado ese día, `Consultar_disponibilidad_de_taller` no devuelve nada, el agente
contesta con verdad que no tiene horarios, y **cualquier demostración que agende una
cita deja de existir**. La escena que el guion del video prohíbe recortar es
precisamente esa.

Dos consecuencias más, ya visibles hoy:

- De las nueve sucursales, sólo **FL-QRO** tiene franjas apartables a futuro. Las otras
  ocho traen horarios cuya capacidad nadie confirmó (`SITIO_WEB_CAPACIDAD_ASUMIDA`), y
  la aplicación los enseña atenuados diciendo por qué.
- «El sábado» sólo cae dentro del calendario el **15 de agosto**. Ese día Querétaro
  tiene 09:00, 11:00 y 13:00 y no tiene las 8:00 — que es lo que hace funcionar la
  corrección del guion.

### Lo que hay para resolverlo

`scripts/extender-agenda.mjs` copia hacia adelante el patrón semanal que cada sucursal
ya tiene: mismos días, mismas horas, mismos tipos de servicio, misma capacidad. Con
`--ver` enseña qué haría sin escribir. Las franjas nuevas nacen como capacidad
**asumida**, no reservable: para que sean apartables hay que declararlo con
`CONFIRM_AGENDA_VERIFICADA=1`.

Esa distinción es deliberada y es la misma de §12: afirmar que un taller abre a una
hora es un hecho operativo del negocio, y un script no puede comprobarlo. **No se ha
ejecutado**: la decisión es de quien conoce la operación.

---

## 14. La traza no lleva kilometraje ni versión de política

**Impacto: medio.** El dato existe como campo y casi nunca se puebla.

`Log_Agente__c` tiene 341 registros. **2 traen `Odometer_Used__c` y 5 traen
`Policy_Version__c`.** Los Flows escriben la traza sin esos dos valores en la ruta
normal.

Importa porque la ficha técnica y el guion del video los nombran como parte de lo que
la traza demuestra. Enseñar la lista mientras se afirma que ahí está el kilometraje y
la versión de la póliza es enseñar dos columnas vacías.

Lo que sí está poblado en todos: `Correlation_Id__c`, `Subagent__c`, `Action_Name__c`,
`Outcome__c` y `Related_Record_Id__c`. Y `Guardrail_Triggered__c` en 41,
`Unit_Verified__c` en 82.

La corrección es en los Flows, no en la aplicación: pasar el odómetro leído y la
versión de la regla aplicada a `Registrar_Log_Agente` en las rutas de éxito. Mientras
tanto, `docs/GUION-RODAJE.md` lleva la narración corregida para no afirmar de más.

---

## 15. El agente ofrece citas que el Flow después rechaza

**Impacto: alto.** Es el defecto que aparece en cuanto el cliente nombra un taller que
no sea Querétaro, y hoy son ocho de nueve.

Tres piezas no dicen lo mismo sobre la misma franja:

| Pieza | Qué hace con una franja `SITIO_WEB_CAPACIDAD_ASUMIDA` |
|---|---|
| La aplicación (`/publico/disponibilidad`, agenda) | no la ofrece; atenúa el taller y explica por qué |
| `ZapataAgendaController` desplegado | **sí la ofrece**, etiquetada «(sujeto a confirmacion del taller)» |
| Flow `Crear_Orden_Servicio` | **la rechaza**: `SLOT_NO_VERIFICADO` |

El Apex se cambió el 11 de agosto para no bloquear ocho sucursales enteras: su
comentario lo explica —el sitio de Zapata publica horarios y la cita se *solicita*, no
se reserva—. Es una decisión razonable. Lo que no se cambió fue el Flow, que sigue
exigiendo procedencia acreditada.

Y entre medias está el modelo. Tecleando en el sitio, pidiendo cita en Aeropuerto para
el VIN `3AKJHHDR4RS567893`, el agente contestó:

> Estas son las opciones disponibles para agendar tu servicio en Zapata Camiones
> Aeropuerto: 1. Jueves 13 de agosto de 13:00 a 15:00 — Diagnóstico […]

Diez opciones, **sin una sola salvedad**: la etiqueta que el Apex devuelve se le perdió
al redactar. Las diez son franjas reales de ese taller, y las diez son
`SITIO_WEB_CAPACIDAD_ASUMIDA`. Elegir cualquiera devuelve:

```
{"ok":false,"bloqueado":true,"motivo":"SLOT_NO_VERIFICADO",
 "mensaje":"La franja tiene procedencia SITIO_WEB_CAPACIDAD_ASUMIDA; su capacidad no
 está verificada operacionalmente y no puede reservarse."}
```

### Lo que hace la aplicación mientras tanto

Nada nuevo: ya lo hacía. Cuando el cliente nombra un taller, la agenda de la pantalla
se abre en ése y, si ninguna franja es apartable, lo dice —«Este taller tiene horarios
en el catálogo, pero su capacidad no está confirmada con el taller, así que no se
pueden apartar desde aquí»— con salida de un toque al que sí puede. Se comprobó en el
navegador durante esta revisión: mientras el agente listaba diez horarios de
Aeropuerto, la pantalla de al lado los desmentía. Se llegó a escribir un segundo aviso
desde el servidor y se retiró por redundante.

### Lo que falta, y es de la organización

Alinear las dos piezas, en cualquiera de los dos sentidos:

- que el Apex vuelva a filtrar `Procedencia__c = 'OPERACIONAL_VERIFICADO'` —vuelve el
  callejón de ocho sucursales—, o
- que `Crear_Orden_Servicio` acepte una franja no verificada creando la orden como
  **solicitud** en un estado propio, que es lo que el comentario del Apex describe.

La segunda es la que sostiene la intención del cambio. No se decide desde aquí: cambia
lo que Zapata le promete a un cliente al confirmar una cita.

---

## 16. El agente ofrece buscar «otro taller» para un modelo que ninguno atiende

**Impacto: medio.** Se ve con cualquier T680, que son 9 de las 15 unidades de la org.

`ZapataAgendaController` responde a la compuerta de modelo con:

> El taller {taller} no da servicio a ese modelo. Puedo buscarte otro taller que si lo
> atienda.

Y el agente lo repite: *«¿Te gustaría que busque disponibilidad en otro taller cercano
que sí pueda atender tu camión?»*. Comprobado tecleando en el sitio con el VIN
`3HAMMAAR8LL123456`.

La segunda frase es falsa para T680: **ninguna de las nueve sucursales lo declara** en
`Modelo_Sucursal__c`, que sólo tiene filas para FL-114SD, FL-360, FL-CASCADIA y FL-M2.
El cliente acepta la búsqueda y acaba probando taller por taller hasta rendirse.

La corrección es de una línea en el Apex: antes de ofrecer, contar en cuántas
sucursales activas aparece ese modelo, y si son cero decirlo —«ninguno de nuestros
talleres tiene ese modelo dado de alta; te paso con un asesor»— en vez de prometer una
búsqueda que no puede terminar bien. No se toca desde aquí por lo mismo que §12: qué
modelos atiende la red es un hecho operativo del negocio.
