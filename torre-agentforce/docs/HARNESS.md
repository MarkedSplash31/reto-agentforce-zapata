# Harness de agentes

Diseñado sobre `skills/agent-harness-construction/SKILL.md` y
`skills/enterprise-agent-ops/SKILL.md`. Los nombres de agente salen de `agents/` —
ninguno inventado.

## Las cuatro reglas

1. **Un agente por nodo.** Nadie hace tres cosas.
2. **Nadie aprueba su propio trabajo.** El revisor es siempre distinto del autor.
3. **`silent-failure-hunter` revisa específicamente los caminos donde un error de red
   o de permiso podría quedarse callado.** En una demo en vivo el fallo silencioso es
   el peor de todos: un panel vacío se ve igual que "no hay datos".
4. **`security-reviewer` audita el manejo de tokens antes de cualquier despliegue.**
   Es puerta, no sugerencia.

---

## Reparto

| Nodo | Autor | Entrada | Entrega | Revisor |
|---|---|---|---|---|
| N1 esquema y SOQL | `database-reviewer` | `evidencia/05-esquema/` | consultas tipadas, sólo campos del describe | `type-design-analyzer` |
| N2 auth y token | `api-connector-builder` (skill) | `docs/CONTRATO-AGENT-API.md` §2, `.env.example` | `ProveedorDeToken` con 2 implementaciones | **`security-reviewer`** |
| N3 Agent API | `api-connector-builder` (skill) | contrato §3–§6 | sesión, mensaje, streaming, cierre | `silent-failure-hunter` |
| N4 datos | `code-architect` | N1 + N2 | lecturas de las 6 vistas | `database-reviewer` |
| N5 flows | `api-connector-builder` (skill) | contratos de `00-CONTEXTO.md` §5 | 4 Flows + relectura del efecto | `silent-failure-hunter` |
| N6 escalamiento | `architect` | `docs/CONTRATO-ESCALAMIENTO.md` | canal + 2 vistas | `silent-failure-hunter` |
| N7 servidor | `code-architect` | N3–N6 | `/salud` de liveness + `/api/admin/salud` de dependencias | `typescript-reviewer` |
| N8 UI | skill `zapata-design` | N7 + `torre-postventa/` | 7 secciones sobre shell inyectado | `auditar-sistema.mjs` + `react-reviewer` |
| N9 traza y diagramas | `doc-updater` | N1 + N4 | mermaid generado desde metadata | `code-explorer` |
| N10 pruebas e2e | `e2e-runner` | N8 + N6 | suite Playwright de HTTP, UI, seguridad y Agent API; integración SF condicionada a credenciales | `pr-test-analyzer` |
| N11 despliegue | skill `deployment-patterns` | N10 | contenedor + Blueprint + runbook; sin publicación remota | **`security-reviewer` pendiente** |

Evaluación del agente (`aiEvaluationDefinitions` ya existentes en la org):
`gan-planner` diseña los casos → `gan-generator` los escribe → **`gan-evaluator`
juzga**. Los tres separados por la regla 2.

Corrección transversal, sobre el código ya revisado: `code-simplifier` y
`refactor-cleaner`. Rendimiento: `performance-optimizer`, sólo si una vista tarda.

---

## Puertas de calidad

Ninguna es negociable.

| Puerta | Comprobación | Quién |
|---|---|---|
| **Sin dato inventado** | ningún mock, fixture, `setTimeout` de latencia falsa ni "modo demo" en `src/` | `silent-failure-hunter` |
| **Sin fallo callado** | todo `catch` propaga o muestra; **prohibido `catch {}` vacío** y prohibido devolver `[]` cuando la consulta falló | `silent-failure-hunter` |
| **Token custodiado** | el token no cruza al navegador, no se loguea, no se persiste | `security-reviewer` |
| **Identidad visual** | `auditar-sistema.mjs` con código 0 en cada ruta | auditor |
| **Efecto verificado** | toda escritura se comprueba releyendo el registro | `pr-test-analyzer` |
| **Exposición cero** | VIN válido con cuenta ajena no revela nada. Umbral **100%**, sin promedio que lo compense | `gan-evaluator` |

### La distinción que gobierna N5, N6 y N8

