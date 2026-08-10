# Contexto de la Torre Agentforce — lo que cambia decisiones de diseño

Levantado el **5 de agosto de 2026**, contra la org `zapata`
(`00DgK00000VXSyCUAX`, Developer Edition, API 67.0).

Cada afirmación de este documento tiene respaldo crudo en `evidencia/`. Lo que no
pude verificar está marcado como no verificado, no como supuesto.

## Estado vigente después de la auditoría de cierre

Esta sección, verificada el **5 de agosto de 2026 (CDT) / 6 de agosto UTC**, sustituye
cualquier fotografía histórica incompatible que aparezca más abajo:

- `Agente Postventa Zapata` **v10 está activo** (`BotVersion`
  `0X9gK000003XkGrSAK`). v9, v8 y v5 están inactivos.
- El agente activo conserva seis subagentes útiles: conocimiento, agenda, varada,
  escalamiento, fuera de alcance y aclaración. La validación de activación de
  Salesforce pasó sin errores.
- El escalamiento ya no depende de `@utils.escalate`: invoca la acción Apex
  `Crear_Escalamiento_Asesor`, que crea un `Case` en la cola real, un
  `CaseComment` interno y un `Log_Agente__c` correlacionado en una transacción.
- La prueba Preview produjo **1 Case + 1 CaseComment + 1 Log**, folio `00001052`,
  correlación `PREVIEW-V8-20260805-03`, sin afirmar una transferencia en vivo que la
  org no tiene.
- La External Client App `Torre Agentforce Zapata` existe, está activa, usa los
  cuatro scopes requeridos y corre como el service agent. El lifecycle oficial de
  Agent API sigue bloqueado sólo por la custodia local del consumer key/secret tras
  rotar la credencial expuesta; un contrato loopback no lo sustituye.
- La migración dejó 20 artículos como `v1.0-sintetica-no-verificada`, 729 slots como
  `SITIO_WEB_CAPACIDAD_ASUMIDA`, 15 Assets no verificados, 30 WorkOrders y 28
  varadas como `PRUEBA_TRANSACCIONAL_SIN_FUENTE_CONFIRMADA`. Quedaron cero registros
  sin clasificar dentro de ese alcance.

Evidencia sanitizada: `evidencia/14-proveniencia/`,
`evidencia/15-escalamiento-apex/` y `evidencia/16-agentforce-v10/`.

---

## 1. Verificación de terreno — lo confirmado y lo corregido

Evidencia: `evidencia/00-terreno/` (13 archivos, sello `20260805T202105Z`).

| Lo que se creía | Lo que devolvió la org | Estado |
|---|---|---|
| org alias `zapata`, Dev Edition, API 67.0 | idéntico | Confirmado |
| bot `Agente_Postventa_Zapata` | `0XxgK0000022RhJSAU`, tipo `ExternalCopilot` | Confirmado |
| planner bundles v1..v5 | v1..v5 + `EmployeeCopilotPlanner` | Confirmado |
| 5 genAiFunctions | las 5, exactas | Confirmado |
| 4 Flows de negocio | los 4, `Active`, `AutoLaunchedFlow` | Confirmado |
| 9 objetos del modelo | los 9, más `Sucursal__c`, `Exclusion_Garantia__c`, `Parametros_Garantia__c` | Confirmado |

**Fotografía histórica de terreno:** v5 era la activa al iniciar la auditoría. El
estado vigente es v10 activa; véase la sección de cierre anterior.

### Volumen real de datos — la demo no corre contra tablas vacías

| Objeto | Registros | Sirve para |
|---|---:|---|
| `Slot_Taller__c` | **729** | Horario web + capacidad asumida; no agenda operativa real |
| `WorkOrder` | **30** | Escrituras reales sobre escenarios de prueba |
| `Unidad_Varada__c` | **28** | Escrituras reales sobre escenarios de prueba |
| `Log_Agente__c` | **98** | Traza |
| `Asset` | **15** | Unidades |
| `Regla_Cobertura__c` | **36** activas | Cobertura |
| `Sucursal__c` | 9 · `Modelo_Sucursal__c` 180 · `Knowledge__kav` 20 | Catálogo |

