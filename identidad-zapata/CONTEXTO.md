# Contexto — identidad y clon de Corporación Zapata

Punto de entrada para cualquier sesión futura que toque diseño, marca, sitio web o
integración con Salesforce de Zapata. Léelo antes de improvisar.

## Qué hay aquí y para qué sirve

| Archivo | Para qué |
|---|---|
| `IDENTIDAD-ZAPATA-COMPLETA.md` | Documento integrador. Marca, sistema de diseño, componentes, arquitectura de información, infraestructura, marketing e ingeniería. Es la referencia larga. |
| `VERIFICACION.md` | Resultado del bucle de verificación del clon, con los números. |
| `clone/biblioteca.html` | **Biblioteca viva: 42 componentes con código copiable.** Ábrela antes de escribir cualquier componente. |
| `clone/*.html` | Cinco clones verificados al 100%: home, accesorios, estrena, cita-mazda, freightliner (legacy). |
| `recon/pages/` | Las 78 páginas del crawl. Fuente cruda para responder cualquier pregunta sobre el sitio sin volver a rastrearlo. |
| `recon/crawl.sh` | Script de crawl acotado, por si hace falta re-capturar. |
| `assets/` | 17 assets descargados, 3.3 MB. |
| `evidencia/` | Capturas maestras y JSON de diff geométrico y de hover. |
| `../../skills/zapata-design/` | **La skill.** Es lo que se usa para construir, no este documento. |

## Cómo usar esto

**Para construir cualquier interfaz Zapata:** invoca la skill `zapata-design`. Contiene las
diez reglas duras, los tokens, los componentes y el checklist. No derives el estilo de las
capturas ni de memoria.

**Para clonar o extender el sitio:** `skills/zapata-design/references/clonar.md` tiene el
protocolo completo y los snippets de extracción.

**Para una pregunta sobre el sitio** (qué páginas hay, qué campos lleva un formulario, qué
pixel dispara dónde): busca primero en `recon/pages/` con `rg`. Está todo ahí y no requiere red.

**Para levantar el clon:**

```bash
cd "reto-agentforce/identidad-zapata" && python -m http.server 8899 --bind 127.0.0.1
```
Luego abre `http://127.0.0.1:8899/clone/index.html`.

## Los cinco hechos que más se olvidan

1. **El sitio es `zapata.com.mx`**, no `grupozapata.com` (ese es un dominio en venta) ni
   `corporacionzapata.com` (no resuelve).
2. **El ámbar `#fbbf24` va una sola vez por página**, en el eyebrow del hero, al 80% de
   opacidad. Zapata lo llama "Ámbar de precisión" en su propio código.
3. **Radio 0 y sombra 0 en todo.** Es la firma del sistema.
4. **12px es el tamaño base.** Usar 14 o 16 rompe la identidad aunque los colores estén bien.
5. **Hay dos generaciones de diseño en producción**: 56 páginas con el sistema 2026 y 22
   legacy. La generación 2026 es la identidad canónica; el legacy es deuda, no referencia.

## Enganche con el proyecto Agentforce

El sitio ya postea a Salesforce con:

- Org ID `00D8V000000jL31`
- Campos custom con prefijo propio `ZPT_` (ej. `ZPT_Comentarios__c`)
- Código numérico de sucursal en `00NNv000000NWQb` (ej. `1102`) y de marca en `id_marca`
- Un flujo de cita de servicio de 3 pasos que ya captura placa, modelo, agencia, fecha y contacto

Los objetos del reto (`Unidad_Varada__c`, `Slot_Taller__c`, `Sesion_Diagnostico__c`,
`Modelo_Sucursal__c`, `Regla_Cobertura__c`) se insertan sobre una Org que **ya tiene** marca,
modelo y sucursal modeladas. Antes de crear un eje nuevo de sucursal, verifica contra el campo
de agencia que ya usa el web-to-lead. Detalle completo en la §23 del documento integrador.

## Límites

- El clon es un artefacto de análisis interno. **No se despliega en un dominio público.** El
  contenido, las marcas y las imágenes son propiedad de Corporación Zapata y de las armadoras
  que representa.
- El clon no lleva GTM, GA4, Google Ads ni reCAPTCHA, a propósito: enviarían datos falsos a las
  propiedades reales.
- Los identificadores documentados (GTM, GA4, pixeles, site key de reCAPTCHA, Org ID de
  Salesforce) son públicos por diseño — viajan en el HTML que recibe cualquier visitante. No
  hay secretos en este directorio.

## Fecha de captura

5 de agosto de 2026. Si el sitio cambia, `recon/crawl.sh` re-captura y el protocolo de
`clonar.md` re-extrae. Los valores de este directorio son un snapshot, no una verdad perpetua.
