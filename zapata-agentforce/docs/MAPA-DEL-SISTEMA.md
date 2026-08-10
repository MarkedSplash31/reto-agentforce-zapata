# Mapa del sistema — qué hay, dónde está y cómo fluye

Estado al 2 de agosto de 2026. Org `orgfarm-1c6625ec2e-dev-ed`.

---

## 1. Los objetos, agrupados por para qué sirven

### Catálogo — casi no cambia, se carga una vez

| Objeto | Campos | Registros | Qué guarda |
| --- | --- | --- | --- |
| `Sucursal__c` | 13 | **9** | Los 9 talleres reales de Zapata |
| `Modelo_Sucursal__c` | 6 | **180** | Qué modelo y qué sistema atiende cada taller |
| `Product2` | 5 | 22 | Los modelos de unidad |
| `Regla_Cobertura__c` | 8 | 0 | Meses y km de garantía por modelo y sistema |
| `Sintoma__c` | 8 | 0 | Los 8-10 síntomas del árbol de diagnóstico |
| `Knowledge__kav` | 8 | **20** | Los artículos oficiales |

### Operación — lo que el agente lee y escribe en una conversación

| Objeto | Campos | Registros | Qué guarda |
| --- | --- | --- | --- |
| `Asset` | 17 | **15** | La unidad. `SerialNumber` = VIN |
| `Account` / `Contact` | 12 / 2 | 18 / 25 | La flota y su gente |
| `Slot_Taller__c` | 8 | **729** | Franjas de agenda con capacidad |
| `WorkOrder` | 15 | 0 | La cita concreta |
| `Lectura_Odometro__c` | 6 | 0 | Historial de kilometraje |
| `Sesion_Diagnostico__c` | 11 | 0 | Cómo terminó un diagnóstico guiado |
| `Unidad_Varada__c` | 21 | 0 | Reporte de unidad detenida en carretera |
| `Case` | 8 | 26 | Escalamientos |

### Traza — la evidencia

| Objeto | Campos | Registros |
| --- | --- | --- |
| `Log_Agente__c` | 19 | 0 |
| `Brecha_Conocimiento__c` | 5 | 0 |

### Duplicados pendientes de retirar

| Objeto | Campos | Sustituido por |
| --- | --- | --- |
| `Cita_Servicio__c` | 9 | `WorkOrder` + `Slot_Taller__c` |
| `Log_Agente_IA__c` | 6 | `Log_Agente__c` |

**Los ceros no son un problema.** Son objetos de operación: se llenan cuando el
agente ejecute. Lo que sí debe estar cargado antes de la demo son las reglas de
cobertura y los síntomas.

---

## 2. Cómo fluye la información en una conversación real

**Escenario: "Mi Cascadia hace un ruido raro y pierde potencia en subida"**

1. **Agent Router** clasifica la intención → diagnóstico.
2. **Diagnóstico** busca en `Sintoma__c` el síntoma que coincide. Lee
   `Nivel_Riesgo__c` y `Autoservicio_Permitido__c`.
   - Si es crítico → no guía, escala. Crea `Case`.
   - Si se permite → usa `Preguntas_Descarte__c` y consulta `Knowledge__kav`
     filtrando por `Modelo_Codigo__c` y `Sistema_Unidad__c`.
3. Se cierra `Sesion_Diagnostico__c` con `Resultado__c`. Si fue
   `RESUELTO_SIN_CITA`, la validación exige que documente los pasos y el artículo.
4. Si requiere taller → **Garantía** pide el VIN, busca en `Asset` por
   `SerialNumber`, valida contra `Account` con el segundo factor, marca
   `Unidad_Verificada__c`.
5. Lee `Cobertura_Citable__c`. Si dice `REQUIERE_DATO`, pide el odómetro y crea
   una `Lectura_Odometro__c`, que estampa el valor en `Asset`.
6. Con dato vigente, compara `Meses_Desde_Instalacion__c` y el odómetro contra
   `Regla_Cobertura__c` del modelo y sistema. Escribe `Estado_Cobertura__c`.
7. **Agenda** llama a `Consultar_Disponibilidad`, que valida en
   `Modelo_Sucursal__c` que ese taller atienda ese modelo, respeta la
   anticipación mínima de `Sucursal__c`, y ofrece `Slot_Taller__c` disponibles.
8. Crea el `WorkOrder` con `Idempotency_Key__c`, sube `Capacidad_Usada__c` del
   slot y devuelve el folio.
9. **Cada paso** escribe un `Log_Agente__c` con el mismo `Correlation_Id__c`.

La regla que amarra todo: **el `Correlation_Id__c` es el hilo de la conversación**.
Aparece en la sesión de diagnóstico, la lectura de odómetro, la orden, el caso, el
reporte de varada y cada log. Filtrando por él sale la historia completa.

