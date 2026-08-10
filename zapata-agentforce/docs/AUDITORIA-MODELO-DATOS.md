# Auditoría del modelo de datos contra los documentos del proyecto

Fecha: 30 de julio de 2026
Documentos contrastados: `PLAN-DE-TRABAJO-FINAL.pdf` (fuente única de verdad),
`Briefing_Reto_Agentforce_Zapata.md.pdf`.

Este documento responde una pregunta incómoda: **¿la estructura que construí realmente
sirve para lo que Zapata necesita, o solo cumple la lista del plan?**

La respuesta corta: cumplía el plan, pero **tenía tres huecos serios** que solo se ven
al leer el briefing. Ya están cerrados.

---

## 1. Huecos encontrados y corregidos

### Hueco 1 — La Propuesta B no tenía dónde vivir (grave)

La decisión ejecutiva del plan es **A+B**. La propuesta B es el copiloto mecánico:
el operador describe un síntoma, el agente lo lleva por un árbol de diagnóstico y
bifurca según si puede resolverlo él mismo.

El briefing dice que su escenario estrella es *"el operador lo resuelve él mismo,
caso cerrado sin cita, con registro"*. **No existía ningún objeto donde guardar ese
registro.** Sin él, el escenario más memorable del video no dejaba rastro y se perdía
el criterio de trazabilidad.

También advierte, en el riesgo 2, que guiar a alguien a intervenir frenos o sistema
neumático tiene implicaciones reales, y que el agente debe **negarse explícitamente**.
No había forma de marcar qué síntoma es seguro guiar y cuál no.

**Corregido con dos objetos nuevos:**

- `Sintoma__c` — catálogo acotado a 8-10 síntomas, como exige el briefing para que el
  retriever no se degrade. Cada uno trae `Nivel_Riesgo__c`,
  `Autoservicio_Permitido__c`, `Preguntas_Descarte__c` y `Senales_De_Alerta__c`
  (cuándo detener la guía aunque el autoservicio esté permitido).
- `Sesion_Diagnostico__c` — el registro del caso. `Resultado__c` tiene las cuatro
  bifurcaciones del briefing: `RESUELTO_SIN_CITA`, `REQUIERE_TALLER`,
  `UNIDAD_NO_VIABLE`, `ESCALADO_SEGURIDAD`. Guarda si el usuario tenía herramientas,
  qué pasos se le indicaron y a qué orden o caso derivó.

### Hueco 2 — Knowledge no sabía a qué modelo aplica un manual

La pregunta era directa: *¿la estructura permite tener un manual completo por cada
modelo, y agregar o quitar un modelo?* Con lo que había, **no**. Los artículos tenían
categoría y sistema, pero nada que los ligara a un modelo de unidad.

**Corregido:**

- `Knowledge__kav.Modelo_Codigo__c` — el `ProductCode` del modelo al que aplica.
  Es texto y no lookup porque Knowledge no admite relaciones hacia Product2.
- `Knowledge__kav.Aplica_Todos_Modelos__c` — para políticas transversales de
  seguridad o proceso, que no dependen del modelo.
- `Knowledge__kav.Nivel_Riesgo__c` — marca el contenido que el agente **no** puede
  usar para guiar autoservicio.
- `Product2.Manual_Completo__c` y `Product2.Sistemas_Documentados__c` — permiten ver
  de un vistazo qué modelos ya tienen manual y cuáles están a medias.

**Cómo se agrega un modelo:** se crea el `Product2`, se publican sus artículos con
`Modelo_Codigo__c` = su `ProductCode`, y se marca `Manual_Completo__c` cuando hay al
menos un artículo por sistema documentado. Nada más se toca.

**Cómo se quita:** se marca `IsActive = false` en el `Product2`. Los artículos y el
histórico se conservan; el agente deja de ofrecerlo. No se borra nada.

### Hueco 3 — El VIN se estaba usando como si autenticara

El briefing lo dice sin rodeos: el VIN está en el parabrisas, en la factura y en el
anuncio de venta, así que **no es un autenticador**. Exige un segundo factor.

`Unidad_Verificada__c` existía, pero no había dónde guardar contra qué se verificó.

