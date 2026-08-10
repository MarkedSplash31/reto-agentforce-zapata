# Plan de ejecución - Los tres Flows que llenan los subagentes vacíos

**Alcance:** `Crear_Orden_Servicio`, `Reprogramar_Orden_Servicio`, `Crear_Reporte_Unidad_Varada`
**Org:** `zapata` (`gabrielvaladezgomez47.a717257e2c6d@agentforce.com`, `00DgK00000VXSyCUAX`, DE, API 67.0)
**Ruta:** 100% CLI (`sf` 2.142.7). Cero clics en Setup salvo los tres pasos marcados como manuales.
**Fecha de levantamiento:** 3 de agosto de 2026

---

## 0. Estado real de la org (verificado, no supuesto)

Todo lo de abajo se leyó con `sf org list metadata`, `sf sobject describe`, `sf data query` y
`sf project retrieve start` contra la org `zapata`. No hay nada inferido del plan.

### 0.1 Lo que YA existe y sirve

| Pieza | Estado | Evidencia |
|---|---|---|
| Objeto `Unidad_Varada__c` | Creado, 21 campos custom, autonumber `VAR-{000000}`, 2 validation rules, compact layout, list view | `sf sobject describe` |
| Objeto `Slot_Taller__c` | 729 registros seed. `Cupos_Libres__c` y `Disponible__c` son fórmulas; `Capacidad_Usada__c` es el campo real que se escribe | describe + retrieve |
| Campos custom en `WorkOrder` | `Idempotency_Key__c` (unique + externalId), `Correlation_Id__c`, `Sintoma_Reportado__c`, `Slot_Taller__c`, `Sucursal__c`, `Tipo_Cita__c`, `Origen_Atencion__c`, `Asesor_Responsable__c`, `Sesion_Diagnostico__c` | describe |
| Subflow `Registrar_Log_Agente` | **Activo**, 19 variables de entrada, salida `varLogId`. Ya contempla `varUnidadVaradaId` | retrieve del `.flow-meta.xml` |
| `Log_Agente__c` | 20 campos, VR `Error_Requiere_Codigo`, 8 registros de prueba | describe |
| Apex `ZapataAgendaController` | `@InvocableMethod` `Consultar_Disponibilidad` completo: valida sucursal activa, modelo atendido y anticipación mínima. Devuelve `slotIds` no desplegables | retrieve del `.cls` |
| Agente `Agente_Postventa_Zapata` | `AiAuthoringBundle`, es_MX, 4 subagentes + off_topic + ambiguous | retrieve del `.agent` |
| Acción `Buscar_Conocimiento_Postventa` | `GenAiFunction` apex, cableada al subagente de conocimiento | retrieve |
| Knowledge | 20 artículos `Online` en `es`, incluye `Protocolo de unidad varada en carretera`, `Politica de grua y traslado de unidades`, `Requisitos para ingresar una unidad a taller`, `Asistencia en carretera: cobertura y tiempos` | SOQL |
| Datos seed | 15 Asset (VIN en `SerialNumber`), 18 Account, 9 Sucursal, 729 Slot, 36 Regla_Cobertura, 1 WorkOrder | SOQL |
| Permission set `Zapata_Agente_Servicio` | Ya trae exactamente los permisos correctos: `WorkOrder` C/E, `Unidad_Varada__c` C/E, `Slot_Taller__c` Edit, `Log_Agente__c` Create, `PermissionsRunFlow=true`, acceso a `ZapataAgendaController`, 155 FLS | retrieve + SOQL |

### 0.2 Lo que está roto o falta — esto es lo que bloquea

| # | Hallazgo | Impacto | Se arregla en |
|---|---|---|---|
| **B1** | **El permission set `Zapata_Agente_Servicio` NO está asignado al usuario del agente.** El usuario `agente_postventa_zapata@00dgk00000vxsyc874696804.ext` (perfil `Einstein Agent User`) tiene `Agente_Postventa_Acceso`, que solo da acceso a `Cita_Servicio__c` y `Log_Agente_IA__c` — dos objetos legacy vacíos que **ningún** Flow del plan usa | Los tres Flows fallarían en runtime aunque funcionen en Setup. Es exactamente el riesgo "acción con permisos de admin pero no de agente" de la §18 del Plan Final | Fase 1 |
| **B2** | Los dos subagentes `agendar_servicio_taller` y `atencion_unidades_varadas` no tienen bloque `actions:` en el `.agent`. Solo instrucciones | Son los "Seleccionar acción". 40% multimodal + 25% autonomía sin tocar | Fase 4 |
| **B3** | `Log_Agente__c.Subagent__c` tiene solo `Garantia, Diagnostico, Agenda, Compensacion`. No hay valor para varadas | El log del tercer Flow quedaría sin dominio o mintiendo | Fase 1 |
| **B4** | `Consultar_Disponibilidad` existe en Apex pero **no está expuesta como `GenAiFunction`**, así que el agente no puede obtener `slotIds` | Mitigado por diseño: los Flows resuelven la franja por sucursal + fecha internamente. Exponerla es *recomendado*, no bloqueante | Fase 5 (opcional) |
| **B5** | No existe `Buscar_Verificar_Unidad` como acción | Mitigado por diseño: `Crear_Orden_Servicio` resuelve VIN → Asset dentro del Flow | Fase 2 |
| **B6** | `Cita_Servicio__c` existe con solo el campo `Name` y 0 registros. `Log_Agente_IA__c` idem | Basura legacy. No se toca, no se borra, no se usa | — |

### 0.3 Desviaciones del Plan Final que encontré de paso (las reporto, no las corrijo aquí)

1. `config.agent_type = "AgentforceServiceAgent"`. El Plan Final §2 dice **Employee Agent interno**. La org tiene un Service Agent con variables de `MessagingSession`. Es una decisión de arquitectura ya tomada en la org; cambiarla no es parte de estos tres Flows.
2. El subagente de escalamiento usa `@utils.escalate`, que la §5.2 regla 6 prohíbe explícitamente porque exige Omni-Channel real.
3. `agendar_servicio_taller` instruye *"Confirma antes de crear: ¿Confirmas?"*, que contradice la §8.3 (*"no se agrega un diálogo de confirmación separado"*) y el 25% de autonomía sin intervención humana. **Esto sí lo corrijo**, porque cae dentro del cableado del subagente que estoy tocando.

---

## 1. Actores

