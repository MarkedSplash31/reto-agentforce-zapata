# Ficha Técnica — Agente Postventa Zapata

**Hackatón IA Agéntica, tercera edición · Equipo 35 · Corporación Zapata**
*(distribución y servicio de camiones pesados)*

> Versión corregida del 12 de agosto de 2026. Sustituye a la anterior: las dos tablas
> salían corridas de fila, cinco cifras habían quedado atrás y faltaba declarar un
> límite. Todo lo que aquí se afirma está releído de la organización el día de la
> corrección, y lo que no se pudo comprobar se dice.

---

## 1 · Equipo y problema atendido

> **Por confirmar antes de entregar.** En la versión anterior esta tabla tenía cuatro
> bloques de contribución para tres personas y quedaron desplazados. Abajo va el reparto
> que corresponde a lo que cada quien firmó en el repositorio; revísenlo ustedes, que es
> lo único que no puedo verificar contra la org.

| Integrante | Rol | Contribución |
|---|---|---|
| Diego González Garduño | Estudiante — Arquitecto de agente | Agent Builder, subagentes e instrucciones, Knowledge y su acción |
| Gabriel Valadez Gómez | Estudiante — Desarrollador de plataforma | Apex, Flows, modelo de datos, reglas de validación, versionado del agente y la extensión web |
| Mtra. Guadalupe Becerra Doncel | Docente — Mentora | Revisión de contenido normativo y validación de criterios de cobertura |

Corporación Zapata distribuye y da servicio a camiones pesados en nueve talleres del
país. La postventa concentra el dolor operativo: el cliente llama para saber si su
unidad tiene garantía, para agendar taller o porque quedó varado en carretera, y cada
consulta consume el tiempo de un asesor que debe cruzar a mano VIN, kilometraje, póliza
y disponibilidad. El Agente Postventa Zapata resuelve esas cuatro conversaciones de
extremo a extremo, en lenguaje natural y con efecto real en el CRM.

---

## 2 · Arquitectura Agentforce

Un solo agente (**Agente Postventa Zapata**) con una capa de clasificación que enruta a
seis subagentes. Cuatro resuelven trabajo; dos son guardrails de contención que impiden
que el agente responda fuera de su alcance. Las acciones son Flows autolaunched y clases
Apex invocables: **ninguna regla de negocio vive únicamente en lenguaje natural.**

| Subagente | Acciones | Salida |
|---|---|---|
| `conocimiento_y_respuestas` | `Buscar_Conocimiento_Postventa` | Respuesta citada del artículo, con estado de fuente declarado |
| `agendar_servicio_taller` | `Consultar_disponibilidad_de_taller`, `Crear_Orden_Servicio`, `Reprogramar_Orden_Servicio` | WorkOrder creado o movido, con folio dictado al cliente |
| `atencion_unidades_varadas` | `Crear_Reporte_Unidad_Varada` | `Unidad_Varada__c` con folio de asistencia en carretera |
| `escalamiento_asesor_humano` | `Crear_Escalamiento_Asesor` | Case en la cola de postventa, con la conversación adjunta |
| `off_topic` | — (contención) | Declina y reencauza sin inventar |
| `ambiguous_question` | — (contención) | Pide la precisión mínima antes de actuar |

Cuatro decisiones de diseño sostienen la ejecución:

- **Compuerta de identidad.** Sin un VIN válido de 17 caracteres el agente no ejecuta
  `Crear_Orden_Servicio`; explica por qué y ofrece un asesor. Toda escritura queda ligada
  a la unidad registrada.
- **Cero invención de disponibilidad.** El agente sólo puede ofrecer las franjas que la
  acción devuelve, y la acción **sólo devuelve las que el alta acepta**. Cuando un taller
  publica horario pero su cupo no está confirmado, la acción no entrega ninguna opción:
  dice que el horario existe, quién lo confirma, y en qué taller sí se puede apartar hoy.
  Una salvedad redactada se pierde; una lista vacía no.
- **No prometer lo que la red no puede.** Antes de ofrecer «otro taller que sí lo
  atienda», la acción cuenta en cuántas sucursales activas está dado de alta ese modelo.
  Si son cero, lo dice y pasa con un asesor en vez de mandar al cliente a buscar en vano.
- **Autonomía explícita.** La petición del cliente es su autorización: el agente ejecuta
  y reporta el resultado, sin pedir una confirmación adicional que rompería la resolución
  autónoma.

---

## 3 · Lógica de los Flows y del modelo de datos

