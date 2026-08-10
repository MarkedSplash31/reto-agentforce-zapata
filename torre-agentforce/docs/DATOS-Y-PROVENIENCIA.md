# Datos y proveniencia

Fecha de auditoría: **5 de agosto de 2026**.

Este documento separa dos ideas que antes aparecían mezcladas: una petición puede
consultar o escribir **de verdad** en una org de Salesforce y, aun así, el contenido
del registro puede ser semilla sintética. «Está en Salesforce» no significa «es dato
de un cliente real de Zapata».

## Etiquetas

| Etiqueta | Significado |
|---|---|
| **WEB** | Derivado del sitio público de Zapata. Es una observación externa con fecha, no una confirmación interna de negocio. |
| **SF-O** | Efecto operativo real en la org Developer Edition: la consulta o escritura ocurrió y Salesforce asignó Id/folio/fecha. No prueba que el sujeto del registro sea un cliente real. |
| **GEN** | Semilla sintética, contenido redactado por el equipo, cálculo derivado o supuesto. Nunca debe presentarse como póliza, flota, capacidad o cliente real. |
| **BLOQ** | No disponible o no verificado por una dependencia o decisión humana pendiente. |

Un campo puede tener dos etiquetas. Por ejemplo, un `Slot_Taller__c.Inicio__c` es
**WEB+GEN**: se genera desde el horario publicado, pero el bloque concreto no salió de
la agenda interna del taller.

## Resumen ejecutivo por dataset

| Dataset | Clasificación honesta | Qué sí demuestra |
|---|---|---|
| Sucursales y familias Freightliner | **WEB**, con algunos campos **GEN** | Observaciones del sitio oficial cargadas en Salesforce |
| Agenda (`Slot_Taller__c`) | **WEB+GEN**; ocupación **SF-O** | Algoritmo y Flow de reserva, no disponibilidad real del taller |
| Flota, cuentas y VIN (`Asset`, `Account`) | **GEN** | Lectura/filtrado contra la org, no flota real |
| Pólizas (`Regla_Cobertura__c`, `Parametros_Garantia__c`) | **GEN** | Detección de contradicciones del modelo de demo, no garantía real de Zapata |
| Órdenes, varadas, casos, comentarios y logs | **SF-O** sobre escenarios **GEN** | Escritura, relectura, correlación y guardrails reales en Salesforce |
| Metadata del agente, Flows y objetos | **SF-O** | La arquitectura realmente desplegada en la org |
| Conversación Agent API | **BLOQ** | Cliente implementado contra contrato; no ejecución exitosa en esta org |
| Identidad visual | **WEB**; hero **GEN** | Derivación del sistema visual, no un asset fotográfico oficial |

## Estado exacto después de la migración de proveniencia

La migración del 6 de agosto UTC clasificó todos los registros del alcance y fue
idempotente: una segunda ejecución modificó 0 filas.

| Dataset | Estado exacto en la org |
|---|---|
| `Knowledge__kav` latest | 20/20 `Online`, `Version_Politica__c=v1.0-sintetica-no-verificada` |
| `Slot_Taller__c` | 729 `Procedencia__c=SITIO_WEB_CAPACIDAD_ASUMIDA`; 0 `OPERACIONAL_VERIFICADO` |
| `Asset` | 15/15 `Procedencia__c=SEED_SINTETICO_NO_VERIFICADO` y `Unidad_Verificada__c=false` |
| `WorkOrder` | 30 `Procedencia__c=PRUEBA_TRANSACCIONAL_SIN_FUENTE_CONFIRMADA` |
| `Unidad_Varada__c` | 28 `Procedencia__c=PRUEBA_TRANSACCIONAL_SIN_FUENTE_CONFIRMADA` |
| Registros sin clasificar en alcance | 0 |

Los valores de `Procedencia__c`, `Version_Politica__c` y
`Unidad_Verificada__c` son guardrails persistidos, no sólo etiquetas de la UI. La
evidencia agregada está en `evidencia/14-proveniencia/`.

## Campos expuestos por la Torre

La lista siguiente cubre los campos que el servidor consulta o deriva. Campos de la
org que la Torre no expone quedan fuera de este contrato.

### `Asset` y `Lectura_Odometro__c`

**GEN:** la flota actual es semilla. Incluye nombres, VIN, placas, cuentas, modelo,
fechas de instalación, kilometrajes y estados. Los VIN mezclan marcas y los 15 Asset
apuntan a un T680 que no cruza con las reglas Freightliner.

