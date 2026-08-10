# Plan de Trabajo v3 — ARCHIVADO / SUPERADO

> **No ejecutar esta versión.** La fuente única de verdad es
> [PLAN-DE-TRABAJO-FINAL.md](PLAN-DE-TRABAJO-FINAL.md). El plan final actualiza el
> proyecto al nuevo Agentforce Builder de Summer '26, sustituye Topics por subagents,
> corrige la estrategia de Knowledge, elimina afirmaciones no verificadas y cierra el
> reparto entre Gabriel y Diego.

# Plan de Trabajo v3 — Reto Hackatón Agentforce · Corporación Zapata

**29 de julio → 17 de agosto de 2026** · Congelamiento: sábado 15 · Entrega: lunes 17
**Equipo: Gabriel y Diego** (2 integrantes)

> v3 integra el Briefing y el Resumen Ejecutivo al Plan de Trabajo. El esqueleto original se
> conserva —un agente, cuatro Topics, dos pistas, congelamiento el 15, paquete documental que se
> ensambla en el `.docx`— porque es correcto. Lo que cambia: **el plan ahora está anclado a la
> rúbrica**, se corrigen los supuestos de plataforma que no se sostenían, y se cierran las
> decisiones que estaban abiertas.
> Detalle de hallazgos: [`EVALUACION-PLAN-v1.md`](EVALUACION-PLAN-v1.md).

---

## 0. La rúbrica manda — y no estaba en el plan

El Briefing tiene los pesos de evaluación; el Plan de Trabajo v1 no los menciona ni una vez. Ese
es el hallazgo más importante de esta revisión: **se estaba planificando sin la función objetivo
a la vista.**

| Criterio | Peso | Dónde se gana |
|---|---|---|
| **Integración multimodal** (Flow + Knowledge + Event logging) | **40%** | En el **video**, no en la org: cada escenario debe *mostrar* las tres capas |
| **Resolución autónoma** (sin intervención humana en la demo) | **25%** | En que los flujos cierren solos, de punta a punta |
| **Precisión vs. artículos de Knowledge** | **15%** | En el retriever propio y en el alcance acotado del contenido |
| **Trazabilidad** (registro auditable por acción) | **10%** | `Log_Agente__c` — barato de maximizar |
| **Documentación técnica** | **10%** | El `.docx` + reproducibilidad |

### Las tres consecuencias que reordenan el plan

**1. El 65% se juega en tres escenarios de video, no en la robustez de la org.**
Un Flow impecable que no aparece en el video vale 0 en el 40%. La regla operativa que se deriva:

> **Cada uno de los tres escenarios debe tocar las tres capas: Knowledge + Flow + Log.**
> Un escenario que solo conversa no puntúa en el 40%, por bien que se vea.

Aplicando esa regla a los escenarios del Resumen Ejecutivo, **dos tienen hueco** (§7).

**2. La reproducibilidad vive dentro del 10% de documentación, no es un criterio propio.**
Corrijo mi propia recomendación de la v2: sigue valiendo la pena —desriesga y suma al 10%— pero
**no a costa de horas del 65%**. Por eso baja de "tarea de 3 h" a **`retrieve` de 5 minutos al
cierre de cada bloque** (regla 7). Mismo resultado, sin robarle tiempo a lo que más pesa.

**3. La precisión de Knowledge (15%) depende de una pieza técnica, no de redactar mejor.**
Ver §1, decisión sobre el retriever.

---

## 1. Alcance congelado y decisiones cerradas

### El concepto

Un agente que acompaña a la unidad **desde el anuncio que generó el contacto hasta el
mantenimiento que la mantiene rodando**. Identifica por VIN, diagnostica contra Knowledge oficial,
resuelve en autoservicio lo que el operador puede resolver, agenda o reprograma cuando requiere
taller, y escala con criterio explícito — dejando registro auditable de cada acción y del origen
publicitario.

*(Es la combinación A+B del Briefing, con la atribución de C como capa transversal.)*

### Alcance

| | |
|---|---|
| **Agente** | Uno solo, 4 Topics. Employee interno (`agentType` + `type` — son dos campos) |
| **Topics** | 1) Triage y diagnóstico guiado · 2) VIN y cobertura · 3) Agenda de servicio · 4) Escalamiento |
| **Atribución** | Capa transversal vía subflow único de log — **no ocupa Topic** |
| **Knowledge** | 12 artículos en español (mínimo viable: 8) |
| **Diagnóstico** | 2–3 modelos, 8–10 síntomas frecuentes (mínimo viable: 5) |
| **Datos** | Sintéticos sobre estructuras reales, versionados como CSV en el repo |
| **Entorno** | **Developer Edition *with Agentforce and Data Cloud*** — no la DE clásica |
| **Avatar** | Solo narración de los primeros 20 s del video. Conversacional → fase 3 |