| Actor | Identidad | Rol en estos tres Flows |
|---|---|---|
| Operador / gestor de flota | Usuario final de la conversación | Reporta síntoma, pide cita, reprograma, reporta unidad varada. Nunca ve Ids |
| Agente Agentforce | `Agente_Postventa_Zapata` (AiAuthoringBundle) | Enruta, recaba datos, invoca acciones |
| Usuario de ejecución | `agente_postventa_zapata@00dgk00000vxsyc874696804.ext`, perfil `Einstein Agent User` | **Es quien realmente escribe en la base.** Sus permisos son el gate real |
| Subagente `agendar_servicio_taller` | Dominio Agenda | Consume Flow 1 y Flow 2 |
| Subagente `atencion_unidades_varadas` | Dominio Varada | Consume Flow 3 |
| Coordinador de asistencia | `Unidad_Varada__c.Coordinador__c` (lookup a User) | Destinatario operativo del reporte. En P0 se deja vacío salvo que se pase |
| Subflow `Registrar_Log_Agente` | Autolaunched activo | Único escritor de `Log_Agente__c`. Los tres Flows lo invocan en éxito y en error |

---

## 2. Objetos y campos exactos que tocan los tres Flows

### 2.1 Lectura

| Objeto | Campos | Uso |
|---|---|---|
| `Asset` | `Id`, `SerialNumber` (=VIN), `AccountId`, `Product2.ProductCode`, `Unidad_Verificada__c`, `Odometro__c`, `Tipo_Unidad__c` | Resolver VIN → unidad y aplicar el gate `Unidad_Verificada__c` |
| `Sucursal__c` | `Id`, `Name`, `Codigo_Sucursal__c`, `Activa__c`, `Anticipacion_Minima_Horas__c`, `Ciudad__c` | Gate de anticipación mínima (Zapata pide 24 h en su propio sitio) |
| `Slot_Taller__c` | `Id`, `Name`, `Sucursal__c`, `Inicio__c`, `Fin__c`, `Tipo_Servicio__c`, `Capacidad_Total__c`, `Capacidad_Usada__c`, `Cupos_Libres__c` (f), `Disponible__c` (f) | Resolver y validar la franja |
| `WorkOrder` | `Id`, `WorkOrderNumber`, `Status`, `StartDate`, `EndDate`, `Slot_Taller__c`, `Sucursal__c`, `AssetId`, `Idempotency_Key__c` | Idempotencia y reprogramación |

### 2.2 Escritura

| Objeto | Operación | Campos escritos |
|---|---|---|
| `WorkOrder` | INSERT (Flow 1) | `AssetId`, `AccountId`, `Subject`, `Description`, `Sintoma_Reportado__c`, `StartDate`, `EndDate`, `Status='New'`, `Priority`, `Slot_Taller__c`, `Sucursal__c`, `Tipo_Cita__c`, `Origen_Atencion__c='Agentforce'`, `Idempotency_Key__c`, `Correlation_Id__c` |
| `WorkOrder` | UPDATE (Flow 2) | `StartDate`, `EndDate`, `Slot_Taller__c`, `Sucursal__c`, `Description` (append motivo). **Mismo registro. Jamás un INSERT** |
| `Slot_Taller__c` | UPDATE (Flows 1 y 2) | `Capacidad_Usada__c` (+1 al reservar, −1 al liberar) |
| `Unidad_Varada__c` | INSERT (Flow 3) | `Asset__c`, `VIN_Reportado__c`, `Carretera__c`, `Kilometro__c`, `Sentido__c`, `Referencia_Ubicacion__c`, `Descripcion_Falla__c`, `Codigos_Falla_Tablero__c`, `Carga__c`, `Fuera_De_Carril__c`, `Intermitentes_Encendidas__c`, `Estado__c='Reportada'`, `Prioridad__c='Critica'`, `Fecha_Reporte__c=NOW()`, `Sucursal_Apoyo__c`, `Correlation_Id__c` |
| `Log_Agente__c` | INSERT vía subflow (los tres) | Todo lo que pase el llamador |

### 2.3 Reglas de la base que los Flows tienen que respetar (no negociable)

| Regla | Objeto | Consecuencia en el diseño |
|---|---|---|
| `Capacidad_Usada_No_Excede_Total`: `Capacidad_Usada__c > Capacidad_Total__c` | `Slot_Taller__c` | Hay que releer el slot y validar `Cupos_Libres__c >= 1` **antes** de reservar |
| `Capacidad_No_Negativa` | `Slot_Taller__c` | Al liberar en Flow 2, nunca bajar de 0 |
| `Seguridad_Antes_De_Avanzar`: no se puede salir de `Reportada` sin `Fuera_De_Carril__c` **y** `Intermitentes_Encendidas__c` | `Unidad_Varada__c` | Flow 3 crea siempre en `Reportada`. No intenta avanzar estado |
| `Resuelta_Requiere_Fecha` | `Unidad_Varada__c` | Flow 3 no cierra reportes. Fuera de alcance |
| `Error_Requiere_Codigo`: `ERROR`/`BLOCKED` exigen `Error_Code__c` o `Guardrail_Triggered__c` | `Log_Agente__c` | Toda rama de bloqueo pasa un código estable. El subflow ya pone `SIN_CODIGO_REPORTADO` como red de seguridad |
| `Idempotency_Key__c` unique + externalId | `WorkOrder` | Permite `Get Records` por clave antes de crear, y un upsert si hiciera falta |
| FLS: los campos `required` (`Estado__c`, `Fecha_Reporte__c`, `Inicio__c`, `Fin__c`, `Sucursal__c`, `Capacidad_Total__c`, `Outcome__c`, `Timestamp__c`, `Correlation_Id__c` del log) no llevan entrada de FLS | varios | Verificado: su ausencia en el permission set **no** es un hueco |

---

## 3. Contratos I/O

Descripciones en el estilo que exige la §8.1: cuándo se usa, formato, validación, fuente y qué hacer si falta.

### 3.1 `Crear_Orden_Servicio` — Autolaunched Flow

**Entradas**

| Variable | Tipo | Req | Descripción para el planner |
|---|---|:--:|---|
| `varVIN` | Text | Sí | VIN de 17 caracteres alfanuméricos que el operador dictó. Se busca en `Asset.SerialNumber`. Si el usuario no lo tiene, pídelo; no inventes uno |
| `varSucursalClave` | Text | Sí* | Código o nombre del taller, p.ej. `FL-QRO` o `Queretaro`. *Obligatorio si no envías `varSlotId` |
| `varFechaDeseada` | DateTime | No | Fecha y hora que pidió el operador. Se toma la primera franja libre igual o posterior. Si va vacía se toma la primera franja libre disponible |
| `varSlotId` | Text | No | Id interno de franja devuelto por `Consultar_Disponibilidad`. Uso interno. Nunca lo muestres ni lo pidas al usuario |
| `varTipoServicio` | Text | No | `Diagnostico`, `Mantenimiento`, `Garantia` o `Reparacion mayor`. Si va vacío no se filtra por tipo |
| `varSintoma` | Text | Sí | Lo que el operador reportó, con sus palabras. No escribas aquí un diagnóstico que no dijo |
| `varIdempotencyKey` | Text | Sí | Clave estable de la solicitud, formato `CONV-{correlationId}-WO`. Si repites la misma clave, no se crea una segunda orden |
| `varCorrelationId` | Text | Sí | Hilo de la conversación. Sin esto la traza no se reconstruye |
| `varSessionKey` | Text | No | Referencia de sesión sin PII |

