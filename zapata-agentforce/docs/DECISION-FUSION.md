# Decisión de fusión: qué se queda de cada quien

Fecha: 2 de agosto de 2026

Este documento no elige por autoría. Elige por **lo que el agente que ya existe
necesita para funcionar**, que es un criterio más honesto que "lo dice el plan".

---

## Corrección importante

En el corte anterior reporté que el agente no existía porque no aparecía en
ninguno de los seis tipos de metadata de Agentforce. **Estaba equivocado.**

`Agente Postventa Zapata` existe con sus 7 subagentes, pero está en
**Versión 1 (Borrador)**. Los borradores no se publican como metadata, por eso el
CLI no los ve. El diagnóstico correcto es: el agente existe y está bien diseñado.

## Lo que sí es un problema real

De los 7 subagentes, **solo 2 tienen una acción conectada**:

| Subagente | Acción conectada | Puede actuar |
| --- | --- | --- |
| Agent Router | `go_to_*` (transiciones) | — enruta |
| Conocimiento y Respuestas | `Buscar en base de conocimiento` | ✅ |
| **Agendar Servicio en Taller** | *Seleccionar acción* (vacío) | ❌ |
| **Atención de Unidades Varadas** | *Seleccionar acción* (vacío) | ❌ |
| Escalamiento a Asesor Humano | `escalate_to_human` | ✅ |
| Fuera de Alcance | — | correcto que no tenga |
| Pregunta Ambigua | — | correcto que no tenga |

Las instrucciones de "Agendar Servicio en Taller" dicen *"Después de crear la
cita, informa el número de folio al cliente"*. **No hay nada que cree la cita.**
El agente hoy conversa muy bien y no ejecuta.

Ahí viven el 40% de integración multimodal y el 25% de resolución autónoma.

---

## El hueco que descubrió el agente

El subagente **Atención de Unidades Varadas** recaba: VIN, carretera, kilómetro,
sentido, descripción de falla, códigos de tablero, y si la unidad va cargada.
Antes de eso confirma que el operador esté fuera del carril con intermitentes.

Se verificó en la org: **cero campos** con carretera, kilómetro, sentido, código
de falla o varada. Ese subagente recababa información valiosa y la tiraba.

Y no es un dominio menor: el briefing abre el video con *"una unidad detenida es
pérdida diaria directa y cuantificable"*. Es el dolor más caro del cliente y era
el único sin modelo de datos.

**Se creó `Unidad_Varada__c`** con 20 campos que siguen el orden exacto en que el
agente pregunta, más `Horas_Detenida__c` (fórmula) que traduce el problema a la
métrica de negocio que abre el video.

Incluye una regla de validación que encoda la seguridad: **no se puede avanzar el
reporte sin confirmar que el operador está fuera del carril y con intermitentes.**
La seguridad va antes que el dato, igual que en las instrucciones del subagente.

---

## Los cuatro duplicados

### 1. Logs → se queda `Log_Agente__c`

| | Diego | Gabriel |
| --- | --- | --- |
| Campos | 6 | 18 |
| Correlation Id | ❌ | ✅ |
| Qué subagente atendió | ❌ | ✅ |
| Versión de política aplicada | ❌ | ✅ |
| Odómetro usado y su fuente | ❌ | ✅ |
| Guardrail que bloqueó | ❌ | ✅ |
| Artículo citado | ❌ | ✅ |
| Enlaces a Asset / WorkOrder / Case | ❌ | ✅ |
| **Guarda VIN completo** | ⚠️ **Sí** | No |

El plan sección 10 dice literal: *"No se guarda VIN completo, AccountNumber ni
segundo factor en el log"*. El de Diego lo guarda. Sus 6 campos mapean limpio:
`Tipo_Accion__c`→`Action_Name__c`, `Resultado__c`→`Outcome__c`,
`Registro_Afectado__c`→`Related_Record_Id__c`, `Fecha_Hora__c`→`Timestamp__c`.
El VIN se sustituye por el lookup a `Asset__c`.

### 2. Citas → se queda `WorkOrder` + `Slot_Taller__c` + `Sucursal__c`

Su `Cita_Servicio__c` tiene `Taller__c` como **picklist**. Un picklist no puede
decir si hay cupo el jueves, ni qué modelos atiende ese taller, ni respetar las
24 horas de anticipación que Zapata exige en su propio sitio.