### Regla de diseño no negociable *(del Resumen Ejecutivo — se conserva y se refuerza)*

> **El agente no calcula la cobertura de garantía: la lee de campos del Asset.
> El modelo redacta, no decide.**

Esta regla es la mejor decisión de todo el paquete documental. Y por eso mismo el problema de
`Km_Estimado__c` (§3, decisión 3) es más grave de lo que parece: **si esos campos no existen como
la regla asume, la regla se rompe** y el modelo termina infiriendo cobertura de texto libre —
exactamente lo que la regla existe para impedir.

### [v3] Decisiones que estaban abiertas y aquí se cierran

| # | Decisión | Resuelta | Por qué |
|---|---|---|---|
| 1 | **Retriever propio: ¿opcional?** | **Obligatorio** | El retriever dinámico por defecto busca en fuentes externas y el agente inventa. Precisión de Knowledge = **15%**. No es un lujo, es el guardarraíl. *(Corrijo la v2, que lo había degradado a opcional.)* |
| 2 | **¿El grounding pasa por Data Cloud?** *(pregunta 3 del Resumen)* | **Sí, obligatoriamente** | Una Data Library es una capa de conveniencia sobre Data 360; el retriever propio también vive ahí. No hay ruta que evite Data Cloud. Por eso el punto 3 de la puerta de arranque es bloqueante. |
| 3 | **`ServiceAppointment` y `Entitlement`** | **Fuera** | Cada uno es una compuerta de setup (Field Service habilitado / Entitlement Management + permission sets) y **ninguno suma al 40%**: un Flow que crea `WorkOrder` puntúa igual que uno que crea `WorkOrder` + `ServiceAppointment`. La cita se modela con `WorkOrder.StartDate`/`EndDate`; reprogramar = UPDATE sobre esos campos, que es justo lo que la demo debe enseñar. |
| 4 | **`AssetWarranty` / `WarrantyTerm`** | **Evaluar el día 1, adoptar solo si sale gratis** | Están disponibles en Developer Edition y son el modelo de datos de garantía de **Automotive Cloud** — máxima credibilidad para el sector. Pero requieren el permission set *Warranty Lifecycle Management*. **Timebox de 45 min:** si queda funcionando, se usa y se presume en el `.docx`; si no, campos custom sobre `Asset` y se documenta la decisión en la bitácora. |
| 5 | **Disponibilidad de taller** | **Objeto custom**, portando el patrón `Session__c` + `Availability__c` de Coral Cloud | Ya está resuelto y documentado en `salesforce/27-conocimiento/04-modelo-de-datos.md`. Es horas, no días. |
| 6 | **Confirmación humana vs. "resolución autónoma"** | **Una sola acción con confirmación, narrada** | Ver §2. |

### Modelo de objetos final

| Objeto | Tipo | Para qué |
|---|---|---|
| `Asset` | Estándar | La unidad. `SerialNumber` = VIN, `Product2Id` = modelo, `AccountId` = flota, `ParentId` = tracto+caja |
| `WorkOrder` | Estándar | Orden de servicio y cita (`StartDate`/`EndDate`). Sin licencia de Field Service |
| `Case` | Estándar | Escalamiento. `Origin` = Agentforce |
| `Knowledge__kav` | Estándar | Los 12 artículos |
| `Lectura_Odometro__c` | Custom | Lecturas de odómetro con fecha y procedencia |
| `Log_Agente__c` | Custom | Traza + atribución publicitaria |
| `Brecha_Conocimiento__c` | Custom | Detector de brecha (diferenciador D1) |
| `Sucursal__c` | Custom | Las 3 sucursales |
| `Disponibilidad_Taller__c` | Custom | Franjas con capacidad (patrón Coral Cloud) |
| `AssetWarranty` / `WarrantyTerm` | Estándar | **Condicionado** a la evaluación del día 1 |

### Reglas del plan

1. El día 15 se congela. Lo que no esté funcionando ese día no entra al video. Sin excepciones.
2. La ficha del componente está commiteada **antes** del commit que lo implementa. Mismo día está
   bien; el orden importa.
3. El `.docx` no se escribe al final: se ensambla de los documentos que se generan cada día.
4. Cadencia: 2–3 h entre semana por persona, bloques largos en fin de semana. Checkpoint corto los
   domingos.
5. Dos pistas: **Plataforma** (Gabriel o Diego) y **Contenido** (el otro). Reparto en §10.
6. **Presupuesto de generaciones LLM: 150 por hora** en Developer Edition. Un turno consume 6–12
   (clasificación + cada paso ReAct); una corrida de los 20 casos, 120–200.
   - **Una sola persona prueba contra el agente a la vez.** Ventanas asignadas en el checkpoint.
   - **Modo seco por defecto:** validar Flows ejecutándolos desde Setup con entradas fijas. Cuesta
     0 generaciones y atrapa la mayoría de los errores.
   - Las corridas de lote se agendan; nunca dos el mismo bloque.
