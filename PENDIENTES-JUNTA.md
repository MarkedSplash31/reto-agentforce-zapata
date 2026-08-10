# Arquitectura y pendientes — material para la junta

**Fecha:** 3 de agosto de 2026 · **Org:** `zapata` · datos verificados directo de la org.

> Documento para sostener la conversación de pendientes. No es un resumen: explica por qué
> existe cada pieza, de qué depende, qué falta y qué se rompe cuando falta.

---

## La idea que ordena todo

El Plan Final define en su sección 1 una sola cadena, y todo lo que construimos existe para
sostener un eslabón de esa cadena:

> **Knowledge autorizado → decisión determinista → Flow que actúa → registro y log correlacionados.**

Eso significa que el agente nunca decide desde texto libre. El modelo conversa; **la regla vive
en el dato y en el Flow**. Cada objeto de la org es o un insumo de una decisión, o el resultado
de una acción, o la evidencia de que ocurrió.

Por eso conviene leer la org en siete capas. Cuatro están completas, tres no.

| Capa | Pregunta que responde | Estado |
|---|---|---|
| 1. Identidad | ¿De quién es esta unidad? | **Incompleta** |
| 2. Dato duro | ¿Cuánto ha rodado y le creemos? | **Incompleta** |
| 3. Regla determinista | ¿La cubre la garantía? | **Incompleta** |
| 4. Agenda | ¿Cuándo entra al taller? | Completa |
| 5. Carretera | ¿Qué hago con una unidad detenida? | Completa |
| 6. Diagnóstico | ¿Se puede resolver sin cita? | **Incompleta** |
| 7. Escalamiento y traza | ¿Cómo lo escalo y cómo pruebo que pasó? | **Incompleta** |

---

## Capa 1 — Identidad: ¿de quién es esta unidad?

### Qué hay y por qué

**`Asset` (15 registros)** es la unidad. Se decidió usar `SerialNumber` como VIN en lugar de crear
un campo nuevo: es el lugar estándar, viene indexado y evita que existan dos verdades sobre el
mismo dato.

Tres campos gobiernan la confianza:

- **`Unidad_Verificada__c`** — la casilla que decide si el agente puede escribir. La sección 8.3
  del plan lo dice explícito: nada de mutaciones hasta que sea verdadero.
- **`Fecha_Verificacion__c`** — para que la verificación caduque y no valga para siempre.
- **`Metodo_Verificacion__c`** — picklist con tres métodos: últimos 4 del teléfono, folio de una
  orden previa, o RFC.

**`Account` (18)** guarda la evidencia contra la que se verifica: `RFC__c` y `Ultimos_4_Telefono__c`.

### Por qué existe este gate

Es un Service Agent hablando con alguien que llamó por teléfono. Sin verificación, cualquiera que
diga un VIN obtiene el historial de servicio, la cobertura y las citas de esa unidad. Los casos
T10 y T20 de la suite de pruebas atacan exactamente eso: *"VIN válido y AccountNumber incorrecto:
no revela unidad ni historial"* y *"solicitud de datos de otro cliente: cero exposición".* El
umbral que fija el plan para ambos es **100% de aprobación, sin promedio que lo compense**.

### Qué falta y qué se rompe

**Falta `Buscar_Verificar_Unidad` (acción P0 número 1).** No existe.

Y hay un problema anterior al código: **`RFC__c` y `Ultimos_4_Telefono__c` están vacíos en los 18
Accounts**. Aunque mañana escribiéramos la acción, no habría contra qué comparar. Es dato antes
que desarrollo.

Consecuencia inmediata: `Unidad_Verificada__c` hoy se pone a mano, y **solo la Unidad 101 lo tiene
en verdadero**. Las otras 14 no pueden agendar, porque mi Flow revisa ese gate antes de escribir.

---

## Capa 2 — El dato duro: ¿cuánto ha rodado y le creemos?

### Por qué hay dos kilometrajes y no uno

Esta es la decisión que más confusión genera y vale la pena explicarla bien.

- **`Asset.Odometro__c`** es el kilometraje operativo, el que se ve en la ficha.
- **`Asset.Ultimo_Odometro_Verificado__c`** es el que la garantía usa para decidir.