**Ningún objeto del camino crítico está vacío.** Esto corrige el estado descrito en
`MAPA-DEL-SISTEMA.md` (2 de agosto), que reportaba `WorkOrder`, `Unidad_Varada__c` y
`Log_Agente__c` en cero. Se llenaron con los tres Flows P0 entre el 3 y el 5 de agosto.

Sí siguen vacíos, y **no están en el camino crítico de esta app**:
`Sesion_Diagnostico__c` (0), `Invalidacion_Garantia__c` (0), `Brecha_Conocimiento__c` (0),
`Lectura_Odometro__c` (1, y es seed). La consecuencia concreta: **la sección de
Unidades no puede mostrar historial de odómetro**, porque no existe. Mostrará el
odómetro estampado en `Asset` y dirá explícitamente que no hay historial, en vez de
inventar una serie.

---

## 2. La decisión que define la arquitectura: cómo se autentica la app

Esto no estaba resuelto en ningún documento previo y determina qué se puede construir.

### Lo que funciona hoy, verificado

La REST API de Salesforce responde con el token que ya custodia el CLI:

```
GET /services/data/v67.0/query?q=SELECT COUNT() FROM Asset   → HTTP 200  {"totalSize":15}
```

Evidencia: `evidencia/01-agent-api/sanity-soql.*.json`.

Y la invocación de Flows por REST **escribe de verdad**:

```
POST /services/data/v67.0/actions/custom/flow/Crear_Reporte_Unidad_Varada
→ HTTP 200  varFolio = "VAR-000026"  Flow__InterviewStatus = "Finished"
```

Relectura del registro y de su log, mismo `Correlation_Id__c`:

```
Unidad_Varada__c  VAR-000026     a0BgK00000b0GXNUA2   Estado=Reportada  Prioridad=Critica
Log_Agente__c     LOG-00000124   Subagent=Varada      Outcome=SUCCESS
```

Evidencia: `evidencia/02-flows/`. **La cadena que el reto pide demostrar —acción,
efecto y traza correlacionada— está probada de extremo a extremo por API.**

### Lo que estaba bloqueado al inicio

Antes de crear la ECA, Agent API respondía **HTTP 404 con cuerpo vacío** a todo. Este
resultado es histórico y no sustituye una prueba con credenciales de la ECA:

| Prueba | Resultado | Lo que descarta |
|---|---|---|
| agent id real + token válido | 404, `content-length: 0` | — |
| agent id inventado | 404 idéntico | No es "agente no encontrado" |
| sin header `Authorization` | 404 idéntico | El gateway no llega a evaluar el token |
| token basura | 404 idéntico | No es token inválido (daría 401) |
| `https://api.salesforce.com/` raíz | 404, IP `155.226.144.128`, TLS válido | No es DNS ni red |
| mismo path sobre el My Domain | 404 | El endpoint no vive ahí |

**Diagnóstico histórico:** `api.salesforce.com` requiere tokens emitidos para Agent
API con los scopes adecuados; el token de `PlatformCLI` no los tiene. La org no tenía
una app cliente en esa fotografía. La ECA ya fue creada y activada durante el cierre,
pero el consumer key/secret no se revela ni se copia a evidencia.

Tres intentos, misma causa raíz → se detiene y se documenta. Ver `BLOQUEOS.md` §1.

### Consecuencia de diseño

El servidor se construye con **dos proveedores de token detrás de una sola interfaz**:

- `client_credentials` contra la External Client App — la ruta de producción. Lee de
  `process.env`; el lifecycle queda pendiente hasta que un humano rote la credencial
  expuesta y custodie el par de consumidor localmente.
- token del CLI ya autenticado — habilita SOQL y Flows **hoy, contra la org real**.

No es un mock ni un modo demo: las dos rutas hablan con la misma org. La segunda usa
una credencial OAuth que ya existía. Cuando un humano cargue localmente las
credenciales de la ECA, la primera queda verificable sin tocar el resto de la app.

---

## 3. Escalamiento humano: por qué no es Messaging