7. **`sf project retrieve start` al cerrar cada bloque de trabajo.** 5 minutos. Es lo que hace el
   proyecto reproducible sin robarle tiempo al 65%.
8. **[v3] Regla del 40%:** ningún escenario entra al video si no toca Knowledge **y** un Flow
   **y** deja registro en `Log_Agente__c`.

---

## 2. [v3] "Resolución autónoma" (25%) — la ambigüedad que hay que resolver antes de construir

El criterio dice *100% sin intervención humana en la demo*. Dos cosas del diseño podrían leerse
como violación, y conviene decidir cómo se narran **antes** de configurarlas:

**El escalamiento (Topic 4) no es una violación — es el ejemplo más fuerte del criterio.**
El agente decide **por sí solo** que no está autorizado y crea el Case. No hubo humano en la
conversación; hubo una decisión autónoma de derivar. Se narra así, explícitamente, en el video:
*"nadie intervino: el agente resolvió que esto no le corresponde"*.

**La confirmación del usuario (`isConfirmationRequired`) sí es un riesgo de lectura.**
En la v2 recomendé activarla en las tres acciones de escritura. **Lo corrijo:** tres pausas de
confirmación en un video de 180 segundos se comen el ritmo y le dan al jurado tres oportunidades
de leer "el agente no resolvió solo".

> **Decisión: confirmación activa en UNA sola acción — `Reprogramar_Cita`** — y narrada como
> guardarraíl deliberado: *"mover una cita afecta la agenda del taller y a otro cliente; aquí el
> agente pide confirmación a propósito"*. Una vez es diseño. Tres veces parece indecisión.

Las otras dos acciones de escritura se protegen con **action filters**, que restringen sin pausar
la conversación: `Crear_Orden_Servicio` simplemente **no es invocable** hasta que la context
variable `Unidad_Verificada` sea `true`. El planner ni siquiera la ve. Eso es autonomía **y**
control, sin costar un segundo de video.

---

## 3. Día 0 — Puerta de arranque (miércoles 29, primeras 2 horas)

Nada arranca hasta que esto esté en verde. Es la corrección del riesgo más caro: descubrir el
jueves que la org no sirve.

### Verificación de entorno (bloqueante)

- [ ] **1.** Org creada con el signup **"Developer Edition with Agentforce and Data Cloud"** — la
      Developer Edition clásica **no** incluye Agentforce.
- [ ] **2.** **Agentforce Studio** visible en el App Launcher, con la sección *Agents*.
- [ ] **3.** **Data Cloud** aprovisionado y permite crear una Data Library. *(Bloqueante: sin esto
      no hay retriever propio y se cae parte del 15%.)*
- [ ] **4.** **Knowledge** habilitado, con **idioma español** activo y al menos una categoría.
- [ ] **5.** **Salesforce CLI** conectada: `sf org login web` + `sf project retrieve start` sin error.
- [ ] **6.** **Testing Center** accesible dentro de Agentforce Studio.
- [ ] **7. [v3]** Confirmar en la propia org los límites de **topics por agente** y **acciones por
      topic** (las fuentes públicas dicen 15/15, conviene verlo).

### Decisiones a registrar en `10_bitacora.md`

| Decisión | Resuelta como |
|---|---|
| Tipo de agente | Employee interno (`agentType` + `type`) |
| Unidad | `Asset` estándar |
| Orden de servicio y cita | `WorkOrder` estándar, con `StartDate`/`EndDate` |
| `ServiceAppointment` / `Entitlement` | **Fuera** (§1, decisión 3) |
| `AssetWarranty` | Timebox de 45 min; si no sale, campos custom |
| Retriever | Propio, obligatorio |
| Idioma | Español, agente y Knowledge |
| Confirmación humana | Solo en `Reprogramar_Cita` |

---

## 4. Semana 1 — Fundación

**Miércoles 29 de julio → domingo 2 de agosto**

**Meta:** que el agente responda una pregunta de cobertura **citando el artículo correcto**, con
el retriever propio ya en su lugar. Nada más, pero eso completo.