`varMotivoBloqueo` poblado **no es un error**: es un guardrail funcionando. La UI lo
muestra como bloqueo de política, con su motivo, en un estado visual distinto al de
fallo técnico. Confundirlos haría que un guardrail correcto parezca una app rota
—y al revés, que una app rota parezca un guardrail. Ambas lecturas arruinan la demo.

---

## Loop por nodo

De `skills/verification-loop/SKILL.md`:

```
construir → verificar contra la org → si falla, causa raíz → corregir → reverificar
```

«Contra la org» verifica integración y efectos. La proveniencia de los registros es
mixta y gran parte es semilla sintética; ver `docs/DATOS-Y-PROVENIENCIA.md`.

- **Verde:** verificación pasa **y** evidencia en disco.
- **Rojo:** 3 intentos con el mismo bloqueo → `BLOQUEOS.md` y se sigue con otro nodo.
  Insistir una cuarta vez es desperdicio. **Ya pasó con N3** (Agent API, 404 del
  gateway previo a la ECA) y se aplicó la regla; la ECA ya existe, pero falta probar
  el lifecycle con sus credenciales.
- Prohibido bajar el criterio. Si una prueba estorba, se arregla el código.

---

## Qué corre en paralelo

Ola 2 (`N3`, `N4`, `N5`) y ola 3 (`N6`, `N9`) son los tramos anchos: nodos hermanos
sin dependencia entre sí, sólo con su padre común ya verificado.

`N7` es el cuello: junta a los cuatro clientes y no puede empezar hasta que los cuatro
estén verificados. `/salud` sólo cubre liveness; `/api/admin/salud` es el punto
autenticado donde se ve si una dependencia está disponible.

---

## Ejecución real — lo que pasó, no lo que se planeó

Registrado el 5 de agosto de 2026. El harness se despachó como estaba diseñado y
**no se cumplió completo**. Se anota aquí porque un harness que dice haber revisado
lo que no revisó es peor que no tener harness.

### Lo que corrió

| Nodo | Autor | Resultado |
|---|---|---|
| N4 datos | agente | Completó y verificó. Reportó el hallazgo de §7 de `BLOQUEOS.md` por su cuenta |
| N3 agente | agente | Completó y verificó. Diagnóstico del 404 discriminado en tres condiciones |
| N6 escalamiento | agente | Completó y dejó evidencia |
| N5 flows | agente | **Escribió el módulo y murió antes de reportar.** El fichero quedó completo y con evidencia en disco |

### Lo que NO corrió

**Los cinco revisores fallaron**, todos con el mismo error: límite de gasto mensual
de la cuenta. Es decir, la regla 2 del harness —nadie aprueba su propio trabajo— **no
se cumplió por la vía prevista**.

```
[revisar:N4-datos]        falló: monthly spend limit
[revisar:N5-flows]        falló: monthly spend limit
[revisar:N3-agente]       falló: monthly spend limit
[revisar:N6-escalamiento] falló: monthly spend limit
[construir:N5-flows]      falló: monthly spend limit (tras escribir el fichero)
```

### Qué se hizo en su lugar

La revisión se ejecutó **en la sesión principal**, por un actor distinto del que
escribió cada módulo (los módulos los escribieron los subagentes; la revisión la hizo
el hilo principal). No es equivalente a cuatro revisores independientes, y no se
presenta como tal.

Lo que la revisión inline sí comprobó, con su resultado:

| Comprobación | Resultado |
|---|---|
| `catch` vacíos o que se tragan el error | ninguno |
| `return []` / `null` en camino de fallo | ninguno; el único `return undefined` está documentado y sus llamantes reportan el texto crudo |
| Token en logs, respuestas o disco | ninguno |
| Interpolaciones SOQL sin `lit()` | ninguna; 34 usos de `lit()` entre los tres módulos |
| `npx tsc --noEmit` | limpio |
| Las 16 rutas contra la org | 16 de 16 |
| Auditoría de diseño en 9 páginas | 0 violaciones |

### Defectos que la revisión inline encontró y corrigió