`DICCIONARIO-DE-DATOS.md` §6 describía que el subagente de escalamiento usaba
`@utils.escalate` y **no ejecutaba nada**. La versión activa v10 ya no usa esa salida:
ejecuta la acción Apex `Crear_Escalamiento_Asesor`.
Confirmado hoy: **0 `MessagingChannel` en la org**, y 0 `EmbeddedServiceConfig`.

Messaging for In-App and Web exige canal, despliegue y licenciamiento que no puedo
crear. Omni-Channel exige configuración de presencia y enrutamiento.

Lo que **sí existe y está probado hoy**: la cola `Escalamiento_Postventa`
(`00GgK00000BMTaVUAX`, tipo `Queue`), el objeto `Case` con `Origin = Agentforce` y
`Correlation_Id__c`, y `CaseComment`.

```
POST /sobjects/Case        → HTTP 201  500gK00001CMO13QAH   OwnerId = la cola real
POST /sobjects/CaseComment → HTTP 201  00agK00000Em3tBQAR
```

Evidencia: `evidencia/03-escalamiento/`.

**Decisión: el escalamiento se construye sobre `Case` + `CaseComment` enrutado a la
cola real.** Salesforce es el sistema de registro; nuestro servidor es sólo el
transporte en vivo entre los dos navegadores. Lo que el evaluador verifica no es
nuestra UI: es que el `Case`, sus `CaseComment` y el `Log_Agente__c` con el mismo
folio quedaron en la org. Eso es auditable sin creernos nada.

Contrato completo en `docs/CONTRATO-ESCALAMIENTO.md`.

---

## 4. La contradicción de cobertura, medida

El objetivo pedía hacerla visible. **Está confirmada con datos reales**, no sólo
documentada. Evidencia: `evidencia/04-cobertura/`.

`Regla_Cobertura__c` — 36 reglas activas, y para Cabina y Chasis dice:

| Sistema | Meses | Km |
|---|---:|---|
| Cabina | **36** | **Sin_Limite_Km__c = true** |
| Chasis y estructura | **36** | **Sin_Limite_Km__c = true** |
| Corrosión | 60 | sin límite |
| Tren motriz | 24 (60 si extendida) | 250,000 (750,000) |
| Eléctrico y electrónica | 24 | 200,000 |
| Frenos · Refrigeración · General | 24 | 250,000 |

`Asset.Garantia_Vigente__c` es una fórmula que aplica **24 meses y 250,000 km a
todo**, sin mirar el sistema. `Parametros_Garantia__c` confirma la base:
24 meses / 250,000 km / margen 10%.

**El caso que lo hace visible en pantalla — Unidad 105:**

```
odómetro 268,000 km · 30 meses desde instalación
Regla_Cobertura__c (Cabina):   36 meses, sin límite de km  →  CUBIERTO
Asset.Garantia_Vigente__c:      30 > 24  y  268,000 > 250,000  →  false
```

**Corrección de lo que acabo de escribir tres líneas arriba.** Ese cuadro salió de
cruzar las dos tablas en abstracto. Al evaluar de verdad, unidad por unidad contra la
org, resultó falso — y por una razón que importa mucho más que el ejemplo:

```
Los 15 Asset apuntan al producto  "Tractocamion Clase 8 - Serie T680"   (15 de 15)
Las 36 reglas activas cuelgan de   Freightliner Cascadia · M2 · 114SD · FL 360
                                   (9 reglas cada uno)
Intersección: NINGUNA
```

Verificado con dos consultas agregadas
(`evidencia/04-cobertura/assets-por-modelo.*` y `modelos-con-regla.*`). Evaluar la
Unidad 105 devuelve `reglasActivas: 0` y `hayConflicto: false` — **no porque las
fuentes coincidan, sino porque no hay ninguna regla que aplique a su modelo.**

Es la consecuencia operativa del defecto que `MAPA-DEL-SISTEMA.md` §5 señalaba como
asunto de coherencia frente al jurado: el T680 es un modelo **Kenworth** y Zapata
distribuye **Freightliner**. No era sólo cosmético. Deja la evaluación de cobertura
por unidad **inoperante en toda la flota**.