| Día | Pista Plataforma | Pista Contenido |
|---|---|---|
| **Mié 29** | **Puerta de arranque (§3): 7 verificaciones + 8 decisiones.** Crear repo y proyecto SFDX. **Timebox `AssetWarranty`.** | `00_vision.md` y primera versión de `01_requisitos.md`. Definir los 12 títulos de Knowledge y los 8–10 síntomas del árbol. |
| **Jue 30** | `02_modelo_datos.md` y crear en la org: campos custom sobre `Asset`, `Lectura_Odometro__c`, `Log_Agente__c`, `Brecha_Conocimiento__c`, `Sucursal__c`, `Disponibilidad_Taller__c`. `retrieve` al cerrar. | **KB-01 a KB-04**: póliza de tren motriz, póliza de cabina y chasis, exclusiones, requisitos de lubricante. |
| **Vie 31** | **Primero** el Flow `record-triggered` sobre `Lectura_Odometro__c` que estampa `Ultimo_Km__c` y `Fecha_Ultima_Lectura__c` en el Asset. **Después** las fórmulas: `Meses_Transcurridos__c`, `Km_Restantes_Garantia__c`, `Cobertura_Vigente__c`, `Km_Estimado__c`, `Confianza__c`. | **KB-05 a KB-08**: plan de mantenimiento por rango de km, proceso de reclamo, política de reprogramación, tiempos estándar de diagnóstico. |
| **Sáb 1** | Cargar el seed desde `/datos` en CSV: 15–20 unidades, 3 sucursales, historial disperso, **al menos una unidad fuera de cobertura por poco margen**. **Crear la Data Library e iniciar el indexado con los 8 artículos que ya existan — no esperar a los 12.** | **KB-09 a KB-12**: unidad de reemplazo, alcance de certificado de seminuevo, **política de compensación** *(la cita el escenario 3 — ver §7)*, seguridad y límites de auto-reparación. Cerrar `06_arbol_diagnostico.md`. |
| **Dom 2** | **Verificar el indexado y sobrescribir el retriever dinámico por el propio.** Probar en Prompt Builder: 10 preguntas, verificar cita correcta y cero invención. Si el indexado no responde → fallback (§8). | Preparar las 20 frases de prueba, sacadas de conversaciones reales, ya en formato `07b_testing_center.csv`. Checkpoint. |

**Listo cuando:** en Prompt Builder, *"¿el turbo de mi unidad entra en garantía?"* devuelve el
artículo correcto sin inventar condiciones, en **8 de 10** preguntas de control, con la fuente
citada — **y el retriever propio está activo, no el dinámico.**

> ⚠️ **Los tres riesgos de la semana, en orden:**
> **1. El retriever dinámico.** Si no se sobrescribe, el agente busca en fuentes externas e
> inventa. Es el 15% completo. Se valida en Prompt Builder **antes** de conectarlo al agente.
> **2. El indexado de la Data Library.** Asíncrono, de horas, falla en silencio (síntoma típico:
> la acción devuelve 0 resultados aunque Knowledge sí encuentre). Por eso arranca el sábado con 8
> artículos, no el domingo con 12.
> **3. Los artículos de Knowledge.** Si se atrasan, se atrasa todo. Si hay que sacrificar algo el
> fin de semana, que sea configuración avanzada, **nunca contenido**.

---

## 5. Semana 2 — Construcción

**Lunes 3 → domingo 9 de agosto**

**Meta:** los tres escenarios corren de punta a punta sin intervención, **cada uno tocando las
tres capas del 40%**, y los tres diferenciadores construidos.

| Día | Pista Plataforma | Pista Contenido |
|---|---|---|
| **Lun 3** | Subflow `Registrar_Log_Agente` **primero** (entradas: topic, acción, resultado, IDs, `Origen_Campania__c`, `Ad_ID__c`). Luego `Buscar_Unidad_por_VIN`: VIN + segundo factor, valida, devuelve modelo, km, sucursal, cobertura. | Instrucciones del **Topic 2** (VIN y cobertura): Classification Description, Scope, cuándo aplica y cuándo no, frases de ejemplo. **Máximo 8 instrucciones.** |
| **Mar 4** | `Consultar_Disponibilidad_Taller` y `Crear_Orden_Servicio` (con `Sintoma_Reportado__c` en texto libre y `Case.Origin = Agentforce`). Ambos invocan el subflow de log. | Instrucciones del **Topic 3** (agenda) + guardrails: qué no debe prometer. |
| **Mié 5** | `Reprogramar_Cita` (UPDATE sobre `WorkOrder.StartDate`) con la regla de 24 h → si falta menos, crea Task en vez de reprogramar. Escribir `04b_acciones.md` con el contrato I/O de las acciones ya hechas. | Instrucciones del **Topic 1** (diagnóstico guiado) desde el árbol. Incluir las negativas por seguridad. |
| **Jue 6** | `Escalar_Caso`: Case con prioridad, cola, Chatter. Cerrar `08_trazabilidad.md`. El log ya está en los cuatro Flows vía subflow — no se repite. **[v3]** `Registrar_Lectura_Odometro` (el Flow que hace que el escenario 1 toque la capa de acción). | Instrucciones del **Topic 4** (escalamiento) con disparadores explícitos. |
| **Vie 7** | Armar los 4 Topics en Agent Builder, conectar acciones, probar clasificación. Activar `isConfirmationRequired` **solo en `Reprogramar_Cita`**. | Definir la context variable `Unidad_Verificada` y los **action filters**: las acciones de escritura no son invocables hasta que sea `true`. Documentar en `12_seguridad.md`. |
| **Sáb 8** | **Los tres diferenciadores (§6)** + los campos de atribución como entradas del subflow *(el Report se arma el martes 11, cuando ya haya filas)*. | Cargar `07b_testing_center.csv` y correr el **primer lote en Testing Center**. ⚠️ Una sola persona — es el bloque de mayor consumo de cuota. |
| **Dom 9** | **Corrida completa de los 3 escenarios end-to-end** + corregir y ajustar instrucciones de los Topics que clasificaron mal. `retrieve` completo + borrador de `11_reproducir.md`. | Pruebas adversariales: frases ambiguas, VIN inexistente, cliente enojado, intento de sacarle una promesa de cobertura, e intento de inyección de instrucciones. Checkpoint. |

