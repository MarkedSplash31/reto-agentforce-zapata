# Auditoría de producción — Torre Agentforce Zapata

Fecha de cierre técnico: **5 de agosto de 2026 CDT / 6 de agosto UTC**.

## Veredicto ejecutivo

La solución **ya es funcional como evaluación controlada contra la org real** y no es
únicamente un frontend. El agente v10 está activo; conocimiento, agenda, varada y
escalamiento tienen acciones o decisiones útiles; la Torre consulta, escribe y relee
Salesforce; el escalamiento deja Case + CaseComment + Log correlacionados; las nueve
páginas pasan pruebas funcionales y visuales.

No es todavía una operación pública production-grade. Tres puertas dependen de una
decisión o credencial humana y se mantienen rojas: rotación de la contraseña expuesta
y revocación de sesiones, lifecycle oficial Agent API con el par consumidor
custodiado localmente, y aprobación de identidad/hosting. Ninguna se sustituyó con un
mock, un fixture o un éxito visual.

## Matriz requisito → evidencia

| Requisito | Estado | Evidencia autoritativa |
|---|---|---|
| Auth fail-closed, roles y ownership | **PASS para evaluación controlada** | 32/32 unitarias; E2E 401/403/IDOR; `docs/SEGURIDAD-BACKEND.md` |
| Rate limiting, CORS, límites, timeouts y redacción | **PASS** | unitarias de seguridad + E2E 429/`Retry-After`; configuración validada al arrancar |
| Identidad corporativa individual | **BLOQUEO HUMANO** | seam `AuthProvider` listo; falta aceptar tokens estáticos o integrar OIDC/SSO |
| External Client App | **PASS de configuración** | ECA activa `Torre Agentforce Zapata`, cuatro scopes, client credentials/JWT, Run As service agent |
| Metadata ECA no secreta | **PASS** | 4 componentes recuperados y check-only `0AfgK00000PdvHoSAJ`; consumer-bearing global metadata excluida |
| Agent API sesión→mensaje→stream→cierre | **BLOQUEO HUMANO** | `npm run verificar:agent-api` falla de forma explícita sin el consumer pair; `BLOQUEOS.md` §0–§1 |
| Agente y subagentes | **PASS** | `BotVersion` v10 `Active`, compilación/activación Salesforce; clasificación 9/9 y Knowledge 3/3 |
| Fuente local del agente | **PASS** | bundle exacto target `Agente_Postventa_Zapata.v10`; retrieve `09SgK00000Id9vWUAR`; check-only `0AfgK00000PeOObSAN` |
| Escalamiento real del agente | **PASS** | Preview: 1 Case + 1 comentario interno + 1 Log; Apex 13/13, 93.04% |
| Conversación posterior ida/vuelta | **PASS técnico** | comentarios escritos/releídos en Salesforce y SSE; usuario integrador, no identidad humana individual |
| Proveniencia sin inventar realidad | **PASS** | 0 filas sin clasificar en el alcance; segunda migración 0 cambios |
| Bindings Unidades/Órdenes | **PASS** | E2E valida relaciones anidadas Asset/Product/Account y WorkOrder/Asset/Sucursal/Slot |
| Agenda paginada y honesta | **PASS** | máximo 24 por página; muestra 729 franjas asumidas, pero reserva sólo con `OPERACIONAL_VERIFICADO` (hoy 0) |
| Reprogramación y varada | **PASS de contrato/guardrail** | formularios reales, validación, Flow y relectura; mutación extra se omite sin cleanup aprobado |
| Nueve páginas con identidad Zapata | **PASS** | `verificar:diseno`: 0 violaciones en 9 páginas; fuentes/CSS/Mermaid locales; móvil sin scroll horizontal |
| Playwright real | **PASS** | 50/50 ejecutadas en verde, 3 skips explícitos y justificados |
| Despliegue reproducible | **PASS de artefacto** | deploy contract PASS; Docker no-root `healthy`; imagen local `sha256:830720…87bdf7` |
| Despliegue público | **NO EJECUTADO** | requiere aprobación de costo/hosting y secretos; `autoDeployTrigger: off` |

## Valor de las páginas

