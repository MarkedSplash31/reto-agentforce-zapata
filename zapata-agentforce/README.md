# Reto Agentforce 2026 — Corporación Zapata

Proyecto SFDX con el modelo de datos completo del **Plan de Trabajo Final** (29 jul 2026).
Fuente única de verdad: `PLAN-DE-TRABAJO-FINAL.pdf`, secciones 6, 8, 9 y 10.

## Estado

Org destino: `gabrielvaladezgomez47.a717257e2c6d@agentforce.com` — org `00DgK00000VXSyCUAX`, alias `zapata`.

| Fase | Estado |
| --- | --- |
| Metadata del modelo de datos | ✅ desplegada, 80 componentes |
| Permission set | ✅ desplegado y asignado |
| Datos semilla | ✅ cargada y verificada en la org |
| App `Zapata Postventa` + 7 pestañas | ✅ desplegada |
| Knowledge habilitado (es, Lightning) | ✅ + los 3 campos de la sección 6.2 |
| Corpus de 8 artículos (plan 7.1) | ⏳ fase 2 |
| Data Library / retriever (K1 o K2) | ⏳ fase 2 |
| Flows de las 8 acciones P0 | ⏳ fase 3 |
| Agente + 4 subagents | ⏳ fase 4 |

## Puesta en marcha

```bash
# 1. Autenticar la org del hackathon (elige la cuenta @agentforce.com)
sf org login web --alias zapata --set-default

# 2. Desplegar todo el modelo de datos
sf project deploy start --source-dir force-app --target-org zapata

# 3. Asignar el permission set
sf org assign permset --name Zapata_Agente_Servicio --target-org zapata

# 4. Cargar datos semilla sintéticos
sf apex run --file scripts/apex/seed-datos.apex --target-org zapata
```

> **Lee primero [docs/AUDITORIA-MODELO-DATOS.md](docs/AUDITORIA-MODELO-DATOS.md)** — auditoría
> del modelo contra el plan y el briefing, huecos encontrados, pruebas ejecutadas y qué
> datos hay que pedirle a Zapata.

## Estado de funciones de la org

| Función | Estado | Nota |
| --- | --- | --- |
| Knowledge (español, Lightning) | ✅ activado | Vía `KnowledgeSettings`, sección 7 del plan |
| Work Orders | ✅ disponible | Objeto `WorkOrder` estándar |
| **Field Service** | ⚠️ **activado el 30 jul 2026** | Decisión del usuario, opcional — ver abajo |

### Field Service está activado, pero la demo no lo usa

El usuario activó Field Service en Configuración. Eso habilitó `ServiceAppointment`,
`ServiceTerritory`, `ServiceResource`, `OperatingHours`, `TimeSlot` y `WorkType`
(todos vacíos por ahora).

**No rompe nada, pero conviene ser explícito:** el plan (sección 6.3) dice
*"Agenda sin Field Service"* y por eso existe `Slot_Taller__c`. Ahora hay dos caminos
posibles para agendar y **no se deben mezclar**:

- `Slot_Taller__c` — el del plan, ya construido, con datos y probado. **Es el que usa la demo.**
- `ServiceAppointment` + `OperatingHours` — el nativo de Field Service, más potente
  pero mucho más pesado de configurar (territorios, recursos, reglas de asignación).

Si en algún momento se decide migrar a Field Service, es un cambio de alcance real:
hay que rehacer `Consultar_Disponibilidad`, `Crear_Orden_Servicio` y
`Reprogramar_Orden_Servicio`, y rehacer los datos semilla. No es una decisión para
tomar después del Demo Freeze del 13 de agosto.

## App `Zapata Postventa` — una ventana por intención del agente

La navegación **no** está ordenada por objetos, sino por las capacidades del agente
principal. Cada pestaña es una intención, con los datos que esa intención necesita:

| Pestaña | Subagent | Qué contiene |
| --- | --- | --- |
| Inicio | — | Panorama + traza completa (`Log_Agente__c`) |
| Garantía y cobertura | Garantía | Unidades, reglas de cobertura, lecturas de odómetro |
| Diagnóstico y manuales | Diagnóstico | Modelos, artículos de Knowledge, brechas |
| Agenda de taller | Agenda | Sucursales, modelos por sucursal, slots, órdenes |
| Compensación y escalamiento | Compensación | Casos, logs del agente |
| Cuentas · Reportes · Calendario | — | Los tres menús donde aterrizará lo que se extraiga de Zapata |

### Regla de orden de los datos

**Los modelos y sus manuales no dependen de la sucursal.** Un operador que pregunta
por una falla eléctrica, mecánica o de motor solo necesita saber *qué modelo* maneja;
el taller es irrelevante para esa conversación. Por eso `Product2` (modelo) y Knowledge
viven en *Diagnóstico y manuales*, sin ninguna referencia a `Sucursal__c`.

**La sucursal solo aparece cuando el usuario quiere una cita.** Ahí sí importa qué
taller atiende ese modelo y ese sistema, y para eso existe `Modelo_Sucursal__c`. Ese
objeto vive únicamente en *Agenda de taller*.

## Modelo de datos

### Objetos custom (plan 6.3)

