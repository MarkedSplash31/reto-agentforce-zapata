# Guion de rodaje — lo que se comprobó y lo que hay que cambiar

Ensayo del `GUION-VIDEO-FINAL` contra la organización real, escena por escena, el
**12 de agosto de 2026**. No es una lectura del guion: es una corrida que teclea sus
frases literales en un navegador, con el VIN del guion, y después relee Salesforce por
el CLI —nunca por la aplicación— para comprobar que lo que se vio en pantalla existe.

Se repite con:

```bash
npm run verificar:guion
```

Escribe en la organización, igual que hará la cámara: la escena 2 crea una orden y la 3
un caso. Deja capturas y el detalle en `evidencia/19-guion/<marca>/`.

## Estado por escena

| Escena | Minutaje | Veredicto | Nota |
|---|---|---|---|
| Apertura | 0:00–0:15 | grabable | sin dependencias |
| La plataforma | 0:15–0:32 | grabable | los nueve talleres cargan de la org |
| Conocimiento | 0:32–1:05 | grabable, con varianza | 13 de 15 tomas nombran el turbocargador |
| Agendar | 1:05–2:05 | grabable **con la línea corregida** | ver corrección 2 |
| Escalamiento | 2:05–2:40 | grabable | caso, origen, cola y transcripción verificados |
| Variante B (panel) | 2:05–2:40 | **grabable ahora** | el contraste y la cola están arreglados |
| Traza | 2:40–2:52 | grabable **con la narración corregida** | ver corrección 3 |
| Cierre | 2:52–3:00 | grabable | sin dependencias |

Órdenes y casos que dejó el ensayo, releídos de Salesforce: `00000079` (sábado 15 de
agosto, 09:00, taller FL-QRO, creada por `EinsteinServiceAgent User`), `00000080`, y los
casos `00001142`, `00001143` y `00001144`, todos con origen `Agentforce` y dueño
`Escalamiento Postventa`.

## Las cuatro correcciones al PDF

### 1 · El alias de la organización no es `hackaton2`

El guion manda comprobar la API con `sf org display --target-org hackaton2`. En esta
máquina ese alias no existe y el comando falla con `NamedOrgNotFoundError` — que se lee
como «la organización está caída» cuando lo único que pasa es que el alias es otro.

```bash
sf org display --target-org zapata
```

Si `Connected Status` dice `Connected`, adelante. `sf org list` los enseña todos.

### 2 · Con «1» a secas la cita no se cierra

El guion dice: *«Escribe el número de la opción que ofrezca (la primera)»*. Junto con
las opciones, el agente pide en el mismo turno el tipo de servicio y el motivo de la
visita. Un «1» solo devuelve otra pregunta, y la cámara se queda esperando diez segundos
que el presupuesto no tiene.

La línea que cierra la cita en un solo turno:

> **La 1, es mantenimiento preventivo de 40 mil kilómetros**

Verificado: con esa frase el agente confirma y dicta el folio en el turno siguiente. Con
«1» a secas hicieron falta dos turnos en las tres corridas.

### 3 · La traza no tiene kilometraje ni versión de política

La narración de 2:40 dice: *«qué acción se ejecutó, sobre qué registro, con qué
kilometraje y qué versión de la política»*. De los 341 registros de `Log_Agente__c` de la
organización, **2 traen odómetro y 5 traen versión de política**. En la sesión que se
grabe, esas dos columnas van a estar vacías mientras la voz en off afirma que están
llenas.

Lo que sí está poblado en todos: `Correlation_Id__c`, `Subagent__c`, `Action_Name__c`,
`Outcome__c`, `Related_Record_Id__c`. Y `Guardrail_Triggered__c` en 41 registros,
`Unit_Verified__c` en 82.

Narración corregida:

> Todo lo que hicieron el cliente y el agente quedó registrado. Un mismo identificador de
> correlación amarra la conversación completa: qué subagente actuó, qué acción ejecutó,
> sobre qué registro, y con qué resultado.

### 4 · La variante B ya se puede grabar