**Corregido:** `Asset.Metodo_Verificacion__c` (últimos 4 del teléfono, folio de OS
previa, o RFC), `Asset.Fecha_Verificacion__c`, y en `Account` los campos
`Ultimos_4_Telefono__c` y `RFC__c`. Ninguno se escribe completo en el log.

### Hueco 4 — Nadie era responsable de nada

Una cita sin dueño no sirve en operación real.

**Corregido:** `Sucursal__c.Responsable__c`, `Sucursal__c.Telefono__c`,
`Sucursal__c.Horario_Atencion__c`, `WorkOrder.Asesor_Responsable__c`,
`WorkOrder.Tipo_Cita__c` y `WorkOrder.Sesion_Diagnostico__c` (para que la orden llegue
al taller **con el síntoma ya capturado**, que es exactamente el valor que el briefing
promete a Zapata).

### Hueco 5 — Los formularios salían vacíos

Los campos existían pero **ningún page layout los incluía**. Al dar "Nuevo" en
Sucursal solo aparecía el nombre. Se regeneraron los 9 layouts de objetos custom y se
insertó una sección propia en los 6 layouts estándar (Asset, WorkOrder, Product2,
Case, Account, Knowledge) sin tocar lo que Salesforce ya traía.

---

## 2. Preguntas que quedaron respondidas

### ¿Para qué sirve el Calendario? — Se quitó

Era decorativo. La agenda del taller **no usa** el objeto `Event` de Salesforce: usa
`Slot_Taller__c` (la franja con capacidad) y `WorkOrder` (la cita concreta). Tener un
calendario que no reflejaba ninguna de las dos cosas solo confundía. Si más adelante
se quiere un calendario visual real, el camino es Field Service con
`ServiceAppointment`, y eso es cambio de alcance.

### ¿De qué sirve `Log_Agente__c`?

Vale el **10% de la calificación** (criterio de trazabilidad) y es lo que se muestra
en el segundo 2:42 del video: la lista filtrada por `Correlation_Id`.

En concreto sirve para tres cosas:

1. **Probar que el agente actuó y no solo conversó.** Cada acción deja un registro con
   qué subagent la atendió, qué acción corrió y si terminó en `SUCCESS`, `BLOCKED`,
   `NOT_FOUND` o `ERROR`.
2. **Poder auditar una decisión después.** Guarda el odómetro usado, su fuente, la
   versión de política aplicada y el artículo citado. Si alguien reclama *"el agente
   me dijo que sí entraba en garantía"*, ahí está con qué datos lo decidió.
3. **Demostrar los guardrails.** `Guardrail_Triggered__c` registra qué regla bloqueó
   o desvió una acción — es la evidencia de que el agente se negó cuando debía.

Sin este objeto, la demo sería un chat bonito sin forma de comprobar nada.

### ¿La agenda de taller realmente funciona?

Sí, probado contra la org con `scripts/apex/prueba-humo.apex`. Resultados reales:

| Prueba | Esperado | Obtenido |
| --- | --- | --- |
| Slot con cupo → `Disponible__c` | true | true |
| Slot lleno → `Disponible__c` | false | false |
| Cupos libres (3 total, 1 usado) | 2 | 2 |
| Odómetro de hace 10 días → vigente | true | true |
| Odómetro de hace 120 días → vigente | false | false |
| Segunda orden con la misma `Idempotency_Key` | bloqueada | bloqueada |
| Diagnóstico cerrado sin cita | se guarda | se guarda |
| Log ligado a unidad y orden | se guarda | se guarda |

La prueba hace *rollback* al terminar: **la org queda en 0 registros**.

---

## 3. Qué falta pedirle a Zapata

Esto **no lo puedo inventar** y es lo que bloquea pasar de estructura a algo real:

| Dato | Para qué | Sin esto |
| --- | --- | --- |
| Pólizas de garantía reales (meses y km por modelo y sistema) | Llenar `Regla_Cobertura__c` | El agente decide con números falsos |
| Catálogo real de modelos que atienden | Llenar `Product2` | No hay a qué asociar los manuales |
| Sucursales reales y qué modelos atiende cada una | `Sucursal__c` y `Modelo_Sucursal__c` | Puede agendar en un taller que no da ese servicio |
| Horarios y capacidad real de taller | `Slot_Taller__c` | La agenda no refleja la operación |
| Política de compensación: qué está autorizado y qué no | Subagent de compensación | El agente no sabe qué puede ofrecer |
| Cola y responsable de escalamiento | `Case` | Los casos no llegan a nadie |

