# Evaluación del Plan de Trabajo v1 — HISTÓRICA

> Esta evaluación conserva el rastro de los hallazgos sobre el plan original, pero
> algunas afirmaciones fueron corregidas después de verificar documentación oficial
> de Summer '26. La evaluación convergida y todas las decisiones vigentes están
> integradas en [PLAN-DE-TRABAJO-FINAL.md](PLAN-DE-TRABAJO-FINAL.md). En particular,
> no debe reutilizarse la afirmación sobre un retriever predeterminado que busca fuentes
> externas ni tratar ocho instrucciones como límite de plataforma.

# Evaluación del Plan de Trabajo v1 — Reto Hackatón Agentforce

Revisión técnica de `Plan_de_Trabajo_Reto_Agentforce.md.pdf` (10 páginas, 29 jul → 17 ago 2026).
Contrastado contra: la estructura real de Agentforce extraída en `salesforce/28-metadata-coral-cloud/`
(4 bots, 18 topics, 119 acciones, 212 contratos I/O) y contra los límites publicados de la plataforma.

**Veredicto en una línea:** el plan es bueno como *plan de proyecto* y débil como *plan de
Agentforce*. La disciplina de entrega está por encima del promedio de un hackathon; lo que falla es
que varios supuestos de plataforma no se sostienen — y que **el plan no lleva la rúbrica a la
vista**, por lo que optimiza cosas que no son las que más pesan (§A1).

> **Nota de lectura:** las secciones 1–3 se escribieron con el Plan de Trabajo únicamente. La
> **§4 (Addendum)** incorpora el Briefing y el Resumen Ejecutivo, y corrige dos puntos anteriores.
> Donde haya discrepancia, manda el addendum.

---

## 0. Lo que está bien y no hay que tocar

Antes de la crítica, lo que ya es un activo. Estos puntos se conservan íntegros en la v3:

| Acierto | Por qué vale |
|---|---|
| **Un solo agente con Topics, sin orquestador** | Técnicamente correcto. El clasificador de Topics *es* el router; construir un agente orquestador sería duplicar el runtime. Está confirmado en el metadata: `GenAiPlannerBundle` → `localTopicLinks` → cada topic carga solo sus acciones. |
| **Congelamiento el 15 + toma 2 de respaldo** | Es la regla que separa un entregable de una demo rota en vivo. |
| **Paquete documental de archivos `.md` que se ensambla en el `.docx`** | Evita el "documento escrito la última noche". Es la decisión más rentable del plan. |
| **Matriz de trazabilidad requisito → topic → flow → artículo → prueba → escena** | Es exactamente lo que un jurado busca para verificar que no hay humo. |
| **Bitácora con decisiones descartadas** | Diferenciador real de documentación. |
| **"Si hay que sacrificar algo, que sea configuración, nunca contenido"** | Diagnóstico correcto: en un agente con RAG, el contenido es el producto. |
| **Definición de "terminado" en 3 ejes (funciona / documentado / probado)** | Impide el falso avance. |
| **Riesgos con señal temprana + plan B** | Poco común y bien hecho. Solo le faltan números. |

---

## 1. Bloqueantes — pueden costar el reto, no solo puntos

### B1. "Developer Edition" a secas **no trae Agentforce**

El plan dice el miércoles 29: *"Crear org Developer Edition con Agentforce. Verificar que Data Cloud
esté aprovisionado."* Eso mezcla dos productos distintos. La Developer Edition clásica **no tiene
Agentforce Studio ni Data Cloud**. Lo que necesitan es el signup específico
**"Developer Edition with Agentforce and Data Cloud"**, que es un tipo de org aparte.

**Impacto si falla:** se descubre el jueves 30 al intentar crear los objetos y no encontrar el
Studio. Son 1–2 días perdidos de los 19 disponibles, en la semana que bloquea a todas las demás.

**Corrección:** convertir el día 1 en una *puerta de arranque* con verificación explícita de 7 puntos
(ver plan v3 §3). No se avanza a nada más hasta que los 7 estén en verde.

### B2. El límite de LLM está subestimado: son **150 generaciones por hora**

El plan lista el riesgo *"Se topa el límite de generaciones de LLM por hora"* con la señal
*"las pruebas empiezan a fallar sin razón aparente"* y el plan B *"probar por bloques"*. Correcto en
la intuición, pero sin el número no se puede planear. El número real en Developer Edition es
**150 generaciones LLM por hora**.