| Objeto | Uso | Campos |
| --- | --- | --- |
| `Sucursal__c` | Taller disponible | 5 |
| `Modelo_Sucursal__c` | Qué modelos atiende cada sucursal | 6 |
| `Slot_Taller__c` | Agenda sin Field Service | 8 |
| `Regla_Cobertura__c` | Decisión determinista de garantía | 8 |
| `Lectura_Odometro__c` | Historial de lecturas | 6 |
| `Log_Agente__c` | Trazabilidad punta a punta (plan 10) | 18 |
| `Brecha_Conocimiento__c` | P1, backlog editorial | 5 |

`Modelo_Sucursal__c` no está en el plan original. Se añadió porque la operación real
de Zapata organiza sucursales por modelo, y sin ese cruce el agente puede agendar una
unidad en un taller que no da servicio a ese modelo.

### Campos custom sobre estándar (plan 6.2)

- **Asset** — `Ultimo_Odometro_Verificado__c`, `Fecha_Odometro_Verificado__c`,
  `Dato_Odometro_Vigente__c` (fórmula), `Estado_Cobertura__c`,
  `Fecha_Ultima_Evaluacion__c`, `Unidad_Verificada__c`
- **WorkOrder** — `Sintoma_Reportado__c`, `Sucursal__c`, `Slot_Taller__c`,
  `Idempotency_Key__c` (unique), `Origen_Atencion__c`, `Correlation_Id__c`
- **Case** — `Asset__c`, `WorkOrder__c`, `Politica_Aplicada__c`, `Correlation_Id__c`

## Decisiones de implementación que conviene revisar

1. **Umbral de vigencia de odómetro = 90 días.** El plan dice "el umbral documentado"
   sin fijar el número. Está en dos lugares: la fórmula `Asset.Dato_Odometro_Vigente__c`
   y el campo `Regla_Cobertura__c.Vigencia_Odometro_Dias__c`. Si cambian el umbral,
   hay que cambiar ambos.
2. **`Slot_Taller__c.Disponible__c` no filtra por tiempo.** Una fórmula con `NOW()`
   complica el filtrado en SOQL, así que `Disponible__c` solo evalúa sucursal activa
   y cupo libre. El Flow `Consultar_Disponibilidad` debe añadir `Inicio__c > NOW()`.
3. **`Case.Asset__c` coexiste con el `AssetId` estándar.** El plan pide el lookup
   custom; Salesforce ya trae uno. Se creó el custom para respetar el plan, pero hay
   que decidir cuál usan las acciones y usar solo ese.
4. **`Asset` queda con permiso de solo lectura** en el permission set, tal como dice
   el plan sección 9. Pero `Registrar_Lectura_Odometro` y `Evaluar_Cobertura_Garantia`
   hacen UPDATE sobre Asset. Funciona si esos Flows corren en modo sistema; si se
   ejecutan en el contexto del usuario, hay que añadir Edit sobre Asset.
5. **Los lookups a Product2 usan `SetNull`.** Salesforce no permite Restrict ni Cascade
   en lookups hacia Product2.
6. **Datos semilla 100% sintéticos.** Los modelos (`ZP-500`, `ZP-350`, `ZP-220`,
   `ZP-120`) y las sucursales no son el catálogo real de Zapata. El plan sección 7.1
   prohíbe presentar como reales datos no confirmados.

## Casos de prueba que la semilla deja listos

| Unidad (VIN) | Escenario esperado |
| --- | --- |
| `3ZPAAA500KX000101` | `CUBIERTO` — 18 meses, 310k km, lectura de hace 12 días |
| `3ZPAAA500KX000102` | `NO_CUBIERTO` — 915k km excede el límite de 800k |
| `3ZPAAA350KX000201` | `NO_CUBIERTO` — 62 meses excede el límite de 48 |
| `3ZPAAA220KX000301` | `REQUIERE_DATO` — sin ninguna lectura de odómetro |
| `3ZPAAA120KX000302` | `REQUIERE_DATO` — lectura de hace 140 días, caducada |

Además: la sucursal Celaya está **inactiva** y Aguascalientes **no repara tren motriz
ni frenos**, para poder demostrar las rutas negativas.

Verificado en la org tras la carga: 4 modelos, 5 sucursales, 56 cruces modelo×sucursal,
12 reglas, 3 cuentas, 5 unidades, 4 lecturas y 120 slots. Los 4 talleres activos
muestran 23 slots disponibles cada uno; Celaya no aparece por estar inactiva.

## Lo que falta (no está en este repo todavía)

- **Knowledge**: ya está habilitado (español, Lightning) con los campos
  `Categoria_Agente__c`, `Sistema_Unidad__c` y `Version_Politica__c`. Falta redactar
  y publicar los 8 artículos del corpus P0 (plan 7.1) y decidir ruta K1
  (Data Library) o K2 (Flow sobre `Knowledge__kav`).
- **Flows**: las 8 acciones P0 del catálogo (plan 8.2) más el subflow
  `Registrar_Log_Agente`.
- **Agente**: 1 Employee Agent + 4 subagents (Garantía, Diagnóstico, Agenda,
  Compensación).
- **Suite de 20 pruebas** (plan 12).
