# Diccionario de datos y estado real de la org - Reto Agentforce Zapata

**Org:** `zapata` · `00DgK00000VXSyCUAX` · Developer Edition · API 67.0
**Levantado:** 3 de agosto de 2026, directo de la org (Tooling API + SOQL + Metadata API).
**Nada de esto viene de memoria ni de documentos previos.** Cada dato es consultable.

> Este es el documento que propuso Diego: qué existe, para qué sirve y quién lo creó.

---

## 1. Estado del catálogo P0 (sección 8.2 del Plan Final)

Las 8 acciones obligatorias, más lo que se agregó fuera del catálogo.

| # | Acción P0 | ¿Existe? | Implementación | Autor |
|---|---|---|---|---|
| 1 | `Buscar_Verificar_Unidad` | **NO** | — | — |
| 2 | `Registrar_Lectura_Odometro` | **NO** | — | — |
| 3 | `Evaluar_Cobertura_Garantia` | **NO** | — | — |
| 4 | `Consultar_Disponibilidad` | **SÍ** | Apex `ZapataAgendaController` + GenAiFunction | Apex: Gabriel · Acción: Diego |
| 5 | `Crear_Orden_Servicio` | **SÍ** | Flow autolaunched | Gabriel |
| 6 | `Reprogramar_Orden_Servicio` | **SÍ** | Flow autolaunched | Gabriel |
| 7 | `Crear_Caso_Escalamiento` | **NO** | El subagente usa `@utils.escalate`, que no ejecuta nada | — |
| 8 | `Registrar_Resultado_Diagnostico` | **NO** | — | — |
| + | `Registrar_Log_Agente` (subflow) | **SÍ** | Flow autolaunched, lo invocan los tres | Gabriel |
| + | `Buscar_Conocimiento_Postventa` | **SÍ** | Apex `BuscarConocimientoPostventa` | Diego |
| + | `Crear_Reporte_Unidad_Varada` | **SÍ** | Flow autolaunched (fuera del catálogo, propuesto por Gabriel) | Gabriel |

**Marcador: 4 de 8 acciones P0 construidas**, más el subflow de log, la de conocimiento y la de varadas.

---

## 2. Quién hizo qué

### Gabriel — 15 objetos custom, 173 campos, 16 validation rules

Creados el **30 de julio**: `Slot_Taller__c`, `Sucursal__c`, `Modelo_Sucursal__c`, `Regla_Cobertura__c`,
`Lectura_Odometro__c`, `Sesion_Diagnostico__c`, `Sintoma__c`, `Log_Agente__c`, `Brecha_Conocimiento__c`,
más 6 campos custom sobre `Knowledge__kav`.

Creados el **2 de agosto**: `Unidad_Varada__c`, `Exclusion_Garantia__c`, `Invalidacion_Garantia__c`,
`Parametros_Garantia__c`.

Campos sobre objetos estándar: `WorkOrder` (15), `Asset` (17), `Case` (4), `Product2` (5), `Account` (2).

Apex: `ZapataAgendaController` + su test, `ZapataFormatoFecha` + su test, `ZapataFlowsAgentePermisosTest`.

Flows: los 4 (`Registrar_Log_Agente`, `Crear_Orden_Servicio`, `Reprogramar_Orden_Servicio`,
`Crear_Reporte_Unidad_Varada`).

UI: app `Zapata_Postventa`, 17 tabs, componente `zapataCalendarioTaller`.

### Diego — 3 objetos custom, 26 campos, 1 clase Apex

Creados el **30 de julio**: `Accion_Agente_IA__c`, `Cita_Servicio__c`, `Log_Agente_IA__c`.

**Los tres están muertos hoy.** `Accion_Agente_IA__c` ya no existe en la org (borrado).
`Cita_Servicio__c` y `Log_Agente_IA__c` siguen existiendo pero **sin un solo campo custom vivo** y
con 0 registros. Sus 20 campos aparecen en la papelera de metadata. Fue el modelo de datos v1,
que se reemplazó por `WorkOrder` + `Log_Agente__c`.

**Lo que sí sobrevive de Diego y es carga estructural:**

