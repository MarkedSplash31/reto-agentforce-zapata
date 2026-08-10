# Alineación con el curso local de Agentforce

Revisión del 5/6 de agosto de 2026 contra el material de
`salesforce/INDICE-CURSO.md` y la síntesis técnica de `salesforce/27-conocimiento/`.
El curso sirve como patrón arquitectónico; la org `zapata` y sus efectos son la
evidencia final.

## Resultado

La implementación aplica los conceptos centrales del curso: agente versionado,
router semántico, subagentes con instrucciones acotadas, acciones Flow/Apex con
contratos tipados, Knowledge, permisos de service account, guardrails programáticos,
evaluaciones y trazabilidad. No copia el caso Coral Cloud: adapta el patrón a
postventa de camiones y conserva los límites reales de la org Zapata.

## Concepto del curso → implementación Zapata

| Curso / síntesis local | Aplicación en Zapata | Evidencia |
|---|---|---|
| `BotDefinition/BotVersion` y versiones inmutables | `Agente Postventa Zapata` v10 activa; v9/v8/v5 inactivas | SOQL `BotVersion` + Builder |
| Router → un subagente/topic por intención | router con conocimiento, agenda, varada, escalamiento, fuera de alcance y aclaración | bundle v10 regenerado en `publico/datos/arquitectura.json` |
| Acción → Flow | consultar agenda, crear/reprogramar orden y registrar varada usan Flows activos | metadata + E2E de contratos y relectura |
| Acción → Apex | escalamiento usa `Crear_Escalamiento_Asesor` → `EscalarAsesorHumano` | GenAiFunction + Apex recuperados de la org; deploy `0AfgK00000PdpNgSAJ`; 13/13 Apex |
| Programmatic instructions | seguridad primero en varada; no prometer agenda real; idempotencia y conflicto | Agent Script v10 + Preview |
| Variables/action inputs tipados | entradas de slot, sesión, correlación, sucursal y contexto coinciden con Flows/Apex | validación de activación Salesforce |
| Outputs como memoria de trabajo | folios, Ids, bloqueos y resultado se devuelven al planner | esquemas GenAiFunction + respuestas de Flow/Apex |
| Service account con mínimo privilegio | Run As `EinsteinServiceAgent User`, activo, perfil `Einstein Agent User` | SOQL User |
| Permission sets por agente | incluye `AgentforceServiceAgentUserPsg` y `Zapata_Agente_Servicio` | SOQL `PermissionSetAssignment` |
| Knowledge/RAG | búsqueda de 20 artículos; el agente revela `v1.0-sintetica-no-verificada` | Preview + eval Knowledge 3/3 |
| Guardrails antes de mutar | slot sólo opera con `OPERACIONAL_VERIFICADO`; hoy 0 | backend, validación rule y E2E |
| Trazabilidad CRM | `Correlation_Id__c` cruza Log, Case, WorkOrder y varada | traza + escalamiento 1/1/1 |
| Pruebas repetibles | eval de clasificación 9/9, Knowledge 3/3, 32 unitarias y 50 E2E | IDs de run + evidencia v10 |
| Canal/API externo | ECA activa con cuatro scopes y Run As | Setup; lifecycle aún bloqueado por consumer pair local |

## Dónde la solución mejora el patrón de ejemplo

- El caso Coral Cloud muestra acciones de reserva y Case; Zapata además obliga a
  declarar proveniencia y bloquea una capacidad no verificada antes del Flow.
- El escalamiento no se limita a cambiar estado: persiste Case, contexto interno y
  Log en una transacción idempotente.
- La Torre añade una superficie independiente para comprobar acciones, relectura,
  traza y arquitectura; no usa la respuesta del LLM como única prueba.
- Los subagentes `off_topic` y `ambiguous_question` no tienen acciones por diseño:
  son fronteras cognitivas, no topics de negocio incompletos.

## Brechas frente al estándar profesional del curso

1. **Agent API externo:** falta probar sesión→mensaje→stream→cierre con un token de la
   ECA. La configuración existe, pero el secreto no puede obtenerlo ni guardarlo el
   agente de desarrollo.
2. **Knowledge productivo:** los 20 artículos son sintéticos y están etiquetados; hace
   falta contenido aprobado por Zapata para respuestas de garantía/servicio reales.
3. **Agenda productiva:** los 729 slots provienen de horario web y capacidad asumida;
   se necesita integración con el sistema operativo del taller.
4. **Identidad humana:** la Torre aplica RBAC/ownership, pero el rol asesor sigue
   escribiendo como usuario integrador. Para producción corporativa falta SSO/OIDC y
   actor individual.
5. **Trust Layer y observabilidad:** Salesforce aporta su Trust Layer; la Torre añade
   redacción y protección de evidencia, pero aún no tiene métricas distribuidas ni
   request tracing global.

Estas brechas no invalidan el agente funcional. Sí impiden declarar que la solución
representa datos productivos o una operación pública completa.

## Material local contrastado

- `salesforce/13-introduction-to-agentforce/`
- `salesforce/15-new-agentforce-builder/`
- `salesforce/16-introduction-to-agent-builder/`
- `salesforce/18-agentforce-service-agent/`
- `salesforce/22-quickstart-service-agent/`
- `salesforce/23-programmatic-instructions/`
- `salesforce/10-einstein-trust-layer/`
- `salesforce/11-autonomous-agents/`
- `salesforce/27-conocimiento/00-MEMORIA-MAESTRA.md`
- `salesforce/27-conocimiento/01-agentes.md`
- `salesforce/27-conocimiento/02-flows.md`
- `salesforce/27-conocimiento/12-seguridad-gobernanza.md`
- `salesforce/27-conocimiento/14-verificacion-runtime-config.md`