Cuatro Flows productivos concentran las reglas deterministas.
`Crear_Orden_Servicio` valida la anticipación mínima por sucursal y ocupa el cupo de la
franja. `Reprogramar_Orden_Servicio` mueve la cita existente **conservando el folio**, y
cuando la ventana ya no lo permite deriva a un caso en lugar de fallar en silencio.
`Crear_Reporte_Unidad_Varada` levanta el reporte con lo mínimo indispensable —carretera y
falla— sin exigir VIN ni kilómetro, porque una unidad inmovilizada no puede esperar.
`Registrar_Log_Agente` es un subflow invocado por los tres en las rutas de éxito, bloqueo
y error, de modo que ninguna acción pueda olvidar su traza.

La cobertura de garantía es determinista y no la decide el modelo: se evalúa contra el
custom setting `Parametros_Garantia__c` (**250 000 km y 24 meses**) usando el odómetro
registrado, y devuelve `CUBIERTO`, `NO_CUBIERTO` o `REQUIERE_DATO`. **Diecisiete reglas
de validación** activas protegen la consistencia; entre ellas,
`Error_Requiere_Codigo` obliga a que todo resultado `ERROR` o `BLOCKED` traiga código o
guardrail, para que un bloqueo siempre sea auditable.

El catálogo operativo comprende **nueve talleres y 803 franjas**, de las cuales sólo las
marcadas `OPERACIONAL_VERIFICADO` son reservables.

---

## 4 · Knowledge y artículos utilizados

La acción estándar de Knowledge no era funcional en la org (Data Library sin
aprovisionar), por lo que se construyó una clase Apex invocable propia,
`BuscarConocimientoPostventa`, con búsqueda SOSL sobre los artículos publicados y
respaldo SOQL por título y resumen. Devuelve el contenido convertido a texto plano y
limitado a tres artículos, lo que hace la respuesta determinista y citable: **el agente
reproduce el artículo en vez de parafrasearlo.**

El corpus cubre **20 artículos publicados en español** sobre garantía y exclusiones,
mantenimiento programado, política de citas y reprogramación, diagnóstico seguro y
asistencia en carretera. Cada respuesta declara su procedencia: el material del reto es
sintético y no verificado, y el agente lo comunica en lenguaje natural —sin presentarlo
como póliza oficial— y repite el estado literal de la fuente si el cliente lo cuestiona.

Si el cliente dicta un número de serie que no existe en el padrón, la acción lo detecta y
antepone el aviso **dentro del contenido**, no sólo en un campo aparte: pedirle al agente
que además leyera otro campo eran dos órdenes contradictorias, y el aviso se perdía.

---

## 5 · Trazabilidad y evidencia

Cada acción escribe un registro en `Log_Agente__c` con `Correlation_Id__c` —que amarra la
conversación completa—, `Related_Record_Id__c`, `Guardrail_Triggered__c`,
`Odometer_Used__c` y su origen, `Policy_Version__c` y `Unit_Verified__c`. La org acumula
**361 registros de traza** generados durante construcción y pruebas.

**Verificación de extremo a extremo del 12 de agosto de 2026**, reproducible con un
comando (`npm run verificar:e2e`): un cliente solicitó cita en Querétaro para el VIN
`1FUJGLDR9PL456781`; el agente consultó disponibilidad, ofreció franjas reales y creó la
orden **00000088** (taller FL-QRO, estado New). Después la movió a otro día conservando
el mismo folio, sin crear una segunda cita. La relectura posterior contra Salesforce
confirma los registros con `EinsteinServiceAgent User` como autor: **el agente ejecutó, no
describió.**

El escalamiento presenta **111 casos** en la cola de postventa abiertos por el propio
usuario del agente, con idempotencia por `Idempotency_Key__c` que impide duplicar el caso
ante reintentos.

### El aparato de verificación

Lo que sostiene las afirmaciones de esta ficha no es una corrida manual: son gates que
cualquiera puede volver a correr.

| Gate | Qué comprueba | Estado |
|---|---|---|
| `npm run test:unit` | 139 pruebas del servidor y sus reglas | verde |
| `npm run test:agent-protocol` | 80 comprobaciones del contrato de la Agent API | verde |
| `npm run test:e2e` | 41 casos de rutas, UI y seguridad | verde |
| `npm run verificar:e2e` | conversaciones completas, releídas de Salesforce por el CLI | verde |
| `npm run verificar:generalidad` | las 15 unidades y los 9 talleres, con datos que no son los del demo | verde |
| `npm run verificar:guion` | el guion del video, escena por escena | grabable |
| `npm run verificar:diseno` | once reglas del sistema visual, incluido contraste, en 7 estados de pantalla | 0 violaciones |
| Apex en la org | 21 pruebas de `ZapataAgendaController` y procedencia | verde |

---

## 6 · La extensión web: un canal propio de cliente

