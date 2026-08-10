# Bitácora — Reto Agentforce Zapata

Sesión del 30 de julio al 2 de agosto de 2026.
Equipo: Gabriel Valadez + Diego Gonzalez. Entrega: 17 de agosto. Demo freeze: 13 de agosto.

---

## 1. La org

| | |
| --- | --- |
| Usuario | `gabrielvaladezgomez47.a717257e2c6d@agentforce.com` |
| Org Id | `00DgK00000VXSyCUAX` |
| Instancia | `orgfarm-1c6625ec2e-dev-ed` |
| Alias sf CLI | `zapata` |
| Proyecto local | `C:\Users\Admin\Desktop\zapata-agentforce` |

**Es la única org que se debe usar.** Hubo otras dos (`gabriel0@developer.com` y
`gabrielvg@developer.com`) contaminadas con ejercicios de Trailhead. La segunda se
autorizó por accidente al inicio porque el navegador tenía esa sesión abierta.

Diego trabaja en **esta misma org**, no en una aparte.

## 2. Cómo se conectó

El CLI se autentica por OAuth en navegador, no por contraseña en línea de comandos:

```bash
sf org login web --alias zapata --set-default
```

Si el navegador entra automático con otra cuenta, hay que usar *Iniciar sesión con
otro usuario*.

## 3. Qué se construyó

### Modelo de datos

| Objeto | Registros | Para qué |
| --- | --- | --- |
| `Sucursal__c` | 9 | Los talleres reales de Zapata |
| `Modelo_Sucursal__c` | 180 | Qué modelo y sistema atiende cada taller |
| `Slot_Taller__c` | 729 | Agenda con capacidad, sin Field Service |
| `Regla_Cobertura__c` | 36 | Límites de garantía por modelo y sistema |
| `Exclusion_Garantia__c` | 9 | Partes que nunca entran en garantía |
| `Invalidacion_Garantia__c` | 0 | Las 7 causas que cancelan cobertura |
| `Sintoma__c` | 10 | Árbol de diagnóstico guiado |
| `Sesion_Diagnostico__c` | 0 | Evidencia del caso resuelto sin cita |
| `Unidad_Varada__c` | 0 | Reporte de unidad detenida en carretera |
| `Lectura_Odometro__c` | 0 | Historial de kilometraje |
| `Log_Agente__c` | 8 | Trazabilidad punta a punta |
| `Brecha_Conocimiento__c` | 0 | P1, backlog editorial |
| `Parametros_Garantia__c` | setting | Umbrales editables sin desplegar |

Más 177 campos custom, 15 page layouts, 14 reglas de validación, 9 compact layouts,
9 vistas de lista, 5 páginas de app, 4 tipos de informe, 4 reportes, 1 cola,
1 permission set (155 FLS).

### Código

- `ZapataAgendaController` — calendario visual + acción `Consultar_Disponibilidad`
  como método invocable. Consulta en modo usuario. 9 pruebas Apex.
- `zapataCalendarioTaller` — componente Lightning, rejilla semanal.
- `Registrar_Log_Agente` — subflow de trazabilidad, activo y probado.
- App Lightning **Zapata Postventa**: 5 páginas por intención del agente.

## 4. Datos reales de Zapata

Investigados en `zapata.com.mx`. **El formulario de citas se inspeccionó sin enviarlo.**

Las 9 agencias Freightliner con su **ID real** del selector de su formulario:

| Id | Código | Sucursal | Ciudad |
| --- | --- | --- | --- |
| 96 | FL-TLA | Tlalnepantla | Edo. Méx. |
| 97 | FL-LEO | León | Gto. |
| 98 | FL-QRO | Querétaro | Qro. |
| 99 | FL-CEL | Celaya | Gto. |
| 100 | FL-TAM | Tampico | Altamira, Tamps. |
| 101 | FL-AER | Aeropuerto | Texcoco |
| 102 | FL-GDL | Guadalajara | Zapopan |
| 103 | FL-GDLRM | Guadalajara R. Michel | Jal. |
| 104 | FL-MTY | Monterrey | Apodaca, N.L. |

Reglas de negocio de su sitio: **24 horas mínimo de anticipación**, domingo cerrado,
L-V 9:00–19:00, sábado 9:00–15:00.

Su formulario pide marca, modelo, agencia, **placa**, número de serie, nombre,
teléfono y correo. Y **ya manda `utm_source`, `utm_medium` y `utm_campaign` ocultos**:
Zapata ya sella el origen publicitario en cada cita de servicio.

Modelos reales: Cascadia, M2, 114SD, FL 360.

## 5. Los cuatro duplicados

Diego y Gabriel construyeron en paralelo sin verse. Salieron cuatro cruces:

| Cruce | Propuesta | Razón |
| --- | --- | --- |
| Logs | `Log_Agente__c` | El otro guarda VIN completo y el plan lo prohíbe (sección 10) |
| Citas | `WorkOrder` + `Slot_Taller__c` | `Taller__c` es picklist, no sabe capacidad ni horario |
| Garantía | `Regla_Cobertura__c` | Umbrales editables por modelo y sistema |
| Odómetro | **Ambos** | `Km_Ultimo_Servicio__c` y `Proximo_Servicio_Km__c` son de Diego y se quedan |

**La lectura de fondo:** cada quien resolvía una pregunta distinta. Diego construyó
para *"¿esta unidad todavía tiene garantía?"* — propiedad de la unidad, instantánea,
sirve para reportes y agente proactivo. Gabriel construyó para *"¿le puedo decir a
este cliente que SU falla entra en garantía?"* — necesita saber qué sistema falló.
Las dos son necesarias.