| Campo | Objeto | Por qué importa |
|---|---|---|
| `Contenido__c` | `Knowledge__kav` | Es de donde lee la acción de conocimiento. Sin esto no hay RAG |
| `Odometro__c` | `Asset` | Kilometraje operativo |
| `Garantia_Vigente__c` | `Asset` | 10 de 15 unidades en true |
| `Tipo_Unidad__c` | `Asset` | Tractocamión, camión rígido, volteo, pipa |
| `Km_Ultimo_Servicio__c` | `Asset` | Referencia de mantenimiento |
| `Proximo_Servicio_Km__c` | `Asset` | Referencia de mantenimiento |

Apex: `BuscarConocimientoPostventa` (5,011 caracteres, `with sharing`).

---

## 3. Inventario objeto por objeto

Formato: **registros · campos custom · quién escribe · qué guarda**

### Objetos que el agente ESCRIBE

#### `WorkOrder` — estándar · 29 registros · 15 campos custom (Gabriel)
La orden de servicio y la cita de taller. **La escribe `Crear_Orden_Servicio` (INSERT) y
`Reprogramar_Orden_Servicio` (UPDATE).**

Campos estándar usados: `WorkOrderNumber` (folio), `Status`, `StartDate`, `EndDate`, `Subject`,
`Description`, `Priority`, `AssetId`, `AccountId`.

Campos custom: `Idempotency_Key__c` (Text 64, **unique + externalId**), `Correlation_Id__c`,
`Sintoma_Reportado__c` (Long Text), `Slot_Taller__c` (lookup), `Sucursal__c` (lookup),
`Tipo_Cita__c` (picklist: Diagnostico/Mantenimiento/Garantia/Reparacion mayor),
`Origen_Atencion__c` (picklist: Agentforce/Telefono/Mostrador), `Asesor_Responsable__c` (lookup User),
`Sesion_Diagnostico__c` (lookup), `Placa__c`, `Confirmacion_Enviada__c`,
`Ad_ID__c` · `Utm_Source__c` · `Utm_Medium__c` · `Utm_Campaign__c` (atribución publicitaria, sin uso).

**OWD: Privado.** Por eso hizo falta la regla de compartir `Zapata_Agente_Ve_Ordenes`.

Ejemplo real:
```
00000007 | New | 2026-07-31 21:00 | "Revision por perdida de potencia"
Sintoma_Reportado__c = "Silba y pierde potencia en subida cargado"
Asset = 3HAMMAAR8LL123456 | Sucursal = FL-QRO | Slot = SLOT-000385
Tipo_Cita__c = Garantia | Origen_Atencion__c = Agentforce
Idempotency_Key__c = CONV-2026-0802-0001-WO1
```

Huecos: `Ad_ID__c`, `Asesor_Responsable__c`, `Placa__c` y `Sesion_Diagnostico__c` vacíos en los 29.
`Sintoma_Reportado__c` solo en 7 de 29 (los que creó el agente).

#### `Slot_Taller__c` — 729 registros · 8 campos (Gabriel)
La agenda del taller sin Field Service. **La escriben los dos Flows de agenda**, actualizando
`Capacidad_Usada__c` (+1 al reservar, −1 al liberar).

`Sucursal__c` (lookup, requerido), `Inicio__c` (DateTime, requerido), `Fin__c` (DateTime, requerido),
`Tipo_Servicio__c` (picklist), `Capacidad_Total__c` (requerido), `Capacidad_Usada__c`,
`Cupos_Libres__c` (**fórmula**), `Disponible__c` (**fórmula**).

Validation rules: `Fin_Posterior_A_Inicio`, `Capacidad_No_Negativa`, `Capacidad_Usada_No_Excede_Total`.

```
SLOT-000385 | FL-QRO | 31 jul 21:00-23:00 | Diagnostico
Capacidad_Total__c=3 | Capacidad_Usada__c=1 | Cupos_Libres__c=2 | Disponible__c=true
```

Sin huecos: los 729 completos.