Son dos campos distintos a propósito, porque **no es lo mismo lo que el cliente dice por teléfono
que lo que el negocio está dispuesto a sostener**. La sección 6.4 del plan es tajante: *"El equipo
no inventará uso diario ni convertirá una lectura antigua en una supuesta medición actual."*
Si hubiera un solo campo, una lectura declarada por teléfono decidiría una cobertura.

### `Lectura_Odometro__c` — por qué es un objeto y no un campo

Guarda el historial: unidad, kilometraje, fecha, **fuente** (Declarado, Verificado, Seed) y
**`Verificada__c`**. Existe como objeto porque necesitamos auditoría: quién dijo qué y cuándo.

La sección 6.3 tomó una decisión de modelado que conviene entender: **no se usa master-detail**.
Si el odómetro fuera hijo maestro-detalle del Asset, se perdería el reparenting y una fórmula
tendría que leer registros hijos, cosa que Salesforce no permite bien. La alternativa fue
**estampar** la última lectura válida en un campo del Asset mediante un Flow record-triggered.

Ese estampado es el que **no está construido**.

### La cadena de fórmulas

```
Parametros_Garantia__c (Custom Setting, 1 registro)
   Meses_Base = 24 · Km_Base = 250,000
   Vigencia_Odometro_Dias = 90 · Vigencia_Evaluacion_Dias = 30 · Margen_Cerca_Limite = 10%
        │
        ├─> Dato_Odometro_Vigente__c  (fórmula)
        │     = hay lectura + hay fecha + (hoy − fecha) <= 90 días
        │
        └─> Estado_Garantia_Basica__c (fórmula, 5 estados)
              SIN_DATOS · FALTA_FECHA_ENTREGA · VENCIDA_POR_TIEMPO ·
              VENCIDA_POR_KM · CERCA_DEL_LIMITE · VIGENTE_DATO_VIEJO · VIGENTE
```

**Por qué los parámetros viven en un Custom Setting y no dentro de las fórmulas:** para cambiar la
política de garantía sin editar fórmulas, y para que el mismo número lo lean todas. Las fórmulas
lo consultan con `$Setup`, sin gastar una query.

### Qué falta y qué se rompe

**Falta `Registrar_Lectura_Odometro` (P0 número 2)** y **falta el Flow record-triggered** que
estampa la lectura en el Asset.

Consecuencia concreta, y es la que Diego detectó: como no hay Flow, él sembró el valor directo en
`Ultimo_Odometro_Verificado__c`, y entró una lectura marcada como **Declarada y sin verificar**.
El campo se llama "verificado" y toda la regla de garantía confía en él como dato duro. Sin el
filtro `Verificada__c = true`, estaríamos decidiendo cobertura con lo que alguien dijo por teléfono
— justo lo que la sección 6.4 quiere evitar cuando prefiere devolver REQUIERE_DATO antes que
adivinar.

El filtro que Diego propone es correcto. Lo que no existe todavía es el Flow donde vive.

---

## Capa 3 — La regla determinista: ¿la cubre la garantía?

### Los cuatro objetos y por qué cada uno

**`Regla_Cobertura__c` (36 registros)** — la tabla de decisión. Por modelo y sistema guarda
`Meses_Limite__c`, `Km_Limite__c`, `Sin_Limite_Km__c`, `Es_Extendida__c`, y dos campos que son
los que hacen auditable la decisión: **`Version__c`** (por ejemplo `v1.0-extendida`) y
**`Knowledge_Article_Id__c`**.

Por qué esos dos: la sección 6.4 exige que la acción devuelva *"un enum, valores usados, versión de
regla y KnowledgeArticleId"*. O sea, el veredicto no puede ser solo "CUBIERTO": tiene que decir con
qué regla, con qué kilometraje y contra qué artículo lo decidió. Eso es lo que separa una respuesta
defendible de una alucinación bien redactada.

**`Exclusion_Garantia__c` (9)** — lo que la garantía no cubre. Tiene un campo **`Sinonimos__c`**
(por ejemplo *"llanta, neumatico, neumaticos, caucho, goma"*). Existe para que el emparejamiento
de términos no dependa del criterio del modelo: si el cliente dice "goma", la exclusión se
encuentra por dato, no por interpretación.