El guion la condiciona a *«que Gabriel ya haya subido el contraste»* y advierte de los
*«83 casos viejos»* de la cola. Las dos cosas están hechas:

- **Contraste.** Los tres tonos callados del sistema estaban por debajo del mínimo
  legible sobre el lienzo casi negro: etiquetas a 3.99:1, metadatos a 2.55:1 y los
  placeholders a 1.87:1. Subidos a 5.63, 4.92 y 4.92. El auditor de diseño ahora mide
  contraste (regla R11) y además **entra al panel con sesión**: antes recibía un 401, la
  página se iba a `acceso.html` y el auditor medía la pantalla de entrada creyendo que
  medía el panel. Por eso el panel salía siempre limpio: no se estaba auditando.
- **La cola.** La bandeja abre por lo de hoy. El conteo dice «19 · 83 anteriores» y
  «Todas» las trae con un toque: nada se esconde, pero el caso que el cliente acaba de
  escalar sale el primero de la lista.

Verificado de punta a punta en el ensayo: el asesor entra, el caso recién escalado
aparece en la posición 1, responde, y **el mensaje llega a la ventana del cliente sin
recargar**.

## La ventana de rodaje

**La última franja apartable de toda la red es el 20 de agosto de 2026.** Después de ese
día no hay nada que agendar en ningún taller, y la escena 2 —la que el guion prohíbe
recortar— deja de existir. No es un defecto: es que se acabó la semilla del calendario.

Y «el sábado» del guion sólo cae dentro del calendario **el 15 de agosto**. Ese día el
taller de Querétaro tiene 09:00, 11:00 y 13:00, y **no tiene las 8:00** — que es
exactamente lo que hace funcionar la corrección de la escena. A partir del domingo 16, «el
sábado» sería el 22 y el agente contestará, con verdad, que no hay nada.

| Si se graba… | Escena 2 |
|---|---|
| hasta el sábado 15 de agosto | tal como está escrita |
| del 16 al 20 de agosto | cambiar «el sábado» por «el jueves» y ajustar la narración |
| a partir del 21 de agosto | hay que extender el calendario antes |

Para extenderlo:

```bash
node scripts/extender-agenda.mjs --dias 21 --ver
```

Copia hacia adelante el patrón semanal que cada sucursal ya tiene —mismos días, mismas
horas, misma capacidad— y enseña qué haría sin escribir nada. Las franjas nuevas nacen
como capacidad **asumida**, no reservable, porque afirmar que un taller abre a una hora
es un hecho operativo del negocio y no algo que un script pueda comprobar. Para que sean
reservables hay que declararlo:

```bash
CONFIRM_EXTENDER_AGENDA=1 CONFIRM_AGENDA_VERIFICADA=1 node scripts/extender-agenda.mjs --dias 21
```

Sólo Querétaro tiene hoy franjas apartables a futuro; en las otras ocho sucursales el
catálogo trae horarios cuya capacidad nadie confirmó, y la aplicación lo dice.

## Antes de grabar

- [ ] `sf org display --target-org zapata` → `Connected`
- [ ] `npm run verificar:guion` en verde o ámbar (rojo = alguna escena no ocurre)
- [ ] Dos ventanas lado a lado: izquierda (60 %) `localhost:3000`, derecha (40 %)
      Salesforce con WorkOrders, Cases y `Log_Agente__c` ya cargados
- [ ] Zoom del navegador al 110–125 %
- [ ] VIN a la mano: `1FUJGLDR9PL456781` — Unidad 110, Freightliner Cascadia,
      41 200 km, 9 meses
- [ ] Entre escenas: pestaña nueva, nunca F5
- [ ] Sin DevTools, sin extensiones, sin pestañas de trabajo
- [ ] No mostrar: reprogramación (fuera del guion, no se ensayó)
- [ ] **No nombrar otro taller que no sea Querétaro.** En los otros ocho el agente
      lista horarios que el Flow después rechaza (`BLOQUEOS.md §15`). La pantalla lo
      desmiente al lado, pero es una contradicción que no conviene tener en cámara.
