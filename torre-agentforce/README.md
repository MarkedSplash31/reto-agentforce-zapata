# Postventa Zapata — sitio de clientes con agente

Extensión web de postventa de Corporación Zapata **para sus clientes**: el dueño o el
operador de una unidad entra, conversa con el Agente Postventa y resuelve lo que
necesita. No es una consola para el equipo técnico de Zapata; esa vista ya existe
dentro de Salesforce.

El agente es el protagonista: según lo que el cliente cuenta, la conversación lo
lleva a la sección que le sirve. Y todo lo que hace tiene efecto real en Salesforce.

| Lo que el cliente hace | Lo que ocurre en Salesforce |
|---|---|
| Conversa con el agente | Sesión de Agent API bajo un folio propio de la visita |
| Agenda servicio en taller | Se crea su cita y se ocupa el lugar en la agenda del taller |
| Reporta una unidad varada | Se levanta el reporte de asistencia en carretera |
| Consulta su garantía | Se evalúa su unidad contra la póliza de su modelo |
| Pide hablar con una persona | Se abre su caso en la cola de postventa, con la conversación completa |

Un solo identificador —el de la visita— amarra la primera pregunta del cliente con el
caso que termina atendiendo un asesor. Es el mismo valor que viaja como
`$Context.RoutableId` al agente y que queda en la traza.

## Quién entra y cómo

- **Clientes: sin cuenta.** Como en cualquier sitio público. El servidor emite una
  sesión de visitante en cookie HttpOnly; el alcance de lo que puede leer o escribir
  vive en esa sesión, nunca en lo que mande el navegador.
- **Asesores: un acceso.** `acceso.html` con el usuario y la contraseña de
  `APP_ADMIN_USER` / `APP_ADMIN_PASS`. Sin esa variable el acceso queda cerrado y lo
  dice, en vez de abrirse con un valor por omisión.

## Páginas

| Ruta | Para quién | Qué resuelve |
|---|---|---|
| `/index.html` | cliente | Inicio con el agente y los accesos a cada servicio |
| `/taller.html` | cliente | Agendar cita sobre la disponibilidad real de la red |
| `/carretera.html` | cliente | Reportar una unidad detenida; la seguridad va primero |
| `/garantia.html` | cliente | Consultar cobertura por número de serie |
| `/asesor.html` | cliente | Chat en vivo con una persona |
| `/acceso.html` | asesor | Entrada al panel |
| `/panel.html` | asesor | Conversaciones escaladas y respuesta en vivo |

## Levantarlo

```bash
cd reto-agentforce/torre-agentforce
npm install
npm run sitio
```

Abre <http://localhost:3000>. `npm run sitio` avisa qué credenciales faltan y levanta
igual: cada pieza dice en pantalla qué le falta en vez de fingir que funciona.

Para que el chat del agente abra sesión hacen falta `SF_CLIENT_ID` y
`SF_CLIENT_SECRET` de la External Client App; para el panel, `APP_ADMIN_PASS`.
Van en `.env`, nunca en el repositorio ni en el chat. Ver `BLOQUEOS.md` §1.

## Requisitos

- Node.js 22 o superior.
- Para desarrollo directo: Salesforce CLI autenticado contra un alias autorizado.
- Para Docker o hosting: External Client App con client credentials y los cuatro
  scopes oficiales:
  - `api`
  - `refresh_token`, `offline_access`
  - `chatbot_api`
  - `sfap_api`

Consumer key, consumer secret y tokens nunca se copian al repo, chat, logs ni
evidencia. Los pasos humanos exactos están en `BLOQUEOS.md` §1.

## Desarrollo local

```bash
cd reto-agentforce/torre-agentforce
npm install
cp .env.example .env
sf org login web --alias zapata
npm start
```

Con `SF_TOKEN_PROVIDER=cli`, el servidor usa la credencial custodiada por Salesforce
CLI. Habla con la misma org, pero ese token no habilita Agent API. Abre
<http://localhost:3000>.

No pegues valores reales de `.env` en una incidencia o conversación. `.env` está
ignorado por Git y Docker.

## Docker

Validar contrato y construir:

```bash
node scripts/deploy-verificar.mjs
docker build --pull -t torre-agentforce:local .
```

Arranque de liveness sin credenciales:

```bash
docker run --rm --name torre-agentforce-local -p 3000:3000 \
  -e APP_ENV=development \
  -e APP_AUTH_PROVIDER=disabled \
  -e APP_AUTH_MODE=disabled \
  -e SF_TOKEN_PROVIDER=client_credentials \
  torre-agentforce:local
```

`GET /` y `GET /salud` deben responder; `/salud` es sólo liveness y devuelve
`status`/`build`. La readiness de Salesforce está en `/api/admin/salud` y exige una
identidad de rol `admin`. Para end-to-end en contenedor se requieren secretos de aplicación y
ECA fuera de la imagen. El proveedor `cli` no funciona dentro de la imagen porque
ésta no incluye `sf`.