Lo que eso significa en la práctica, y que el plan no calcula:

- Un turno de conversación no es 1 generación. Es clasificación de topic + cada paso del ciclo
  ReAct (razonar → elegir acción → observar resultado → razonar de nuevo). Un escenario de
  diagnóstico guiado con 3 idas y vueltas consume fácilmente **6–12 generaciones**.
- Los 20 casos de `07_pruebas.md` en una corrida completa: **~120–200 generaciones**.
- Traducción: **cabe aproximadamente una corrida completa de pruebas por hora, y no dos personas
  probando al mismo tiempo.**

El sábado 8 el plan pide "corrida completa de los 3 escenarios end-to-end" en la pista Plataforma
**y** "ejecutar los 20 casos" en la pista Contenido, el mismo día. Con el límite real, esas dos
actividades compiten por la misma cuota y se van a estorbar.

**Corrección:** presupuesto de generaciones por día, ventanas de prueba asignadas por persona,
y un "modo seco" para validar Flows sin invocar al agente (ejecutar el Flow desde Setup con
entradas fijas). El modo seco cuesta 0 generaciones y atrapa el 70% de los errores.

### B3. El retriever el domingo 2 es el eslabón más frágil de todo el plan

*"Configurar retriever propio sobre la data library"* está puesto como criterio de cierre de la
semana 1. Es la pieza con **más dependencias externas y menos control**:

- Una Data Library es una capa de conveniencia sobre **Data Cloud (Data 360)**: requiere
  aprovisionamiento, ingesta, *chunking* e indexado.
- El indexado es asíncrono y puede tardar horas. Su modo de falla característico es **silencioso**:
  el agente responde "no encontré información" sin error, y el síntoma documentado más común de
  la plataforma es precisamente *Answer Questions with Knowledge devuelve 0 resultados aunque la
  búsqueda en Knowledge sí funcione*.
- Un retriever *propio* (custom retriever) añade encima la configuración de filtros y categorías.

Poner esto el último día de la semana 1, como condición de "listo", es apostar la fundación
entera a la pieza menos controlable — y hacerlo un domingo, sin días hábiles por delante para
reaccionar.

**Corrección:** partirlo en dos y adelantarlo.
1. **Sábado 1 (o antes):** crear la Data Library en cuanto existan **4 artículos**, no 12. El
   objetivo del sábado no es tener el contenido completo, es **arrancar el reloj del indexado**.
2. **Domingo 2:** probar, ajustar y **sobrescribir el retriever dinámico por el propio**.
   *(En la primera versión de esta evaluación propuse mover el retriever propio a la semana 2 como
   opcional. **Era un error** — ver §A2: sin sobrescribirlo, el agente busca en fuentes externas e
   inventa, y eso es el 15% de la rúbrica. Lo que sí se adelanta es el **indexado**, que es lo que
   da margen para configurarlo con calma.)*
3. **Fallback declarado:** si el indexado no responde, el agente cita artículos vía acción sobre
   Flow que consulta Knowledge directamente. Es menos elegante y hay que decirlo en la bitácora,
   pero mantiene la demo viva.

### B4. No está decidido el **tipo de agente**, y eso decide media arquitectura

El plan dice "un solo agente, 4 topics" pero nunca dice si es un **Employee Agent** (interno, lo usa
un asesor de servicio de Zapata) o un **Agentforce Service Agent** (externo, lo usa el cliente final
por web/WhatsApp). No es un detalle de presentación: cambia el canal, la identidad con la que corre,
los permisos, el sitio de Experience Cloud, y **si el escalamiento a humano es siquiera posible**.

Esto se ve en el metadata que ya tienen extraído, donde la decisión no es **un** campo sino **dos**,
más el cableado de canal:

```xml
<Bot>
    <agentType>Employee</agentType>              <!-- Employee | AgentforceEmployeeAgent -->
    <contextVariables>
        <contextVariableMappings>
            <SObjectType>MessagingEndUser</SObjectType>    <!-- ← solo existe si hay Messaging -->
            <messageType>EmbeddedMessaging</messageType>
        </contextVariableMappings>
    </contextVariables>
    ...
    <type>ExternalCopilot</type>                 <!-- ExternalCopilot | InternalCopilot -->
</Bot>
```