> **Por qué el lote (sáb 8) y la corrida E2E (dom 9) van en días distintos:** ambos consumen la
> misma cuota de 150/hora. Juntarlos —como hacía la v1— garantiza que uno falle **por límite y no
> por defecto real**, que es el peor tipo de fallo: consume horas depurando algo que no existe.
> El domingo sí caben los dos bloques: 3 escenarios E2E ≈ 30 generaciones y ~10 adversariales ≈ 60,
> suman ~90 de 150 **si se corren separados por al menos una hora**. El lote completo del sábado
> (120–200) ocupa la ventana entera y por eso va solo.

**Listo cuando:** los tres escenarios corren completos sin intervención, **cada uno deja evidencia
de las tres capas**, y el lote de Testing Center supera los umbrales de §9.

---

## 6. Los tres diferenciadores

Se construyen el **sábado 8**, no en la semana 3. Cada uno ataca un criterio distinto de la rúbrica.

### D1 · Detector de brecha de conocimiento
Cuando el agente no encuentra artículo, un Flow crea `Brecha_Conocimiento__c` con la pregunta
literal, el topic activo y la fecha. El resultado no es un log: es **una cola editorial priorizada
por frecuencia real**. Un sistema que mejora solo.
*Ataca:* originalidad frente al jurado + trazabilidad (10%).

### D2 · Incertidumbre declarada en lugar de omnisciencia fingida
`Km_Estimado__c` se calcula desde la última lectura verificada más el uso diario. `Confianza__c`
cae con los días transcurridos. **Cerca de un límite de póliza el agente no decide: declara la
antigüedad de su dato y pide confirmación** — y la conversación funciona como canal de ingesta del
odómetro.
*Ataca:* precisión de Knowledge (15%) y la capa de confianza. El turno *"mi última lectura
verificada tiene 78 días, confírmame tu odómetro"* demuestra la capa en 15 segundos.

### D3 · Atribución anuncio → conversación → cita
`Origen_Campania__c` y `Ad_ID__c` entran como parámetros del subflow `Registrar_Log_Agente`, y un
Report estándar sobre `Log_Agente__c` cierra el circuito: **de qué anuncio vino la conversación que
terminó en una orden de servicio.** Sin licencias adicionales.
*Ataca:* trazabilidad (10%) — *"es el criterio donde menos competencia habrá"*.
*Secuencia:* campos en el subflow el **sábado 8**; Report el **martes 11**, cuando ya haya filas.
Un reporte vacío no demuestra nada.
⚠️ **Riesgo del Briefing que sigue vigente:** si la demo se apoya demasiado en el reporte, el
jurado lo lee como analítica y no como agente, y ahí se cae el 40%. **El reporte va en los últimos
20 segundos, nunca antes.**

### El número que abre el video
En autos una garantía mal explicada es una molestia. **En camión de carga, un día parado es
pérdida diaria directa y cuantificable.** El número sale de la pregunta 3 del Briefing
(*"¿cuál es el costo estimado por día de una unidad detenida?"*). Si no llega para el viernes 1,
rango público del sector marcado explícitamente como estimación.

---

## 7. [v3] El video — donde se juega el 65%

Máximo **3 minutos, 3 escenarios**. Estructura del Resumen Ejecutivo, con los huecos corregidos.