**Salidas**

| Variable | Tipo | Flags | Descripción |
|---|---|---|---|
| `varCreada` | Boolean | planner | Verdadero solo si hay una orden vigente para esta solicitud |
| `varFolio` | Text | planner + displayable | `WorkOrderNumber`. Es lo único que el operador debe recibir como comprobante |
| `varMensaje` | Text | planner + displayable | Texto listo para leer. Sin Ids, sin VIN completo, sin AccountNumber |
| `varMotivoBloqueo` | Text | planner | `VIN_NO_ENCONTRADO`, `UNIDAD_NO_VERIFICADA`, `SUCURSAL_NO_ENCONTRADA`, `SUCURSAL_INACTIVA`, `SIN_CUPO`, `ANTICIPACION_INSUFICIENTE`, `SLOT_NO_DISPONIBLE`, `DUPLICADO_IDEMPOTENTE`, `ERROR_PERSISTENCIA`. Vacío en éxito |
| `varCitaTexto` | Text | displayable | Día y hora en español, p.ej. `martes 11 de agosto de 09:00 a 11:00` |

### 3.2 `Reprogramar_Orden_Servicio` — Autolaunched Flow

**Entradas**

| Variable | Tipo | Req | Descripción |
|---|---|:--:|---|
| `varFolio` | Text | Sí | `WorkOrderNumber` que el operador dictó, p.ej. `00000007`. Es el dato que el cliente sí tiene |
| `varNuevaFecha` | DateTime | Sí* | Nueva fecha y hora pedida. *Obligatoria si no envías `varNuevoSlotId` |
| `varNuevoSlotId` | Text | No | Id interno de franja. Uso interno, nunca visible |
| `varSucursalClave` | Text | No | Solo si el operador quiere cambiar de taller. Si va vacío se mantiene el taller actual |
| `varMotivo` | Text | Sí | Por qué se mueve la cita, en palabras del operador. Queda en la descripción de la orden y en el log |
| `varCorrelationId` | Text | Sí | Hilo de conversación |
| `varSessionKey` | Text | No | Referencia de sesión |

**Salidas**

| Variable | Tipo | Flags | Descripción |
|---|---|---|---|
| `varReprogramada` | Boolean | planner | |
| `varFolioSalida` | Text | planner + displayable | **El mismo folio de entrada.** Si cambia, hubo un INSERT y eso es un defecto |
| `varAntes` | Text | displayable | Fecha anterior en español |
| `varDespues` | Text | displayable | Fecha nueva en español |
| `varMensaje` | Text | planner + displayable | |
| `varMotivoBloqueo` | Text | planner | `ORDEN_NO_ENCONTRADA`, `ORDEN_NO_REPROGRAMABLE`, `VENTANA_RESTRINGIDA`, `SIN_CUPO`, `ANTICIPACION_INSUFICIENTE`, `SLOT_NO_DISPONIBLE`, `ERROR_PERSISTENCIA` |
| `varCasoCreado` | Text | displayable | `CaseNumber` cuando la ventana restringida impide mover y se dispone el caso (§8.3) |

### 3.3 `Crear_Reporte_Unidad_Varada` — Autolaunched Flow

**Entradas**

| Variable | Tipo | Req | Descripción |
|---|---|:--:|---|
| `varFueraDeCarril` | Boolean | Sí | Confirmación explícita de que la unidad está fuera del carril de circulación. **Pregúntalo antes que nada.** Si el operador no lo confirma, envía falso, no lo asumas |
| `varIntermitentes` | Boolean | Sí | Confirmación de intermitentes encendidas. Mismo criterio |
| `varCarretera` | Text | Sí | Nombre o número de carretera, p.ej. `Mexico-Queretaro 57D`. Máx. 120 caracteres |
| `varKilometro` | Number | No | Kilómetro aproximado. Si el operador no lo sabe, deja vacío y usa `varReferencia` |
| `varSentido` | Text | No | `Norte`, `Sur`, `Oriente`, `Poniente` o `No especifica` |
| `varReferencia` | Text | No | Referencia visual: caseta, puente, poblado más cercano |
| `varVIN` | Text | No | VIN de 17 caracteres. En carretera puede no tenerlo a la mano: **no bloquees el reporte por esto**. Se guarda tal cual y se enlaza al Asset si coincide |
| `varDescripcionFalla` | Text | Sí | Lo que el operador describe. Máx. 8000 caracteres |
| `varCodigosTablero` | Text | No | Códigos SPN/FMI o luces encendidas, separados por coma. Máx. 255 |
| `varCarga` | Text | No | `Cargada`, `Vacia` o `No especifica` |
| `varSucursalClave` | Text | No | Taller de apoyo si el operador o el agente ya sabe cuál corresponde |
| `varCorrelationId` | Text | Sí | Hilo de conversación |
| `varSessionKey` | Text | No | |

**Salidas**

| Variable | Tipo | Flags | Descripción |
|---|---|---|---|
| `varReportada` | Boolean | planner | |
| `varFolio` | Text | planner + displayable | Folio `VAR-000001`. **No cierres la conversación sin entregarlo** |
| `varMensaje` | Text | planner + displayable | Confirmación + siguiente paso |
| `varAvisoSeguridad` | Text | planner + displayable | Se llena solo si `varFueraDeCarril` o `varIntermitentes` vinieron en falso. Léelo primero, antes que el folio |
| `varUnidadIdentificada` | Boolean | planner | Verdadero si el VIN empató con un Asset. Si es falso, el reporte igual existe |
| `varMotivoBloqueo` | Text | planner | `CARRETERA_FALTANTE`, `DESCRIPCION_FALTANTE`, `ERROR_PERSISTENCIA` |

---

## 4. Lógica interna, paso a paso

### 4.1 `Crear_Orden_Servicio`