En su org: `Coral_Cloud_Agent` es `agentType=Employee` + `type=ExternalCopilot`; los otros tres son
`agentType=AgentforceEmployeeAgent` + `type=InternalCopilot`. Es decir, **hay que declarar dos cosas
distintas** —qué clase de agente es y por dónde habla— y los `contextVariableMappings` a
`MessagingEndUser`/`MessagingSession` solo tienen sentido en el camino externo. Elegir esto el día
1 es barato; descubrirlo el jueves 6 con los Flows ya hechos, no.

El riesgo que el propio plan lista —*"el escalamiento a humano real no se logra configurar / jueves
6 sin canal de Messaging funcionando"*— **es la consecuencia de no haber tomado esta decisión el
día 1.** El plan B propuesto (Flow → Case + cola + Chatter) es bueno, pero se está usando para
tapar una decisión pendiente, no un imprevisto.

**Recomendación:** **Employee Agent** como agente principal.
- Razón de negocio: en camiones el interlocutor real es el **asesor de servicio** o el **gestor de
  flota**, no un consumidor anónimo. El caso "el asesor identifica la unidad por VIN mientras el
  cliente está al teléfono" es más creíble para Zapata que un chat público.
- Razón de proyecto: evita Experience Cloud, perfil de usuario invitado, despliegue de Embedded
  Service y canal de Messaging. Eso es **~1 día completo de configuración** que no aporta a ningún
  criterio de evaluación.
- El escalamiento sigue siendo demostrable y real: Case con prioridad → cola → Chatter → Omni.
- Si sobra tiempo en la semana 3, exponer el mismo agente en un canal externo es aditivo, no un
  rediseño.

---

## 2. Estructurales — cuestan puntos en los criterios que dijiste que hay que ganar

### E1. Reproducibilidad: el plan **documenta** pero no **reproduce**

Es el hueco más grande respecto a tus criterios. Todo el plan produce archivos `.md` que
*describen* la org, pero la org se configura **a mano por la UI**. Si un juez pregunta "¿puedo
levantar esto?", la respuesta hoy es "sí, siguiendo 40 páginas de instrucciones a mano".

Y ya tienen la prueba de que saben hacerlo bien: `salesforce/28-metadata-coral-cloud/extract/force-app/main/default/`
contiene `bots/`, `genAiPlannerBundles/`, `genAiFunctions/`, `flows/`, `objects/` — metadata real
recuperada con Salesforce CLI. Es exactamente lo que le falta al plan.

**Corrección (la mejora de mayor retorno del documento entero, ~3 h de trabajo total):** proyecto
SFDX dentro del repo, `sf project retrieve start` al cierre de cada día de construcción, seed de
datos en CSV versionado, y un `README-REPRODUCIR.md` que reconstruya todo en dos comandos.
Con eso, "reproducible e implementable" deja de ser una afirmación y pasa a ser un artefacto.

### E2. Falta el **contrato I/O de cada acción** — y es la causa nº1 de agentes que no funcionan

`04_flows.md` especifica *"parámetros de entrada, qué consulta, qué crea o modifica, qué devuelve"*.
Eso es la vista del desarrollador. Agentforce necesita además la **vista del planner**: por cada
variable, una descripción escrita *para que la lea un LLM* y cuatro banderas que deciden el
comportamiento. Del metadata real que ya extrajeron (`Create_a_Reservation/input/schema.json`):

```json
"Check_In_Date": {
  "description": "This is the check-in date for the reservation. If a relative date is
                  provided, calculate it and use that. If one isn't provided ask for it.",
  "lightning:type": "lightning__dateType",
  "lightning:isPII": false,
  "copilotAction:isUserInput": true
}
```

Y en la salida:

```json
"output_Success": {
  "copilotAction:isDisplayable": false,
  "copilotAction:isUsedByPlanner": true,      // ← vuelve al ciclo de razonamiento = memoria
  "copilotAction:useHydratedPrompt": false
}
```

Cuatro banderas que el plan v1 no menciona en ningún lado:

| Bandera | Qué decide | Qué pasa si se ignora |
|---|---|---|
| `copilotAction:isUserInput` | Si el LLM la pregunta al usuario o la recibe del sistema | El agente pide el `Contact_Id` al cliente. Ridículo en demo. |
| `copilotAction:isUsedByPlanner` | Si la salida vuelve al ciclo de razonamiento | El agente ejecuta la acción y luego "olvida" el resultado. |
| `copilotAction:isDisplayable` | Qué ve el humano vs. qué es interno | Se filtran IDs y mensajes internos a la pantalla. |
| `lightning:isPII` | Dispara el enmascarado de la Trust Layer | El VIN y el teléfono viajan en claro al modelo. |

Y por encima de las banderas: **la descripción de cada variable es el prompt**. Una entrada
descrita como "VIN" no se llena; descrita como *"VIN de 17 caracteres de la unidad. Si el cliente
da menos de 17, pídelo completo; no inventes los faltantes"* sí. La causa más común de "el agente
no llama mi acción" no es la acción: es su descripción y la de sus variables.

**Corrección:** archivo `04_acciones.md` nuevo, con una ficha de contrato por acción. `04_flows.md`
se queda con la lógica interna del Flow. Son dos documentos distintos porque son dos audiencias
distintas: el LLM y el desarrollador.

### E3. Los guardrails están solo como texto — hay tres mecanismos declarativos sin usar

El plan pone los guardrails como instrucciones en lenguaje natural ("qué no debe prometer").
Necesario, pero es la capa más débil: una instrucción es una sugerencia estadística. Agentforce
tiene tres mecanismos **duros** que el plan no usa y que además son la mejor historia de seguridad
del entregable:

1. **`isConfirmationRequired`** en la `GenAiFunction`. Confirmación humana explícita antes de
   escribir. Está en el metadata que extrajeron y hoy vale `false` en todo. Debería ser `true`
   en `Crear_Orden_Servicio`, `Reprogramar_Cita` y `Escalar_Caso`.
2. **Context Variables + Action Filters.** Una acción no es invocable hasta que una variable de
   sesión cumple una condición. Es decir: **`Crear_Orden_Servicio` literalmente no existe para el
   planner hasta que `Unidad_Verificada = true`.** Eso no es una instrucción que el modelo pueda
   ignorar; es una restricción del runtime. Es el patrón `ServiceCustomerVerification` de su propia
   extracción, y es el módulo 23 del curso.
3. **`canEscalate`** a nivel de topic — declara qué topic puede derivar a humano.

Esto suma en tres criterios a la vez: innovación (nadie en un hackathon usa action filters),
realismo (es la estructura que Agentforce demanda) y seguridad.

### E4. Límites estructurales no verificados

Los que importan, para que el diseño no choque con ellos:

| Límite | Valor | Fuente | Implicación para el plan |
|---|---|---|---|
| Generaciones LLM/hora (DE) | **150** | Salesforce Help (DE con Agentforce) | Ver B2. Es el que duele. |
| Instrucciones ejecutadas en una corrida | **~8 pasos** | Salesforce Help | **Aquí sí hay riesgo.** |
| Topics por agente | 15 | Secundaria — verificar el día 1 | 4 topics: holgado. Sin problema. |
| Acciones por topic | 15 (recomendado **5–8**) | Secundaria + buenas prácticas | Vigilar el topic de agenda, que tiende a crecer. |
| Agentes activos por org | 20 | Secundaria | Irrelevante aquí. |

Los dos primeros están documentados por Salesforce; los otros tres vienen de fuentes secundarias y
conviene confirmarlos en la propia org el día 1 (no cambian el diseño de 4 topics, pero sí la
decisión de partir un topic en dos si crece).

El límite de ~8 es el que muerde: si un topic tiene 15 instrucciones secuenciales, el agente
ejecuta las primeras y se detiene, sin error visible. El plan no acota el número de instrucciones
por topic en ningún lado.

**Corrección:** máximo 8 instrucciones por topic, ordenadas por prioridad, y las de seguridad
siempre primero. Si un topic necesita más de 8, es señal de que son dos topics.

### E5. El modelo de datos tiene dos trampas técnicas y una decisión sin tomar

**Trampa 1 — `Km_Estimado__c` y `Confianza__c` no pueden ser campos fórmula.**
El plan los lista el viernes 31 junto a las fórmulas de cobertura. Pero ambos dependen de la
*última* `Lectura_Odometro__c` y del tiempo transcurrido desde esa lectura, y **una fórmula no
puede leer registros hijos**. Solo puede hacerlo un roll-up summary (que exige relación
**maestro-detalle**) o un Flow que estampe el valor en la unidad.

