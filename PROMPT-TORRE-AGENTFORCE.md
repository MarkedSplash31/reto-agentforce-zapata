# Prompt — Torre Agentforce Zapata

Pégalo completo en una sesión nueva de Claude Code, con `cwd` en
`C:\Users\Admin\Desktop\Workspace definitivo`.

Está escrito sobre hechos verificados el 5 de agosto de 2026: la org `zapata` responde, los
objetos y Flows existen, el bot existe. Si algo de eso cambió, la Fase 0 lo detecta y para.

---

```
Construye la Torre Agentforce Zapata: una web app que hospeda el Agente Postventa y sus
subagentes contra la org REAL de Salesforce, con escalamiento humano que de verdad escala.

Es material de demo para el hackatón del 17 de agosto. La demo se juega en que un evaluador
pueda ver datos reales moviéndose, no maquetas.

═══════════════════════════════════════════════════════════════════════════════
REGLA CERO — ANTI-SIMULACIÓN
═══════════════════════════════════════════════════════════════════════════════

Está prohibido el dato inventado. Ni mocks, ni fixtures, ni "modo demo", ni arreglos con
setTimeout que finjan latencia. Si un endpoint no responde, la app muestra el error real.

Cada vez que declares "conectado", "funciona" o "listo", tiene que existir en
`torre-agentforce/evidencia/` un archivo con la respuesta cruda de la API que lo respalda,
con marca de tiempo. Sin evidencia en disco, la afirmación no existe.

Cuando algo esté bloqueado por credenciales o permisos que no puedes crear, dilo, sigue con
todo lo demás, y deja el bloqueo escrito en `torre-agentforce/BLOQUEOS.md` con el paso exacto
que debe hacer un humano. No lo rodees con un mock.

═══════════════════════════════════════════════════════════════════════════════
FASE 0 — CONOCIMIENTO Y VERIFICACIÓN DE TERRENO  (sin esto no empieza nada)
═══════════════════════════════════════════════════════════════════════════════

0.1 · Carga de contexto. Lee, en este orden, y resume en
     `torre-agentforce/00-CONTEXTO.md` lo que cambia decisiones de diseño:

  Negocio y estado del reto
    reto-agentforce/PLAN-DE-TRABAJO-FINAL.md
    reto-agentforce/PLAN-3-FLOWS-P0.md
    reto-agentforce/PENDIENTES-JUNTA.md
    reto-agentforce/DICCIONARIO-DE-DATOS.md

  Modelo de datos y decisiones ya tomadas
    reto-agentforce/zapata-agentforce/docs/MAPA-DEL-SISTEMA.md
    reto-agentforce/zapata-agentforce/docs/AUDITORIA-MODELO-DATOS.md
    reto-agentforce/zapata-agentforce/docs/DECISION-FUSION.md
    reto-agentforce/zapata-agentforce/docs/DATOS-REALES-ZAPATA.md
    reto-agentforce/zapata-agentforce/docs/BITACORA-SESION-2026-08-02.md

  Memoria en Obsidian — vault "C:\Users\Admin\Desktop\Social media page"
    02 - PROJECTS/Reto Agentforce Zapata.md
    02 - PROJECTS/Sistema de Diseno Zapata.md

  Identidad visual, que es obligatoria para toda la UI
    skills/zapata-design/SKILL.md  y sus references/

  Grafo de memoria: consulta las entidades "Reto Agentforce Zapata",
  "Corporación Zapata", "Sistema de diseño Zapata 2026",
  "Infraestructura web de Zapata" y "Proyecto identidad y clon de Zapata".

0.2 · Verificación de terreno. Ejecuta y guarda salida cruda en `evidencia/00-terreno/`:

    sf org display --target-org zapata --json
    sf org list limits --target-org zapata --json
    sf data query -o zapata --json -q "SELECT Id,DeveloperName,Type FROM BotDefinition"
    sf data query -o zapata --json -q "SELECT COUNT() FROM Asset"
    sf data query -o zapata --json -q "SELECT COUNT() FROM Slot_Taller__c"
    sf data query -o zapata --json -q "SELECT COUNT() FROM Unidad_Varada__c"
    sf data query -o zapata --json -q "SELECT COUNT() FROM Log_Agente__c"
    sf data query -o zapata --json -q "SELECT COUNT() FROM WorkOrder"
    sf org list metadata -m Flow -o zapata --json
    sf org list metadata -m GenAiFunction -o zapata --json

  Lo que se sabe hoy y debes CONFIRMAR, no asumir:
    org alias `zapata`, Developer Edition, API 67.0
    bot `Agente_Postventa_Zapata`, planner bundles v1..v5
    genAiFunctions: Buscar_Conocimiento_Postventa, Consultar_disponibilidad_de_taller,
                    Crear_Orden_Servicio, Crear_Reporte_Unidad_Varada,
                    Reprogramar_Orden_Servicio
    Flows: Crear_Orden_Servicio, Crear_Reporte_Unidad_Varada,
           Registrar_Log_Agente, Reprogramar_Orden_Servicio
    Objetos: Asset, Lectura_Odometro__c, Log_Agente__c, Modelo_Sucursal__c,
             Regla_Cobertura__c, Sesion_Diagnostico__c, Sintoma__c,
             Slot_Taller__c, Unidad_Varada__c

  Si algún objeto está vacío, dilo en `00-CONTEXTO.md`: una demo contra tablas vacías no
  demuestra nada, y sembrar datos es una tarea explícita, no un efecto colateral.

0.3 · Contrato de la API del agente. NO confíes en tu memoria de entrenamiento para el
  shape de la Agentforce Agent API: cambia. Consulta la documentación oficial vigente
  (usa context7, WebFetch o WebSearch) y escribe el contrato verificado en
  `torre-agentforce/docs/CONTRATO-AGENT-API.md`: cómo se obtiene el token, cómo se abre
  sesión, cómo se manda un mensaje, cómo llega el streaming, y cómo se cierra.
  Incluye la fecha de consulta y el enlace.

  Guarda igual el contrato de lo que uses para escalamiento humano (Messaging for In-App
  and Web, Omni-Channel, o Case + routing) en `docs/CONTRATO-ESCALAMIENTO.md`.

0.4 · Credenciales. La app necesita una Connected App con OAuth. Tú NO puedes crearla ni
  debes pedir que te peguen secretos en el chat. Escribe en `BLOQUEOS.md` los pasos
  exactos en Setup, los scopes mínimos, y el `.env.example` con los nombres de variable.
  El código lee de `process.env`. Ningún secreto entra al repo ni a un log.

═══════════════════════════════════════════════════════════════════════════════
FASE 1 — GRAFO DE CONSTRUCCIÓN  (graph engineering)
═══════════════════════════════════════════════════════════════════════════════

Antes de escribir código, modela el trabajo como un grafo dirigido y escríbelo en
`torre-agentforce/docs/GRAFO-CONSTRUCCION.md` con un diagrama mermaid.

Cada nodo declara: qué produce, de qué depende, cómo se verifica que quedó, y qué agente
lo hace. Las aristas son dependencias de datos reales, no de gusto.

El grafo gobierna el orden de despacho: todo nodo sin dependencias pendientes puede correr
en paralelo. No despaches un nodo cuyo padre no haya pasado su verificación.

Nodos mínimos:

  N1  esquema y consultas SOQL contra los 9 objetos
  N2  capa de auth OAuth y refresco de token
  N3  cliente de la Agent API — sesión, mensaje, streaming
  N4  cliente de datos — lectura de unidades, slots, órdenes, logs
  N5  escritura — invocación de los 4 Flows vía API
  N6  canal de escalamiento humano
  N7  servidor de la web app y sus rutas
  N8  UI con el sistema zapata-design
  N9  vista de traza y diagramas del grafo de subagentes
  N10 suite de pruebas end to end contra la org real
  N11 despliegue

Marca en el grafo qué nodos son "camino crítico de la demo": si uno de esos falla, la demo
no se puede dar. Esos se atienden primero y se verifican dos veces.

═══════════════════════════════════════════════════════════════════════════════
FASE 2 — HARNESS DE AGENTES  (usa los del repo, no inventes roles)
═══════════════════════════════════════════════════════════════════════════════

Antes de repartir trabajo lee `skills/agent-harness-construction/SKILL.md` y
`skills/enterprise-agent-ops/SKILL.md`. Diseña el harness y escríbelo en
`torre-agentforce/docs/HARNESS.md`: quién hace qué nodo, con qué entrada, qué entrega, y
quién verifica su salida. Nadie aprueba su propio trabajo.

Agentes disponibles en `agents/` — usa estos nombres:

  diagnóstico y datos     code-explorer · database-reviewer · type-design-analyzer
  arquitectura            architect · code-architect · planner
  construcción            build-error-resolver · typescript-reviewer · react-reviewer
  diseño                  (aplica la skill zapata-design; verifica con auditar-sistema.mjs)
  conexión e integración   api-connector-builder (skill) · network-troubleshooter
  evaluación              gan-planner · gan-generator · gan-evaluator
  corrección              code-simplifier · refactor-cleaner · silent-failure-hunter
  pruebas                 tdd-guide · e2e-runner · pr-test-analyzer
  seguridad               security-reviewer
  rendimiento             performance-optimizer
  documentación           doc-updater
  operación del harness   harness-optimizer · loop-operator

Reglas del harness:
  · Un agente por nodo. Nada de un agente haciendo tres cosas.
  · Todo entregable pasa por un revisor distinto al autor.
  · `silent-failure-hunter` revisa específicamente los caminos donde un error de red o de
    permiso podría quedarse callado. En una demo en vivo, el fallo silencioso es el peor.
  · `security-reviewer` audita manejo de tokens antes de cualquier despliegue.

═══════════════════════════════════════════════════════════════════════════════
FASE 3 — LOOP DE CONSTRUCCIÓN  (iterar hasta verde, con salida definida)
═══════════════════════════════════════════════════════════════════════════════

Lee `skills/verification-loop/SKILL.md` y `skills/autonomous-loops/SKILL.md`.

Por cada nodo del grafo, el ciclo es:

    construir → verificar contra la org real → si falla, diagnosticar la causa raíz
    → corregir → volver a verificar

Condiciones de salida del loop, explícitas:
  · sale en verde cuando la verificación del nodo pasa y su evidencia está en disco
  · sale en rojo tras 3 intentos con la MISMA causa raíz — entonces escribe el hallazgo en
    `BLOQUEOS.md` y sigue con otros nodos. Insistir una cuarta vez es desperdicio.
  · nunca sale en verde por "parece que ya"

Prohibido bajar el criterio para que pase. Si una prueba estorba, se arregla el código,
no la prueba.

═══════════════════════════════════════════════════════════════════════════════
FASE 4 — QUÉ SE CONSTRUYE
═══════════════════════════════════════════════════════════════════════════════

Ubicación: `reto-agentforce/torre-agentforce/`

Servidor. Node con TypeScript. Es un intermediario, no un almacén: no persiste datos de
negocio, los lee y los escribe en Salesforce. Responsabilidades:
  · custodiar el token OAuth — jamás llega al navegador
  · proxy hacia la Agent API con streaming al cliente
  · consultas SOQL de sólo lectura para las vistas
  · invocación de Flows para las escrituras
  · canal de escalamiento
  · un endpoint `/salud` que reporta el estado real de cada dependencia

Frontend. Aplica `skills/zapata-design` sin excepción. La app de referencia es
`reto-agentforce/torre-postventa/` — mismo shell inyectado, mismos tokens. Secciones:

  Conversación
    Chat contra el agente real. Muestra en vivo qué subagente tomó el turno y qué
    genAiFunction se invocó. Sin esto la demo no enseña la arquitectura, sólo un chat.

  Unidades
    Lectura real de Asset y Unidad_Varada__c, con su estado y su odómetro
    (Lectura_Odometro__c). Filtros por sucursal y estado.

  Agenda
    Calendario real sobre Slot_Taller__c. Disponibilidad consultada, no simulada.
    Reservar dispara `Crear_Orden_Servicio`; reprogramar dispara
    `Reprogramar_Orden_Servicio`. Verifica el efecto releyendo el registro.

  Órdenes
    WorkOrder reales, con su unidad, su sucursal y su estado.

  Cobertura
    `Regla_Cobertura__c` evaluada contra datos reales de la unidad, citando la fuente.
    Ojo con la contradicción ya documentada: el artículo de cobertura dice 36 meses sin
    límite de kilometraje para cabina y chasis, y la fórmula aplica 24 meses / 250,000 km
    a todo. La UI debe hacer visible el conflicto, no esconderlo. Está en el modelo, no
    es tuyo para arreglarlo en silencio.

  Traza
    `Log_Agente__c` correlacionado por folio: la conversación, la decisión, el Flow que
    actuó y su evidencia. Es la cadena que el reto pide demostrar.

  Arquitectura
    Diagramas mermaid GENERADOS desde la metadata real de la org, no dibujados a mano:
    el bot, sus planner bundles, sus genAiFunctions, y qué Flow toca qué objeto.
    Un diagrama que se desincroniza de la realidad es peor que no tenerlo.

Escalamiento humano. Este es el que se demuestra en vivo y el que más fácil se finge.
Requisitos:
  · el agente detecta el caso que debe escalar y lo declara
  · se abre un canal real con un humano
  · el humano ve el contexto completo de la conversación, no un resumen
  · el humano responde y su respuesta llega al usuario
  · queda registrado en `Log_Agente__c` con el mismo folio

  Prueba de aceptación, y no vale otra cosa: dos navegadores abiertos, uno como cliente y
  otro como agente humano; el mensaje cruza en ambos sentidos; el registro queda en la org.
  Grábalo.

═══════════════════════════════════════════════════════════════════════════════
FASE 5 — EVALUACIÓN, PRUEBAS Y DESPLIEGUE
═══════════════════════════════════════════════════════════════════════════════

Evaluación del agente. Lee `skills/agent-eval/SKILL.md` y `skills/eval-harness/SKILL.md`.
Hay `aiEvaluationDefinitions` en la org: úsalos. Escribe casos que ataquen lo que el plan
marca como crítico, incluidos los de seguridad — VIN válido con cuenta incorrecta no debe
revelar nada, y petición de datos de otro cliente debe dar exposición cero. El umbral de
esos dos es 100%, sin promedio que los compense.

Pruebas end to end. `e2e-runner` con Playwright contra la org real. Como mínimo:
  conversación completa con invocación de acción · reserva de cita que crea WorkOrder ·
  reprogramación · reporte de unidad varada · escalamiento humano de ida y vuelta ·
  caso de seguridad de VIN ajeno

Diseño. `node skills/zapata-design/scripts/auditar-sistema.mjs <cada ruta>`.
Sale con código 0 o no se despliega.

Despliegue. Lee `skills/deployment-patterns/SKILL.md`. Elige destino y justifica.
Verifica el despliegue con una llamada real contra el entorno desplegado, no localhost, y
guarda la evidencia.

═══════════════════════════════════════════════════════════════════════════════
CÓMO ENTREGAS
═══════════════════════════════════════════════════════════════════════════════

Reporta en cada hito: qué quedó verde con su evidencia, qué quedó rojo y por qué, y qué
necesita mano humana. Si algo no se pudo, dilo con esa palabra; no lo maquilles.

Al terminar deja:
  torre-agentforce/README.md          cómo levantarlo, con prerrequisitos honestos
  torre-agentforce/BLOQUEOS.md        lo que requiere un humano, con pasos exactos
  torre-agentforce/docs/              contratos, grafo, harness
  torre-agentforce/evidencia/         respuestas crudas que respaldan cada afirmación
  y actualiza la nota de Obsidian "02 - PROJECTS/Reto Agentforce Zapata.md" y el grafo
  de memoria con lo aprendido.

Trabaja hasta que el camino crítico esté en verde. Si te topas con algo que sólo un humano
puede desbloquear, sigue por otro nodo del grafo en vez de detenerte.
```