- [ ] **No usar un VIN que empiece por `3HAM`, `1XKA` o `4V4N`.** Son los T680, y
      ninguna sucursal declara ese modelo (`§16`). El VIN del guion es un Cascadia.

## Escena por escena, con lo que se verificó

### 0:32–1:05 · Conocimiento

Se escribe: **¿Qué cubre la garantía del turbocargador?**

De 15 tomas, 13 nombraron el turbocargador y respondieron desde
«Garantía extendida de tren motriz» —donde el turbocargador aparece listado— con su
vigencia, el deducible y la condición de servicios completos. Las 15 citaron el material
y declararon la fuente como no verificada.

Las otras 2 contestaron sobre la garantía básica sin nombrar el turbo. No es un fallo del
agente: el término que manda al SOSL varía. **Si la respuesta no dice «turbocargador»,
corta y repite en pestaña nueva** — pasa una de cada ocho veces.

Lo que se ve en pantalla al terminar la respuesta: una marca con el estado de la fuente y
una línea «Material consultado · …» con los títulos. Eso es lo que señala la narración.

### 1:05–2:05 · Agendar

1. **Quiero agendar servicio en Queretaro**
   → pide el VIN, dice que son 17 caracteres y explica para qué. Verificado en las tres
   corridas.
2. **Agendame el sabado a las 8 de la mañana, VIN 1FUJGLDR9PL456781**
   → nombra las 8:00 para negarlas y ofrece la lista real. Dos redacciones vistas:
   *«No hay disponibilidad a las 8:00 a.m. el sábado, pero tengo estas opciones
   confirmadas…»* y *«No hay disponibilidad el sábado a las 8:00 am, pero el taller Zapata
   Camiones Querétaro tiene estos horarios…»*. Las horas ofrecidas se cruzaron contra
   `Slot_Taller__c`: todas existen, ninguna inventada.
   → **en paralelo el panel derecho se pobló solo**: Unidad 110, número de serie,
   41 200 km, 9 meses y la cobertura por sistema. Es lo que señala la narración.
3. **La 1, es mantenimiento preventivo de 40 mil kilómetros**
   → confirma y dicta el folio.

En Salesforce: la orden existe con ese folio, en `FL-QRO`, ligada a la unidad del VIN y a
una franja real, y `CreatedBy` es `EinsteinServiceAgent User`. Ese es el dato que la
narración señala en cámara.

### 2:05–2:40 · Escalamiento

Misma conversación. Se escribe: **Quiero hablar con una persona**

La cabecera de la ventana pasa a «Asesor de postventa · caso 00001144» sin cambiar de
pantalla, y el número que enseña es el número real del caso. El agente no promete
transferencia en vivo. En Salesforce: origen `Agentforce`, dueño `Escalamiento Postventa`,
y el expediente lleva el resumen para el asesor más la conversación completa —los nueve
turnos— sembrada por la aplicación.

**Variante B.** `/panel.html`, credencial de asesor. El caso sale el primero de la lista.
Se responde algo breve y el mensaje aparece en la ventana del cliente sin recargar.
Verificado en el ensayo.

### 2:40–2:52 · Traza

Lista de `Log_Agente__c` filtrada por el `Correlation_Id` de la sesión. En la corrida
final salieron dos registros: `Crear_Orden_Servicio` y `Escalar_Asesor_Humano`, ambos
`SUCCESS` y con su `Related_Record_Id__c`. Narrar la versión corregida (corrección 3).

## Lo que no se ha probado

- **Reprogramar.** El guion lo excluye por un defecto abierto y aquí no se ensayó: no hay
  dato nuevo sobre él en ninguno de los dos sentidos.
- **La cola con tráfico ajeno.** Los 19 casos «de hoy» del ensayo los creó el propio
  ensayo. El día del rodaje serán los que se creen ese día.
- **Las respuestas de seguridad de una varada.** Sigue el defecto de `BLOQUEOS.md §11`;
  la escena de varada no está en este guion.