- `Asset`: `Id`, `Name`, `SerialNumber`, `Status`, `Product2Id`, `Product2.Name`,
  `Product2.ProductCode`, `Account.Name`, `Odometro__c`,
  `Ultimo_Odometro_Verificado__c`, `Fecha_Odometro_Verificado__c`,
  `Estado_Cobertura__c`, `Tipo_Unidad__c`, `Placa__c`,
  `Unidad_Verificada__c`, `InstallDate`, `Garantia_Extendida__c`.
- **GEN derivado por fórmulas Salesforce:** `Dato_Odometro_Vigente__c`,
  `Cobertura_Citable__c`, `Garantia_Vigente__c`,
  `Meses_Desde_Instalacion__c`, `Evaluacion_Vigente__c`,
  `Extendida_Aplicable__c`, `Estado_Garantia_Basica__c`.
- `Lectura_Odometro__c`: `Id`, `Name`, `Asset__c`, `Fecha_Lectura__c`,
  `Kilometraje__c`, `Fuente__c`, `Verificada__c`, `Correlation_Id__c` son **GEN**;
  sólo existe un registro semilla en la fotografía auditada.

`historialOdometro` es un arreglo **generado por el servidor** al agrupar lecturas.
Vacío significa que no existe serie, no que haya un historial real en cero.

### `Sucursal__c`

- **WEB:** `Name`, `Ciudad__c`, `Direccion__c`, `Telefono__c`,
  `Horario_Atencion__c`, `Horario_Sabado__c`, `Abre_Domingo__c`,
  `Anticipacion_Minima_Horas__c`, `Marca_Principal__c`.
- **WEB+GEN:** `Codigo_Sucursal__c` es una clave interna creada para representar la
  agencia observada; no es un identificador publicado por Zapata.
- **GEN/asumido:** `Activa__c` y la mayoría de `Zona_Horaria__c`. Monterrey tiene una
  zona diferenciada en el cargador; el resto usa `America/Mexico_City` por defecto.
- `Id` es **SF-O**: lo asignó Salesforce al registro cargado.

Fuente trazable: `zapata-agentforce/docs/DATOS-REALES-ZAPATA.md` y
`zapata-agentforce/scripts/apex/cargar-sucursales-reales.apex`. La observación fue el
30 de julio de 2026 y puede quedar obsoleta.

### `Product2` y `Modelo_Sucursal__c`

- Las filas `Freightliner Cascadia`, `M2`, `114SD` y `FL 360`, con `Name`,
  `ProductCode`, `Marca__c` y familia general, son **WEB**.
- Descripciones, `Anio_Modelo__c=2026` y `Manual_Completo__c=false` son **GEN**.
- El T680 al que apunta la flota y cualquier fila de prueba son **GEN**.
- En `Modelo_Sucursal__c`, `Sucursal__c`, `Modelo__c`,
  `Sistemas_Soportados__c`, `Nivel_Servicio__c='Servicio completo'`,
  `Capacidad_Diaria__c=4` y `Activo__c=true` son **GEN/asumidos**. El sitio no
  confirmó cobertura total de modelo × sistema ni capacidad diaria.

### `Slot_Taller__c`

- `Sucursal__c`: referencia a una sucursal **WEB** cargada en Salesforce.
- `Inicio__c`, `Fin__c`: **WEB+GEN**. El generador divide el horario público en
  bloques de dos horas; no consultó disponibilidad interna.
- `Tipo_Servicio__c`: **GEN**, asignado cíclicamente.
- `Capacidad_Total__c`: **GEN/asumido** (3 entre semana, 2 el sábado).
- `Capacidad_Usada__c`: parte en cero **GEN**; sus incrementos/decrementos hechos por
  los Flows son **SF-O**.
- `Cupos_Libres__c`, `Disponible__c`: **GEN derivados** por fórmulas sobre esas
  capacidades; no equivalen a cupos reales del taller.
- `Id`, `Name`: **SF-O** como identidad técnica en la org.

### Cobertura y garantía