```
START
 │
 1. GET WorkOrder WHERE Idempotency_Key__c = varIdempotencyKey  (LIMIT 1)
 │   └─ encontrado → varCreada=true, varFolio=WorkOrderNumber,
 │                   varMotivoBloqueo='DUPLICADO_IDEMPOTENTE'
 │                   LOG(Outcome=SUCCESS, Guardrail='IDEMPOTENCIA_REUSO') → FIN
 │
 2. GET Asset WHERE SerialNumber = varVIN (LIMIT 1)
 │   └─ vacío → LOG(NOT_FOUND, Error='VIN_NO_ENCONTRADO') → FIN
 │
 3. DECISION Asset.Unidad_Verificada__c = true?
 │   └─ no → LOG(BLOCKED, Guardrail='UNIDAD_NO_VERIFICADA') → FIN
 │
 4. GET Sucursal__c WHERE Codigo_Sucursal__c = varSucursalClave
 │                     OR Name LIKE '%varSucursalClave%'  (LIMIT 1)
 │   ├─ vacío   → LOG(NOT_FOUND, 'SUCURSAL_NO_ENCONTRADA') → FIN
 │   └─ Activa__c = false → LOG(BLOCKED, 'SUCURSAL_INACTIVA') → FIN
 │
 5. FORMULA frmDesde = NOW() + Sucursal.Anticipacion_Minima_Horas__c (default 24)
 │   DECISION varFechaDeseada < frmDesde?
 │     └─ sí → LOG(BLOCKED, 'ANTICIPACION_INSUFICIENTE') → FIN
 │
 6. RESOLVER FRANJA
 │   ├─ varSlotId presente  → GET Slot_Taller__c por Id
 │   └─ varSlotId vacío     → GET Slot_Taller__c
 │                             WHERE Sucursal__c = suc.Id
 │                               AND Disponible__c = true
 │                               AND Inicio__c >= MAX(frmDesde, varFechaDeseada)
 │                               AND (Tipo_Servicio__c = varTipoServicio si viene)
 │                             ORDER BY Inicio__c ASC LIMIT 1
 │   └─ vacío → LOG(BLOCKED, 'SIN_CUPO') → FIN
 │
 7. DECISION slot.Cupos_Libres__c >= 1 AND slot.Inicio__c >= frmDesde
 │   └─ no → LOG(BLOCKED, 'SLOT_NO_DISPONIBLE') → FIN
 │
 8. CREATE WorkOrder
 │     AssetId              = asset.Id
 │     AccountId            = asset.AccountId
 │     Subject              = 'Cita de taller - ' + tipo + ' - Unidad ' + asset.Name
 │     Description          = varSintoma
 │     Sintoma_Reportado__c = varSintoma
 │     StartDate            = slot.Inicio__c
 │     EndDate              = slot.Fin__c
 │     Status               = 'New'
 │     Priority             = 'Medium'
 │     Slot_Taller__c       = slot.Id
 │     Sucursal__c          = suc.Id
 │     Tipo_Cita__c         = varTipoServicio (o slot.Tipo_Servicio__c)
 │     Origen_Atencion__c   = 'Agentforce'
 │     Idempotency_Key__c   = varIdempotencyKey
 │     Correlation_Id__c    = varCorrelationId
 │   FAULT → LOG(ERROR, 'ERROR_PERSISTENCIA') → FIN
 │
 9. ASSIGN slot.Capacidad_Usada__c = slot.Capacidad_Usada__c + 1
    UPDATE slot
 │   FAULT → LOG(ERROR, 'ERROR_RESERVA_SLOT') → FIN
 │           (la orden queda creada; el log lo dice, no se finge éxito)
 │
10. GET WorkOrder por Id → varFolio = WorkOrderNumber
11. varCitaTexto = formato español de slot.Inicio__c / slot.Fin__c
12. LOG(Accion='Crear_Orden_Servicio', Subagent='Agenda', Outcome=SUCCESS,
        varWorkOrderId, varAssetId, varRelatedRecordId=WO.Id, varUnidadVerificada=true)
FIN
```

### 4.2 `Reprogramar_Orden_Servicio`

```
START
 1. GET WorkOrder WHERE WorkOrderNumber = varFolio (LIMIT 1)
 │   └─ vacío → LOG(NOT_FOUND, 'ORDEN_NO_ENCONTRADA') → FIN
 │
 2. DECISION Status IN ('New','In Progress','On Hold')?
 │   └─ no → LOG(BLOCKED, 'ORDEN_NO_REPROGRAMABLE') → FIN
 │
 3. GET Sucursal__c: la de varSucursalClave si viene, si no la actual de la orden
 │   frmDesde = NOW() + Anticipacion_Minima_Horas__c
 │
 4. VENTANA RESTRINGIDA
 │   DECISION la cita actual arranca dentro de la anticipación mínima
 │            (StartDate <= frmDesde) O varNuevaFecha < frmDesde?
 │   └─ sí → NO se tocan fechas
 │           CREATE Case (AccountId, Asset__c, WorkOrder__c,
 │                        Origin='Agentforce', Priority='High',
 │                        Subject='Solicitud de reprogramacion fuera de ventana',
 │                        Description=varMotivo, Correlation_Id__c)
 │           varCasoCreado = CaseNumber
 │           LOG(BLOCKED, Guardrail='VENTANA_RESTRINGIDA', varCaseId)
 │           → FIN
 │
 5. RESOLVER NUEVA FRANJA (mismo bloque que Flow 1, paso 6-7)
 │   └─ falla → LOG(BLOCKED, motivo) → FIN
 │
 6. ASSIGN varAntes = formato español de WO.StartDate (guardar ANTES de escribir)
 │
 7. UPDATE **el mismo** WorkOrder (por Id, nunca CREATE)
 │     StartDate      = nuevoSlot.Inicio__c
 │     EndDate        = nuevoSlot.Fin__c
 │     Slot_Taller__c = nuevoSlot.Id
 │     Sucursal__c    = suc.Id
 │     Description    = Description + '\n[Reprogramado] ' + varMotivo
 │   FAULT → LOG(ERROR, 'ERROR_PERSISTENCIA') → FIN
 │
 8. LIBERAR slot viejo: si WO tenía Slot_Taller__c y es distinto del nuevo
 │     Capacidad_Usada__c = MAX(0, Capacidad_Usada__c - 1) → UPDATE
 │   RESERVAR slot nuevo: Capacidad_Usada__c + 1 → UPDATE
 │
 9. varFolioSalida = varFolio  (invariante: el mismo)
    varDespues = formato español
10. LOG(Accion='Reprogramar_Orden_Servicio', Subagent='Agenda', SUCCESS,
        varWorkOrderId=WO.Id, varRelatedRecordId=WO.Id)
FIN
```

**Invariante que se prueba explícitamente en T12:** `varFolioSalida == varFolio` y
`SELECT COUNT() FROM WorkOrder` no aumenta.

### 4.3 `Crear_Reporte_Unidad_Varada`