Los documentos ya lo anticipan. El briefing cierra con: *"Kilometrajes, coberturas y
umbrales son ejemplos parametrizables; deben sustituirse con las pólizas reales de
Zapata antes de redactar los artículos de Knowledge."*

**Lo que sí puedo hacer sin ellos:** los modelos, los síntomas y los manuales de
diagnóstico. Son conocimiento técnico de camión pesado, no política interna de Zapata.

---

## 4. Diferencias deliberadas con el plan

| Punto | Plan | Implementado | Por qué |
| --- | --- | --- | --- |
| `Modelo_Sucursal__c` | No existe | Creado | Sin él se agenda en talleres que no atienden ese modelo |
| `Sintoma__c`, `Sesion_Diagnostico__c` | No existen | Creados | La Propuesta B del briefing no tenía dónde vivir |
| `Asset.Unidad_Verificada__c` | Solo mencionado en 8.3 | Creado | El plan lo exige como gate pero olvidó listarlo en 6.2 |
| Umbral de odómetro | "el umbral documentado" | 90 días | El plan no fija el número; queda parametrizable |
| `Case.Asset__c` | Lookup custom | Creado, coexiste con `AssetId` estándar | Respeta el plan, pero hay que elegir uno para las acciones |
| Calendario en la app | No se menciona | Retirado | No usamos `Event`; confundía más que ayudaba |

## 5. Estado final del esqueleto (verificado contra la org)

| Componente | Cantidad |
| --- | --- |
| Objetos custom | 9 |
| Campos custom | 82 |
| Reglas de validación | 14 (probadas, las 6 críticas bloquean) |
| Page layouts | 15 (9 custom + 6 estándar con sección propia) |
| Related lists | 14 |
| Compact layouts | 9 |
| Vistas de lista | 9 |
| Pestañas | 14 |
| Páginas de app (FlexiPage) | 5 |
| Aplicación Lightning | 1 |
| Tipos de informe | 4 |
| Reportes | 4 |
| Cola de escalamiento | 1 |
| Permission set | 1 (94 FLS, 11 objectPermissions) |
| Texto de ayuda en campos | 111 |

Funciones de org activadas: Knowledge (español, Lightning), Work Orders,
Field Service (activo pero no se usa), Agentforce disponible.

### Lo que NO puedo hacer yo y requiere configuración manual

| Qué | Por qué no puedo | Dónde |
| --- | --- | --- |
| **Data Cloud / Data Library** | No está habilitado y su activación no se expone por Metadata API | Configuración → Data Cloud Setup |
| **Miembros de la cola de escalamiento** | La cola existe pero está vacía; hay que decidir quién la atiende | Configuración → Colas → Escalamiento Postventa |
| **Retriever del agente** | Se configura en Agentforce/Prompt Builder, no por metadata | Agent Builder |
| **Decidir fórmula vs picklist** en `Estado_Cobertura__c` | Es una decisión de diseño, no técnica | Ver sección 6 |

El resto del esqueleto está completo y desplegado.

## 6. Conflicto entre documentos — RESUELTO

El **Resumen Ejecutivo** marcaba como *regla de diseño no negociable*:

> el agente no calcula la cobertura de garantía; la lee de **campos fórmula** del Asset

El **Plan Final** define `Estado_Cobertura__c` como picklist que escribe la acción.

### Por qué una fórmula pura es imposible

La regla aplicable vive en `Regla_Cobertura__c`, que es **hijo de `Product2`** y se
elige por el **sistema que el usuario reporta en la conversación**. Una fórmula de
Salesforce no puede filtrar registros hijos ni recibir una entrada de tiempo de
ejecución. El Resumen pide algo que la plataforma no permite construir tal cual.

### Lo que sí resuelve el riesgo real

El riesgo que señala el Resumen —*"una garantía regalada frente al jurado"*— no viene
de que el modelo infiera (no lo hace: decide un Flow determinista). Viene de que el
agente **cite un veredicto viejo**. Eso sí se puede blindar, y se blindó:

| Campo (fórmula) | Qué hace |
| --- | --- |
| `Meses_Desde_Instalacion__c` | Meses cumplidos. Hecho calculado, nadie lo puede dejar viejo |
| `Evaluacion_Vigente__c` | Verdadero solo si la evaluación se hizo **después** de la última lectura, con odómetro vigente y hace menos de 30 días |
| `Cobertura_Citable__c` | **Lo único que el agente tiene permitido citar.** Si la evaluación perdió vigencia, degrada solo a `REQUIERE_DATO` |

**La regla operativa:** el agente lee `Cobertura_Citable__c`, **nunca**
`Estado_Cobertura__c`. Al ser fórmula, no puede quedar desactualizado.

### Probado contra la org

| Caso | `Estado_Cobertura__c` guardado | `Cobertura_Citable__c` |
| --- | --- | --- |
| Evaluación de hace 2 días, odómetro fresco | CUBIERTO | **CUBIERTO** |
| Evaluación de hace 60 días | CUBIERTO | **REQUIERE_DATO** |
| Odómetro leído después de evaluar | CUBIERTO | **REQUIERE_DATO** |
| Odómetro caducado (200 días) | CUBIERTO | **REQUIERE_DATO** |

Los tres casos con datos viejos degradan solos aunque el campo guardado diga
`CUBIERTO`. Es imposible regalar una garantía con datos vencidos, que era
exactamente lo que el Resumen quería evitar.

## 7. Verificación exhaustiva ejecutada

Se corrió una verificación automatizada que compara la definición local contra el
estado real de la org, campo por campo. Reproducible con
`scripts/verificacion/verificar-ambiente.py`.

| Comprobación | Resultado |
| --- | --- |
| Campos definidos localmente | 114 |
| Todos existen y son accesibles en la org | ✅ |
| FLS: ningún campo sin permiso | ✅ 97 campos en el permission set |
| Todos los campos aparecen en algún formulario | ✅ |
| Vistas de lista y compact layouts sin referencias muertas | ✅ |
| Fórmulas verificadas como calculadas en la org | ✅ 6 |
| Contratos I/O de las 8 acciones (plan 8.2) | ✅ 51 campos, ninguno falta |
| `Log_Agente__c` completo (plan sección 10) | ✅ 18 campos |

### Dos bugs propios encontrados durante la verificación

1. **El generador de layouts saltaba secciones existentes en vez de reemplazarlas.**
   Consecuencia: los 3 campos de blindaje de cobertura estaban desplegados pero no
   aparecían en el formulario de Asset. Corregido: ahora reemplaza la sección.
2. **Los `describe` se escribían en `/tmp`**, que Git Bash resuelve pero Python en
   Windows no. La primera corrida reportó 221 problemas falsos. Corregido.

### Contratos I/O verificados uno por uno

| Acción (plan 8.2) | Campos | Estado |
| --- | --- | --- |
| `Buscar_Verificar_Unidad` | 5 | ✅ |
| `Registrar_Lectura_Odometro` | 6 | ✅ |
| `Evaluar_Cobertura_Garantia` | 10 | ✅ |
| `Consultar_Disponibilidad` | 7 | ✅ |
| `Crear_Orden_Servicio` | 8 | ✅ |
| `Reprogramar_Orden_Servicio` | 2 | ✅ |
| `Crear_Caso_Escalamiento` | 4 | ✅ |
| `Registrar_Resultado_Diagnostico` | 9 | ✅ |

### Pruebas de comportamiento (todas con rollback, la org queda en 0)

22 comprobaciones en tres suites: cadena completa de negocio (11), reglas de
validación (6) y blindaje de cobertura (4 escenarios + 1 control). **Todas pasan.**

## 8. Lo que sigue

1. Redactar los 8 artículos del corpus P0 y los 8-10 síntomas. **Ruta crítica de la
   semana 1** según ambos documentos.
2. Cargar el catálogo de modelos con sus manuales.
3. Los 8 Flows de acciones del plan sección 8.2.
4. Esperar los datos reales de Zapata para las pólizas y sucursales.