#### `Unidad_Varada__c` — 26 registros · 21 campos (Gabriel, 2 ago)
El reporte de asistencia en carretera. **La escribe `Crear_Reporte_Unidad_Varada` (INSERT).**
Autonumber `VAR-{000000}`.

Seguridad: `Fuera_De_Carril__c`, `Intermitentes_Encendidas__c` (ambos requeridos).
Ubicación: `Carretera__c` (120), `Kilometro__c`, `Sentido__c` (picklist), `Referencia_Ubicacion__c`.
Falla: `Descripcion_Falla__c` (8000), `Codigos_Falla_Tablero__c` (255), `Carga__c` (picklist).
Unidad: `VIN_Reportado__c` (17), `Asset__c` (lookup).
Gestión: `Estado__c` (requerido, 6 valores), `Prioridad__c`, `Fecha_Reporte__c` (requerido),
`Fecha_Resolucion__c`, `Horas_Detenida__c` (fórmula), `Coordinador__c` (lookup User),
`Sucursal_Apoyo__c` (lookup), `Case__c`, `WorkOrder__c`, `Correlation_Id__c`.

Validation rules: `Seguridad_Antes_De_Avanzar` (no se sale de "Reportada" sin las dos banderas),
`Resuelta_Requiere_Fecha`.

```
VAR-000024 | Reportada | Critica | 3 ago 21:56
Mexico-Queretaro 57D, km 120, Norte | "Marca falla de frenos de aire" | SPN 520192
Carga=Cargada | VIN=3HAMMAAR8LL123456 -> Unidad 101 | seguridad confirmada
```

**Huecos: `Coordinador__c`, `Case__c`, `WorkOrder__c` y `Fecha_Resolucion__c` vacíos en los 26.**
El reporte se levanta pero nadie lo asigna ni lo cierra: el ciclo termina en "Reportada".

#### `Case` — estándar · 34 registros · 4 campos custom (Gabriel)
**Lo escribe `Reprogramar_Orden_Servicio` (INSERT), solo cuando la ventana restringida impide mover.**

`Asset__c` (lookup), `WorkOrder__c` (lookup), `Correlation_Id__c`, `Politica_Aplicada__c`.
`Origin` lleva el valor `Agentforce`, agregado al StandardValueSet el 3 de agosto.

```
00001035 | New | High | Origin=Agentforce
"Reprogramacion fuera de ventana - orden 00000026"
Politica_Aplicada__c = K_REPROGRAMACION_TALLER
```

Los 4 campos custom vacíos en 26 de 34 (los 8 poblados son del agente; el resto es seed).

#### `Log_Agente__c` — 98 registros · 19 campos (Gabriel)
La trazabilidad. **La escribe `Registrar_Log_Agente`, invocado por los tres Flows.**
Autonumber `LOG-00000000`.

`Correlation_Id__c` (**requerido**), `Session_Key__c`, `Subagent__c` (picklist: Garantia,
Diagnostico, Agenda, Compensacion, **Varada**), `Action_Name__c`, `Outcome__c` (requerido),
`Error_Code__c`, `Guardrail_Triggered__c`, `Related_Record_Id__c`, `Asset__c`, `WorkOrder__c`,
`Case__c`, `Unidad_Varada__c`, `Knowledge_Article_Version_Id__c`, `Policy_Version__c` (Text **40**),
`Odometer_Used__c`, `Odometer_Source__c`, `Unit_Verified__c`, `Timestamp__c` (requerido), `Actor__c`.

Validation rule: `Error_Requiere_Codigo` (ERROR o BLOCKED exigen código o guardrail).

```
LOG-00000123 | Crear_Reporte_Unidad_Varada | Varada | SUCCESS
Guardrail_Triggered__c = SEGURIDAD_NO_CONFIRMADA | Unit_Verified__c = false
Actor__c = agente_postventa_zapata@...
```

**Huecos críticos: `Knowledge_Article_Version_Id__c` poblado en 2 de 98** y `Policy_Version__c`
en 5 de 98. La acción de conocimiento **no escribe ni un solo log** (0 de 98).

### Objetos que el agente solo LEE