```
START
 1. DECISION varCarretera vacía?     → LOG(BLOCKED,'CARRETERA_FALTANTE') → FIN
    DECISION varDescripcionFalla vacía? → LOG(BLOCKED,'DESCRIPCION_FALTANTE') → FIN
 │
 2. GET Asset WHERE SerialNumber = varVIN (solo si varVIN no está vacío)
 │   varUnidadIdentificada = (encontrado)
 │   El reporte NO se bloquea si no hay VIN. Una unidad detenida se registra igual
 │
 3. GET Sucursal__c por varSucursalClave (opcional, no bloquea)
 │
 4. ASSIGN varAvisoSeguridad:
 │   si NOT(varFueraDeCarril) OR NOT(varIntermitentes) →
 │     'Antes de continuar: coloca los triangulos, enciende las intermitentes y
 │      manten a la tripulacion fuera del carril de circulacion.'
 │   guardrail = 'SEGURIDAD_NO_CONFIRMADA'
 │
 5. CREATE Unidad_Varada__c
 │     Estado__c                  = 'Reportada'        ← la VR impide avanzar sin seguridad
 │     Prioridad__c               = 'Critica'          ← regla del subagente
 │     Fecha_Reporte__c           = NOW()
 │     Fuera_De_Carril__c         = varFueraDeCarril
 │     Intermitentes_Encendidas__c= varIntermitentes
 │     Carretera__c, Kilometro__c, Sentido__c, Referencia_Ubicacion__c
 │     Descripcion_Falla__c, Codigos_Falla_Tablero__c, Carga__c
 │     VIN_Reportado__c = varVIN     Asset__c = asset.Id (si hubo)
 │     Sucursal_Apoyo__c = suc.Id (si hubo)
 │     Correlation_Id__c = varCorrelationId
 │   FAULT → LOG(ERROR,'ERROR_PERSISTENCIA') → FIN
 │
 6. GET Unidad_Varada__c por Id → varFolio = Name  (VAR-000001)
 7. LOG(Accion='Crear_Reporte_Unidad_Varada', Subagent='Varada', SUCCESS,
        varUnidadVaradaId, varAssetId, varRelatedRecordId, Guardrail si aplica)
FIN
```

**Por qué el Flow crea aunque la seguridad no esté confirmada:** la VR
`Seguridad_Antes_De_Avanzar` solo bloquea *salir* de `Reportada`. Negarse a registrar una
unidad inmovilizada porque el operador no confirmó las intermitentes sería peor operación y
peor demo. El reporte existe, el guardrail queda en el log y el agente lee la advertencia de
seguridad **antes** del folio.

---

## 5. Cableado al agente

### 5.1 Metadata `GenAiFunction` (una por Flow)

Se calca el patrón exacto de `Buscar_Conocimiento_Postventa`, cambiando el target:

```xml
<invocationTarget>Crear_Orden_Servicio</invocationTarget>
<invocationTargetType>flow</invocationTargetType>
<isConfirmationRequired>false</isConfirmationRequired>   <!-- §8.3: cero confirmación extra -->
<isIncludeInProgressIndicator>true</isIncludeInProgressIndicator>
<progressIndicatorMessage>Agendando tu cita...</progressIndicatorMessage>
```

Con `input/schema.json` y `output/schema.json` usando las mismas anotaciones que ya usa la
org: `lightning:type`, `lightning:isPII`, `copilotAction:isUserInput`,
`copilotAction:isDisplayable`, `copilotAction:isUsedByPlanner`.

`lightning:isPII = true` en `varVIN` de los tres Flows.

### 5.2 Bloques `actions:` en el `.agent`

En `subagent agendar_servicio_taller`:

```
    reasoning:
        instructions: -> ...
        actions:
            Crear_Orden_Servicio: @actions.Crear_Orden_Servicio
                with varVIN = ...
            Reprogramar_Orden_Servicio: @actions.Reprogramar_Orden_Servicio
                with varFolio = ...
    actions:
        Crear_Orden_Servicio:      # descripción, label, inputs, outputs
        Reprogramar_Orden_Servicio:
```

En `subagent atencion_unidades_varadas`: idem con `Crear_Reporte_Unidad_Varada`.

### 5.3 Cambios de instrucciones (los mínimos, y digo por qué)

| Subagente | Cambio | Motivo |
|---|---|---|
| `agendar_servicio_taller` | Quitar *"Confirma antes de crear: ¿Confirmas?"*. Se sustituye por: la petición explícita de fecha del operador **es** la autorización | §8.3 del Plan Final + 25% de autonomía sin intervención humana |
| `agendar_servicio_taller` | Añadir: genera `varIdempotencyKey` como `CONV-{correlationId}-WO` y **reutiliza la misma clave** si el usuario repite la solicitud | T15, cero duplicados |
| `agendar_servicio_taller` | Añadir: nunca menciones ni pidas Ids de franja | §8.3, ninguna salida visible con Ids |
| `atencion_unidades_varadas` | Añadir: llama a `Crear_Reporte_Unidad_Varada` **en cuanto tengas carretera y descripción**, aunque falte VIN o kilómetro. Entrega el folio siempre | *"No cierres la conversación sin haber entregado un número de folio"* |
| `atencion_unidades_varadas` | Añadir: si el Flow devuelve `varAvisoSeguridad`, léelo antes del folio | Seguridad antes que el dato |

---

## 6. Secuencia de ejecución (CLI, en orden)

### Fase 0 — Proyecto de trabajo

```bash
cd "C:/Users/Admin/Desktop/Workspace definitivo/reto-agentforce" && sf project generate -n zapata-dx --template empty
```

Luego traer la línea base real de la org al proyecto:

```bash
cd "C:/Users/Admin/Desktop/Workspace definitivo/reto-agentforce/zapata-dx" && sf project retrieve start -m "Flow:Registrar_Log_Agente" -m "AiAuthoringBundle:Agente_Postventa_Zapata_1" -m "GenAiFunction:Buscar_Conocimiento_Postventa" -m "PermissionSet:Zapata_Agente_Servicio" -m "ApexClass:ZapataAgendaController" -m "CustomObject:Unidad_Varada__c" -m "CustomObject:Slot_Taller__c" -m "CustomObject:WorkOrder" -m "CustomObject:Log_Agente__c" -o zapata
```

### Fase 1 — Desbloqueos (B1 y B3). Esto va primero o todo lo demás miente

```bash
sf org assign permset -n Zapata_Agente_Servicio -b agente_postventa_zapata@00dgk00000vxsyc874696804.ext -o zapata
```

Añadir el valor `Varada` al picklist `Log_Agente__c.Subagent__c` en el `.field-meta.xml` y
desplegar:

```bash
sf project deploy start -m "CustomField:Log_Agente__c.Subagent__c" -o zapata
```

Verificación inmediata de B1:

```bash
sf data query -q "SELECT PermissionSet.Name FROM PermissionSetAssignment WHERE Assignee.Username='agente_postventa_zapata@00dgk00000vxsyc874696804.ext'" -o zapata -r csv
```

### Fase 2 — Los tres Flows

Se escriben a mano como `.flow-meta.xml` (el Flow Builder no tiene ruta CLI; el XML sí, y es
revisable en diff, que es justo lo que pide la §14 del Plan Final).

```
force-app/main/default/flows/Crear_Orden_Servicio.flow-meta.xml
force-app/main/default/flows/Reprogramar_Orden_Servicio.flow-meta.xml
force-app/main/default/flows/Crear_Reporte_Unidad_Varada.flow-meta.xml
```

Validación sin escribir en la org:

```bash
sf project deploy start -d force-app/main/default/flows --dry-run -o zapata
```

Despliegue:

```bash
sf project deploy start -d force-app/main/default/flows -o zapata
```