`Regla_Cobertura__c` es **GEN** en todos los campos expuestos: `Id`, `Name`,
`Sistema__c`, `Meses_Limite__c`, `Km_Limite__c`, `Sin_Limite_Km__c`,
`Es_Extendida__c`, `Knowledge_Article_Id__c`, `Deducible__c`, `Version__c`,
`Vigencia_Odometro_Dias__c`, `Clave_Unica__c`, `Activa__c`, `Modelo__c`,
`Modelo__r.Name` y `Modelo__r.ProductCode`. Los Id son técnicamente **SF-O**, pero la
póliza representada no es real. La versión `v1.0-sintetica` del cargador lo declara.

`Parametros_Garantia__c` también es **GEN**: `Id`, `Name`, `Meses_Base__c`,
`Km_Base__c`, `Margen_Cerca_Limite_Pct__c`, `Vigencia_Odometro_Dias__c` y
`Vigencia_Evaluacion_Dias__c`.

Los siguientes campos de respuesta son **GEN derivados por código**, no nuevas
fuentes: `veredicto`, `motivo`, `calculoReplicado`, `hayConflicto`, `tipoConflicto`,
`sistemasQueDifieren`, `sinReglasParaElModelo`, `citabilidad`, `advertencias`,
`modelos`, `difiereDeLaBase` y `detalleDiferencia`. La aplicación compara dos reglas
sintéticas/inconsistentes; no debe decir «cobertura real».

### `WorkOrder`

Las altas y actualizaciones hechas por `Crear_Orden_Servicio` y
`Reprogramar_Orden_Servicio` son **SF-O**: Salesforce asigna `Id` y
`WorkOrderNumber`, y la Torre relee el efecto. El contexto sigue siendo **GEN** porque
la unidad, cuenta, síntoma y agenda son de escenario.

Campos: `Id`, `WorkOrderNumber`, `Status`, `StartDate`, `EndDate`, `Subject`,
`Priority`, `AssetId`, `Asset.Name`, `Asset.SerialNumber`, `Account.Name`,
`Sucursal__c`, `Sucursal__r.Name`, `Sucursal__r.Codigo_Sucursal__c`,
`Tipo_Cita__c`, `Origen_Atencion__c`, `Correlation_Id__c`,
`Sintoma_Reportado__c`, `Slot_Taller__r.Name`, `Slot_Taller__r.Inicio__c`,
`Slot_Taller__r.Fin__c` y `Placa__c`.

Los folios/Ids/estados son **SF-O**; nombres, VIN, placa, síntoma y fechas elegidas
por pruebas o usuarios de demo son **GEN/entrada de escenario**.

### `Unidad_Varada__c`

La creación vía Flow es **SF-O**; el incidente representado es **GEN/entrada de
escenario**.

Campos: `Id`, `Name`, `Estado__c`, `Prioridad__c`, `Carretera__c`,
`Kilometro__c`, `Sentido__c`, `Referencia_Ubicacion__c`, `VIN_Reportado__c`,
`Asset__c`, `Asset__r.Name`, `Asset__r.SerialNumber`, `Correlation_Id__c`,
`Fecha_Reporte__c`, `Fecha_Resolucion__c`, `Horas_Detenida__c`,
`Descripcion_Falla__c`, `Codigos_Falla_Tablero__c`, `Carga__c`,
`Fuera_De_Carril__c`, `Intermitentes_Encendidas__c`, `Sucursal_Apoyo__r.Name`,
`Sucursal_Apoyo__r.Codigo_Sucursal__c`, `WorkOrder__r.WorkOrderNumber` y
`Case__r.CaseNumber`.

`Id`, autonúmero, fecha y relaciones confirmadas son **SF-O**; ubicación, falla, VIN,
carga y banderas son **GEN/entrada de escenario**; `Horas_Detenida__c` es derivado.

### Escalamiento: `Case` y `CaseComment`

La escritura y relectura son **SF-O**; la conversación es **GEN/entrada de prueba** y
no prueba atención de un asesor real. El escalamiento inicial del agente se escribe
atómicamente por Apex: Case, comentarios semilla internos y Log comparten
correlación. Los comentarios posteriores del cliente/rol asesor conservan la
visibilidad solicitada y se releen desde Salesforce.

- `Case`: `Id`, `CaseNumber`, `Status`, `Origin`, `Subject`, `Priority`,
  `Correlation_Id__c`, `Politica_Aplicada__c`, `CreatedDate`, `Owner.Name`,
  `Asset__c`, `WorkOrder__c`.
- `CaseComment`: `Id`, `ParentId`, `CommentBody`, `IsPublished`, `CreatedDate`,
  `CreatedBy.Name`. El resumen/contexto inicial usa `IsPublished=false` para no
  exponer la transcripción en un portal.