**Lo que sí es demostrable y lo que no:**

| | Estado |
|---|---|
| Contradicción a nivel de **política** (5 sistemas) | **Demostrable hoy.** Medida, con las dos cifras enfrentadas |
| Evaluación de cobertura **por unidad** | **Inoperante.** Ninguna unidad tiene regla aplicable |

Qué hace la UI con esto, que es lo único que me toca decidir:

1. muestra la contradicción de política, con los cinco sistemas y sus dos cifras;
2. al evaluar una unidad dice, con esas palabras, que **no hay regla para su modelo**,
   y explica por qué;
3. no inventa una regla, no cae por defecto a la regla "General", y no presenta el
   `REQUIERE_DATO` como si fuera un veredicto de cobertura.

Reapuntar los 15 `Asset` a modelos Freightliner es una tarea de datos con dueño
humano: `BLOQUEOS.md` §7. **No la hice como efecto colateral.** Cambiar a qué producto
apunta la flota entera para que una pantalla se vea mejor es exactamente lo que la
regla cero prohíbe.

Dato adicional que la UI debe respetar: **14 de 15 unidades tienen
`Cobertura_Citable__c = REQUIERE_DATO`** y sólo una tiene `Estado_Cobertura__c`
poblado. La app dirá "no sabemos" cuando el modelo dice `REQUIERE_DATO`, que es
justo el tercer estado que el plan definió para no confundir "no sé" con "no tienes".

---

## 5. Contratos de los cuatro Flows — verificados, no recordados

Recuperados de la org (`sf project retrieve`), los cuatro `Active` y `AutoLaunchedFlow`.
Estos nombres de variable son el contrato exacto que consume el servidor.

**`Crear_Orden_Servicio`**
IN `varVIN` · `varSlotId` · `varSucursalClave` · `varFechaDeseada` (Date) ·
`varTipoServicio` · `varSintoma` · `varCorrelationId` · `varSessionKey` · `varIdempotencyKey`
OUT `varCreada` (Bool) · `varFolio` · `varCitaTexto` · `varMensaje` · `varMotivoBloqueo`

**`Reprogramar_Orden_Servicio`**
IN `varFolio` · `varNuevoSlotId` · `varNuevaFecha` (Date) · `varSucursalClave` ·
`varMotivo` · `varCorrelationId` · `varSessionKey`
OUT `varReprogramada` (Bool) · `varAntes` · `varDespues` · `varFolioSalida` ·
`varCasoCreado` · `varMensaje` · `varMotivoBloqueo`

**`Crear_Reporte_Unidad_Varada`**
IN `varVIN` · `varCarretera` · `varKilometro` (Number) · `varSentido` · `varReferencia` ·
`varDescripcionFalla` · `varCodigosTablero` · `varCarga` · `varFueraDeCarril` (Bool) ·
`varIntermitentes` (Bool) · `varSucursalClave` · `varCorrelationId` · `varSessionKey`
OUT `varReportada` (Bool) · `varFolio` · `varUnidadIdentificada` (Bool) ·
`varAvisoSeguridad` · `varMensaje` · `varMotivoBloqueo`

**`Registrar_Log_Agente`** — 18 entradas, salida `varLogId`. Lo invocan los otros tres
como subflow; el servidor **no lo llama directo** salvo para registrar el escalamiento.

Los tres devuelven `varMotivoBloqueo`: **cuando viene poblado, la acción fue
rechazada por política y la UI debe decirlo con esas palabras**, no tratarlo como error
genérico. Es la diferencia entre un guardrail funcionando y una falla.

---

## 6. Esquema real — 16 objetos introspectados

`scripts/describe-objetos.mjs` consulta `/describe` y deja el inventario en
`evidencia/05-esquema/`. **Ningún nombre de campo en esta app se escribe de memoria.**

Correcciones que la introspección obligó, y que habrían roto consultas:

| Se asumía | Nombre real |
|---|---|
| `Regla_Cobertura__c.Modelo_Codigo__c` | `Modelo__c` (lookup a `Product2`) |
| `Regla_Cobertura__c.Articulo_Id__c` | `Knowledge_Article_Id__c` |
| `Parametros_Garantia__c.Meses_Garantia_Basica__c` | `Meses_Base__c` |
| `Parametros_Garantia__c.Km_Garantia_Basica__c` | `Km_Base__c` |

Campos fórmula que se leen pero **no se escriben**: `Slot_Taller__c.Cupos_Libres__c` y
`.Disponible__c`; `Asset.Cobertura_Citable__c`, `.Evaluacion_Vigente__c`,
`.Meses_Desde_Instalacion__c`, `.Estado_Garantia_Basica__c`, `.Garantia_Vigente__c`;
`Unidad_Varada__c.Horas_Detenida__c`.

---

## 7. Identidad visual — restricciones que gobiernan toda la UI

De `skills/zapata-design/SKILL.md`. Las que más fácil se violan en una app de datos:

- **`border-radius: 0` y `box-shadow: none`** en todo lo que esté en flujo. Sombra
  sólo en modal y CTA flotante.
- **12px es el tamaño base de interfaz.** Nunca 14 ni 16 para texto de UI.
- **Cinzel 300/400 en títulos, Inter 300/400/500 en todo lo demás.** Nada más.
- **El ámbar `#fbbf24` señala lo local y accionable; jamás es el CTA principal**, que
  siempre es blanco sólido. Ámbar decorativo rompe la identidad.
- **Las tarjetas invierten el fondo respecto a su sección** (`#0b0c10` ↔ `#0d0e12`).
- **Un solo easing `cubic-bezier(0.4,0,0.2,1)`**, 300ms por defecto.
- **`font-mono` para todo identificador** que se lea carácter por carácter: VIN, folio,
  código de sucursal, id de artículo. Siempre con `tracking-wide`.
- **Rejilla de 4 columnas: `sm:grid-cols-2 lg:grid-cols-4`**, nunca `md:grid-cols-4`.
- Sin emoji, sin exclamaciones. CTA con verbo de resultado.

La app de referencia es `reto-agentforce/torre-postventa/`: **nav y footer se inyectan
desde `js/sistema.js`**, no se duplican por página. La Torre replica ese shell.

Verificación obligatoria antes de desplegar:
`node skills/zapata-design/scripts/auditar-sistema.mjs <ruta>` — código 0 o no se despliega.

---

## 8. Lo que este contexto deja decidido

1. **El camino crítico no depende de la Agent API.** Unidades, Agenda, Órdenes,
   Cobertura, Traza, Arquitectura y Escalamiento consultan o escriben hoy contra la
   org real. Su contenido conserva proveniencia mixta o sintética; sólo el lifecycle
   de Conversación queda bloqueado.
2. **El escalamiento es `Case` + `CaseComment` sobre la cola real**, no Messaging.
3. **La contradicción de cobertura se muestra, no se resuelve.**
4. **Sin historial de odómetro**: la UI lo dice en vez de fabricarlo.
5. **`varMotivoBloqueo` es un estado de primera clase en la UI**, distinto de error.
6. **Ningún nombre de campo se escribe de memoria**: sale de `describe`.

## 9. Fuentes leídas

Negocio: `PLAN-DE-TRABAJO-FINAL.md` · `PLAN-3-FLOWS-P0.md` · `PENDIENTES-JUNTA.md` ·
`DICCIONARIO-DE-DATOS.md`.
Modelo: `MAPA-DEL-SISTEMA.md` · `AUDITORIA-MODELO-DATOS.md` · `DECISION-FUSION.md` ·
`DATOS-REALES-ZAPATA.md` · `BITACORA-SESION-2026-08-02.md`.
Identidad: `skills/zapata-design/SKILL.md` y sus `references/`.
Org: los 13 archivos de `evidencia/00-terreno/` y el esquema de `evidencia/05-esquema/`.

Donde un documento y la org discrepan, **manda la org**, y la discrepancia queda
anotada arriba (§1 volumen de datos, §6 nombres de campo).