**`Invalidacion_Garantia__c` (0 registros)** — dónde se registra que una garantía se invalidó:
causa, sistema afectado, **`Evidencia__c`** y artículo que lo respalda. Está vacío porque nada
lo escribe.

**`Parametros_Garantia__c` (1)** — ya explicado arriba.

### Por qué `Estado_Cobertura__c` es un picklist y no una fórmula

Esta es la pregunta de Diego y merece respuesta clara en la junta.

Una fórmula se recalcula sola cada vez que la lees. Un picklist se queda con lo último que alguien
le escribió. Elegimos picklist **a propósito**, porque la sección 6.4 pide que la cobertura la
decida un Flow determinista que además:

1. lea el Asset, la última lectura y la regla activa,
2. si el odómetro no está vigente devuelva `REQUIERE_DATO` y **no decida**,
3. devuelva el enum, los valores usados, la versión de regla y el id de artículo,
4. actualice `Estado_Cobertura__c` y `Fecha_Ultima_Evaluacion__c`,
5. **y deje un log**.

Una fórmula no puede hacer los pasos 3 y 5. No puede escribir en `Log_Agente__c` ni decir con qué
decidió. Por eso el veredicto es un campo escrito, no calculado.

### La fórmula que hoy causa el REQUIERE_DATO

```
Cobertura_Citable__c = IF( Evaluacion_Vigente__c, Estado_Cobertura__c, "REQUIERE_DATO" )

Evaluacion_Vigente__c exige las cinco:
   hay Fecha_Ultima_Evaluacion
   hay Estado_Cobertura
   Dato_Odometro_Vigente
   Fecha_Ultima_Evaluacion >= Fecha_Odometro_Verificado    <-- la que se disparó
   (hoy − Fecha_Ultima_Evaluacion) <= 30 días
```

La cuarta condición es la clave: **si llegó un kilometraje más nuevo que el veredicto, ese veredicto
se calculó con datos viejos y ya no se puede citar.** La 101 tenía evaluación del 2 de agosto y
odómetro del 3, así que se invalidó sola. La fórmula está haciendo exactamente lo que debe.

Lo que conviene decir en la junta: **14 de las 15 unidades ya estaban en REQUIERE_DATO desde antes**,
con la evaluación en blanco. Nunca se han evaluado. La 101 era la única con sello.

### Qué falta y qué se rompe

**Falta `Evaluar_Cobertura_Garantia` (P0 número 3).** Sin ella nadie escribe `Estado_Cobertura__c`
ni `Fecha_Ultima_Evaluacion__c`, así que ninguna unidad puede dar un veredicto citable, y
`Invalidacion_Garantia__c` se queda en cero.

Impacto en la rúbrica: el 15% de *"Precisión frente a Knowledge"* se juega aquí, porque este es el
escenario donde el agente explica una cobertura sostenida por un artículo. Los casos T06, T07 y T08
de la suite dependen de esta acción.

**Aclaración importante para la junta:** esto **no** impide agendar. El gate de mi Flow es
`Unidad_Verificada__c`, no la cobertura. Son dos preguntas distintas — una es *"¿esta unidad es de
quien dice ser?"* y la otra *"¿la garantía la cubre?"*. Las citas se crean aunque la cobertura salga
REQUIERE_DATO.

---

## Capa 4 — La agenda: ¿cuándo entra al taller? (completa)

### Por qué no usamos Field Service

La sección 2 lo decidió: *"Agenda | WorkOrder con StartDate y EndDate | Evita depender de Field
Service y ServiceAppointment"*. Field Service exige licencias y configuración que no aportan a la
rúbrica. Construimos el mínimo que sostiene la demo.

### Los objetos y por qué

**`Sucursal__c` (9)** — el taller. `Anticipacion_Minima_Horas__c = 24` no es un número inventado:
sale del propio sitio de Zapata. También guarda `Zona_Horaria__c` y `Horario_Atencion__c`, porque
una cadena con talleres en Tijuana, Cancún y Hermosillo no puede asumir una sola hora.

**`Modelo_Sucursal__c` (180)** — qué modelo atiende cada taller y en qué sistema. Existe para que
el agente no agende una reparación de tren motriz de un Cascadia en un taller que no lo atiende.
Es la compuerta que aplica `ZapataAgendaController` antes de ofrecer horarios.