El rol «asesor» de la UI no autentica a un asesor individual. `CreatedBy` corresponde
al usuario integrador. La cola existe en la org, pero su política de negocio no fue
confirmada por Zapata.

### `Log_Agente__c` y traza

Los registros creados por los Flows son **SF-O** y prueban correlación técnica; el
contenido describe escenarios **GEN**.

Campos: `Id`, `Name`, `Correlation_Id__c`, `Timestamp__c`, `CreatedDate`,
`Subagent__c`, `Action_Name__c`, `Outcome__c`, `Error_Code__c`,
`Guardrail_Triggered__c`, `Related_Record_Id__c`, `Session_Key__c`, `Actor__c`,
`Policy_Version__c`, `Odometer_Used__c`, `Odometer_Source__c`, `Unit_Verified__c`,
`Knowledge_Article_Version_Id__c`, `WorkOrder__c`, `WorkOrder__r.WorkOrderNumber`,
`WorkOrder__r.Status`, `Case__c`, `Case__r.CaseNumber`, `Case__r.Status`,
`Case__r.Subject`, `Unidad_Varada__c`, `Unidad_Varada__r.Name`,
`Unidad_Varada__r.Estado__c`, `Asset__c`, `Asset__r.Name` y
`Asset__r.SerialNumber`.

`resumen`, sus conteos, listas de subagentes/acciones/guardrails y timestamps extremos
son **GEN derivados** por el servidor. Los folios `DRYRUN-*`, `PERMTEST-*`, `CONV-*`
y equivalentes son pruebas, no conversaciones de clientes.

### Arquitectura y salud

- Metadata de `BotDefinition`, `GenAiPlannerBundle`, genAiFunctions, Flows, objetos y
  cola: **SF-O** como configuración existente en la org Developer Edition.
- `publico/datos/arquitectura.json`, Mermaid, `generadoEn`, listas de aristas,
  `implementacionesAcciones` y `ejecutaAlgo`: **GEN derivados** por el script desde
  el grafo, GenAiFunctions, Flows y Apex recién recuperados de esa org. El gate
  `requisitosArquitectura.escalamientoDurable` sólo queda en `true` si el código Apex
  demuestra DML sobre `Case`, `CaseComment` y `Log_Agente__c`.
- `/salud`: `status` y `build` son **GEN técnicos** de liveness y no consultan
  Salesforce.
- `/api/admin/salud`: latencias, conteos y disponibilidad son **SF-O técnicos** en el
  momento de la consulta; mensajes y `pasoQueFalta` son **GEN**. Exige rol `admin`.
  La ECA existe y está activa; Agent API sigue **BLOQ** hasta custodiar sus
  credenciales localmente y pasar una prueba completa del lifecycle.
- `/api/panorama`: cada conteo es una consulta **SF-O** de filas de origen mixto;
  no convierte esas filas en datos reales de negocio.

### Agentforce y Agent API

`Agente Postventa Zapata` v10 está activo y su validación de activación pasó. Preview
verificó que conocimiento revela la fuente no verificada, agenda no afirma capacidad
real y escalamiento crea 1 Case + 1 CaseComment + 1 Log correlacionados. Esto prueba
el agente y su acción en la org, pero no el canal Agent API externo.

`sessionId`, mensajes, `planId`, `traceId`, citas y eventos SSE permanecen **BLOQ**
para esta org. Los ejemplos del contrato y el token del harness loopback son **GEN** y
sirven sólo para verificar el protocolo local. No hay una conversación real exitosa
que pueda exhibirse como evidencia.

### Identidad visual y contenido estático

- Logo, tipografías, paleta, espaciados y reglas CSS medidas desde el sitio público:
  **WEB** con fecha de captura; pueden cambiar.
- `hero-red.svg`: **GEN**. Es una composición SVG calibrada, no una fotografía ni un
  asset oficial de Zapata.
- Textos explicativos, etiquetas, notas, descripciones y estados visuales: **GEN**.

## Regla de lenguaje

Permitido: «consulta en vivo a la org», «escritura confirmada y releída en
Salesforce», «sucursal derivada del sitio público», «escenario sintético».

Prohibido sin nueva evidencia: «flota real», «cliente real», «capacidad real»,
«póliza real», «conversación Agentforce verificada» o «dato productivo».