Como está escrito, el viernes 31 se atoran. Las dos salidas:
- `Lectura_Odometro__c` en **maestro-detalle** con `Asset` → roll-up `MAX(Fecha_Lectura__c)`; o
- Flow `record-triggered` sobre `Lectura_Odometro__c` que actualiza `Ultimo_Km__c` y
  `Fecha_Ultima_Lectura__c` en la unidad. **Esta es la recomendada**: master-detail es
  irreversible y bloquea el reparenting.

Con `Ultimo_Km__c` y `Fecha_Ultima_Lectura__c` como campos normales, entonces sí:
`Km_Estimado__c` y `Confianza__c` funcionan como fórmula.

**Trampa 2 — `Unidad__c` / `Asset` sin decidir.** El plan escribe `Unidad__c /Asset` como si
fueran intercambiables. No lo son, y la decisión importa:

| | Custom `Unidad__c` | Estándar `Asset` |
|---|---|---|
| VIN | campo custom | `SerialNumber` (estándar) |
| Modelo | campo custom | `Product2Id` → catálogo real |
| Flota / dueño | lookups custom | `AccountId` / `ContactId` (estándar) |
| Fechas de vida | custom | `InstallDate`, `LifecycleStartDate`, `LifecycleEndDate` |
| Jerarquía (tractocamión + caja) | hay que construirla | `ParentId` nativo |
| Percepción del jurado | "hizo tablas" | "modeló sobre el estándar" |

**Recomendación: `Asset` estándar** + campos custom solo para lo que Zapata necesita de más
(`Ultimo_Km__c`, `Sucursal__c`, `Cobertura_Vigente__c`…). Mismo criterio para el taller:
**`WorkOrder` estándar** en vez de `Orden_Servicio__c`, y `Case.Origin` estándar en vez de un
`Origen__c` propio donde el estándar alcanza.

**Falta un objeto: la disponibilidad del taller.** El plan tiene un Flow
`Consultar_Disponibilidad_Taller` pero ningún objeto que consultar. Y ya tienen el patrón
resuelto y documentado: es `Session__c` + `Availability__c` de Coral Cloud
(`salesforce/27-conocimiento/04-modelo-de-datos.md`) — capacidad por franja, fórmulas de
`Available_Slots__c`, y el Flow de conteo. Portarlo es horas, no días.

### E6. Los criterios de aceptación no son medibles, y hay una herramienta nativa sin usar

*"Listo cuando: la pregunta '¿el turbo de mi unidad entra en garantía?' devuelve el artículo
correcto y no inventa condiciones."* Eso es una anécdota, no un criterio. Con un LLM, una corrida
buena no prueba nada — la siguiente puede fallar.

Y existe **Agentforce Testing Center**, que hace exactamente esto de forma reproducible: se carga
un CSV con `Utterance`, `Expected Topic`, `Expected Action` y respuesta esperada, se ejecuta en
lote, y produce un reporte de aciertos contra *ground truth*. Dos consecuencias:

- `07_pruebas.md` deja de ser una tabla que alguien llena a mano y pasa a ser **el CSV fuente**
  de Testing Center. Mismo esfuerzo, resultado ejecutable y versionado.
- El reporte del Testing Center es **evidencia gráfica para el `.docx` y para el video**.

Detalle que cuesta una tarde si no se sabe: **el CSV usa API names de topics y acciones, no las
etiquetas visibles.**

**Corrección:** umbrales numéricos en la definición de "terminado" (ver plan v3 §9) y Testing
Center como el mecanismo, con corrida obligatoria antes de cada checkpoint dominical.

### E7. La semana 2 está sobrecargada y repite trabajo

Semana 2 pide: 5 Flows + 4 Topics armados + campos de atribución + corrida E2E + 20 casos de
prueba + correcciones, en 7 días a 2–3 h/día por persona. Y el jueves 6 dice *"agregar escritura
de `Log_Agente__c` a los cuatro Flows"* — eso es hacer cuatro veces el mismo trabajo y crear
cuatro sitios donde el log puede quedar inconsistente.

**Corrección:**
- Un subflow único `Registrar_Log_Agente` (autolaunched, entradas: topic, acción, resultado,
  IDs, campos de atribución) invocado por los cuatro Flows. Una implementación, un formato.