**Punto medio propuesto:** `Estado_Garantia_Basica__c` (fórmula, 8 estados,
consultable) para el tamizaje, y `Cobertura_Citable__c` para el veredicto por sistema.

### Sin resolver

- Dos odómetros en la misma unidad con **144,000 km de diferencia** (Unidad 101).
- Los veredictos discrepan en **14 de 15 unidades**.
- `Cita_Servicio__c` y `Log_Agente_IA__c` siguen en la org. No se borraron: es
  trabajo de Diego y se decide con él.

## 6. Contradicción encontrada en el contenido

El artículo *"Cobertura de garantía básica por componente"* dice que cabina y chasis
tienen **36 meses sin límite de kilometraje**. La fórmula `Garantia_Vigente__c`
aplica 24 meses / 250,000 km a todo.

Un cliente con 300,000 km y falla de cabina a los 30 meses: el artículo dice
cubierto, la fórmula dice que no. El agente citaría el artículo y daría el veredicto
contrario.

No es un error de criterio: la fórmula implementa bien la primera línea del artículo.
Una fórmula no puede representar cinco coberturas que dependen del sistema reportado,
porque el sistema es un dato de la conversación.

## 7. Trampas técnicas aprendidas

Esto es lo que más tiempo costó. Vale releerlo antes de construir los Flows.

1. **Una variable booleana vacía asignada a un campo checkbox truena un Flow** con el
   error genérico que no dice nada. Costó siete intentos aislarlo. Se arregla dando
   `false` como valor por defecto a la variable.
2. **Un campo nuevo sin FLS es invisible aunque esté desplegado.** Mordió tres veces.
   Si algo "no existe" pero sí aparece en Setup, regenerar el permission set antes de
   buscar otra causa.
3. **Cada despliegue de un Flow crea una versión nueva.** No se puede borrar el flujo
   hasta borrar todas las versiones y todas las `FlowInterview` que dejó al correr.
4. **Los `describe` del CLI se cachean.** Un campo recién desplegado puede no aparecer.
   `FieldDefinition` por Tooling API ignora tanto la caché como el FLS.
5. **Product2 no admite `deleteConstraint` Restrict ni Cascade** en lookups entrantes.
6. **Un campo fórmula de texto rechaza `precision`.** Solo los numéricos la aceptan.
7. **`formulaTreatBlanksAs` en `BlankAsZero` rompe `ISBLANK`** sobre campos numéricos.
8. **El report type de un objeto custom es `CustomEntity$Objeto__c`**, no el nombre
   del objeto. Y la carpeta debe desplegarse antes que los reportes.
9. **Git Bash convierte rutas** en argumentos: `/lightning/n/X` se vuelve
   `C:/Program Files/Git/lightning/n/X`. Usar `MSYS_NO_PATHCONV=1`.
10. **Un generador que regenera todo sobreescribe parches posteriores.** Pasó cuatro
    veces. Los cambios van en el generador base, no en un parche encima.

## 8. Estado de funciones de la org

| Función | Estado |
| --- | --- |
| Knowledge (español, Lightning) | ✅ activado |
| Work Orders | ✅ disponible |
| Field Service | ⚠️ activado pero **no se usa** — la agenda es `Slot_Taller__c` |
| Data Cloud | ✅ aprovisionado el 2 de agosto |
| Omni-Channel | ✅ ya habilitado |
| MIAW | ✅ disponible, 6 licencias |
| Experience Cloud | ❌ no habilitado (el objeto `Network` no existe) |
| Agentforce | ✅ licencias activas |

## 9. El agente

`Agente Postventa Zapata`, **Versión 1 en borrador**. Los borradores no se publican
como metadata, por eso el CLI no los ve.

Siete subagentes: Agent Router, Conocimiento y Respuestas, Agendar Servicio en Taller,
Atención de Unidades Varadas, Escalamiento a Asesor Humano, Fuera de Alcance,
Pregunta Ambigua.

**Solo dos tienen acción conectada.** *Agendar Servicio en Taller* y *Atención de
Unidades Varadas* dicen "Seleccionar acción" — vacío. El agente conversa bien y no
ejecuta. Ahí viven el 40% de integración multimodal y el 25% de resolución autónoma.

## 10. Lo que sigue

1. **Los Flows** — `Crear_Orden_Servicio`, `Reprogramar_Orden_Servicio`,
   `Crear_Reporte_Unidad_Varada`. Es el 40%.
2. Conectar `Consultar_Disponibilidad` al subagente de agenda (ya está lista).
3. Decidir los cuatro duplicados con Diego.
4. Los 8 artículos del corpus P0 y la suite de 20 pruebas.
5. Video de 3 minutos y ficha técnica.

**Cortes acordados:** 6 de agosto, si no hay Flows se cancela WhatsApp y portal.
9 de agosto, si WhatsApp no manda ni recibe, se cambia a voz en navegador.
11 de agosto, congelamiento.

## 11. Verificación

```bash
python scripts/verificacion/verificar-ambiente.py
sf apex run --file scripts/apex/prueba-humo.apex --target-org zapata
sf apex run --file scripts/apex/prueba-validaciones.apex --target-org zapata
sf apex run --file scripts/apex/prueba-blindaje-cobertura.apex --target-org zapata
```

Las tres pruebas Apex hacen rollback: no dejan registros.

## 12. Lo que falta pedirle a Zapata

Pólizas reales (meses y km por modelo y sistema), capacidad real por taller, qué
modelos atiende cada sucursal de verdad, política de compensación y responsable de
la cola de escalamiento.

Todo lo cargado hoy está marcado `v1.0-sintetica` a propósito.