Contra eso: 9 sucursales reales con Id de agencia verdadero (96–104), 729 franjas
con capacidad, y la validación de que el taller atienda ese modelo y ese sistema.

Se rescata su idea de `Creada_por_Agente_IA__c` — ya la cubre
`Origen_Atencion__c = Agentforce`.

### 3. Garantía → se queda `Regla_Cobertura__c`, pero él tiene razón en algo

Su fórmula `Garantia_Vigente__c` lleva **24 meses y 250,000 km quemados en el
código**. El briefing dice que esos umbrales *"deben sustituirse con las pólizas
reales de Zapata"*. Con el objeto de reglas eso es editar un registro; con la
fórmula es volver a desplegar.

Pero su instinto es correcto y coincide con el Resumen Ejecutivo: hace falta algo
que no pueda quedar desactualizado. Por eso existe `Cobertura_Citable__c`, que es
fórmula y degrada sola a `REQUIERE_DATO` cuando el dato ya no es confiable.

### 4. Odómetro → **aquí gana Diego, en parte**

`Km_Ultimo_Servicio__c` y `Proximo_Servicio_Km__c` **no existían en mi modelo** y
son genuinamente útiles: son lo que permite decir *"te faltan 12,000 km para el
próximo servicio"*, y habilitan el agente proactivo que él propone.

**Se quedan.** Lo que sí se sustituye es su `Odometro__c` suelto, porque
`Ultimo_Odometro_Verificado__c` más el historial en `Lectura_Odometro__c` dan lo
mismo y además permiten auditar de dónde salió cada lectura.

---

## Lo que NO se borró todavía

`Cita_Servicio__c` y `Log_Agente_IA__c` **siguen en la org**. No los eliminé
porque son trabajo de otra persona y borrarlos sin él delante no es una decisión
de una sola parte del equipo.

Cuando acuerden, es un solo comando:

```bash
sf project delete source --metadata "CustomObject:Cita_Servicio__c" --metadata "CustomObject:Log_Agente_IA__c" --target-org zapata
```

---

## `ZapataAgendaController`: se queda y se extendió

**Decisión: no quitarlo. Extenderlo.**

Antes solo alimentaba el calendario visual. Ahora también expone la acción
`Consultar_Disponibilidad` del plan sección 8.2, como método invocable que el
Flow o el agente pueden llamar.

**Por qué juntos y no en dos lugares:** si el Flow reimplementara la regla de qué
es una franja disponible, tarde o temprano el calendario y el agente dirían cosas
distintas sobre el mismo horario. Es exactamente el problema de duplicación que
este documento está resolviendo — habría sido incoherente crearlo de nuevo.

La acción aplica tres compuertas antes de ofrecer una cita:

1. La sucursal existe y está activa → `SUCURSAL_NO_ENCONTRADA` / `SUCURSAL_INACTIVA`
2. El taller atiende ese modelo y ese sistema → `MODELO_NO_ATENDIDO`
3. La franja respeta la anticipación mínima de la sucursal → `SIN_CUPO`

Los motivos de bloqueo son códigos estables, listos para `Log_Agente__c.Error_Code__c`.

**Dos detalles de diseño que importan:**

- El texto visible **nunca** lleva Ids internos. Los `slotIds` van en una variable
  aparte marcada como uso interno del Flow. Lo exige el plan 8.3.
- Las fechas se arman en español a mano. `format()` usa el idioma del usuario que
  ejecuta, y el agente puede correr con un usuario en inglés — salía *"Monday 3 de
  August"*. Ese texto lo lee el cliente.

Probado contra los datos reales: pide cita en Querétaro para un Cascadia y
devuelve *"lunes 3 de agosto de 13:00 a 15:00 — Garantía (3 lugares)"*. Pide un
modelo que el taller no atiende y responde `MODELO_NO_ATENDIDO`.

**9 pruebas Apex, todas pasan.**

### Cómo conectarlo al agente

En Agent Builder, subagente **Agendar Servicio en Taller** → *Acciones
disponibles para razonamiento* → agregar acción → **Consultar disponibilidad de
taller** (categoría *Zapata Postventa*). Eso llena el hueco de "Seleccionar
acción" que hoy está vacío.