No es una pantalla de pruebas ni el Preview de Agentforce. Es un portal con la identidad
de Zapata, hospedado aparte, que consume la **Agent API** y propaga el mismo identificador
de visita como `$Context.RoutableId`. Una conversación iniciada en el sitio termina en el
expediente que atiende un asesor, bajo el mismo folio.

- **El cliente entra sin cuenta.** El servidor emite una sesión de visitante en cookie
  HttpOnly; el alcance de lo que puede leer o escribir vive en esa sesión, nunca en lo que
  mande el navegador.
- **La conversación es la aplicación.** Agendar, reportar una varada, consultar garantía y
  pedir una persona se resuelven hablando. Lo que el asistente consulta o registra
  —cobertura, horarios, la orden, el caso— ocupa la pantalla al lado del hilo.
- **El asesor hereda al agente.** En `/panel.html` atiende los escalamientos con la
  conversación completa delante, responde al cliente **en vivo**, y tiene una consulta
  privada al mismo asistente que el cliente no ve.
- **La pantalla comprueba lo que el agente afirma.** Cuando el cliente nombra un taller y
  dicta su número de serie, el servidor lo verifica contra la organización y lo dice:
  *«Comprobado en el sistema de Zapata: Querétaro sí atiende el modelo de tu unidad»*.

**Accesibilidad, como desviación declarada.** El sistema visual se reconstruyó desde
zapata.com.mx midiendo el sitio vivo. Los tres tonos de texto callado que se midieron allí
quedan por debajo del mínimo legible sobre el lienzo casi negro (3.99, 2.55 y 1.87 : 1
frente al 4.5 : 1 que pide WCAG AA). Se subieron a 5.63, 4.92 y 4.92 conservando la
jerarquía. Es la única desviación deliberada del clon, está escrita como tal en el CSS, y
un auditor la comprueba en cada corrida.

---

## 7 · Escalabilidad y limitaciones declaradas

La solución es nativa de Salesforce y no depende de infraestructura externa para operar:
Flows, Apex invocable, Knowledge y objetos estándar. Los parámetros de negocio —umbral de
garantía, anticipación por sucursal, catálogo de talleres— viven en configuración, no en
código, de modo que una red mayor se atiende cargando datos y no reprogramando.

Se declaran **cuatro límites conocidos**, por rigor y no por omisión:

1. **La acción de conocimiento ya deja traza, pero falta enganchar su entrada.** La clase
   `BuscarConocimientoPostventa` recibe ahora `correlationId` y escribe en
   `Log_Agente__c` con el artículo consultado y su versión de política —comprobado—. Lo
   que falta es un paso de interfaz: refrescar la acción en Agent Builder para que el
   planner le pase `$Context.RoutableId`, igual que ya hace con el escalamiento. El
   esquema de entrada de una `GenAiFunction` no se puede desplegar por metadata.

2. **El escalamiento entrega un caso enrutado a la cola de postventa**, no una
   transferencia en vivo por Omni-Channel, y el agente lo comunica en esos términos para
   no prometer algo que la org no puede sostener.

3. **Ocho de los nueve talleres no tienen cupo confirmado.** Sus horarios están publicados
   pero nadie ha verificado cuántas unidades caben por franja, y el alta rechaza una franja
   sin procedencia acreditada. El agente ya no las ofrece —dice que el horario existe,
   quién lo confirma y dónde sí se puede apartar hoy—, pero mientras esas franjas no se
   verifiquen, sólo Querétaro reserva en el acto.

4. **El modelo T680 no está dado de alta en la red.** Nueve de las quince unidades del
   padrón son T680 y ninguna sucursal lo declara en `Modelo_Sucursal__c`, ni tiene reglas
   de cobertura. El agente lo dice y pasa con un asesor en vez de ofrecer una búsqueda que
   no puede terminar bien. Cargar esas filas es una decisión operativa del negocio, no algo
   deducible desde el código.

Un quinto punto, menor y también dicho: la póliza cubre **Eléctrico y electrónica**,
**Chasis y estructura** y **Corrosión**, y la lista de valores de `Sistemas_Soportados__c`
no incluye ninguno de los tres. La compuerta de disponibilidad dejó de cruzar por un
sistema que el catálogo no sabe expresar —hacerlo garantizaba cero y negaba el taller—, y
cruza sólo por modelo, que es lo único que el catálogo puede afirmar.

---

**Org de desarrollo** `00DgK00000VXSyCUAX` · **API** 67.0 · Repositorio con el bundle del
agente, sus seis acciones, los cuatro Flows, el Apex, las pruebas y la extensión web,
sincronizado con la organización el 12 de agosto de 2026.
