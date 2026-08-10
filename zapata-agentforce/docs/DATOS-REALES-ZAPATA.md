# Datos reales de Zapata — investigación del sitio oficial

Fecha: 30 de julio de 2026
Fuentes consultadas:

- `zapata.com.mx/freightliner/distribuidoras` — direcciones y horarios
- `zapata.com.mx/greatdane/distribuidoras` — teléfonos
- `zapata.com.mx/camiones/cita-de-servicio/freightliner` — formulario de citas
- `zapata.com.mx/freightliner/catalogo` — catálogo de modelos

**El formulario de citas se inspeccionó, no se envió.** Agendar una cita real
habría creado un compromiso falso con un taller y ocupado un espacio de agenda.
Todos los campos se leyeron sin llegar al botón de confirmar.

---

## 1. Las 9 agencias Freightliner (cargadas en la org)

| Id agencia | Código | Sucursal | Ciudad | Teléfono |
| --- | --- | --- | --- | --- |
| 96 | FL-TLA | Zapata Camiones Tlalnepantla | Tlalnepantla, Edo. Méx. | (55) 7931 3901 |
| 97 | FL-LEO | Zapata Camiones León | León, Gto. | (477) 710 0016 |
| 98 | FL-QRO | Zapata Camiones Querétaro | Querétaro, Qro. | (442) 209 6900 |
| 99 | FL-CEL | Zapata Camiones Celaya | Celaya, Gto. | (461) 689 1108 |
| 100 | FL-TAM | Zapata Camiones Tampico | Altamira, Tamps. | (833) 115 1500 |
| 101 | FL-AER | Zapata Camiones Aeropuerto | Texcoco, Edo. Méx. | (595) 954 9933 |
| 102 | FL-GDL | Zapata Camiones Guadalajara | Zapopan, Jal. | (33) 3180 8541 |
| 103 | FL-GDLRM | Zapata Camiones Guadalajara R. Michel | Guadalajara, Jal. | — |
| 104 | FL-MTY | Zapata Camiones Monterrey | Apodaca, N.L. | (81) 8305 4500 |

El **Id de agencia** no lo inventé: es el `value` real del selector de agencia en
su formulario de citas. Queda en `Sucursal__c.Id_Agencia_Web__c` porque es la
llave para integrar de verdad con su sitio más adelante.

Horario Freightliner en toda la red: **lunes a viernes 9:00–19:00, sábado
9:00–15:00, domingo cerrado.**

## 2. Lo que el formulario de citas pide realmente

Tres pasos: **Vehículo → Horario → Contacto**.

| Campo | Obligatorio | ¿Lo teníamos? |
| --- | --- | --- |
| Marca | Sí | ❌ **No existía** → `Product2.Marca__c` |
| Modelo | Sí | ✅ `Product2` |
| Agencia | Sí | ✅ `Sucursal__c` |
| **Placa** | Sí | ❌ **No existía** → `Asset.Placa__c` |
| Número de serie (VIN) | Sí | ✅ `Asset.SerialNumber` |
| Nombre completo | Sí | ✅ `Contact` |
| Teléfono móvil (10 dígitos) | Sí | ✅ `Contact` |
| Correo electrónico | Sí | ✅ `Contact` |
| Comentarios (síntomas, ruidos, testigos) | No | ✅ `WorkOrder.Sintoma_Reportado__c` |

### Campos ocultos que su formulario ya envía

`utm_source`, `utm_medium`, `utm_campaign`, `coupon`, más un token CSRF y
reCAPTCHA.

**Esto importa:** Zapata **ya está sellando el origen publicitario** en cada cita
de servicio. La Propuesta C del briefing (atribución anuncio → cita) no es una
idea nueva para ellos: es algo que su web ya captura y que probablemente nadie
está explotando en el CRM. Se agregaron `Utm_Source__c`, `Utm_Medium__c`,
`Utm_Campaign__c` y `Ad_ID__c` a `WorkOrder` aunque el plan final dejó C fuera
del MVP, porque cuestan nada y conectan con lo que ellos ya hacen.

## 3. Reglas de negocio que el sitio declara

| Regla | Dónde vive ahora |
| --- | --- |
| **"Programe su cita con al menos 24 hrs. de anticipación"** | `Sucursal__c.Anticipacion_Minima_Horas__c` = 24 |
| Domingo cerrado | `Sucursal__c.Abre_Domingo__c` = false |
| Sábado con horario reducido | `Sucursal__c.Horario_Sabado__c` |
| "Disponibilidad síncrona con el taller central" | La agenda sale de `Slot_Taller__c`, no de texto libre |
| Confirmación de la cita por correo | `WorkOrder.Confirmacion_Enviada__c` |
| Presentarse 10 min antes con duplicado de llaves | Nota operativa, va en Knowledge |

## 4. Un detalle que cambia el modelo

**El horario depende de la marca, no solo de la sucursal.** En la misma
dirección física:

- Freightliner: L-V 9:00–19:00 · Sáb 9:00–15:00
- Great Dane: L-V 9:00–18:00 · Sáb 9:00–14:00

Hoy `Sucursal__c` guarda el horario Freightliner, que es la línea del reto. Si
más adelante se cubren varias marcas por sucursal, el horario tiene que bajar al
cruce marca × sucursal, no quedarse en la sucursal.

## 5. Marcas que opera Corporación Zapata

Camiones: **Freightliner**, **Mercedes-Benz Autobuses**, **Mercedes-Benz Vanes**,
**Great Dane**.
Autos: **Ford**, **Nissan**, **Mazda**, **JAC**, **Lincoln**.
Además V4B (subastas).

Todas están en el picklist `Product2.Marca__c` y `Sucursal__c.Marca_Principal__c`.
El reto cubre solo Freightliner, pero el modelo ya no se rompe si mañana suman otra.

## 6. Modelos Freightliner del catálogo

`Cascadia`, `M2`, `114SD`, `FL 360`. Su catálogo muestra 12 unidades que son
configuraciones de estas cuatro familias. Cargadas como `Product2` con su
`ProductCode`.

## 7. Agenda cargada

**729 franjas** en 9 sucursales para los próximos 21 días, generadas desde el
horario real: cinco bloques de 2 h entre semana, tres los sábados, ninguna en
domingo, y ninguna antes de las 24 horas de anticipación que ellos exigen.

Todas empiezan **libres**. La ocupación la irá marcando `Crear_Orden_Servicio`.

## 8. Lo que sigue sin poder saberse desde fuera

- **Capacidad real por taller.** Se asumieron 3 cupos por bloque entre semana y
  2 el sábado. Es un supuesto, no un dato.
- **Qué modelos atiende realmente cada sucursal.** Se asumió que todas dan
  servicio completo a toda la línea Freightliner, porque son distribuidores
  autorizados. Habría que confirmarlo.
- **Pólizas de garantía**: meses y kilómetros por modelo y sistema. No son
  públicos.
- **Política de compensación** y **cola de escalamiento**.
- **Bloques de horario exactos** que ofrece su calendario: se cargan por AJAX
  después de elegir día y no se inspeccionaron para no tocar su sistema de más.