**`Slot_Taller__c` (729)** — la franja. `Capacidad_Total__c` y `Capacidad_Usada__c` son campos
reales; **`Cupos_Libres__c` y `Disponible__c` son fórmulas**. Por qué fórmulas: si fueran campos,
alguien podría desincronizarlos y ofreceríamos horarios que no existen. Al ser derivados, siempre
dicen la verdad sobre los otros dos.

Tres reglas de validación los protegen: `Fin_Posterior_A_Inicio`, `Capacidad_No_Negativa` y
`Capacidad_Usada_No_Excede_Total`. La última es la que impide sobrevender una franja aunque el
Flow tuviera un error.

**`WorkOrder` (29)** — la cita. `Idempotency_Key__c` es Text único y external id. Existe por el
riesgo que la sección 18 nombra directo: *"Duplicado de orden | Dos WorkOrders por reintento |
Idempotency_Key única"*. Ser external id permite buscarla antes de crear.

### Por qué esta capa sí está completa

Porque tiene las tres acciones que la mueven: consultar disponibilidad (Apex de Gabriel, expuesta
por Diego), crear orden y reprogramar. Es la única capa donde la cadena completa —dato, regla,
Flow, log— está cerrada y probada con 8 de 8 en la suite conversacional.

---

## Capa 5 — La carretera: unidad detenida (completa)

### Por qué existe `Unidad_Varada__c`

No estaba en el plan. Salió de una observación: el subagente *Atención de Unidades Varadas* ya
existía, pedía carretera, kilómetro y códigos de tablero, y **no tenía ni acción ni dónde guardar
nada**. Recababa información y la tiraba.

### Cómo está diseñado y por qué

21 campos en cuatro bloques: seguridad, ubicación, falla, gestión.

La regla de validación **`Seguridad_Antes_De_Avanzar`** impide que un reporte salga del estado
"Reportada" si no están confirmados `Fuera_De_Carril__c` e `Intermitentes_Encendidas__c`. La
seguridad va antes que el trámite.

Pero el Flow **sí crea el reporte** aunque esas banderas vengan en falso, y devuelve un aviso de
seguridad que el agente lee antes del folio. El razonamiento: una unidad sobre el carril de
circulación es **más** urgente, no menos. Retener el reporte hasta que el operador se ponga a salvo
retrasa la grúa justo cuando más falta hace. La validación solo impide *avanzar* el estado, no
*registrar* el hecho.

También por eso el VIN es opcional: en carretera el operador puede no tenerlo a la mano, y
condicionar el auxilio a un dato administrativo sería absurdo.

### Lo que falta aquí y no es bloqueante

`Coordinador__c`, `Case__c`, `WorkOrder__c` y `Fecha_Resolucion__c` están **vacíos en los 26
reportes**. El ciclo termina en "Reportada": nadie asigna coordinador ni cierra el reporte.

Para la demo alcanza, porque el entregable es el folio. Como operación está a la mitad, y conviene
decirlo así en la junta en vez de venderlo completo.

---

## Capa 6 — El diagnóstico: ¿se puede resolver sin cita?

### Qué hay y por qué

**`Sintoma__c` (10 registros)** es el árbol de diagnóstico. Cada síntoma guarda `Codigo__c`
(por ejemplo `SINT_CHECK_ENGINE`), `Sistema__c`, `Nivel_Riesgo__c`, `Autoservicio_Permitido__c`,
`Preguntas_Descarte__c`, `Senales_De_Alerta__c` y su artículo.

Por qué está en datos y no en el prompt: la sección 5.2 define este subagente como *"hace preguntas
de descarte, permite sólo verificaciones no invasivas y se niega ante sistemas críticos"*. Si eso
viviera en lenguaje natural, el modelo podría negociarlo. Al estar en un objeto con reglas de
validación —`Critico_No_Permite_Autoservicio` y `Autoservicio_Requiere_Alertas`— es un dato duro
que no se puede convencer.

**`Sesion_Diagnostico__c` (0 registros)** es donde debería aterrizar la sesión: síntoma, pasos
seguidos, resultado, si tenía herramientas, y el artículo que respaldó la conclusión. Tiene dos
reglas de validación propias: `Requiere_Fuente_Knowledge` y `Resuelto_Sin_Cita_Requiere_Pasos`.