- Mismo criterio para atribución: no son "campos en cada Flow", son entradas del mismo subflow.
- Mover los dos diferenciadores de la semana 3 a la semana 2 y dejar el 10–12 de agosto como
  **colchón real**, que hoy no existe.

### E8. La innovación está delgada y en el lugar equivocado del calendario

Dos diferenciadores (detector de brecha de conocimiento, confianza declarada) y ambos el lunes 10
y martes 11 — es decir, **después** de que el equipo mentalmente ya cerró, y a 5 días del
congelamiento. Si algo sale mal ahí, se entrega sin diferenciadores.

Además, el elemento **más** diferenciado del negocio está degradado: la **atribución
anuncio → conversación → cita** aparece como *"capa transversal: campos en los Flows, sin Topic
propio"*. Nadie en un hackathon de Agentforce demuestra atribución de marketing dentro de un
agente de servicio, y para un concesionario es dinero directo y medible.

Y falta el argumento que hace que un comprador de camiones escuche: **el costo de la parada**.
En autos, una garantía mal explicada es una molestia; en camiones, **un día parado es un día sin
facturar**. Ese es el número con el que debe abrir el video, no un porcentaje genérico de
satisfacción.

**Corrección:** tres diferenciadores nombrados, construidos en semana 2 (ver plan v3 §6), con el
downtime como métrica narrativa de apertura.

### E9. No hay dueños ni pitch

*"Cadencia: 2–3 horas entre semana por persona"* — nunca dice cuántas personas, ni quién responde
por cada pista, ni quién presenta. En un equipo de 2 se puede improvisar; en uno de 4 es la causa
más común de trabajo duplicado. Y si el reto incluye presentación en vivo, no hay ni un bloque
de ensayo del pitch (sí lo hay del video, que es distinto).

### E10. El idioma es un problema de día 1 que muerde el sábado 1

La org nace en inglés. Publicar 12 artículos de Knowledge en español requiere Knowledge
multi-idioma habilitado, canal de datos y categorías creadas, y el locale del agente configurado.
Si se descubre el sábado 1 al intentar publicar, se pierde la tarde con los artículos ya escritos.

### E11. La regla "documentar antes de construir" no se cumple en su propio calendario

Regla 2: *"Nada se construye sin estar documentado antes."* Pero `03_topics.md` y `04_flows.md`
se escriben en la semana 2, **el mismo día** que se construyen los Flows y Topics. En la semana 1
la pista Plataforma construye objetos el jueves 30 con `02_modelo_datos.md` escrito ese mismo día.

No es grave, pero como está redactada la regla es incumplible y se va a erosionar. Mejor
enunciarla de forma verificable: *"la ficha del componente existe y está commiteada antes del
commit que lo implementa"* — mismo día está bien, orden importa.

### E12. El Trust Layer no aparece en el relato, teniendo todo el material

Tienen documentado el Trust Layer completo (`salesforce/27-conocimiento/14-verificacion-runtime-config.md`):
masking de PII, detección de toxicidad, **detección de prompt injection**, auditoría. Y el plan sí
contempla pruebas adversariales (bien), pero el video cierra genéricamente con "los registros de
traza visibles".

Cerrar mostrando **Sessions & Intents** con la conversación clasificada y un campo con PII
enmascarada convierte una demo de chatbot en una demo de plataforma gobernada. Es material que ya
tienen y no cuesta construir nada.

---

## 3. Resumen priorizado

Ordenado por severidad, con la columna de **qué criterio de la rúbrica toca cada hallazgo**
(los pesos se incorporaron después — ver §A1).