| Tramo | Escenario | Knowledge | Flow | Log |
|---|---|---|---|---|
| 0:00–0:25 | El dolor con número: costo diario de una unidad detenida | — | — | — |
| 0:25–1:10 | Entrada desde campaña → síntoma → diagnóstico guiado → **resuelto sin cita** | ✅ árbol | ⚠️ **hueco** | ✅ |
| 1:10–2:05 | Segundo síntoma no resoluble → VIN → cobertura citando póliza → **crea y reprograma cita** | ✅ póliza | ✅✅ INSERT+UPDATE | ✅ |
| 2:05–2:40 | Compensación → el agente reconoce que no puede autorizar → Case prioridad alta + cola | ⚠️ **hueco** | ✅ | ✅ |
| 2:40–3:00 | Cierre en el CRM: registros creados, cita movida, caso abierto, `Log_Agente__c` sellado | — | — | ✅ |

### Los dos huecos y su corrección

**Escenario 1 no crea ningún registro.** "Caso resuelto sin cita" es el escenario más memorable de
la propuesta B — y tal como está, **no puntúa en el 40%**, que es el criterio de mayor peso.
→ **Corrección:** el cierre sin cita **crea un registro**. Dos opciones, la primera es mejor:
   1. `Registrar_Lectura_Odometro` — el agente aprovecha para capturar el odómetro y lo registra.
      Enlaza con D2, alimenta el dato que la empresa no tiene, y se ve natural en la conversación.
   2. `Case` cerrado con la resolución y el artículo aplicado.
   *(Por eso este Flow entra el jueves 6 en §5.)*

**Escenario 3 no cita Knowledge.** La negativa a autorizar compensación se ve como una regla
programada, no como una decisión fundada.
→ **Corrección:** el agente **cita KB-09, la política de compensación**, al explicar por qué no
puede autorizar. Cuesta una línea de instrucción y convierte el escenario en las tres capas —
además de que un agente que fundamenta su negativa se ve mucho más maduro que uno que solo dice
que no.

> **La reprogramación es obligatoria:** demuestra `UPDATE`, no solo `INSERT`. Es lo que separa
> "el agente crea cosas" de "el agente opera el CRM".

---

## 8. Riesgos y plan B

| Riesgo | Señal temprana | Plan B |
|---|---|---|
| **El retriever dinámico no se sobrescribe** y el agente inventa | Domingo 2: cita fuentes que no son los artículos | Es bloqueante del 15%. Validar en Prompt Builder **antes** de conectar al agente. Si el propio no sale: reducir y especializar artículos + instrucción dura de "solo responde desde los artículos citados" |
| Los artículos de Knowledge se atrasan | Domingo 2 con **menos de 8** escritos | Recortar a 8 artículos y 5 síntomas. Nunca recortar calidad de redacción |
| El indexado de la Data Library no responde | Domingo 2: la acción devuelve 0 resultados aunque Knowledge sí encuentre | **Fallback:** acción sobre Flow que consulta Knowledge directamente y devuelve título + cuerpo + URL. Menos elegante, se declara en la bitácora, la demo sobrevive |
| Se topa el límite de generaciones LLM | Las pruebas fallan sin razón aparente | Son **150/hora**. Presupuestar (regla 6), modo seco por defecto, una persona a la vez, lotes agendados |
| El escalamiento a humano real no se logra | Jueves 6 sin canal de Messaging | Flow → Case + cola + Chatter. Cumple igual y es demostrable. Con Employee Agent el riesgo baja mucho: no depende de Messaging |
| El agente ejecuta solo parte de las instrucciones | Un topic con >8 instrucciones se detiene a media tarea, sin error | Máximo 8 por topic, seguridad primero. Si necesita más, son dos topics |
| **`AssetWarranty` consume más de lo previsto** | Pasan los 45 min del timebox el día 1 | Campos custom sobre `Asset`. Se documenta en la bitácora como decisión, no como carencia |
| **La demo se lee como analítica, no como agente** | El ensayo del jueves 13 dedica >30 s al reporte | Acción primero, reporte solo en los últimos 20 s |
| La org no se puede reconstruir | El deploy sobre org limpia falla (prueba del 12) | Documentar los pasos manuales en `11_reproducir.md`. Un paso manual documentado sigue siendo reproducible; uno no documentado, no |
| Algo se rompe después del congelamiento | — | Existe la toma 2. Se entrega con lo grabado, **no se arregla la org** |
| No llegan los números de la operación | **Viernes 1** sin respuesta | Rangos públicos del sector, marcados como estimación en el documento |

---

## 9. Definición de "terminado"