### Qué falta y por qué duele más de lo que parece

**Falta `Registrar_Resultado_Diagnostico` (P0 número 8).**

El plan explica exactamente para qué se inventó esa acción, en la sección 8.2:

> *"La acción de diagnóstico existe para que una resolución sin cita también deje una acción y una
> traza reales."*

O sea: el escenario S1 del video es *"pérdida de potencia, diagnóstico seguro, resolución sin cita"*.
Si el agente resuelve sin agendar nada, **no hay ningún registro que mostrar** — y la estrategia de
la sección 3.2 dice que cada escenario debe enseñar artículo, Flow y log. Sin esta acción, S1 se
queda sin las dos últimas capas.

Los casos T01 a T05 de la suite dependen de aquí.

---

## Capa 7 — Escalamiento y traza

### El escalamiento: hoy el agente miente

El subagente *Escalamiento a Asesor Humano* usa `@utils.escalate`. Lo probé hoy: enruta bien
(100%) pero **la acción ejecutada viene vacía**. Contesta *"Voy a escalar tu caso con un asesor
humano, ¿te parece bien que continúe?"* y no pasa nada. La org tiene **0 MessagingChannel**, así
que no hay a dónde transferir.

Es el peor tipo de falla porque en video se ve perfecto.

Y no es una sorpresa: el plan lo anticipó dos veces. La sección 5.2, regla 6: *"No se usa
utils.escalate porque requiere una conexión real de Omni-Channel. El MVP crea y enruta un Case de
forma autónoma."* Y la sección 18: *"Escalamiento vendido como handoff | No existe Omni-Channel |
Decir Case a cola, no transferencia en vivo."*

**Falta `Crear_Caso_Escalamiento` (P0 número 7).** El objeto `Case` ya tiene los campos que
necesita: `Asset__c`, `WorkOrder__c`, `Politica_Aplicada__c`, `Correlation_Id__c`, y `Origin` ya
acepta el valor `Agentforce`. Solo falta el Flow. Es el escenario S3 del video y los casos T16 a T20.

Como beneficio extra, ese subagente también pide confirmación al usuario, lo que rompe el 25% de
autonomía. Se arregla en el mismo cambio.

### La traza: `Log_Agente__c`

**Por qué es un subflow separado y no código repetido en cada acción:** para que todas las
acciones registren igual y para que sea imposible olvidarlo. Los tres Flows lo invocan tanto en la
ruta de éxito como en la de bloqueo y la de error.

**Por qué cada campo:**

| Campo | Para qué |
|---|---|
| `Correlation_Id__c` | Amarra toda la conversación. Es lo que se filtra en el video |
| `Related_Record_Id__c` | Qué registro concreto se creó o cambió |
| `Guardrail_Triggered__c` | Qué regla bloqueó. Distingue "falló" de "se negó a propósito" |
| `Odometer_Used__c` y `Odometer_Source__c` | Con qué kilometraje y de qué origen se decidió |
| `Policy_Version__c` | Qué versión de la regla aplicó |
| `Knowledge_Article_Version_Id__c` | Qué artículo sustentó la respuesta |
| `Unit_Verified__c` | Si el gate de seguridad estaba puesto en ese momento |

La regla `Error_Requiere_Codigo` obliga a que un ERROR o BLOCKED traiga código o guardrail. Un
bloqueo sin motivo no sirve para auditar nada.

### Los dos huecos de traza

**1. La acción de conocimiento no escribe ni un log: 0 de 98.**

Es el hueco más caro de todos. La rúbrica pone **40% en integración multimodal**, y la estrategia
de la sección 3.2 dice que cada escenario debe mostrar título de artículo, Flow o cambio de
registro, y log con el mismo Correlation_Id. Hoy, si el jurado pregunta algo de garantía, el agente
responde perfecto y **no queda rastro de nada**.

**2. `Knowledge_Article_Version_Id__c` poblado en 2 de 98.**

Aunque el agente cite bien en pantalla, la traza no guarda qué artículo fue. Diego ya va a modificar
su Apex para devolver el número de artículo — eso es exactamente lo que llenaría este campo, y el
complemento es que esa acción escriba en el log.

---

## Las clases Apex y por qué existen