### Fase 3 — Modo seco: probar la lógica sin gastar generaciones LLM

Invocación directa por Apex anónimo (Plan Final §12: *"Los Flows se prueban en modo seco
desde Setup antes de gastar generaciones"* — esto es lo mismo, pero por CLI y reproducible):

```bash
sf apex run -f scripts/dry-run/crear-orden-feliz.apex -o zapata
```

Un archivo por caso. La batería mínima:

| Archivo | Caso | Espera |
|---|---|---|
| `crear-orden-feliz.apex` | VIN verificado + sucursal activa + hay cupo | `varCreada=true`, folio, `Capacidad_Usada__c` +1, 1 log SUCCESS |
| `crear-orden-vin-malo.apex` | VIN inexistente (T09) | `VIN_NO_ENCONTRADO`, cero WorkOrder, 1 log NOT_FOUND |
| `crear-orden-no-verificada.apex` | Asset con `Unidad_Verificada__c=false` | `UNIDAD_NO_VERIFICADA`, cero mutación (umbral: 0) |
| `crear-orden-sin-cupo.apex` | Sucursal sin franjas libres (T14) | `SIN_CUPO`, cero orden, cero horario inventado |
| `crear-orden-idempotente.apex` | Misma clave dos veces (T15) | Segunda corrida devuelve el mismo folio; `COUNT(WorkOrder)` no sube |
| `reprogramar-ok.apex` | Reprogramación explícita permitida (T12) | Mismo `WorkOrderNumber`, `StartDate` cambia, viejo slot −1, nuevo +1 |
| `reprogramar-ventana.apex` | Dentro de ventana restringida (T13) | Fechas intactas, `CaseNumber` devuelto, log BLOCKED con guardrail |
| `reprogramar-cerrada.apex` | Orden `Completed` | `ORDEN_NO_REPROGRAMABLE` |
| `varada-completa.apex` | Todos los datos + seguridad confirmada | Folio `VAR-…`, `Estado='Reportada'`, `Prioridad='Critica'`, 1 log |
| `varada-sin-vin.apex` | Sin VIN, con carretera y falla | Se crea igual, `varUnidadIdentificada=false` |
| `varada-sin-seguridad.apex` | `FueraDeCarril=false` | Se crea, `varAvisoSeguridad` lleno, guardrail en el log |

Prueba de permisos con la **identidad real del agente** (el riesgo de la §18) dentro de una
clase de test con `System.runAs(agentUser)`:

```bash
sf apex run test -t ZapataFlowsAgentePermisosTest -o zapata -w 10 -r human
```

### Fase 4 — Cableado del agente

```bash
sf agent validate --agent-file force-app/main/default/aiAuthoringBundles/Agente_Postventa_Zapata/Agente_Postventa_Zapata.agent -o zapata
sf project deploy start -m "GenAiFunction:Crear_Orden_Servicio" -m "GenAiFunction:Reprogramar_Orden_Servicio" -m "GenAiFunction:Crear_Reporte_Unidad_Varada" -o zapata
sf project deploy start -m "AiAuthoringBundle:Agente_Postventa_Zapata_1" -o zapata
sf agent publish --api-name Agente_Postventa_Zapata -o zapata
```

### Fase 5 — Opcional pero recomendado (B4)

Exponer `Consultar_Disponibilidad` como `GenAiFunction` apex sobre el
`@InvocableMethod` que ya existe. Sin esto los Flows siguen funcionando (resuelven la franja
solos), pero el agente no puede *ofrecer* horarios antes de agendar, y ese ida y vuelta es lo
que hace que el escenario S2 del video se vea como una conversación y no como un formulario.

### Fase 6 — Prueba conversacional (gasta generaciones: presupuesto 90/150 por ventana)

```bash
sf agent preview --api-name Agente_Postventa_Zapata -o zapata
```

Utterances mínimas, tres corridas consecutivas por escenario:

1. `Necesito agendar servicio para el VIN 3HAMMAAR8LL123456 en Queretaro el martes por la mañana, trae perdida de potencia`
2. `Me surgió algo, mueve la cita 00000008 al jueves, mismo taller`
3. `Se me quedó parada una unidad en la 57D como en el km 120 rumbo al norte, marca falla de frenos de aire`

Evidencia por corrida:

```bash
sf data query -q "SELECT Action_Name__c,Outcome__c,Related_Record_Id__c,Guardrail_Triggered__c,Subagent__c,Timestamp__c FROM Log_Agente__c WHERE Correlation_Id__c='<id>' ORDER BY Timestamp__c" -o zapata -r csv
```

### Fase 7 — Cierre

```bash
sf project retrieve start -m "Flow:Crear_Orden_Servicio" -m "Flow:Reprogramar_Orden_Servicio" -m "Flow:Crear_Reporte_Unidad_Varada" -o zapata
sf project deploy start -d force-app --dry-run -o zapata
```

Commit en rama, no en `main`. Diff revisado antes de aceptar cualquier metadata generada
(§14).

---

## 7. Mapeo a la rúbrica

| Criterio | Peso | Qué aporta este bloque |
|---|---:|---|
| Integración multimodal (Flow + Knowledge + Event logging) | 40% | Los subagentes de agenda y varada pasan de cero acciones a tres Flows que escriben `WorkOrder`, `Slot_Taller__c` y `Unidad_Varada__c`, y cada rama —éxito, bloqueo y error— deja un `Log_Agente__c` correlacionado. Knowledge entra vía transición a `conocimiento_y_respuestas` (`Requisitos para ingresar una unidad a taller`, `Protocolo de unidad varada en carretera`, `Politica de grua y traslado de unidades`) |
| Resolución autónoma 100% | 25% | `isConfirmationRequired=false` en las tres acciones + se elimina el "¿Confirmas?" del subagente. Ventana restringida y falta de cupo se resuelven con disposición automática (Case), no pidiendo ayuda humana |
| Precisión frente a Knowledge | 15% | Indirecto: los Flows nunca devuelven política en texto libre, solo enums y códigos. La explicación siempre viene del artículo |
| Trazabilidad | 10% | `Correlation_Id__c` en `WorkOrder`, `Unidad_Varada__c` y `Log_Agente__c`. `Related_Record_Id__c` apunta al registro real. Antes/después explícito en reprogramación |
| Documentación técnica | 10% | Este documento + contratos I/O + los 11 archivos de modo seco versionados |

---

## 8. Riesgos y supuestos declarados

| # | Riesgo / supuesto | Cómo lo trato |
|---|---|---|
| R1 | El perfil `Einstein Agent User` podría no tener FLS de escritura en campos **estándar** de `WorkOrder` (`Status`, `StartDate`, `EndDate`, `Subject`, `Description`). Las permission sets solo cubren los custom | Se comprueba en Fase 3 con `System.runAs`. Si falta, se añade al permission set `Zapata_Agente_Servicio`, no al perfil |
| R2 | `Consultar_Disponibilidad` consulta `WITH USER_MODE`. Si el agente no tiene FLS en algún campo del SELECT, la query **falla** en vez de devolver menos | Mismo test de Fase 3. Los campos del SELECT son `required` o ya tienen FLS, así que espero que pase |
| R3 | Reservar cupo con `Capacidad_Usada__c + 1` no es atómico. Dos agendamientos simultáneos podrían pasar la VR | En una demo de un solo operador no ocurre. Se documenta como limitación honesta, no se finge concurrencia resuelta |
| R4 | Formatear fecha en español dentro de Flow es feo (fórmulas con `CASE`). El Apex ya tiene `enEspanol()` | Empiezo con fórmula en el Flow. Si sale ilegible, expongo `enEspanol` como invocable y lo reuso. No bloquea |
| R5 | `sf agent publish` puede exigir un paso manual en el nuevo Builder | Se registra en el runbook como paso manual si ocurre. No se afirma "deploy limpio completo" si no lo fue (§14) |
| R6 | Supongo que `Sucursal_Apoyo__c` se deja vacío cuando el agente no sabe qué taller corresponde. No hay geolocalización en la org y no voy a inventar una | Declarado. El coordinador lo asigna después |
| R7 | El agente es `AgentforceServiceAgent`, no Employee Agent como dice el Plan Final §2 | Lo reporto. No lo cambio: está fuera del alcance de estos tres Flows y cambiarlo tocaría las variables de `MessagingSession` de todo el agente |

---

## 9. Definition of Done de este bloque

- [x] `Zapata_Agente_Servicio` asignado al usuario del agente y verificado por SOQL
- [x] `Varada` existe en `Log_Agente__c.Subagent__c`
- [x] Los tres Flows desplegados y `Active`
- [x] Casos de modo seco corridos por CLI, todos con el resultado esperado
- [x] `ZapataFlowsAgentePermisosTest` verde (4/4) con `System.runAs` del usuario del agente
- [x] Cero duplicados en la prueba de idempotencia
- [x] Reprogramación devuelve el mismo `WorkOrderNumber` y `COUNT(WorkOrder)` no aumenta
- [x] Ventana restringida: fechas intactas + `Case` creado + log `BLOCKED`
- [x] Reporte de varada creado sin VIN y sin kilómetro
- [x] Los dos subagentes ya no dicen "Seleccionar acción"
- [x] Verificación conversacional con acciones reales: **8/8 en Topic, Action y Outcome** (ver §11)
- [x] `sf project deploy start -d force-app --dry-run` verde
- [ ] Metadata en rama, diff revisado — **pendiente**, sin commit hasta que el equipo lo pida

---

## 10. Registro de ejecución (3 de agosto de 2026)

Lo que el plan no anticipó y se resolvió sobre la marcha. Se documenta porque son
landmines reales de esta org, no anécdotas.

| # | Problema encontrado | Causa | Solución aplicada |
|---|---|---|---|
| E1 | El deploy del Flow fallaba con `Element decisions is duplicated at this location` | El Metadata API exige los hijos de `<Flow>` **agrupados por tipo y en el orden del WSDL**, no en orden de lectura | Se escribió [`scripts/order-flow.js`](reto-agentforce/zapata-dx/scripts/order-flow.js), que reordena los bloques antes de desplegar. Los XML se escriben en orden lógico y se ordenan mecánicamente |
| E2 | `Reprogramar_Orden_Servicio` reventaba con un fallo no gestionado, sin dejar log | `Log_Agente__c.Policy_Version__c` tenía **20 caracteres** y `K_REPROGRAMACION_TALLER` mide 23. El `Crear_Log` del subflow fallaba, y los subflows no admiten fault connector | Campo ensanchado a 40. Afecta también a `K_COMPENSACION_ESCALAMIENTO` (27), así que le habría estallado igual a los Flows de Diego |
| E3 | `Case.Origin` no aceptaba `Agentforce` | El picklist estándar solo traía `Phone`, `Email`, `Web` | Se agregó `Agentforce` al `StandardValueSet:CaseOrigin`, alineado con `WorkOrder.Origen_Atencion__c` que ya lo tenía |
| E4 | Los `GenAiFunction` de agenda fallaban con "unexpected error" | **`lightning__dateTimeType` no es un tipo válido en el esquema de acción de Agentforce.** `lightning__dateType` sí | Los dos Flows pasaron a recibir **fecha sin hora**. Es además como habla el cliente ("muévela al jueves"). El Flow toma la primera franja libre de ese día |
| E5 | La conversión de día a franja podía irse un día atrás | `DATETIMEVALUE(fecha)` da medianoche **GMT**, que en México es la tarde del día anterior | `+ 0.25` (6 h) para caer en la medianoche local. Ninguna franja del taller arranca entre 05:00 y 06:00 GMT, así que el horario de verano no cambia el resultado |
| E6 | Bloquear por anticipación mínima descartaba días que sí servían | Se comparaba el **inicio** del día pedido contra la anticipación | Ahora se compara el **fin** del día pedido: solo se bloquea cuando el día completo ya no es agendable |
| E7 | `Crear_Reporte_Unidad_Varada` no existía en la org aunque su deploy "no había fallado" | Los deploys de metadata son **atómicos**: al fallar dos de las tres funciones, se revirtió también la que sí pasó | Se desplegó sola. Detectado porque `sf agent publish` se negó a publicar con `source` inválido |
| E8 | El texto de la cita salía en GMT y con nombres de día en inglés | `TEXT()` sobre DateTime en fórmula de Flow devuelve GMT, y `format()` usa el idioma del usuario que ejecuta —el del agente puede estar en inglés | Clase `ZapataFormatoFecha` con `@InvocableMethod` propia (Apex solo admite uno por clase, y `ZapataAgendaController` ya usa el suyo). 3 pruebas unitarias |

### Resultados reales de las corridas en seco

| Caso | Resultado |
|---|---|
| Crear, camino feliz | Folio, `martes 4 de agosto de 11:00 a 13:00`, cupo 1/3, log `SUCCESS` |
| Idempotencia (T15) | Mismo folio en las dos corridas, `COUNT(WorkOrder)` +1, log con `IDEMPOTENCIA_REUSO` |
| VIN inválido (T09) | `VIN_NO_ENCONTRADO`, log `NOT_FOUND`, cero escritura |
| Unidad sin verificar | `UNIDAD_NO_VERIFICADA`, log `BLOCKED`, cero escritura |
| Taller inexistente | `SUCURSAL_NO_ENCONTRADA`, log `NOT_FOUND` |
| Anticipación insuficiente | `ANTICIPACION_INSUFICIENTE`, guardrail `ANTICIPACION_MINIMA` |
| Reprogramar (T12) | Mismo folio, franja vieja 1→0, nueva +1, descripción original conservada |
| Ventana restringida (T13) | Fechas intactas, `Case` levantado, log `BLOCKED` con `Policy_Version__c` |
| Orden cerrada | `ORDEN_NO_REPROGRAMABLE` |
| Folio inexistente | `ORDEN_NO_ENCONTRADA` |
| Varada completa | Folio `VAR-…`, `Reportada`, `Critica`, ligada al Asset y al taller |
| Varada sin VIN ni km | Se crea igual, `varUnidadIdentificada=false` |
| Varada sin seguridad confirmada | Se crea, devuelve el aviso, guardrail `SEGURIDAD_NO_CONFIRMADA` en el log |
| Varada sin carretera | `CARRETERA_FALTANTE`, cero escritura |
| Permisos con `System.runAs` del agente | 4/4 |

### Estado del agente publicado

`sf agent publish authoring-bundle` generó `GenAiPlannerBundle:Agente_Postventa_Zapata_v1`.
Verificado en la metadata recuperada:

- `agendar_servicio_taller` → *Crear orden de servicio en taller* + *Reprogramar orden de servicio*
- `atencion_unidades_varadas` → *Levantar reporte de unidad varada*

Los dos subagentes vacíos ya no lo están.

---

## 11. Verificación conversacional con acciones reales

Corrida el 3 de agosto contra el agente publicado, con **Testing Center**, no con
`sf agent preview`. La diferencia importa: **`agent preview` simula las acciones con IA
salvo que se le pase `--use-live-actions`**, así que no habría probado nada real, y además
es interactivo y no se puede guionar. Testing Center ejecuta los Flows de verdad —por eso
valida `expectedActions`— y deja artefacto versionado, que es lo que pide la §12 del Plan
Final.

Suite: [`specs/Zapata_Flows_P0-testSpec.yaml`](reto-agentforce/zapata-dx/specs/Zapata_Flows_P0-testSpec.yaml), 8 casos.

```bash
sf agent test run --api-name Zapata_Flows_P0 -o zapata --wait 14 --result-format human
```

### Resultado final

| Métrica | Resultado |
|---|---|
| Topic (enrutamiento al subagente correcto) | **100%** (8/8) |
| Action (acción terminal correcta) | **100%** (8/8) |
| Outcome (respuesta al cliente) | **100%** (8/8) |

Los 8 casos: agendar con VIN verificado, pedir cita sin VIN (no debe escribir), unidad sin
verificar (gate), reprogramar por folio, reintento en conversación nueva, varada completa,
varada sin VIN, y varada con el operador todavía sobre el carril.

Evidencia en la base, escrita bajo la identidad `agente_postventa_zapata@…`, no la del
administrador:

```
Crear_Reporte_Unidad_Varada   SUCCESS   guardrail=SEGURIDAD_NO_CONFIRMADA
Crear_Orden_Servicio          BLOCKED   guardrail=UNIDAD_NO_VERIFICADA
Reprogramar_Orden_Servicio    SUCCESS
Crear_Orden_Servicio          SUCCESS
```

### Los cinco defectos que solo aparecieron aquí

Ninguno se veía en las pruebas en seco. Este es el valor de haber corrido la capa
conversacional.

| # | Defecto | Causa raíz | Solución |
|---|---|---|---|
| **V1** | Los tres Flows tronaban con "tuve un inconveniente" y **no escribían nada** | El agente no mandaba `varCorrelationId` (lo declaré obligatorio pero nunca le dije de dónde tomarlo). `Log_Agente__c.Correlation_Id__c` es obligatorio → el `Crear_Log` del subflow fallaba → **se revertía la interview completa** | Fórmula `frmCorrelationId` con respaldo a `$Flow.InterviewGuid` en los tres Flows, más binding `@variables.RoutableId` en el `.agent` |
| **V2** | `Log_Agente__c: bad field names on insert/update call: Asset__c` | El usuario del agente **no tenía permiso de objeto sobre `Asset`, `Account` ni `Product2`** — solo FLS, que sin CRUD no sirve. Escribir un lookup a Asset exige leer Asset | Permisos de lectura sobre los tres objetos en `Zapata_Agente_Servicio` |
| **V3** | Reprogramar contestaba "no encontré ninguna orden con ese folio" | `WorkOrder` tiene **OWD Privado** y la orden era de otro usuario. La licencia `Einstein Agent User` **no admite "Ver todos los WorkOrder"** | Grupo público `Zapata_Agentes` + regla de compartir `Zapata_Agente_Ve_Ordenes` (owner-based, acceso Edit). Es la vía de menor privilegio: ni subir el permiso de objeto ni poner el Flow en modo sistema |
| **V4** | **El gate de seguridad se podía puentear.** Una petición sobre una unidad sin verificar respondía "ya tenías una orden registrada" | El modelo inventó `varCorrelationId = "1"`, de ahí salió `Idempotency_Key__c = "CONV-1-WO"` — **la misma clave en todas las conversaciones**. El Flow revisaba idempotencia ANTES del gate, así que la colisión lo saltaba y además devolvía el folio de OTRA unidad | Tres cambios: (a) la compuerta de VIN y unidad verificada corre **antes** del atajo de idempotencia; (b) la búsqueda idempotente se acota por `AssetId`; (c) se exige largo mínimo al correlation id y a la clave, y **la clave se quitó del contrato que ve el modelo** para que no la invente |
| **V5** | Ante un operador todavía sobre el carril, el agente daba el aviso de seguridad pero **no levantaba el reporte** | La instrucción decía "ejecuta en cuanto tengas carretera y descripción", pero el modelo interpretó que la seguridad iba primero | Instrucción explícita: una unidad sobre el carril es MÁS urgente, no menos. Se ejecuta la acción con las banderas en falso, se lee el aviso primero y el folio después |

### Dos cosas que corrijo de lo que reporté antes

1. **La prueba de permisos con `System.runAs` no probaba lo que dije.** Un Flow lanzado
   desde Apex corre en contexto de **sistema**, así que saltaba CRUD y FLS. Pasaba en verde
   con el permiso de `Asset` faltante (V2). La prueba real de permisos es Testing Center;
   `ZapataFlowsAgentePermisosTest` sigue siendo útil para la lógica, pero no como evidencia
   de permisos.
2. La sintaxis de variables en Agent Script es **`@variables.X`**, no `{!X}`.

### Limitación declarada

La idempotencia se apoya en el identificador de sesión. Dentro de una conversación real de
Messaging, `RoutableId` es estable y un reintento devuelve el mismo folio. En Testing Center
cada caso corre en sesión aislada, así que ahí **no** se puede probar la deduplicación: eso
se verifica a nivel de Flow en
[`scripts/dry-run/02-crear-orden-idempotente.apex`](reto-agentforce/zapata-dx/scripts/dry-run/02-crear-orden-idempotente.apex),
donde dos llamadas con la misma clave devuelven un solo folio y `COUNT(WorkOrder)` sube en 1.