| Componente | Funciona | Documentado | Probado |
|---|---|---|---|
| **Flow** | Corre sin error y crea/modifica el registro correcto | Ficha en `04_flows.md` | ≥2 casos en `07_pruebas.md`, uno de error |
| **Acción** | El planner la invoca sin que el usuario la nombre | Contrato I/O en `04b_acciones.md` (tipo + 4 banderas + descripción por variable) | Invocada bien en **≥4 de 5** frases |
| **Topic** | Clasifica bien e invoca la acción correcta | Classification Description, Scope, ≤8 instrucciones, guardrails | **≥4 de 5** frases clasifican al topic correcto |
| **Artículo Knowledge** | Publicado e indexado | Fuente en `05_knowledge/` | El agente lo cita correctamente |
| **Escenario de demo** | Corre de punta a punta sin intervención | En `09_guion_demo.md` | **3 veces seguidas** sin fallar **+ [v3] toca las tres capas del 40%** |
| **El agente completo** | — | — | Testing Center: **≥18/20** topic correcto · **≥16/20** acción correcta · **0** afirmaciones de cobertura sin cita · **0** promesas fuera de política |
| **Reproducibilidad** | `sf project deploy start` sobre org nueva termina sin error | `11_reproducir.md` completo | Ejecutado **una vez sobre org limpia** antes del 15 |

---

## 10. Semana 3 — Cierre

**Lunes 10 → lunes 17 de agosto** · **Meta: entregar. No agregar.**

| Día | Actividad |
|---|---|
| **Lun 10** | **COLCHÓN.** Terminar lo pendiente de la semana 2. Si no quedó nada: pulir instrucciones con los fallos del lote. **Prohibido empezar algo nuevo.** |
| **Mar 11** | Report de atribución sobre `Log_Agente__c`. Cerrar `12_seguridad.md` con el resultado de las adversariales. |
| **Mié 12** | Hardening. Ajustar instrucciones, **no agregar funcionalidad**. **Prueba de reproducibilidad: desplegar sobre org limpia** y corregir `11_reproducir.md`. |
| **Jue 13** | `09_guion_demo.md` cronometrado. Limpiar datos de demo (nombres, folios y fechas creíbles). Ensayar 3 veces. Lote final de Testing Center → guardar el reporte como evidencia para el `.docx`. **Verificar la regla del 40% escenario por escenario.** |
| **Vie 14** | **Grabar toma 1.** Revisarla juntos y anotar correcciones. Grabar la narración de los primeros 20 s (voz sintética). Ensayo del pitch si hay presentación en vivo. |
| **Sáb 15** | 🔒 **CONGELAMIENTO.** Grabar **toma 2** de respaldo. No se toca la org. `retrieve` final y tag `v1.0-congelado`. |
| **Dom 16** | Ensamblar el `.docx` desde `00`–`12`. Editar el video. |
| **Lun 17** | Revisión final contra §11. Entregar. |

### Reparto

| Pista | Responsable | Responde por |
|---|---|---|
| **Plataforma** | *(Gabriel o Diego)* | Org, modelo de datos, Flows, Topics, retriever, metadata en git |
| **Contenido** | *(el otro)* | Knowledge, árbol de diagnóstico, casos de prueba, guiones, adversariales |
| **Entregable** | *(uno de los dos, además de su pista)* | `.docx`, video, bitácora, y **decir "no" a lo que llegue después del 15** |

Siendo dos, la tercera fila la carga alguien de todas formas. Nombrarla evita que el domingo 16
ninguno la haya empezado.

---

## 11. Lista de verificación de entrega

### Video (3 min) — vale el 65%
- [ ] Abre con el dolor y **el número del día parado**
- [ ] **Cada escenario toca Knowledge + Flow + Log** *(regla 8 — verificar uno por uno)*
- [ ] Muestra identificación por VIN con segundo factor
- [ ] Muestra Knowledge citado correctamente, **incluida la política en el escenario 3**
- [ ] Muestra **INSERT y UPDATE** (crear cita y reprogramarla)
- [ ] Muestra la confirmación deliberada en `Reprogramar_Cita`, **narrada como guardarraíl**
- [ ] Muestra escalamiento **narrado como decisión autónoma**, no como fallo
- [ ] El reporte de atribución solo en los últimos 20 s
- [ ] Cierra con el CRM, `Log_Agente__c` y Sessions & Intents
- [ ] Dura menos de 3:00

### Documento `.docx` — vale el 10%
- [ ] Arquitectura del agente y sus Topics
- [ ] Modelo de datos con justificación de estándar vs. custom
- [ ] Lógica de los Flows
- [ ] Contratos I/O de las acciones (las 4 banderas del planner)
- [ ] Lista de artículos de Knowledge
- [ ] Mecanismo de trazabilidad
- [ ] Guardrails declarativos: action filters, confirmación, PII enmascarada
- [ ] Reglas de escalamiento
- [ ] Matriz de trazabilidad requisito → prueba
- [ ] Reporte del Testing Center con números reales
- [ ] Instrucciones de reproducción (`11_reproducir.md`)
- [ ] Bitácora de decisiones, incluidas las descartadas
- [ ] **Roadmap de las 90+ ideas por fases** *(anexo del Briefing — suma sin costar configuración)*
- [ ] Riesgos y limitaciones, **incluido el límite de 150 gen/hora**