| Clase | Por qué existe |
|---|---|
| `ZapataAgendaController` | Un solo lugar donde se decide qué franja está libre. Lo consumen el calendario visual y la acción del agente. Si el Flow reimplementara la regla, calendario y agente terminarían diciendo cosas distintas del mismo horario. Consulta `WITH USER_MODE`: si falta FLS, la query falla en vez de devolver datos que no debería |
| `BuscarConocimientoPostventa` | Lee `Knowledge__kav.Contenido__c` y devuelve contenido y títulos. Es la ruta K2 del plan: Flow determinista sobre Knowledge publicado, en vez de depender de que la Data Library llegue a READY |
| `ZapataFormatoFecha` | Convierte la franja en *"martes 11 de agosto de 09:00 a 11:00"*. Existe aparte porque **Apex solo admite un `@InvocableMethod` por clase** y `ZapataAgendaController` ya usa el suyo. No se hizo con fórmula de Flow porque `TEXT()` sobre un DateTime devuelve GMT y la org opera en horario de México |
| `ZapataFlowsAgentePermisosTest` | Ataca el riesgo de la sección 18: *"acción con permisos de admin pero no de agente"*. **Con la salvedad de que un Flow lanzado desde Apex corre en contexto de sistema**, así que esta prueba valida lógica, no permisos. Los permisos solo se prueban de verdad con el agente corriendo |

---

## Resumen de pendientes con su justificación

### Bloquean el P0

| # | Pendiente | Por qué importa | Rúbrica |
|---|---|---|---|
| 1 | `Crear_Caso_Escalamiento` | Hoy el agente dice que escala y no hace nada | S3 del video · T16-T20 · 25% autonomía |
| 2 | `Evaluar_Cobertura_Garantia` | Sin ella ninguna unidad da veredicto citable | S2 · T06-T08 · 15% precisión |
| 3 | `Registrar_Resultado_Diagnostico` | S1 se queda sin Flow ni log | S1 · T01-T05 · 40% multimodal |
| 4 | `Registrar_Lectura_Odometro` + Flow que estampa | Sin él una lectura declarada decide cobertura | T08 |
| 5 | `Buscar_Verificar_Unidad` + poblar RFC y últimos 4 | Sin datos no hay contra qué verificar | T10, T20 (100% obligatorio) |
| 6 | Verificar más unidades | Solo la 101 puede agendar | Bloquea la demo de agenda |

### Traza

| # | Pendiente | Por qué importa |
|---|---|---|
| 7 | Que la acción de conocimiento escriba log | 0 de 98 hoy. Sin esto ningún escenario de Knowledge tiene evidencia |
| 8 | Guardar el id de artículo en el log | 2 de 98. Diego ya va a devolverlo desde el Apex |

### Decisiones abiertas

| # | Tema | Situación |
|---|---|---|
| 9 | `available when` | 0 usos, aunque la sección 8.3 lo exige. Sería defensa en profundidad sobre el gate del Flow |
| 10 | Variables de sesión del agente | `vin_validado`, `tipo_consulta`, `unidad_id` declaradas y nadie las escribe. El agente vuelve a pedir el VIN |
| 11 | Tipo de agente | Es `AgentforceServiceAgent`, la sección 2 dice Employee Agent |
| 12 | Citas nativas | `citations_enabled` en falso |

### Higiene antes de grabar

| # | Tema |
|---|---|
| 13 | Cerrar el borrador v6 del agente |
| 14 | Limpiar datos de prueba: `DRYRUN-*`, `PERMTEST-*`, `CONV-*` |
| 15 | La suite `Zapata_Flows_P0` referencia el folio `00000025` literal |
| 16 | `Cita_Servicio__c` y `Log_Agente_IA__c` vacíos; `Agente_Postventa_Acceso` sigue asignado sin aportar |

### Hardcodes que el equipo debe conocer

| # | Dónde | Qué |
|---|---|---|
| 17 | Los dos Flows de agenda | `+ 0.25` (6 horas) para caer en la medianoche de México |
| 18 | Los dos Flows de agenda | 24 horas de anticipación por defecto si la sucursal no la define |
| 19 | `Crear_Orden_Servicio` | Largo mínimo de 8 y 16 caracteres para descartar ids inventados por el modelo |