| Objeto | Reg. | Campos | Qué guarda |
|---|---:|---:|---|
| `Asset` | 15 | 22 (17 Gabriel + 5 Diego) | La unidad. `SerialNumber` = VIN. Ver detalle abajo |
| `Account` | 18 | 9 | Cliente o flota. `RFC__c` y `Ultimos_4_Telefono__c` **vacíos en los 18** |
| `Product2` | 22 | 5 | Modelo. Solo **4 de 22** son de Zapata (`Marca__c` poblado) |
| `Sucursal__c` | 9 | 13 | Taller. Código, ciudad, `Anticipacion_Minima_Horas__c`=24, horarios, zona horaria |
| `Modelo_Sucursal__c` | 180 | 6 | Qué modelo atiende cada taller y en qué sistema |
| `Regla_Cobertura__c` | 36 | 12 | Meses y km límite por modelo y sistema, con id de artículo |
| `Exclusion_Garantia__c` | 9 | 5 | Qué no cubre la garantía, con sinónimos para búsqueda |
| `Sintoma__c` | 10 | 8 | Árbol de diagnóstico: código, riesgo, preguntas de descarte |
| `Parametros_Garantia__c` | 1 | 5 | Custom Setting: 24 meses, 250,000 km, vigencias, margen 10% |
| `Knowledge__kav` | 20 online | 7 | Artículos. `Contenido__c` (Diego) es lo que lee el Apex |

**`Asset` al detalle** — el objeto más cargado:

Verificación: `Unidad_Verificada__c`, `Fecha_Verificacion__c`, `Metodo_Verificacion__c`
(picklist: Ultimos 4 del telefono / Folio de OS previa / RFC).
Odómetro: `Odometro__c` (Diego), `Ultimo_Odometro_Verificado__c`, `Fecha_Odometro_Verificado__c`,
`Dato_Odometro_Vigente__c` (**fórmula**), `Km_Ultimo_Servicio__c` (Diego), `Proximo_Servicio_Km__c` (Diego).
Cobertura: `Estado_Cobertura__c` (**picklist**, no fórmula), `Fecha_Ultima_Evaluacion__c`,
`Evaluacion_Vigente__c` (**fórmula**), `Cobertura_Citable__c` (**fórmula**),
`Estado_Garantia_Basica__c` (**fórmula**, 5 estados), `Garantia_Vigente__c` (Diego),
`Garantia_Extendida__c`, `Extendida_Aplicable__c`, `Fecha_Contratacion_Extendida__c`,
`Meses_Desde_Instalacion__c` (fórmula), `Servicios_Completos__c`.
Otros: `Tipo_Unidad__c` (Diego), `Placa__c`.

Estado real de los 15: **1 con `Unidad_Verificada__c = true`** (Unidad 101), 15 con dato de
odómetro vigente, 10 con garantía vigente, **1 con `Estado_Cobertura__c` poblado**.

### Objetos vacíos, esperando su acción