---

## 3. Dónde ver cada cosa

**App `Zapata Postventa`** (Iniciador de aplicación → buscar "Zapata"):

| Pestaña | Qué muestra |
| --- | --- |
| Inicio | Panorama + traza completa |
| Garantía y cobertura | Unidades, reglas, lecturas |
| Diagnóstico y manuales | Modelos, síntomas, artículos, sesiones, brechas |
| Agenda de taller | **Calendario visual** + sucursales, slots, órdenes |
| Compensación y escalamiento | Casos y logs |

**Reportes** (carpeta *Reportes Zapata Postventa*): trazabilidad por conversación,
acciones bloqueadas por guardrail, diagnósticos por resultado, ocupación de taller.

**La estructura**: Configuración → Gestor de objetos.

---

## 4. La batalla, campo por campo

### Las fórmulas de Diego, explicadas

#### `Garantia_Vigente__c` (casilla en Asset)

```
AND(
  NOT(ISBLANK(InstallDate)),
  InstallDate > (TODAY() - 730),
  NOT(ISBLANK(Odometro__c)),
  Odometro__c < 250000
)
```

Se lee: *marca verdadero si hay fecha de instalación, Y esa fecha es de hace menos
de 730 días, Y hay odómetro registrado, Y el odómetro es menor a 250,000 km.*

730 días son los 24 meses. La idea es correcta y es rápida. Tiene tres problemas:

1. **Confunde "no sé" con "no tienes".** Si `Odometro__c` está vacío devuelve
   **falso**, o sea *"esta unidad no tiene garantía"*. La verdad es *"no sabemos"*.
   Decirle a un cliente que perdió su garantía cuando en realidad falta el dato es
   el error caro. Por eso el plan define `REQUIERE_DATO` como tercer estado.
2. **Una sola regla para todo.** 24 meses y 250,000 km para cualquier modelo y
   cualquier sistema. En la realidad el tren motriz y los frenos no se cubren
   igual. Y al estar en la fórmula, cambiar la póliza obliga a volver a desplegar.
3. **No mira qué tan viejo es el odómetro.** Una lectura de hace dos años pesa
   igual que una de ayer. Es justo lo que el briefing llama *"omnisciencia
   fingida"*.

#### `Proximo_Servicio_Km__c` (número en Asset)

```
IF(ISBLANK(Km_Ultimo_Servicio__c), 10000, Km_Ultimo_Servicio__c + 10000)
```

Se lee: *si no hay km del último servicio, el próximo es a los 10,000; si hay, es
ese más 10,000.*

Buena idea, y **no la teníamos**. Un detalle a corregir: si una unidad tiene
300,000 km pero nunca se le registró un servicio, la fórmula dice *"próximo
servicio a los 10,000"*, que ya pasó hace mucho. Debería partir del odómetro
actual cuando no hay historial de servicio.

### Resolución de los cuatro cruces

| Cruce | Se queda | Por qué |
| --- | --- | --- |
| **Logs** | `Log_Agente__c` | El de Diego guarda VIN completo y el plan lo prohíbe. Además no tiene Correlation Id, ni versión de política, ni guardrail |
| **Citas** | `WorkOrder` + `Slot_Taller__c` | Su `Taller__c` es picklist: no sabe capacidad, horario ni cobertura por modelo |
| **Garantía** | `Regla_Cobertura__c` | Umbrales editables por modelo y sistema en vez de quemados. Su necesidad de algo que no mienta la cubre `Cobertura_Citable__c` |
| **Odómetro** | **Ambos** | `Km_Ultimo_Servicio__c` y `Proximo_Servicio_Km__c` son suyos y se quedan. Su `Odometro__c` suelto lo sustituye el historial |

---

## 5. Dos cosas de los datos de prueba

**Las 15 unidades apuntan todas al mismo producto: "Tractocamión Clase 8 - Serie
T680".** El T680 es un modelo **Kenworth**, y Zapata es distribuidor
**Freightliner**. Frente a un jurado que conoce el sector, eso se nota. Los
modelos reales del catálogo de Zapata son Cascadia, M2, 114SD y FL 360, y ya están
cargados como `Product2`.

**Los VIN mezclan prefijos de varias marcas**: `3HAMMAAR` es Mack, `1XKAD49X` es
Kenworth, `4V4NC9EH` es Volvo, `1FUJGLDR` y `3AKJHHDR` sí son Freightliner. Son
VIN de aspecto realista pero de marcas que Zapata no distribuye.

Ninguna de las dos cosas rompe nada técnicamente. Es coherencia de cara a la demo.