| Página | Función real | Límite mostrado al usuario |
|---|---|---|
| Torre | consulta conteos/readiness; no inventa ceros en errores | mezcla de datos SF-O y semillas clasificadas |
| Conversación | cliente del contrato Agent API y errores reales | bloqueada sin credenciales ECA locales |
| Unidades | Asset + Product2 + Account + odómetro y formulario de varada | 15/15 unidades sintéticas no verificadas |
| Agenda | consulta 729 slots, filtra/pagina, reserva/reprograma mediante Flow | 0 slots operacionales; capacidad asumida no habilita botones |
| Órdenes | WorkOrders con unidad, sucursal, franja y procedencia | escenarios transaccionales sin fuente confirmada |
| Cobertura | detecta falta de regla/contradicción entre fuentes | pólizas y modelos son sintéticos; no emite cobertura real |
| Traza | busca por correlación y cruza Log/Case/WO/varada | folios de prueba no equivalen a clientes reales |
| Arquitectura | se regenera desde metadata activa | descubre 6 acciones y sus backends; demuestra escalamiento → Apex → Case/CaseComment/Log, no el antiguo v5 vacío |
| Escalamiento | cola de Case, comentarios y SSE bidireccional | no Messaging ni asesor individual autenticado |

## Defectos encontrados y corregidos en el cierre

- El agente confirmaba agenda sin revelar que la capacidad era asumida: se corrigió
  su instrucción y se validó en Preview.
- Las validaciones de activación detectaron entradas faltantes en Flows de orden,
  reprogramación y varada: v10 incluye el contrato completo y quedó activa.
- El antiguo `@utils.escalate` no persistía nada: fue sustituido por Apex transaccional
  con idempotencia, rollback, límites y comentario interno.
- La página Arquitectura estaba congelada en v5: se regeneró desde el bundle v10.
  El generador ahora descubre las acciones del grafo, recupera sus GenAiFunctions y
  clases Apex desde la org y falla si el escalamiento no demuestra las tres escrituras.
- Después de clasificar slots, la Agenda quedaba vacía por defecto: ahora enseña las
  franjas asumidas y bloquea su operación, que aporta contexto sin mentir.
- Se corrigió IDOR del rol asesor, confianza en proxy, timeouts de CLI y cierre
  ordenado de HTTP/SSE.

## Gates finales ejecutados

```text
npm ci                         PASS · 0 vulnerabilidades
npm run build                  PASS
npm test                       PASS · 32 unitarias + 50 E2E · 3 skips explícitos
npm run verificar:diseno       PASS · 0 violaciones / 9 páginas
node scripts/deploy-verificar  PASS
npm audit --audit-level=high   PASS · 0 vulnerabilidades
whitespace scan (Torre)        PASS
npm start + GET /salud         PASS · HTTP 200 · status=ok · build=1.0.0
docker build --pull            PASS
Docker health                  PASS · healthy · usuario node
npm run verificar:agent-api    BLOQUEADO · falta el par consumidor local
```

El archivo `.agent` recuperado contiene seis líneas en blanco con espacios emitidas
por Salesforce. Limpiarlas hace fallar el check-only porque una versión publicada es
inmutable. Se conserva byte-compatible con la org y se valida por Metadata API; el
scan de whitespace citado arriba cubre la Torre, no reescribe ese bundle generado.

## Salida humana mínima para declarar producción completa

1. Rotar la contraseña que apareció en la conversación, revocar tokens/sesiones y
   reautenticar CLI/Chrome. No compartir la nueva contraseña.
2. Revelar el consumer key/secret de la ECA sólo en la sesión limpia, guardarlo en el
   secret store y ejecutar `npm run verificar:agent-api` hasta completar sesión,
   mensaje, stream y cierre.
3. Aceptar formalmente la identidad Bearer estática para una evaluación cerrada o
   integrar OIDC/SSO con actor individual antes de uso corporativo.
4. Aprobar plan/costo/hosting, cargar secretos, exigir `/api/admin/salud.ok=true` y
   realizar un despliegue manual con rollback probado.

Hasta entonces el estado correcto es: **candidato funcional para evaluación real,
con operación pública bloqueada de forma explícita**.
