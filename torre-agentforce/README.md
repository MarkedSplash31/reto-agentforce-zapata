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
- **Asesores: un acceso.** `acceso.html`. Fuera de producción rige una credencial de
  **demo fija, la misma para cualquiera que clone el repositorio**:

  | Usuario | Contraseña |
  |---|---|
  | `asesor` | `demo-zapata-2026` |

  No es un secreto y no pretende serlo: está escrita aquí a propósito para que el reto
  pueda verse sin configurar nada. Definir `APP_ADMIN_USER` / `APP_ADMIN_PASS` la
  sustituye en cualquier entorno, y con `APP_ENV=production` la de demo **deja de
  existir**: sin `APP_ADMIN_PASS` el acceso queda cerrado y lo dice. Tampoco se imprime
  en la pantalla de acceso —eso se la regalaría a cualquier visitante de un
  despliegue—; el servidor la anuncia por consola al arrancar.

## Páginas

Son tres. La conversación **es** la aplicación: agendar, reportar una varada,
consultar garantía y pedir una persona se resuelven hablando, no navegando a un
formulario por trámite. Las páginas-formulario que hubo (`taller.html`,
`carretera.html`, `garantia.html`, `asesor.html`) se retiraron y
`tests/e2e/sitio-cliente.spec.ts` comprueba que no vuelvan.

| Ruta | Para quién | Qué resuelve |
|---|---|---|
| `/index.html` | cliente | Una caja para escribir qué necesita la unidad. Al primer mensaje esa misma caja se muda al pie y la pantalla se convierte en el espacio de trabajo: la conversación a un lado, y lo que el agente consulta o registra ocupando el escenario. Si el agente escala, la MISMA ventana pasa a un asesor sin cambiar de pantalla |
| `/acceso.html` | asesor | Entrada al panel |
| `/panel.html` | asesor | Conversaciones escaladas, respuesta en vivo y consulta privada al asistente |

### El asesor hereda al agente

Un asesor que atiende un escalamiento necesita los mismos datos que el agente sabe
consultar. En `/panel.html` tiene **Consultar al asistente**: le pregunta lo que sea
—cobertura de un VIN, franjas de un taller, qué dice la póliza— y recibe la respuesta
del mismo Agente Postventa.

Esa consulta es privada y corre bajo una correlación propia del asesor: el cliente no
la ve, no entra al expediente, y si el asistente decidiera escalar durante ella
abriría un caso del asesor, nunca tocaría el del cliente. Lo que el cliente recibe es
sólo lo que el asesor decida mandarle con **Usar en mi respuesta**.

## Levantarlo

```bash
cd reto-agentforce/torre-agentforce
npm install
npm run sitio
```

Abre <http://localhost:3000>. `npm run sitio` avisa qué credenciales faltan y levanta
igual: cada pieza dice en pantalla qué le falta en vez de fingir que funciona.

Lo que se resuelve solo, sin que configures nada:

- el **panel de asesor** entra con la credencial de demo de arriba;
- la **clave de consumidor** (`SF_CLIENT_ID`) se lee de la org por el Salesforce CLI;
- el proveedor de token se elige según lo que haya: `client_credentials` si existe el
  secreto, `cli` si no.

**No hace falta ningún secreto para verlo funcionar.** Basta tener el Salesforce CLI
autenticado contra la org:

```bash
sf org login web --alias zapata
```

Con eso el proveedor `cli` alcanza la Agent API por el JWT de
`/agentforce/bootstrap/nameduser` —lo mismo que hace `sf agent preview` por dentro— y
el agente contesta. Comprobado clonando el repositorio en limpio, sin `.env`. Si el
CLI no tiene sesión, el arranque lo dice y te da el comando exacto.

`SF_CLIENT_SECRET` sólo es indispensable donde **no hay CLI**: el contenedor de
producción no lo lleva. Ahí el proveedor es `client_credentials` y el par consumidor
se inyecta desde el gestor de secretos. Revelarlo se explica en `BLOQUEOS.md` §1; no
se versiona.

La conversación se abre al **cargar la página**, no al mandar el primer mensaje: para
cuando el cliente escribe, la sesión ya está propagada. Antes se pagaban ahí la
apertura, 2.5 s de propagación y hasta 21 s de reintentos, con la pantalla quieta.
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

Superficie pública del sitio de clientes. No lleva login: la identidad es una sesión
de visitante que emite el servidor, y el `caseId` que esa sesión puede leer y
responder vive en el servidor, nunca en el cuerpo de la petición.

| Ruta | Fuente/efecto |
|---|---|
| `GET /publico/sesion` | Identidad de la visita y su `correlationId`; lo crea el servidor |
| `POST /publico/agente/abrir` | Abre la conversación al cargar la página. Esa apertura **es** la prueba de disponibilidad: no se gasta una sesión de sonda aparte |
| `GET /publico/sucursales` | `Sucursal__c` del catálogo, dato observado del sitio público |
| `GET /publico/disponibilidad` | `Slot_Taller__c`; sólo `OPERACIONAL_VERIFICADO` habilita reservar |
| `POST /publico/garantia` | Evalúa cobertura por número de serie contra reglas **sintéticas**, no póliza real |
| `POST /publico/agente/mensaje` | Turno con el Agente Postventa por SSE. Al cerrar el turno relee `Log_Agente__c` y emite `Actividad`, y `Escalado` si la correlación ya tiene `Case` |
| `POST /publico/agente/cerrar` | Cierra la sesión de Agent API. Sin esto se acumulan y la org empieza a rechazar las nuevas |
| `POST /publico/taller/agendar` | Alta real de `WorkOrder` por Flow |
| `POST /publico/carretera/reportar` | Alta real de `Unidad_Varada__c` por Flow |
| `POST /publico/asesor/abrir` | Abre el `Case` en la cola, o adopta el que el agente ya abrió con esa correlación |
| `GET /publico/asesor/conversacion` | Sólo `CaseComment` publicados. Las notas internas de Apex no cruzan a esta superficie |
| `POST /publico/asesor/responder` | Comentario público como `cliente`; el `caseId` sale de la sesión |
| `GET /publico/asesor/stream` | SSE releyendo el expediente desde Salesforce |
| `POST /publico/acceso`, `POST /publico/salir` | Sesión del asesor. Al salir se cierra también su conversación con el asistente |
| `GET /publico/panel/bandeja` | Casos escalados. Exige rol `admin` |
| `GET/POST /publico/panel/caso/:id[/responder\|/stream]` | Hilo del asesor, respuesta como `asesor` y vivo. Exige rol `admin` |
| `POST /publico/panel/caso/:id/consultar` | Consulta privada del asesor al asistente, con correlación propia. No escribe en el expediente. Exige rol `admin` |

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