### Org
- [ ] Datos de demo limpios y creíbles en pantalla
- [ ] Sin registros de prueba basura visibles
- [ ] Los tres escenarios corren tres veces seguidas sin fallar
- [ ] Metadata en git; deploy sobre org limpia probado el día 12

---

## 12. Hoy, miércoles 29

1. **La puerta de arranque (§3): 7 verificaciones.** Antes que nada.
2. **Registrar las 8 decisiones** en `10_bitacora.md`.
3. **Timebox de 45 min a `AssetWarranty`** — adoptar o descartar, y anotarlo.
4. Crear el repositorio con la estructura + proyecto SFDX en `/org`.
5. Escribir `00_vision.md` y la primera versión de `01_requisitos.md`.
6. Definir los 12 títulos de Knowledge y los 8–10 síntomas del árbol.
7. Pedir a la operación las **7 preguntas del Briefing** — sobre todo la 3 (costo diario de unidad
   detenida) y la 5 (reclamo de garantía perdido por falta de historial). Son las que alimentan
   el video.

Los puntos 5 y 6 desbloquean a la otra pista. Van primero después de la puerta.

---

## 13. Qué cambió respecto al Plan de Trabajo original

### De la v1 (bloqueantes de plataforma)
| Cambio | Motivo |
|---|---|
| Puerta de arranque con 7 verificaciones | La DE clásica no trae Agentforce; el tipo de agente decidía media arquitectura |
| Employee Agent, decidido y justificado | Evita ~1 día de Messaging/Experience Cloud y el riesgo asociado |
| Flow que estampa `Ultimo_Km__c` **antes** de las fórmulas | Una fórmula no lee registros hijos: como estaba, el viernes 31 no salía — y rompía la regla no negociable |
| Data Library arranca el sábado con 8 artículos | El indexado es asíncrono, lento y falla en silencio |
| Presupuesto explícito de 150 gen/hora + modo seco | El Briefing tenía el número; el Plan lo perdió |
| `04b_acciones.md` con contratos I/O y las 4 banderas | Es la estructura que Agentforce exige y la causa nº1 de acciones que no se invocan |
| Máximo 8 instrucciones por topic | Límite práctico de ejecución en una corrida |
| Testing Center + umbrales numéricos | Convierte los criterios en evidencia reproducible |
| Subflow único `Registrar_Log_Agente` | Evita implementar el log cuatro veces con cuatro formatos |
| SFDX + `/datos` + prueba en org limpia | La reproducibilidad no estaba cubierta por ningún entregable |
| Diferenciadores a la semana 2; semana 3 como colchón | Estaban a 5 días del congelamiento, sin margen |
| Toma 1 del video el 14, no el 15 | Grabar el día del congelamiento no deja margen |

### De la v3 (al integrar Briefing y Resumen Ejecutivo)
| Cambio | Motivo |
|---|---|
| **§0: la rúbrica al frente** | El Plan v1 planificaba sin la función objetivo. El 65% está en 3 escenarios de video |
| **Regla del 40%: cada escenario toca las tres capas** | Un Flow que no sale en el video vale 0 en el criterio de mayor peso |
| **Corrección de los escenarios 1 y 3** | El 1 no creaba registro; el 3 no citaba Knowledge. Dos huecos en el 40% |
| **Retriever propio pasa de opcional a obligatorio** | **Corrijo mi v2.** El dinámico busca en fuentes externas y el agente inventa. Es el 15% |
| **`ServiceAppointment` y `Entitlement` fuera** | Tres compuertas de setup que no suman al 40%. `WorkOrder.StartDate` basta y demuestra el UPDATE |
| **`AssetWarranty` con timebox de 45 min** | Está en DE y es el modelo de Automotive Cloud: alta credibilidad si sale barato, descartable si no |
| **Confirmación humana solo en `Reprogramar_Cita`** | Tres pausas en 180 s ponen en riesgo el 25% de resolución autónoma |
| **El escalamiento se narra como decisión autónoma** | Es el mejor ejemplo del 25%, no una excepción a él |
| **Reproducibilidad baja de tarea de 3 h a 5 min/día** | Vive dentro del 10%; no debe robarle horas al 65% |
| **Roadmap de 90+ ideas al `.docx`** | Suma en documentación sin costar configuración |
| **Equipo nombrado: Gabriel y Diego** | La v1 decía "por persona" sin decir cuántas |

---

*Plan de trabajo v3. Se revisa en el checkpoint de cada domingo y se ajusta en `10_bitacora.md`.*