| # | Hallazgo | Severidad | Criterio que afecta | Arreglo |
|---|---|---|---|---|
| B1 | DE incorrecta: falta el signup con Agentforce + Data Cloud | 🔴 Bloqueante | Todos | 30 min hoy |
| B2 | 150 generaciones LLM/hora sin presupuestar | 🔴 Bloqueante | Todos | 1 h de replanificación |
| B3 | Retriever/Data Library el último día de la semana 1 | 🔴 Bloqueante | **Precisión 15%** | Reordenar, 0 h extra |
| B4 | Tipo de agente sin decidir (Employee vs Service) | 🔴 Bloqueante | Autonomía 25% | 1 decisión, hoy |
| **A1** | **El plan no lleva la rúbrica; dos escenarios no tocan las tres capas** | 🔴 **Bloqueante** | **Multimodal 40%** | Reordenar + 1 Flow |
| E5 | `Km_Estimado__c`/`Confianza__c` imposibles como fórmula | 🟠 Alta | Precisión 15% — **rompe la regla no negociable** | 1 h de rediseño |
| E2 | Sin contratos I/O de acciones (4 banderas + descripciones) | 🟠 Alta | Multimodal 40% + Doc 10% | 2 h de doc |
| E3 | Guardrails declarativos sin usar (filters, confirmación) | 🟠 Alta | Autonomía 25% + originalidad | 3 h, alto retorno |
| E6 | Criterios no medibles; Testing Center sin usar | 🟡 Media | Autonomía 25% + Doc 10% | 2 h |
| E7 | Semana 2 sobrecargada, log repetido ×4 | 🟡 Media | Ejecución | Reordenar |
| E8 | Innovación tardía; falta el número de downtime | 🟡 Media | Originalidad | Reordenar |
| E4 | Límite de ~8 instrucciones por topic no acotado | 🟡 Media | Autonomía 25% | Regla de diseño |
| E1 | Sin reproducibilidad: la org se configura a mano | 🟡 Media | **Doc 10%** | 5 min/día |
| E10 | Idioma/Knowledge multi-idioma no previsto | 🟡 Media | Precisión 15% | 30 min día 1 |
| E9 | Sin dueños por pista ni ensayo de pitch | 🟢 Baja | Ejecución | 15 min |
| E11 | Regla "documentar antes" incumplible como está escrita | 🟢 Baja | Doc 10% | Reescribir 1 línea |
| E12 | Trust Layer ausente del relato | 🟢 Baja | Trazabilidad 10% | 0 h, ya está hecho |

**Lo que cambia el resultado:** B1–B4 evitan perder días. **A1 es el que más puntos mueve**: toca el
40% y se arregla reordenando. E5, E2 y E3 protegen el 15% y el 25%.

**Reordenamiento respecto a la primera versión de esta tabla:** E1 (reproducibilidad) baja de
🟠 Alta a 🟡 Media. No porque deje de importar, sino porque vive dentro del 10% de documentación
—no es un criterio propio— y por eso el arreglo correcto es un `retrieve` de 5 minutos al día,
no una tarea de 3 horas que le robe tiempo al 65%.

---

## 4. Addendum — al incorporar el Briefing y el Resumen Ejecutivo

Los otros dos documentos cambian el diagnóstico en tres puntos. Uno de ellos es un error mío.

### A1. El hallazgo mayor: **el Plan de Trabajo perdió la rúbrica**

El Briefing tiene los pesos de evaluación en su sección 2. El Plan de Trabajo **no los menciona
ni una vez**. Es decir: se estaba planificando sin la función objetivo a la vista, y eso explica
varias de las decisiones de calendario que parecían arbitrarias.

| Criterio | Peso |
|---|---|
| Integración multimodal (Flow + Knowledge + Event logging) | **40%** |
| Resolución autónoma (sin intervención humana en la demo) | **25%** |
| Precisión vs. artículos de Knowledge | **15%** |
| Trazabilidad | **10%** |
| Documentación técnica | **10%** |

Consecuencia que reordena todo: **el 65% se juega en tres escenarios de video, no en la robustez
de la org.** Un Flow impecable que no aparece en el video vale 0 en el criterio de mayor peso.
De ahí la regla nueva del plan v3: *cada escenario debe tocar Knowledge + Flow + Log*.

Y aplicando esa regla a los escenarios que el Resumen Ejecutivo ya tenía definidos, **dos tienen
hueco en la capa del 40%**:
- **Escenario 1** ("resuelto sin cita") **no crea ningún registro.** Es el escenario más memorable
  del paquete y tal como está no puntúa en el 40%.
- **Escenario 3** (negativa a autorizar compensación) **no cita Knowledge**, aunque KB-09 —la
  política de compensación— ya está en la lista de artículos a redactar.

Ambos se corrigen sin trabajo extra (ver plan v3 §7).

### A2. Corrección de mi propia recomendación: el retriever propio **no es opcional**