---

## Por qué el prompt está armado así

**La Regla Cero va primero y es la que más peso carga.** El fallo característico de un
encargo como éste es que se entrega algo que *parece* conectado. Exigir evidencia cruda en
disco por cada afirmación convierte "está conectado" en algo falsable.

**La Fase 0 verifica antes de construir.** El prompt lleva los nombres reales de objetos,
Flows y funciones, pero pide confirmarlos contra la org. Los datos tienen fecha; una org
cambia. Y pide explícitamente **no** confiar en la memoria del modelo para el contrato de la
Agent API — esa API se mueve y una firma inventada de memoria cuesta horas.

**El grafo antes que el harness, y el harness antes que el loop.** Sin grafo no se sabe qué
puede ir en paralelo; sin harness no se sabe quién verifica a quién; sin condición de salida
un loop se atasca reintentando la misma causa raíz.

**El escalamiento humano lleva una prueba de aceptación física** —dos navegadores, mensaje
de ida y vuelta, registro en la org— porque es la pieza que más fácilmente se simula y la
que el jurado va a mirar.

**Las credenciales quedan fuera por diseño.** El prompt manda documentar el bloqueo en vez
de pedir secretos por chat, y el código lee de `process.env`.

**La contradicción de cobertura se hereda, no se tapa.** Ya está documentada en el modelo:
el artículo dice 36 meses sin límite de kilometraje y la fórmula aplica 24 meses / 250,000
km. El prompt ordena hacerla visible en la UI. Un agente que la resuelve callando escoge una
de las dos y en la demo dará el veredicto contrario al artículo que cita.