1. **`escalamiento.html` no habría mostrado un solo mensaje en vivo.** La página
   escuchaba un evento SSE `comentarios` (plural, con arreglo) y el servidor emite
   `comentario` (singular, uno por evento). Además leía nombres de campo de Salesforce
   (`CaseNumber`, `CommentBody`) donde el módulo devuelve camelCase (`caseNumber`,
   `cuerpo`). El canal habría quedado mudo **sin lanzar ningún error** — exactamente el
   fallo silencioso que `silent-failure-hunter` debía cazar.
2. **El generador de diagramas perdía aristas reales.** No resolvía los
   `recordUpdates` que actualizan por variable sObject (`<inputReference>`), así que
   el diagrama no mostraba que los dos Flows de agenda escriben `Slot_Taller__c`.
3. **Dos páginas violaban la regla 3** por llevar `font-mono` sobre un `<h3>`, que
   anula Cinzel. 58 violaciones entre las dos.
4. **`verificar-datos.ts` exigía conteos exactos en objetos de operación**, así que se
   ponía en rojo en cuanto la app funcionaba y escribía un registro.

### Lección para la próxima vez

Los cuatro defectos estaban en las **costuras** —entre el módulo de un agente y la
página que lo consume, entre el parser y la metadata real—, no dentro de los módulos.
Un harness que asigna un agente por nodo y revisa nodo por nodo **no mira las
costuras**. La verificación que los encontró fue ejecutar el sistema completo contra
la org: `verificar-rutas.mjs`, la prueba e2e de escalamiento y el auditor de diseño.

Vale más un nodo de integración que verifique el conjunto que un revisor más por
módulo.

---

## Continuación del 6 de agosto de 2026 — cerrar lo que quedó a medias

Codex tomó el relevo tras el corte de créditos y avanzó mucho (OIDC, CSP estricta,
Docker, RBAC, Playwright, `/api/admin/salud`). Se quedó a mitad de su última fase por
límite de uso. Esta sesión no reemplazó su trabajo: lo terminó de cablear.

**Los defectos estaban otra vez en las costuras, no dentro de los módulos.** Ninguno lo
habría encontrado un revisor por módulo; todos aparecieron al ejecutar el sistema
completo contra la org.

| Defecto | Síntoma | Causa |
|---|---|---|
| Verificadores muertos al arrancar | `verificar:datos`, `:rutas` y los de escalamiento reventaban al importar la configuración | La seguridad fail-closed exige `APP_AUTH_PROVIDER` explícito y sólo `verificar:agent-api` lo fijaba |
| `/salud` reportado como roto | La prueba exigía `dependencias.length === 4` | El contrato cambió a propósito: `/salud` es liveness público y la readiness se movió a `/api/admin/salud` tras rol admin |
| Escalamiento e2e rechazado | `UNTRUSTED_CONTEXT_FIELD` | El servidor ahora deriva la correlación; el script seguía inventándola. Se cambió a `operationNonce` |
| `InvalidApiVersionError` | El CLI abortaba la verificación en Salesforce | La app usa `v67.0` para rutas REST y el CLI exige `67.0`; lo heredaba del entorno |
| 3.5 MB muertos | `mermaid.min.js` se construía y no lo referenciaba nadie | Se intentó cablearlo y **violó la CSP estricta** (estilos inline). Se retiró del build: la topología en DOM cubre lo mismo sin relajar la política |
| Suite que fallaba una prueba distinta cada vez | 429 `RATE_LIMITED` en pruebas tardías | `security.spec.ts` provoca 401/403 a propósito y agotaba el limitador de autenticación (tope 24 en QA) |
| La prueba del propio rate limit | No alcanzaba el 429 | Su umbral por defecto (24) y el del servidor (200) quedaron desincronizados; ahora se publica un único valor |
| Opt-in mutante a la deriva | Esperaba 1 comentario de apertura | Nunca había corrido: está detrás de `RUN_MUTATING_SF_TESTS`. La implementación siembra resumen + cabecera (2) |

**La lección se repite y ahora con más fuerza:** una prueba que está apagada por
defecto se pudre en silencio. El opt-in mutante llevaba versiones desalineado con su
implementación y nadie lo supo porque el marcador decía "verde con skips".
Un skip no es evidencia; conviene ejecutarlos autorizados de forma periódica, no sólo
antes de entregar.