En la v2 degradé el retriever propio a "mejora opcional de la semana 2". **Estaba equivocado**, y
el Briefing tiene la razón: la acción estándar *Answer Questions with Knowledge* usa por defecto un
retriever dinámico que busca en fuentes externas, y si no se sobrescribe **el agente inventa**.
Siendo que *Precisión vs. Knowledge* vale **15%**, eso no es un refinamiento: es el guardarraíl.

Mi corrección de **secuencia** sigue en pie —arrancar el indexado el sábado con 8 artículos en vez
del domingo con 12— y de hecho es lo que da margen para configurar el retriever propio sin
apostarlo todo al último día. Las dos cosas son compatibles; lo que no era correcto era declararlo
prescindible.

*(De paso queda respondida la pregunta 3 del Resumen Ejecutivo —"¿el grounding debe pasar por Data
Cloud o basta un retriever sobre Knowledge Articles?"—: **sí pasa por Data Cloud**. Una Data
Library es una capa de conveniencia sobre Data 360, y el retriever propio vive ahí también. No hay
ruta que lo evite.)*

### A3. Tensión no resuelta entre dos criterios: confianza vs. autonomía

*Resolución autónoma (25%)* se define como **sin intervención humana en la demo**. Dos piezas del
diseño rozan ese criterio y conviene decidir cómo se narran antes de configurarlas:

- **El escalamiento (Topic 4) no lo viola** — al contrario, es su mejor ejemplo: el agente decide
  **solo** que no está autorizado. Hay que narrarlo así explícitamente, o un jurado distraído lo
  puede leer como "no pudo".
- **La confirmación humana sí es un riesgo de lectura.** En la v2 recomendé `isConfirmationRequired`
  en las tres acciones de escritura. **Lo corrijo a una sola** (`Reprogramar_Cita`): tres pausas en
  un video de 180 segundos se comen el ritmo y dan tres oportunidades de leer "no resolvió solo".
  Una vez es diseño; tres veces parece indecisión. Las otras dos se protegen con **action filters**,
  que restringen sin pausar la conversación.

### A4. Objetos que el Resumen comprometió y conviene revisar

El Resumen Ejecutivo nombra `Asset, WorkOrder, ServiceAppointment, Entitlement, Case`. Los dos
primeros son la elección correcta. Los otros dos, revisados contra lo que exigen en una DE:

| Objeto | Situación real | Recomendación |
|---|---|---|
| `ServiceAppointment` | Requiere **Field Service habilitado** | **Fuera.** `WorkOrder.StartDate`/`EndDate` modela la cita, y reprogramar = UPDATE sobre esos campos — que es justo lo que la demo debe enseñar |
| `Entitlement` | Requiere **Entitlement Management** habilitado + permisos | **Fuera.** Es maquinaria de SLA que no aporta a ningún criterio |
| `AssetWarranty` / `WarrantyTerm` | **Disponibles en Developer Edition**, requieren el permission set *Warranty Lifecycle Management* | **Timebox de 45 min el día 1.** Es el modelo de garantía de Automotive Cloud: máxima credibilidad para el sector si sale barato; si no, campos custom sobre `Asset` y se documenta |

Quitar los dos primeros elimina dos compuertas de setup **sin cambiar un solo segundo del video**.

### A5. Lo que el Briefing ya tenía bien y el plan debe conservar

- El **límite de 150 generaciones/hora** ya estaba identificado en el Briefing §9 — se perdió al
  pasar al Plan de Trabajo, que lo dejó como riesgo cualitativo.
- La **regla de diseño no negociable** ("el agente no calcula la cobertura, la lee de campos del
  Asset; el modelo redacta, no decide") es la mejor decisión de todo el paquete. Y es exactamente
  por eso que el hallazgo **E5** es más grave de lo que parecía: si `Km_Estimado__c` y
  `Confianza__c` no pueden existir como campos fórmula tal como están diseñados, **la regla se
  rompe** y el modelo termina infiriendo cobertura de texto libre.
- El **riesgo de que la demo se lea como analítica y no como agente** (Briefing §6) sigue vigente
  y es real: el reporte de atribución va en los últimos 20 segundos, nunca antes.
- Las **90+ ideas como anexo de roadmap** suman en el 10% de documentación sin costar
  configuración. Conservar.

---

→ Plan corregido e integrado: [`PLAN-DE-TRABAJO-v3.md`](PLAN-DE-TRABAJO-v3.md)
