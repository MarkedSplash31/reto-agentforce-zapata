# Entrega — Equipo 35

Lo que pide la maestra para el viernes, en el formato que lo pide.

| Archivo | Qué es | Requisito |
|---|---|---|
| `Ficha_Tecnica_Equipo35_Agente_Postventa_Zapata.docx` | Topics, Instructions y Actions | punto **B**, `.docx`, **3 páginas exactas** |
| `Documento_Tecnico_Equipo35_Agente_Postventa_Zapata.docx` | Arquitectura, configuración de Topics, lógica de los Flows y artículos de Knowledge | punto **A**, documento técnico |
| `Guion_Rodaje_Equipo35_Video_Demo.docx` | Libreto del video: qué se teclea, qué se narra, minutaje | apoyo para grabar el `.mp4` |

Los `.pdf` al lado son la misma cosa, para revisar sin abrir Word.

## De dónde salen los contenidos

Nada está transcrito de memoria:

- **Topics e Instructions** se extrajeron del bundle del agente desplegado
  (`zapata-dx/force-app/main/default/aiAuthoringBundles/Agente_Postventa_Zapata`).
- **Actions y Flows**, de las clases Apex y los `.flow-meta.xml` sincronizados con la
  organización el 12 de agosto de 2026.
- **Los artículos de Knowledge**, de una consulta a `Knowledge__kav` con
  `PublishStatus = 'Online'`.
- **Las cifras** —361 registros de traza, 803 franjas, 17 reglas de validación, 111
  casos— de consultas SOQL del mismo día.

## Los tres escenarios del video

La maestra pide de dos a tres escenarios clave. El guion cubre tres, que son la forma
del **Escenario C** de su lista (Knowledge + Flow + escalamiento):

1. **Conocimiento** — el cliente pregunta qué cubre la garantía; el agente responde
   citando el artículo y declarando que la fuente no está verificada.
2. **Agendar** — pide cita a una hora que no existe; el agente consulta la
   disponibilidad real, lo corrige y crea la orden en Salesforce.
3. **Escalamiento** — pide hablar con una persona; el agente abre el caso en la cola con
   la conversación adjunta, y un asesor le responde en vivo.

## Una decisión que no es mía

La maestra escribe: *«una demostración fluida del funcionamiento de su agente **en la
plataforma de Salesforce**»*. El video corre en el portal web propio, que consume la
Agent API, con Salesforce al lado mostrando cada registro que se crea.

Eso es lo que nos diferencia —la mayoría demuestra en el Preview de Agentforce— pero un
lector estricto podría leer el requisito como «dentro de Salesforce». Dos salidas, y hay
que elegir una antes de grabar:

- **Dejarlo como está** y decirlo en la narración: el portal es parte de la solución y
  todo lo que pasa ahí queda en el CRM, que se ve en la misma pantalla.
- **Añadir diez segundos** al inicio dentro de Agent Builder enseñando los seis Topics y
  sus acciones, y luego pasar al portal. Cuesta un recorte en la escena de plataforma.

## Reproducir la verificación

```bash
cd reto-agentforce/torre-agentforce
npm run verificar:guion          # el video, escena por escena
npm run verificar:generalidad    # las 15 unidades y los 9 talleres
npm run verificar:e2e            # conversaciones completas releídas de Salesforce
```