Detalles de Render, seguridad, rollback y observabilidad:
[`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md). El Blueprint tiene autodespliegue apagado;
no se creó ningún recurso ni se incurrió en gasto desde este repositorio.

## Verificación

Checks locales deterministas que no necesitan la org:

```bash
npm run typecheck
npm run build:css
npm run build:frontend
node scripts/deploy-verificar.mjs
docker build --pull -t torre-agentforce:local .
```

El protocolo loopback se puede ejercitar sin llamar a la org, pero sólo valida el
parser/estado local; no sustituye el lifecycle real:

```bash
node --env-file=.env --experimental-strip-types scripts/prueba-protocolo-agente.ts
```

El comando con `--env-file` supone un `.env` local de desarrollo con
`APP_AUTH_PROVIDER=disabled` y `APP_AUTH_MODE=disabled`. `npm start` carga `.env` sólo si existe; las variables ya
definidas por el runtime conservan precedencia.

Checks que consultan o escriben en la Developer Edition:

```bash
npm run verificar:datos
npm run verificar:rutas
CONFIRM_MUTATING_ESCALATION_E2E=1 npm run verificar:escalamiento-e2e
npm run verificar:agent-api
npm test
```

Los cuatro `verificar:*` fijan por sí mismos `APP_ENV`/`APP_AUTH_PROVIDER`. Sin eso, la
seguridad fail-closed aborta el arranque —es el comportamiento correcto, pero antes
hacía que los scripts murieran al importar la configuración—.

Los tres primeros pueden consultar o crear registros de prueba. Se ejecutan sólo en
un entorno autorizado y se reportan con evidencia sanitizada.
`npm run verificar:agent-api` requiere las credenciales de la ECA cargadas localmente
y permanece rojo hasta completar el lifecycle real. `npm test` mezcla casos locales
con lecturas/readiness/Agent API: sin autenticación Salesforce válida debe fallar u
omitir esos casos, no declararse verde.

Existe una suite Playwright para rutas, UI, seguridad y el protocolo Agent API. Los
casos que requieren Salesforce se omiten sin credenciales explícitas; un skip no es
evidencia de integración exitosa.

### La conversación completa, de la web app al CRM

```bash
CONFIRM_E2E_MUTACIONES=1 npm run verificar:e2e
```

Es el gate que importa. No comprueba que los subagentes «se invoquen»: sostiene una
CONVERSACIÓN de varios turnos por cada caso —conocimiento, agenda, unidad varada,
escalamiento, escalamiento por el sitio y un recorrido completo en una sola visita— y
después **relee de Salesforce, por el CLI y no por la app**, el folio que el agente le
dictó al cliente, comparando campo por campo contra lo que se pidió en el chat. Si el
agente inventara un número, la relectura lo desmiente.

Cada caso corre en su propia sesión de visitante. El recorrido final comprueba que un
solo folio de visita amarra todo lo que quedó en el CRM. El paso del asesor —entrar al
panel, ver el caso en la bandeja, responder y que el cliente lo reciba— necesita
`APP_ADMIN_PASS` en `.env`; sin ella ese tramo se reporta bloqueado, no verde.

Cubre nueve familias de casos: conocimiento, agenda, unidad varada, escalamiento por
el agente, escalamiento por el sitio con el asesor contestando, reprogramación,
contención (fuera de alcance y petición ambigua), cobertura por VIN y un recorrido
completo en una sola visita. Entre las nueve ejercitan **los 6 subagentes, las 6
acciones, los 4 Flows y las 4 clases Apex productivas**.

Corrida del 7 de agosto de 2026, **dos pasadas consecutivas: VERDE, 50 comprobaciones
en verde, 0 fallas, 0 avisos, 0 bloqueados y 0 cortes de conexión**, con el agente v19
activo y el proveedor `client_credentials`. Evidencia con la transcripción completa en
`evidencia/18-e2e-agente/`.

### La misma conversación, pero tecleada en un navegador

```bash
CONFIRM_E2E_NAVEGADOR=1 npx playwright test tests/e2e/conversacion-navegador.spec.ts --project=api-and-ui
```

Cierra la última rendija entre «las rutas funcionan» y «un cliente puede hacerlo desde
el sitio»: abre la página, escribe en el widget de chat, espera las burbujas del
agente y después relee de Salesforce el `Unidad_Varada__c` que quedó bajo el folio de
esa visita, campo por campo.

Los demás gates en la misma corrida: **73/73 unitarias**, protocolo Agent API
**80/80**, lifecycle real de Agent API en verde y **42 casos Playwright** con 2 skips
que son compuertas opt-in (`RUN_MUTATING_SF_TESTS`), no fallos ocultos.

El escalamiento mutante opt-in se ejecutó autorizado contra la org y pasó:

```bash
RUN_MUTATING_SF_TESTS=1 npx playwright test tests/e2e/mutating-escalation.spec.ts --project=api-and-ui
CONFIRM_MUTATING_ESCALATION_E2E=1 npm run verificar:escalamiento-e2e
```

El segundo verifica 15 invariantes releyendo Salesforce: un solo `Case` por correlación,
idempotencia ante reintento concurrente, comentarios de apertura internos, ida y vuelta
pública posterior y un único `Log_Agente__c` apuntando al mismo `Case`.

## Rutas

| Ruta | Fuente/efecto |
|---|---|
| `/` | Conteos consultados en vivo; las filas tienen origen mixto |
| `/conversacion.html` | ECA activa; lifecycle Agent API pendiente de secretos locales y verificación |
| `/unidades.html` | `Asset` y `Lectura_Odometro__c`, semilla sintética |
| `/agenda.html` | Slots generados desde horario web; sólo `OPERACIONAL_VERIFICADO` habilita reservar/reprogramar (hoy 0) |
| `/ordenes.html` | `WorkOrder` seed/prueba y altas reales de los Flows |
| `/cobertura.html` | Comparación de reglas sintéticas; no póliza real |
| `/traza.html` | `Log_Agente__c` y registros correlacionados en Salesforce |
| `/arquitectura.html` | Grafo v10, GenAiFunctions y backends Flow/Apex derivados de la org; gate Case/CaseComment/Log |
| `/escalamiento.html` | Case de cola, comentarios bidireccionales y SSE releyendo Salesforce; identidad individual vía OIDC, sin Messaging |

`/salud` es liveness público. `/api/admin/salud` prueba credencial Salesforce, REST,
Agent API y cola; exige rol `admin` y su monitor debe inspeccionar `ok`.

## Arquitectura

El runtime es Node con TypeScript por type stripping y no tiene dependencias de
producción. `src/servidor/` contiene configuración, OAuth, cliente REST, Flows,
consultas, Agent API, escalamiento y rutas. `publico/` es el frontend sin framework.
El servidor no guarda datos de negocio, pero sí mantiene sesiones Agent API en
memoria y conexiones SSE; por eso el despliegue de referencia es un proceso Docker
continuo, no funciones serverless.

En producción `APP_AUTH_PROVIDER=oidc` exige identidad individual Salesforce mediante
Authorization Code + PKCE. El BFF valida firma, issuer, audience y nonce; deriva rol y
bindings desde `User`, `Contact` y `PermissionSetAssignment`; y entrega únicamente una
cookie opaca `HttpOnly`, `Secure`, `SameSite=Lax`. La UI no recibe ni almacena access,
refresh o session tokens. `APP_AUTH_PROVIDER=static` queda reservado a QA explícito y
nunca tiene precedencia sobre OIDC.

Toda escritura debe releerse. `varMotivoBloqueo` representa un guardrail, no un fallo
técnico. El escalamiento inicial es una transacción Apex atómica y sus comentarios
posteriores se escriben en Salesforce antes de emitirse por SSE.

## Evidencia

La carpeta `evidencia/` contiene respuestas crudas de desarrollo. Puede incluir
correos de usuario de prueba, VIN sintéticos, Ids Salesforce y cuerpos de escenario.
Por eso no entra a la imagen y no debe publicarse sin redacción.

Usa [`docs/EVIDENCIA-SANITIZADA.md`](docs/EVIDENCIA-SANITIZADA.md) para el formato
compartible. «Evidencia cruda existe» no es autorización para difundirla.

## Documentos

- [`docs/AUDITORIA-PRODUCCION-2026-08-05.md`](docs/AUDITORIA-PRODUCCION-2026-08-05.md) — veredicto requisito por requisito y gates finales
- [`docs/ALINEACION-CURSO-AGENTFORCE.md`](docs/ALINEACION-CURSO-AGENTFORCE.md) — contraste con Builder, Flows, permisos, Knowledge y Trust Layer del curso local
- [`BLOQUEOS.md`](BLOQUEOS.md) — bloqueos y pasos humanos indispensables
- [`docs/DATOS-Y-PROVENIENCIA.md`](docs/DATOS-Y-PROVENIENCIA.md) — origen por dataset y campo
- [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) — Docker, Render, rollback y observabilidad
- [`docs/EVIDENCIA-SANITIZADA.md`](docs/EVIDENCIA-SANITIZADA.md) — política y plantilla de evidencia
- [`docs/CONTRATO-AGENT-API.md`](docs/CONTRATO-AGENT-API.md) — contrato y estado de verificación
- [`docs/CONTRATO-ESCALAMIENTO.md`](docs/CONTRATO-ESCALAMIENTO.md) — alternativa `Case` + `CaseComment`
- [`docs/GRAFO-CONSTRUCCION.md`](docs/GRAFO-CONSTRUCCION.md) — dependencias de construcción
- [`docs/HARNESS.md`](docs/HARNESS.md) — ejecución y límites del harness