| Objeto | Reg. | Campos | Acción que lo llenaría |
|---|---:|---:|---|
| `Sesion_Diagnostico__c` | 0 | 11 | `Registrar_Resultado_Diagnostico` (P0 #8) |
| `Invalidacion_Garantia__c` | 0 | 8 | Parte de `Evaluar_Cobertura_Garantia` (P0 #3) |
| `Lectura_Odometro__c` | 1 | 6 | `Registrar_Lectura_Odometro` (P0 #2). El registro es seed |
| `Brecha_Conocimiento__c` | 0 | 5 | P1, fuera de alcance |

### Objetos muertos (modelo v1 de Diego)

| Objeto | Estado |
|---|---|
| `Accion_Agente_IA__c` | **Borrado de la org.** Sus 5 campos en la papelera |
| `Cita_Servicio__c` | Existe, **0 campos custom vivos**, 0 registros. 9 campos borrados |
| `Log_Agente_IA__c` | Existe, **0 campos custom vivos**, 0 registros. 6 campos borrados |

---

## 4. Clases Apex (6, ninguna con trigger)

| Clase | Tamaño | Autor | Qué hace |
|---|---:|---|---|
| `ZapataAgendaController` | 10,732 | Gabriel (30 jul) | `@AuraEnabled` para el calendario + `@InvocableMethod` de disponibilidad. `with sharing`, consultas `WITH USER_MODE` |
| `ZapataAgendaControllerTest` | 7,889 | Gabriel | Su test |
| `BuscarConocimientoPostventa` | 5,011 | **Diego** (30 jul) | Lee `Knowledge__kav.Contenido__c` y devuelve contenido + títulos. `with sharing` |
| `ZapataFormatoFecha` | 1,922 | Gabriel (3 ago) | Formatea la cita en español de México. Existe aparte porque Apex solo admite un `@InvocableMethod` por clase |
| `ZapataFormatoFechaTest` | 2,220 | Gabriel (3 ago) | 3 pruebas |
| `ZapataFlowsAgentePermisosTest` | 5,091 | Gabriel (3 ago) | 4 pruebas con `System.runAs` del agente |

**0 triggers en toda la org.**

---

## 5. Flows nuestros (4 de ~125 en la org; el resto son del template)

| Flow | Tipo | Estado | Autor |
|---|---|---|---|
| `Registrar_Log_Agente` | AutoLaunched | Activo | Gabriel (2 ago) |
| `Crear_Orden_Servicio` | AutoLaunched | Activo | Gabriel (3 ago) |
| `Reprogramar_Orden_Servicio` | AutoLaunched | Activo | Gabriel (3 ago) |
| `Crear_Reporte_Unidad_Varada` | AutoLaunched | Activo | Gabriel (3 ago) |

**No hay ningún Flow record-triggered.** Por eso nada estampa el odómetro en `Asset`.

---

## 6. El agente

`Agente_Postventa_Zapata` · Bot `0XxgK0000022RhJSAU` · tipo **AgentforceServiceAgent** · es_MX
Usuario de ejecución: `agente_postventa_zapata@00dgk00000vxsyc874696804.ext`, perfil `Einstein Agent User`.

**Versión 5 = Activa.** Existen v1 a v5 publicadas más un borrador v6.

| Subagente | Acciones | Estado |
|---|---|---|
| Agent Router | solo enruta | Funcional |
| Conocimiento y Respuestas | `Buscar_Conocimiento_Postventa` | Funcional, **pero no deja log** |
| Agendar Servicio en Taller | `Consultar_disponibilidad_de_taller`, `Crear_Orden_Servicio`, `Reprogramar_Orden_Servicio` | Funcional |
| Atención de Unidades Varadas | `Crear_Reporte_Unidad_Varada` | Funcional |
| Escalamiento a Asesor Humano | `@utils.escalate` | **NO ejecuta.** 0 MessagingChannel en la org |
| Fuera de Alcance | ninguna, por diseño | Funcional |
| Pregunta Ambigua | ninguna, por diseño | Funcional |

Bloque `knowledge:` del Agent Script: `citations_enabled: False`, `rag_feature_config_id` vacío.
`available when` (filtros de acción): **0 usos en todo el archivo**.
Variables mutables declaradas (`vin_validado`, `tipo_consulta`, `unidad_id`): **nadie las escribe**.

---

## 7. Reglas de validación (16, todas de Gabriel)

`Lectura_Odometro__c`: Fecha_No_Futura · Kilometraje_Positivo · Verificada_Requiere_Fuente_Verificado
`Slot_Taller__c`: Fin_Posterior_A_Inicio · Capacidad_No_Negativa · Capacidad_Usada_No_Excede_Total
`Unidad_Varada__c`: Seguridad_Antes_De_Avanzar · Resuelta_Requiere_Fecha
`Sintoma__c`: Autoservicio_Requiere_Alertas · Critico_No_Permite_Autoservicio
`Regla_Cobertura__c`: Limites_Positivos · Vigencia_Odometro_Razonable
`Sesion_Diagnostico__c`: Requiere_Fuente_Knowledge · Resuelto_Sin_Cita_Requiere_Pasos
`Modelo_Sucursal__c`: Capacidad_Diaria_Positiva
`Log_Agente__c`: Error_Requiere_Codigo

---

## 8. Seguridad

`Zapata_Agente_Servicio` — el permission set del agente. Asignado a Gabriel, Diego y al usuario del agente.
Objetos con acceso: `WorkOrder` (C/E), `Case` (C/E), `Unidad_Varada__c` (C/E), `Sesion_Diagnostico__c` (C/E),
`Brecha_Conocimiento__c` (C/E), `Slot_Taller__c` (E), `Log_Agente__c` (C), `Lectura_Odometro__c` (C),
`Invalidacion_Garantia__c` (C), `Sucursal__c` (R), `Modelo_Sucursal__c` (R), `Regla_Cobertura__c` (R),
`Exclusion_Garantia__c` (R), `Sintoma__c` (R), y **`Account` · `Asset` · `Product2` (R, agregados el 3 de agosto)**.
158 permisos de campo. `PermissionsRunFlow = true`. Acceso a `ZapataAgendaController`.

`Agente_Postventa_Acceso` — legacy de Diego. Solo cubre `Cita_Servicio__c` y `Log_Agente_IA__c`,
los dos objetos muertos. Sigue asignado al agente pero no aporta nada.

Grupo público `Zapata_Agentes` + regla de compartir `Zapata_Agente_Ve_Ordenes` sobre `WorkOrder`
(owner-based, acceso Edit) — porque `WorkOrder` es OWD Privado y la licencia del agente no admite "Ver todos".

---

## 9. Interfaz

App `Zapata_Postventa` (Gabriel). 17 tabs: los objetos custom más `Zapata_Inicio`, `Zapata_Agenda`,
`Zapata_Garantia`, `Zapata_Diagnostico`, `Zapata_Compensacion`.
Componente Lightning `zapataCalendarioTaller` (Gabriel), alimentado por `ZapataAgendaController`.

---

## 10. Pendientes

### Bloqueantes para el P0

1. **`Crear_Caso_Escalamiento`** (P0 #7). El subagente de escalamiento hoy dice que va a transferir
   y no hace nada. En video se ve bien y no deja rastro.
2. **`Evaluar_Cobertura_Garantia`** (P0 #3). Sin ella, `Estado_Cobertura__c` nunca se actualiza y
   las 15 unidades quedan en REQUIERE_DATO.
3. **`Registrar_Lectura_Odometro`** (P0 #2) + el Flow record-triggered que estampa `Asset`.
4. **`Buscar_Verificar_Unidad`** (P0 #1). Y antes que el código: `Account.RFC__c` y
   `Ultimos_4_Telefono__c` están vacíos en los 18, no hay contra qué verificar.
5. **`Registrar_Resultado_Diagnostico`** (P0 #8). `Sesion_Diagnostico__c` sigue en 0.
6. **Solo 1 de 15 unidades verificadas.** Bloquea agendar en 14.

### De trazabilidad (pega en el 40% y el 10% de la rúbrica)

7. La acción de conocimiento **no escribe log**. 0 de 98.
8. `Knowledge_Article_Version_Id__c` poblado en 2 de 98.

### De diseño pendientes de decisión

9. `available when` no se usa en ningún lado, aunque la sección 8.3 del plan lo exige.
10. Las variables mutables del agente están declaradas y nadie las escribe.
11. `citations_enabled` en falso.
12. El agente es `AgentforceServiceAgent`, no Employee Agent como dice la sección 2 del plan.

### Higiene

13. Borrador **v6** del agente sin cerrar.
14. `Cita_Servicio__c` y `Log_Agente_IA__c` vacíos y sin campos; `Agente_Postventa_Acceso` sigue asignado.
15. Datos de prueba en la org: correlation `DRYRUN-*`, `PERMTEST-*`, `CONV-*`. Limpiar antes de grabar.
16. La suite `Zapata_Flows_P0` referencia el folio `00000025` literal.

### Hardcodes que conviene conocer

17. `+ 0.25` (6 horas) en los dos Flows de agenda para la medianoche de México.
18. 24 horas de anticipación por defecto si la sucursal no la define.
19. Umbrales de largo (8 y 16 caracteres) para descartar correlation ids inventados.
