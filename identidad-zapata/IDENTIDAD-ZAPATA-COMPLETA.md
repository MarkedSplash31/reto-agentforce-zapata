# Identidad completa de Corporación Zapata — documento integrador

**Objeto de estudio:** `https://zapata.com.mx` (Corporación Zapata, México)
**Fecha de extracción:** 5 de agosto de 2026
**Método:** investigación previa en GitHub y foros → recon con crawl acotado (78 páginas) →
extracción de estilos computados en navegador real (Playwright/Chromium 151) → análisis de
corpus → verificación cruzada código-fuente contra valores renderizados.

> **Regla que gobierna este documento:** ningún valor está estimado. Todo color, tamaño,
> interlínea, tracking, padding y duración proviene de `getComputedStyle()` sobre la página
> viva, o del código fuente literal del sitio. Donde hay una inferencia, está marcada como
> **[inferencia]**.

> **Nota de propiedad intelectual.** El contenido, las marcas, los logotipos y las imágenes de
> `zapata.com.mx` son propiedad de Corporación Zapata y de las armadoras que representa
> (Ford, Mazda, JAC, Nissan, Lincoln, Freightliner, Mercedes-Benz, Great Dane). Este documento
> y el clon derivado son un artefacto de análisis técnico y de sistema de diseño para uso
> interno del proyecto. El clon no se publica ni se despliega en un dominio público.

---

## Índice

**PARTE I — Cómo se hace esto (investigación en GitHub y foros)**
1. El problema y por qué la mayoría lo hace mal
2. Los cuatro proyectos de referencia
3. El método destilado: extracción > estimación
4. Extraer identidad de marca vs. clonar un sitio: dos trabajos distintos
5. La regla de las reglas duras

**PARTE II — Identidad de marca de Zapata**
6. Quién es Zapata y qué vende
7. Arquitectura de marca y portafolio
8. Posicionamiento, promesa y voz
9. Sistema verbal: patrones de copy

**PARTE III — Sistema de diseño**
10. Color: paleta completa con valores computados
11. Tipografía: familias, escala y roles
12. Espaciado, retícula y contenedor
13. Bordes, radios, sombras y superficies
14. Movimiento: duraciones, curvas y estados

**PARTE IV — Componentes**
15. Inventario y especificación por componente
16. Estados: hover, focus, open
17. Comportamiento responsive

**PARTE V — Arquitectura de información**
18. Inventario completo de páginas
19. Arquetipos de página
20. Flujos de usuario
21. Las dos generaciones de diseño

**PARTE VI — Infraestructura e ingeniería**
22. Stack y hosting
23. Integración con Salesforce
24. Seguridad y cabeceras
25. Deuda técnica observable

**PARTE VII — Marketing y capa de datos**
26. Pixeles, tags e identificadores
27. Modelo de atribución
28. SEO: estado real

**PARTE VIII — Protocolo de clonado**
29. Estrategia de fidelidad
30. Criterios de aceptación

---

# PARTE I — Cómo se hace esto

## 1. El problema y por qué la mayoría lo hace mal

Cuando se le pide a un modelo "clona este sitio", el fallo por defecto es que **estima**. Mira
una captura, deduce "esto parece gris medio, será `#888`", "el título parece 48px", y produce
algo que *se parece* al original a 30% de zoom y se desmorona a tamaño real. El resultado
típico se queda entre 85% y 92% de parecido, y ese último 8-15% es precisamente lo que hace
que un sitio se sienta profesional o falso.

Los proyectos serios que revisé en GitHub convergen, sin coordinarse entre ellos, en la misma
conclusión: **el problema no es de generación, es de medición.** Si mides bien, generar es casi
trivial. Si mides mal, ninguna cantidad de iteración lo arregla, porque el modelo no tiene
contra qué comparar.

## 2. Los cuatro proyectos de referencia

Busqué en GitHub y en foros/agregadores. Estos son los que tienen método real, no marketing:

| Proyecto | Aporte distintivo |
|---|---|
| [`Angelov1314/web-clone-skill`](https://github.com/Angelov1314/web-clone-skill) | Pipeline de 5 fases. Regla fundacional: *"Every CSS value comes from `getComputedStyle()` — never estimate"*. Specs por componente en `.spec.md`, partidos si exceden ~150 líneas. |
| [`Varalix-Digitech-Solutions/clone-team`](https://github.com/Varalix-Digitech-Solutions/clone-team) | Equipo de agentes con *gate de test no saltable*. Aporta el concepto de **cold-session load test**: el movimiento que sólo ocurre una vez, al cargar, es invisible a toda observación posterior. Y la captura de trayectoria de scroll: mapa `scrollY → estado`. |
| [`byosamah/ok-skills`](https://github.com/byosamah/ok-skills) | Pipeline de 13 fases con **verificación por SSIM en bucle**: compara capturas del clon contra el original y no sale del bucle hasta que el score cruza el umbral. Tokens con *confidence scoring* (HIGH/MEDIUM/LOW). |
| [`HossamNomad/clone-any-site`](https://github.com/HossamNomad/clone-any-site) | Clon a fidelidad total en loopback como paso previo a reutilización. |

Fuera de GitHub, la guía de [aimaker sobre brand kits para Claude Design](https://aimaker.substack.com/p/claude-design-brand-system-skill-guide)
aporta la pieza que a los clonadores les falta: cómo convertir la extracción en una **skill
persistente** con `brand.json` como fuente única de verdad, y la distinción entre reglas duras
y sugerencias.

## 3. El método destilado: extracción > estimación

Consolidando los cuatro, el método que realmente funciona tiene siete pasos:

**Paso 1 — Recon multi-viewport.** Capturas a 1440 / 768 / 390 px. Estas capturas son la
*referencia maestra*: todo lo demás se valida contra ellas. Sesión fría para atrapar animaciones
de entrada.

**Paso 2 — Descubrimiento de tokens vía DOM.** No leer el CSS: leer el DOM renderizado.
Recorrer `document.querySelectorAll('*')`, acumular `color`, `backgroundColor`, `borderColor`
de cada nodo, y contar frecuencias. La paleta real emerge ordenada por uso, no por lo que el
diseñador creía que estaba usando.

**Paso 3 — Tipografía por rol semántico, no por clase.** Muestrear `h1`, `h2`, `p`, `nav a`,
botón primario, botón secundario, etc., y capturar de cada uno `font-family`, `font-size`,
`font-weight`, `line-height`, `letter-spacing`, `text-transform`, `color`. El resultado es una
escala tipográfica *observada*, que casi nunca coincide con la escala teórica del framework.

**Paso 4 — Specs por componente.** Un archivo por componente con jerarquía DOM, estilos
computados de cada elemento, transiciones de estado con valores antes/después y timing, modelo
de interacción (estático / click / scroll / tiempo), texto verbatim y comportamiento responsive.

**Paso 5 — Assets literales.** Enumerar vía DOM (`document.images`, `backgroundImage`,
`link[rel*=icon]`, `document.fonts`) y descargar. No regenerar, no sustituir por placeholders.

**Paso 6 — Construcción.** Con specs completos, la construcción es mecánica.

**Paso 7 — Bucle de verificación visual.** Capturar el clon en los mismos tres viewports,
comparar contra las referencias maestras, listar discrepancias, corregir, repetir. El bucle es
lo que separa 92% de 100%.

## 4. Extraer identidad de marca vs. clonar un sitio: dos trabajos distintos

Es la confusión más común y vale la pena dejarla explícita, porque el encargo de este documento
pide las dos cosas:

- **Clonar** = reproducir *esta* página. El entregable es HTML/CSS. Éxito = las capturas
  coinciden. Es un problema cerrado y verificable.
- **Extraer identidad** = destilar las reglas generativas que producirían *cualquier* página
  nueva coherente con la marca. El entregable son tokens + reglas + voz. Éxito = un diseñador
  que nunca vio el sitio produce algo que encaja.

Un clon perfecto no te da la identidad: te da una instancia. Una identidad bien extraída te
permite construir la página 79 que Zapata nunca hizo, y que aun así se ve Zapata. Por eso este
documento produce las dos: el sistema (Partes II–VII) **y** el clon (Parte VIII).

## 5. La regla de las reglas duras

El hallazgo más útil de la guía de brand kits: **una skill de diseño falla cuando codifica
preferencias en vez de restricciones.**

- ❌ "Normalmente usa Inter" → el modelo deriva a sus defaults en la siguiente sesión.
- ✅ "Usa Inter. Nunca ninguna otra sans. Los títulos son Cinzel 300. Nunca Cinzel 700."

La razón es mecánica: un modelo sin restricción dura resuelve la ambigüedad con su prior, y su
prior es "sitio bonito genérico de 2026", no "Zapata". Toda regla de la skill que generamos en
la Parte VIII de este proyecto está escrita en forma absoluta por este motivo.

---

# PARTE II — Identidad de marca de Zapata

## 6. Quién es Zapata y qué vende

**Corporación Zapata** es un grupo automotriz mexicano fundado en **1956** por Don Roberto
Zapata Turnbull. Es uno de los grupos de distribución automotriz más grandes del país.

| Dato | Valor | Fuente |
|---|---|---|
| Fundación | 1956 | Perfiles corporativos públicos |
| Antigüedad declarada en el sitio | "MÁS DE 70 AÑOS" | H1 del home, verbatim |
| Empleados directos | >1,700 | Perfiles corporativos públicos |
| Domicilio corporativo | Boulevard Manuel Ávila Camacho 685, Piso 10, Centro Industrial Alce Blanco, CP 53370, Naucalpan de Juárez | Footer del sitio, verbatim |
| Teléfono | (55) 2122-0370 | Footer, `tel:+525521220370` |
| Reconocimiento | Great Place to Work | Perfiles corporativos públicos |
| Presencia internacional | EUA, Chile, Ecuador, Venezuela, Colombia, Argentina | Perfiles corporativos públicos |

**Modelo de negocio:** distribución multimarca + postventa + refacciones + seminuevos +
arrendamiento/flotas + subastas. No es un concesionario: es una plataforma de movilidad
terrestre que cubre desde un auto familiar hasta la administración de una flota de carga.

## 7. Arquitectura de marca y portafolio

Zapata opera una arquitectura **endorsed brand**: la marca madre (Zapata) respalda, pero cada
armadora conserva su identidad. Esto es obligatorio contractualmente — Ford, Mazda y Nissan
imponen sus propios manuales de marca a sus distribuidores. El sitio corporativo es la capa
que unifica.

### Portafolio verificado en el sitio

**Automóviles y camionetas**
- Ford — `/distribuidora-ford`, `/cita-de-servicio/ford`
- Lincoln — `https://lincolnzapatazonaesmeralda.mx/` (dominio propio), `/cita-de-servicio/lincoln`
- Mazda — `/distribuidora-mazda`, `/cita-de-servicio/mazda`
- Nissan — `/distribuidora-nissan`, `/cita-de-servicio/nissan` (+ Coacalco, Ecatepec, Zona Esmeralda)
- JAC — `/distribuidora-jac`, `/cita-de-servicio/jac`

**Vehículos comerciales y pesados**
- Freightliner — `/freightliner`, catálogo con unidades **Cascadia, M2-35K, 114SD, FL-360**
- Mercedes-Benz Autobuses — `/autobuses/mercedes-benz/*` (catálogo, cotización, postventa, tecnología Safety Bus)
- Mercedes-Benz Vanes (Sprinter) — `https://www.mercedes-benz-zapatavanes.com.mx/` (dominio propio)
- Great Dane (remolques) — `/greatdane`, refrigerado y carga

**Servicios y canales adyacentes**
- GoOn Seminuevos — `https://go-on.mx/` y `https://www.zapataseminuevos.mx/`
- Subastas V4B — `https://www.subastasv4b.com.mx/`
- Collision Center — `/collision-center`
- Accesorios — `/accesorios` (foco declarado en JAC)
- Talento Zapata (RRHH) — `https://www.talentozapata.com.mx/bolsa-de-trabajo`

### Lo que la arquitectura revela

El grupo **no centraliza el dominio**. Lincoln, Vanes, Seminuevos, V4B y Talento viven en
dominios separados. `zapata.com.mx` funciona como *hub corporativo y de postventa*, no como
e-commerce unificado. Consecuencia de diseño: el sitio corporativo puede permitirse una
identidad propia fuerte y oscura, porque no compite con las guías de marca de las armadoras —
esas viven en sus propios dominios. **[inferencia, pero consistente con toda la evidencia
estructural].**

### Cobertura geográfica verificada

Sucursales con página propia de cita de servicio Freightliner: **Aeropuerto, Celaya,
Guadalajara, Guadalajara R. Michel, León, Monterrey, Querétaro, Tampico, Tlalnepantla.**
Nissan: **Coacalco, Ecatepec, Zona Esmeralda.**

## 8. Posicionamiento, promesa y voz

### La promesa central, verbatim del hero

> **Eyebrow:** `Con nuestros clientes`
> **H1:** `MÁS DE 70 AÑOS`
> **Subtítulo:** `Soluciones Integrales a tus retos de movilidad.`

Esta construcción es deliberada y merece desarmarse, porque contiene toda la estrategia:

1. **"Con nuestros clientes"** antepuesto a la cifra convierte una métrica de vanidad
   (antigüedad) en una métrica de relación. No dice "70 años en el mercado"; dice 70 años
   *acompañando*. Es la diferencia entre presumir y prometer.
2. **"MÁS DE 70 AÑOS"** en Cinzel a 72px es el único momento del sitio con esa escala. La
   antigüedad es el activo principal de la marca y se le da el peso tipográfico correspondiente.
3. **"retos de movilidad"** — no "vehículos", no "autos". El sustantivo elegido es *reto*, que
   posiciona a Zapata como resolvedor de problemas operativos, no como vendedor de fierro.
   Esto es lenguaje B2B aplicado también al B2C.

### Ejes de posicionamiento (destilados del corpus)

| Eje | Evidencia textual verbatim |
|---|---|
| **Permanencia** | "MÁS DE 70 AÑOS", "Más de seis décadas construyendo soluciones de movilidad con visión de largo plazo" |
| **Integralidad** | "Soluciones Integrales", "Portafolio Operativo", "Desde un auto familiar hasta una flota de carga con administración completa" |
| **Respaldo operativo** | "la infraestructura de respaldo más robusta del país", "soluciones a la medida para tu flota" |
| **Cuidado de la inversión** | "Deja el cuidado de tu inversión en manos de nuestros expertos", "refacciones originales" |
| **Cultura y gente** | "Consolidando un gran equipo", "Personas, historias y proyectos que dan vida a la cultura Zapata dentro y fuera del camino" |

### Voz de marca

**Registro:** sobrio, técnico-operativo, adulto. Español de México, tuteo consistente
("tus retos", "tu operación", "Agenda tu cita"). Sin exclamaciones. Sin emoji. Sin urgencia
artificial. Sin superlativos vacíos — cuando hay superlativo ("la más robusta del país") va
anclado a una categoría concreta y verificable.

**Tres rasgos que definen la voz:**

1. **Sustantivos operativos sobre adjetivos emocionales.** El sitio habla de *operación*,
   *flota*, *configuraciones*, *kilometraje*, *cobertura*, *administración*. No de *sueños*,
   *aventura*, *libertad*. Incluso en el segmento de autos particulares, el vocabulario sigue
   siendo el del gestor de flota. Es una decisión de voz notable y consistente.

2. **La frase corta después de la frase larga.** Patrón recurrente: descripción densa seguida
   de un cierre breve. *"Tractocamiones y camiones con la infraestructura de respaldo más
   robusta del país y soluciones a la medida para tu flota."* → CTA: *"Ver inventario"*.

3. **El CTA nunca es "clic aquí".** Siempre es un verbo de la operación: *Ver inventario*,
   *Conocer modelos*, *Ver catálogo*, *Agenda tu cita de servicio*, *Explorar*, *Ir a V4B*,
   *Ver historia*, *Conocer ofertas*. El CTA describe el resultado, no la acción mecánica.

**Etiquetas de sección (eyebrows) — el vocabulario propio de Zapata:**

`Cultura` · `Oportunidades Vigentes` · `Portafolio Operativo` · `Soporte` · `Localidades` ·
`Compromiso Irrenunciable` · `Equipa tu vehículo` · `Red Great Dane México` · `Freightliner Zapata`

Este es el léxico más característico de la marca. "Portafolio Operativo" y "Compromiso
Irrenunciable" no son frases que produciría un generador genérico: son marcadamente Zapata.

## 9. Sistema verbal: patrones de copy

**Estructura de bloque de sección (invariante en toda la generación 2026):**

```
[eyebrow]      uppercase · tracking 0.3em · gris 500 · 12px
[H2]           Cinzel 300 · 30px · blanco · sentence case
[descripción]  Inter 300 · 12px · gris 400 · opcional
```

**Estructura de tarjeta (invariante):**

```
[imagen]       aspect ratio fijo · opacity 0.8 · escala en hover
[H3]           Cinzel 400 · 20px · blanco
[párrafo]      Inter 300 · 12px · line-height 19.5px · gris 400
[CTA]          uppercase · tracking widest · 12px · blanco · con → o botón outline
```

**Reglas de mayúsculas observadas:**
- H1: **MAYÚSCULAS COMPLETAS** (sólo el hero y las páginas de campaña: "ESTRENA EN ZAPATA")
- H2 y H3: sentence case ("Consolidando un gran equipo", "Soluciones para cada necesidad")
- Eyebrows, CTAs, links de nav y footer: `text-transform: uppercase` vía CSS, escritos en
  sentence case en el HTML
- Nombre corporativo en footer: "CORPORACIÓN ZAPATA" en mayúsculas literales en el HTML

---

# PARTE III — Sistema de diseño

## 10. Color: paleta completa con valores computados

### Tokens declarados por Zapata en su propio código

Encontrado en `tailwind.config` de `/accesorios` — **estos son los nombres que Zapata usa
internamente**, no una interpretación mía:

```js
tailwind.config = {
  theme: { extend: { colors: { brand: {
    darkBg:  '#0b0c10',
    surface: '#0d0e12',
    accent:  '#fbbf24'   // Ámbar de precisión
  }}}}
}
```

El comentario **"Ámbar de precisión"** es del código fuente de Zapata. Es el nombre propio del
color de acento de la marca.

### Escala de fondos (del más profundo al más elevado)

| Token | Hex | RGB computado | Uso verificado | Frecuencia en corpus |
|---|---|---|---|---|
| `footer` | `#07080a` | `rgb(7, 8, 10)` | Fondo del footer, único elemento más oscuro que el canvas | 59 |
| `canvas` / `brand.darkBg` | `#0b0c10` | `rgb(11, 12, 16)` | Fondo de `body`, secciones impares, tarjetas sobre `surface` | **726** |
| `surface` / `brand.surface` | `#0d0e12` | `rgb(13, 14, 18)` | Secciones pares, tarjetas sobre `canvas` | **449** |
| `elevated` | `#121318` | — | Superficies elevadas puntuales | 43 |
| `elevated-alt` | `#14161d` | — | Variante | 12 |
| `neutral-900` (TW) | `#171717` | `rgb(23, 23, 23)` | Placeholder detrás de imágenes de tarjeta | 14 |

**La regla de alternancia — el mecanismo estructural del sitio.** Las secciones alternan
`#0b0c10` ↔ `#0d0e12`. La diferencia entre ambos es de 2 unidades en R, 2 en G, 2 en B: es
*casi imperceptible*, y ese es exactamente el punto. Separa las secciones sin dibujar una línea,
y el borde de `rgba(255,255,255,0.05)` remata la separación. Es un ritmo de profundidad, no de
contraste.

Y hay una segunda mitad de la regla: **las tarjetas siempre invierten respecto a su sección.**
Sección en `#0d0e12` → tarjetas en `#0b0c10`. Sección en `#0b0c10` → tarjetas en `#0d0e12`.
Verificado en `#comunidad` (sección `rgb(13,14,18)`, tarjetas `rgb(11,12,16)`) y en `#estrena`
(sección `rgb(11,12,16)`, tarjetas `#0d0e12`). Esto crea profundidad sin sombras: el sitio
**no usa una sola `box-shadow`** — todas las mediciones devolvieron `box-shadow: none`.

### Escala de texto

| Rol | Hex | RGB computado | Clase Tailwind | Uso |
|---|---|---|---|---|
| Máximo énfasis | `#ffffff` | `rgb(255, 255, 255)` | `text-white` | H1, H2, H3, CTAs de tarjeta, dato duro en footer |
| Cuerpo base | `#f3f4f6` | `rgb(243, 244, 246)` | `text-gray-100` | `body` — color heredado |
| Secundario | `#e5e7eb` | `rgb(229, 231, 235)` | `text-gray-200` | El más frecuente por herencia (196 nodos) |
| Párrafo / descripción | `#9ca3af` | `rgb(156, 163, 175)` | `text-gray-400` | Todo texto descriptivo, links de nav en reposo, links de footer |
| Terciario / eyebrow oscuro | `#6b7280` | `rgb(107, 114, 128)` | `text-gray-500` | Eyebrows de sección |
| Mínimo / copyright | `#4b5563` | `rgb(75, 85, 99)` | `text-gray-600` | Línea de copyright |
| Sub-título hero | `#d1d5db` | `rgb(209, 213, 219)` | `text-gray-300` | Subtítulo del hero, títulos de columna de footer |
| Placeholder de input | `#374151` | — | `placeholder:text-gray-700` | Inputs de formulario |

### Acento

| Token | Valor computado | Uso |
|---|---|---|
| **Ámbar de precisión** | `rgba(251, 191, 36, 0.8)` (`amber-400/80`) | **Un solo lugar en el home: el eyebrow del hero.** También `accent-amber-400` en checkboxes de formulario. |

Este es el hallazgo cromático más importante del sitio. **El ámbar aparece exactamente una vez
por página, en el eyebrow del hero, y a 80% de opacidad.** No hay botones ámbar, no hay links
ámbar, no hay iconos ámbar. Es un acento de puntuación, no de sistema.

La disciplina es lo que le da valor: en una paleta de siete grises y tres negros, un solo punto
cálido a 80% de opacidad hace más trabajo que un sistema completo de color de acento. Cualquier
clon que use ámbar en más de un lugar por página está rompiendo la identidad, aunque el hex sea
correcto.

### Alfas sobre blanco — el sistema de bordes y superficies

| Valor | Clase | Uso | Frecuencia |
|---|---|---|---|
| `rgba(255,255,255,0.05)` | `border-white/5` · `bg-white/5` | **Borde por defecto de todo.** Tarjetas, secciones, footer. Fondo del CTA de nav. | **1112 bordes + 123 fondos** |
| `rgba(255,255,255,0.1)` | `border-white/10` · `bg-white/10` | Bordes de botones outline en tarjetas, inputs de formulario, hover de botón secundario | 765 + 44 |
| `rgba(255,255,255,0.2)` | `border-white/20` | Borde del CTA de nav y del botón secundario del hero | 256 |
| `rgba(255,255,255,0.3)` | `border-white/30` | Variante | 92 |
| `rgba(255,255,255,0.4)` | `border-white/40` | **Borde de input en `:focus`** | 330 |

### Alfas sobre negro

| Valor | Uso |
|---|---|
| `rgba(11, 12, 16, 0.8)` | Fondo de la nav fija (`bg-[#0b0c10]/80` + `backdrop-blur-md`) |
| `rgba(11, 12, 16, 0.95)` | Fondo del panel de menú móvil (+ `backdrop-blur-lg`) |
| `rgba(0, 0, 0, 0.4)` | Fondo del botón secundario del hero (+ `backdrop-blur`) |

### Gradiente — hay exactamente uno

```css
linear-gradient(to top, rgb(11, 12, 16), rgba(0, 0, 0, 0), rgba(11, 12, 16, 0.5))
```
Clase: `bg-gradient-to-t from-[#0b0c10] via-transparent to-[#0b0c10]/50`

Se aplica sobre la imagen del hero. Su función es funcional, no decorativa: funde la imagen con
el canvas por arriba (para que la nav flote sin línea de corte) y por abajo (para que la
sección siguiente nazca sin costura). El sitio **no tiene ningún otro gradiente**.

### Colores de sub-marca (no pertenecen al sistema corporativo)

Estos aparecen sólo en páginas de sub-marca con su propio `tailwind.config` y **no deben
usarse en contexto corporativo**:

- Great Dane: `primary #000914`, `secondary #356095`, `surface #f1fbfb`, `on-surface #141d1e`
- Mercedes-Benz Buses: `#0C2232`, `#12344b`
- WhatsApp CTA: `#25D366`, hover `#1ebe5d`
- Legacy: `#c5c5c5`, `#8d8b86`, `#00a1eb`, `#FFA500`, `#ff3a2b`

## 11. Tipografía: familias, escala y roles

### Familias

```html
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
```

```css
.font-serif-luxury { font-family: 'Cinzel', serif; }
.font-sans-clean   { font-family: 'Inter', sans-serif; }
```

| Familia | Pesos cargados | Pesos realmente usados | Rol |
|---|---|---|---|
| **Cinzel** (serif) | 400, 600 | **300 y 400** | Todo título: H1, H2, H3, marca en footer |
| **Inter** (sans) | 300, 400, 500, 600 | 300, 400, 500 | Todo lo demás: cuerpo, nav, CTAs, eyebrows, formularios |
| Font Awesome 6.5.1 | — | Free + Brands | Iconografía |

**Anomalía técnica documentada:** el sitio usa `font-weight: 300` en H1 y H2 con Cinzel, pero
**sólo carga Cinzel 400 y 600**. El navegador sintetiza el peso 300 o cae al 400 más cercano.
`document.fonts` confirma: `Cinzel 400 normal loaded`, `Cinzel 600 normal unloaded`. En la
práctica H1 y H2 se renderizan en Cinzel 400. **Para clonar con fidelidad hay que replicar esta
misma configuración**, no "corregirla" cargando Cinzel 300 — eso produciría un resultado
distinto al original.

**Por qué Cinzel.** Cinzel es una serif basada en la capital romana clásica (inscripciones
trajanas). Es una decisión de posicionamiento, no estética: comunica permanencia, institución,
monumento. Combinada con un peso ligero (300/400) y tracking positivo, deja de leerse como
"lujo de joyería" y se lee como "esto lleva aquí mucho tiempo". Es la traducción tipográfica
exacta de "MÁS DE 70 AÑOS".

### Escala tipográfica — valores computados, no teóricos

| Rol | font-size | line-height | weight | letter-spacing | transform | color | familia |
|---|---|---|---|---|---|---|---|
| **H1 hero** | 72px | 72px (1.0) | 300 | 1.8px (0.025em) | none | `#fff` | Cinzel |
| **H1 secundario** | 48px | 48px (1.0) | 300 | 1.2px | none | `#fff` | Cinzel |
| **H2 sección** | 30px | 36px (1.2) | 300 | 0.75px (0.025em) | none | `#fff` | Cinzel |
| **H3 tarjeta grande** | 20px | 28px (1.4) | 400 | 0.5px (0.025em) | none | `#fff` | Cinzel |
| **H3 tarjeta chica** | 18px | 28px | 400 | 0.45px | none | `#fff` | Cinzel |
| **Marca footer** | 14px | 20px | 400 | 1.4px (0.1em) | none | `#fff` | Cinzel |
| **Body base** | 16px | 24px (1.5) | 400 | normal | none | `#f3f4f6` | Inter |
| **Subtítulo hero** | 16px | 24px | 300 | 1.6px (0.1em) | none | `#d1d5db` | Inter |
| **Párrafo tarjeta** | 12px | 19.5px (1.625) | 300 | normal | none | `#9ca3af` | Inter |
| **Eyebrow hero** | 12px | 16px | 500 | **6px (0.5em)** | uppercase | `rgba(251,191,36,.8)` | Inter |
| **Eyebrow sección** | 12px | 16px | 400 | **3.6px (0.3em)** | uppercase | `#6b7280` | Inter |
| **Link de nav** | 12px | 16px | 400 | 1.2px (0.1em) | uppercase | `#9ca3af` | Inter |
| **CTA / botón** | 12px | 16px | 500 | 1.2px (0.1em) | uppercase | según variante | Inter |
| **CTA de tarjeta** | 12px | 16px | 400 | 1.2px | uppercase | `#fff` | Inter |
| **Título col. footer** | 10px | 16px | 500 | 1px (0.1em) | uppercase | `#d1d5db` | Inter |
| **Link footer** | 11px | 16px | 300 | normal | none | `#9ca3af` | Inter |
| **Dirección footer** | 11px | 17.875px (1.625) | 300 | normal | none | `#9ca3af` | Inter |

### Las tres reglas tipográficas que definen la marca

**Regla 1 — 12px es el tamaño del sitio.** `text-xs` (12px) aparece **1469 veces** en el corpus;
`text-sm` (14px) 417; todo lo demás es marginal. El sitio se construye sobre texto de 12px.
Esto es inusual y deliberado: fuerza densidad de información y hace que los títulos en Cinzel
grande golpeen mucho más fuerte por contraste de escala. Un clon que use 14px o 16px de base se
verá inmediatamente mal aunque todos los colores sean correctos.

**Regla 2 — el tracking es el sistema.** `tracking-widest` (0.1em) aparece **1627 veces**. La
escala completa observada:

| Clase | Valor | Uso |
|---|---|---|
| `tracking-widest` | 0.1em | Todo texto en mayúsculas: nav, CTAs, títulos de footer |
| `tracking-wide` | 0.025em | Títulos Cinzel (H1, H2, H3) |
| `tracking-[0.3em]` | 0.3em | Eyebrows de sección |
| `tracking-[0.5em]` | 0.5em | Eyebrow del hero, único |
| `tracking-[0.2em]` / `[0.18em]` | | Variantes puntuales |

El tracking es lo que convierte Inter — una sans neutra de UI — en una tipografía de marca.
Sin él, el sitio se vería como un dashboard. Con él, se lee como identidad.

**Regla 3 — peso ligero para lo grande, peso medio para lo chico.** Contraintuitivo pero
consistente: H1 a 72px va en peso 300; un CTA a 12px va en peso 500. El tamaño provee el
énfasis en los títulos, así que el peso puede retroceder. En texto chico el peso tiene que
compensar. `font-light` aparece 1100 veces, `font-medium` 891.

## 12. Espaciado, retícula y contenedor

### Contenedor

```
max-width : 1280px   (max-w-7xl)
padding-x : 24px     (px-6)
margin    : 0 auto   (mx-auto)
```
Verificado: en viewport de 1440px, el ancho computado del contenedor es exactamente **1280px**,
con padding izquierdo de **24px**. Contenido útil: 1232px.

`max-w-7xl` aparece **280 veces** en el corpus. Es el contenedor universal — no hay excepción
en la generación 2026.

### Ritmo vertical de sección

| Medida | Valor computado | Clase |
|---|---|---|
| Padding vertical de sección | **96px arriba / 96px abajo** | `py-24` |
| Padding vertical de footer | **64px / 64px** | `py-16` |
| Margen bajo el encabezado de sección | 64px | `mb-16` |
| Margen entre eyebrow y H2 | 8px | `mb-2` |
| Altura de la nav | **80px** (81px con borde) | `h-20` |
| Padding-top del hero | 80px (compensa la nav fija) | `pt-20` |
| Altura mínima del hero | 100vh | `min-h-screen` |

El ritmo es: **96 / 64 / 8**. Sección respira 96, encabezado se separa 64 del contenido,
eyebrow se pega 8 al título.

### Retículas medidas (a 1440px de viewport)

| Contexto | Clases | Columnas computadas | Gap |
|---|---|---|---|
| Tarjetas de comunidad | `grid-cols-1 md:grid-cols-3 gap-8` | `389.33px × 3` | **32px** |
| Tarjetas de estrena | `grid-cols-1 md:grid-cols-3 gap-8` | `389.33px × 3` | **32px** |
| Tarjetas de soluciones | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6` | `290px × 4` | **24px** |
| Split de servicio | `grid-cols-1 lg:grid-cols-2 gap-16` | `584px × 2` | **64px** |
| Footer | `grid-cols-1 md:grid-cols-4 gap-10` | `278px × 4` | **40px** |

**Regla observada:** a más columnas, menor gap. 2 col → 64px, 3 col → 32px, 4 col → 24-40px.

### Padding de componente

| Componente | Padding computado |
|---|---|
| Tarjeta | **24px** en los cuatro lados (`p-6`) |
| Botón primario / secundario del hero | **16px vertical / 32px horizontal** (`px-8 py-4`) |
| CTA de nav | **10px / 20px** (`px-5 py-2.5`) |
| Botón outline de tarjeta | **12px vertical / 0 horizontal** (`py-3`, ancho completo) |
| Input de formulario | **10px / 12px** (`px-3 py-2.5`) |

### Aspect ratios de imagen

| Ratio | Uso | Frecuencia |
|---|---|---|
| `aspect-[4/4]` | Fichas de producto | 85 |
| `aspect-[16/10]` | Tarjetas editoriales (comunidad, estrena) | 35 |
| `aspect-[16/14]` | Tarjetas de solución | 21 |
| `aspect-[4/3]` | Variante | 21 |
| `aspect-video` (16/9) | Bloque de imagen de servicio | 4 |

## 13. Bordes, radios, sombras y superficies

### Radio — la decisión más agresiva del sistema

```
border-radius: 0px
```

Verificado en **todos** los componentes medidos: nav, CTA de nav, botones del hero, tarjetas,
botones de tarjeta, inputs, footer. Todos devuelven `border-radius: 0px`.

`rounded-none` aparece **509 veces explícitamente** en el corpus — es decir, no es sólo el
default: el equipo lo escribe a propósito para anular el radio que traen los componentes de
formulario y Tailwind Preflight.

Excepciones controladas: `rounded-full` (62) en avatares/badges, `rounded-lg`/`xl`/`2xl`
(43/23/20) en páginas de sub-marca y legacy, **nunca en el sistema corporativo 2026**.

**La esquina viva es la firma del sistema.** Combinada con Cinzel y el fondo casi negro,
produce el registro "institucional y preciso" en vez de "app amigable". Un clon con `rounded-md`
en las tarjetas falla la identidad más que uno con un color ligeramente desviado.

### Bordes

| Contexto | Valor computado |
|---|---|
| Tarjeta en reposo | `1px solid rgba(255, 255, 255, 0.05)` |
| Tarjeta en hover | `1px solid rgba(255, 255, 255, 0.2)` |
| Separador de sección | `1px` superior y/o inferior en `rgba(255,255,255,0.05)` |
| CTA de nav / botón secundario | `1px solid rgba(255, 255, 255, 0.2)` |
| Botón outline de tarjeta | `1px solid rgba(255, 255, 255, 0.1)` |
| Input en reposo | `1px solid rgba(255, 255, 255, 0.1)` |
| Input en focus | `1px solid rgba(255, 255, 255, 0.4)` |

### Sombras

```
box-shadow: none
```
**En todos los componentes medidos, sin excepción.** La profundidad se construye
exclusivamente con la alternancia de fondos y los bordes de 5% de blanco. Es la decisión
coherente con un sistema casi-negro: una sombra sobre `#0b0c10` sería invisible o sucia.

### Efectos de superficie

| Efecto | Valor computado | Dónde |
|---|---|---|
| `backdrop-filter: blur(12px)` | `backdrop-blur-md` | Nav fija |
| `backdrop-filter: blur(16px)` | `backdrop-blur-lg` | Panel de menú móvil |
| `backdrop-filter: blur(8px)` | `backdrop-blur` | Botón secundario del hero |
| `opacity: 0.4` + `brightness(75%)` + `scale(1.05)` | | Imagen del hero |
| `opacity: 0.8` | | Imágenes de tarjeta editorial |
| `opacity: 0.6` + `brightness(90%)` | | Imágenes de tarjeta de campaña |
| `selection:bg-neutral-700` | | Selección de texto global |

## 14. Movimiento: duraciones, curvas y estados

### Curva única

```
cubic-bezier(0.4, 0, 0.2, 1)
```
Es `ease-in-out` de Tailwind. **Se usa en absolutamente todas las transiciones del sitio**,
incluidas las escritas a mano en el `<style>` del menú móvil. Un solo easing es una decisión de
sistema muy fuerte y muy poco común.

### Escala de duración

| Duración | Frecuencia | Uso |
|---|---|---|
| **300ms** | **599** | Duración por defecto. Hovers de botón, bordes de tarjeta, transiciones de color |
| 500ms | 119 | Escala de imagen en hover de tarjeta |
| 200ms | 52 | Micro-transiciones |
| 700ms | 5 | Escala de imagen del bloque de servicio |
| 150ms | (default TW) | `transition-colors` sin duración explícita |
| 400ms | (a mano) | Apertura/cierre del menú móvil |
| 350ms | (a mano) | Rotación de las líneas del hamburger |
| 250ms | (a mano) | Opacidad de la línea central del hamburger |

**Regla:** cuanto más grande el elemento que se mueve, más lenta la transición. Un color cambia
en 150-300ms; una imagen de 339×212px escala en 500ms; el bloque de servicio de 584px escala en
700ms.

### Estados de hover — deltas verificados

| Componente | Propiedad | Reposo → Hover | Duración |
|---|---|---|---|
| Link de nav | `color` | `#9ca3af` → `#ffffff` | 150ms |
| CTA de nav | `background` / `color` | `rgba(255,255,255,.05)` / `#f3f4f6` → `#ffffff` / `#000000` | 300ms |
| Botón primario hero | `background` | `#ffffff` → `#e5e5e5` (`neutral-200`) | 300ms |
| Botón secundario hero | `background` | `rgba(0,0,0,.4)` → `rgba(255,255,255,.1)` | 300ms |
| Tarjeta (contenedor) | `border-color` | `rgba(255,255,255,.05)` → `rgba(255,255,255,.2)` | 300ms |
| Imagen de tarjeta | `transform` | `scale(1)` → `scale(1.05)` | 500ms |
| CTA de tarjeta | `color` | `#ffffff` → `#9ca3af` (**se apaga**) | 150ms |
| Botón outline de tarjeta | `background` / `color` | transparente / `#fff` → `#ffffff` / `#000000` | 300ms |
| Link de footer | `color` | `#9ca3af` → `#ffffff` | 150ms |
| Imagen del bloque servicio | `transform` | `scale(1)` → `scale(1.05)` | 700ms |

**Detalle fino que casi nadie clonaría bien:** el hover de la tarjeta es *compuesto* — el
`group` de Tailwind dispara simultáneamente el borde del contenedor (300ms) y la escala de la
imagen (500ms). Las dos transiciones tienen duraciones distintas y arrancan juntas. Y el CTA de
tarjeta va en **dirección contraria** a todo lo demás: se oscurece en hover (`text-white` →
`hover:text-gray-400`), mientras que los links de nav y footer se aclaran. No es un error: el
CTA ya es blanco en reposo porque debe destacar dentro de la tarjeta, así que la única
dirección disponible para señalar interacción es hacia abajo.

### Animaciones de carga y scroll

**No hay ninguna.** Verificado: no hay librerías de animación (sin GSAP, sin AOS, sin Lottie),
no hay `@keyframes` fuera del menú móvil, no hay `IntersectionObserver`. El contenido se
renderiza estático. `scroll-smooth` está activo en `<html>` para el scroll por anclas.

Esto simplifica el clon enormemente y es un dato de identidad en sí mismo: la marca no
"performa", presenta.

### Micro-interacción del menú móvil (código verbatim del sitio)

```css
#mobile-menu {
    transform: translateY(-100%);
    opacity: 0;
    visibility: hidden;
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                visibility 0s linear 0.4s;
}
#mobile-menu.open {
    transform: translateY(0);
    opacity: 1;
    visibility: visible;
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                visibility 0s linear 0s;
}

.hamburger-line {
    display: block;
    width: 22px;
    height: 1.5px;
    background: currentColor;
    transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                opacity 0.25s ease;
    transform-origin: center;
}
#hamburger-btn.open .line-top    { transform: translateY(7px) rotate(45deg); }
#hamburger-btn.open .line-mid    { opacity: 0; transform: scaleX(0); }
#hamburger-btn.open .line-bottom { transform: translateY(-7px) rotate(-45deg); }

#mobile-menu a { opacity: 0; transform: translateY(8px);
                 transition: opacity 0.3s ease, transform 0.3s ease; }
#mobile-menu.open a:nth-child(1) { opacity: 1; transform: translateY(0); transition-delay: 0.12s; }
#mobile-menu.open a:nth-child(2) { opacity: 1; transform: translateY(0); transition-delay: 0.18s; }
#mobile-menu.open a:nth-child(3) { opacity: 1; transform: translateY(0); transition-delay: 0.24s; }
#mobile-menu.open a:nth-child(4) { opacity: 1; transform: translateY(0); transition-delay: 0.30s; }
#mobile-menu.open a:nth-child(5) { opacity: 1; transform: translateY(0); transition-delay: 0.36s; }
```

Tres detalles de artesanía que vale la pena señalar:
1. **`visibility` con delay asimétrico** — `0s linear 0.4s` al cerrar (espera a que termine la
   animación) y `0s linear 0s` al abrir (inmediato). Evita que el panel invisible capture
   clicks. Es un detalle que sólo se escribe cuando alguien probó y encontró el bug.
2. **Líneas de 1.5px, no 2px.** Sub-pixel deliberado, consistente con el registro de precisión.
3. **Stagger de 60ms** entre links (0.12 → 0.18 → 0.24 → 0.30 → 0.36).

---

# PARTE IV — Componentes

## 15. Inventario y especificación por componente

Todos los valores son computados a viewport 1440×900. `w`/`h` en px reales del
`getBoundingClientRect()`.

### C1 — Navegación fija

```
Contenedor : <nav> fixed top-0 left-0 w-full z-50
  w × h            1425 × 81 px   (1440 − 15px de scrollbar)
  background       rgba(11, 12, 16, 0.8)
  backdrop-filter  blur(12px)
  border-bottom    1px rgba(255, 255, 255, 0.05)
  border-radius    0px
  box-shadow       none

Inner : <div class="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
  w × h            1280 × 80 px
  padding          0px 24px
  display          flex · items-center · justify-between

Logo : <img src=".../logo-zapata-white.png" class="h-7 w-auto">
  w × h            145 × 28 px
  wrapper          <div class="flex flex-col tracking-[0.3em] text-white">
  contenido        wordmark "ZAPATA ///" en blanco

Links desktop : <div class="hidden md:flex items-center space-x-8 ...">
  separación       32px (space-x-8)
  tipografía       12px / 16px · 400 · 1.2px · uppercase
  color            #9ca3af → #ffffff en hover (150ms)
  items            Marcas · Estrena · Accesorios · Servicio

CTA : <a class="border border-white/20 bg-white/5 px-5 py-2.5 ...">
  w × h            166 × 37 px
  padding          10px 20px
  background       rgba(255, 255, 255, 0.05)
  border           1px solid rgba(255, 255, 255, 0.2)
  color            #f3f4f6
  tipografía       12px / 16px · 400 · 1.2px · uppercase
  border-radius    0px  (rounded-none explícito)
  transition       0.3s cubic-bezier(0.4, 0, 0.2, 1)
  hover            bg #ffffff · color #000000
  texto            "Cita de Servicio"

Hamburger (< md) : <button id="hamburger-btn" class="md:hidden ...">
  w × h            40 × 40 px
  gap entre líneas 5.5px
  línea            22 × 1.5px · currentColor
  color            #d1d5db → #ffffff en hover
  a11y             aria-label · aria-expanded · aria-controls
```

### C2 — Hero

```
Contenedor : <header class="relative min-h-screen flex items-center justify-center pt-20 overflow-hidden">
  min-height       100vh  (900px medido)
  padding-top      80px
  overflow         hidden

Capa de imagen : <div class="absolute inset-0 z-0">
  <img class="w-full h-full object-cover object-center opacity-40 filter brightness-75 scale-105">
  w × h            1496 × 945 px  (desborda por scale-105)
  opacity          0.4
  filter           brightness(0.75)
  transform        scale(1.05)
  src              /public/images/home/2026/header.jpeg

Capa de gradiente : <div class="absolute inset-0 bg-gradient-to-t from-[#0b0c10] via-transparent to-[#0b0c10]/50">
  w × h            1425 × 900 px
  background       linear-gradient(to top, rgb(11,12,16), rgba(0,0,0,0), rgba(11,12,16,0.5))

Contenido : <div class="relative z-10 max-w-5xl mx-auto px-6 text-center mt-12">
  max-width        1024px (max-w-5xl)  ← NOTA: no es max-w-7xl
  margin-top       48px
  text-align       center

  Eyebrow  <span class="text-xs uppercase tracking-[0.5em] text-amber-400/80 font-medium block mb-4">
    12px / 16px · 500 · letter-spacing 6px · uppercase
    color rgba(251, 191, 36, 0.8)      ← ÚNICO USO DE ÁMBAR EN LA PÁGINA
    margin-bottom 16px
    texto: "Con nuestros clientes"

  H1       <h1 class="font-serif-luxury text-4xl md:text-7xl text-white tracking-wide font-light mb-4">
    72px / 72px · 300 · letter-spacing 1.8px · Cinzel
    color #ffffff · margin-bottom 16px
    móvil: text-4xl (36px)
    texto: "MÁS DE 70 AÑOS"

  Sub      <p class="font-sans-clean text-sm md:text-base text-gray-300 tracking-[0.1em] max-w-2xl mx-auto mb-12 font-light">
    16px / 24px · 300 · letter-spacing 1.6px · Inter
    color #d1d5db · max-width 672px · margin-bottom 48px
    móvil: text-sm (14px)
    texto: "Soluciones Integrales a tus retos de movilidad."

  Botonera <div class="flex flex-col sm:flex-row justify-center items-center gap-4">
    gap 16px · columna en móvil, fila desde sm
```

### C3 — Botón primario

```
<a class="w-full sm:w-auto bg-white text-black px-8 py-4 text-xs uppercase tracking-widest font-medium hover:bg-neutral-200 transition-all duration-300">
  w × h            155 × 48 px
  padding          16px 32px
  background       #ffffff
  color            #000000
  tipografía       12px / 16px · 500 · 1.2px · uppercase · Inter
  border           none
  border-radius    0px
  box-shadow       none
  transition       all 0.3s cubic-bezier(0.4, 0, 0.2, 1)
  hover            background #e5e5e5
  responsive       w-full en móvil, w-auto desde sm
```

### C4 — Botón secundario

```
<a class="w-full sm:w-auto border border-white/20 bg-black/40 backdrop-blur px-8 py-4 text-xs uppercase tracking-widest font-medium hover:bg-white/10 transition-all duration-300">
  w × h            187 × 50 px   (2px más alto que el primario por el borde)
  padding          16px 32px
  background       rgba(0, 0, 0, 0.4)
  backdrop-filter  blur(8px)
  border           1px solid rgba(255, 255, 255, 0.2)
  color            #f3f4f6
  tipografía       12px / 16px · 500 · 1.2px · uppercase
  border-radius    0px
  hover            background rgba(255, 255, 255, 0.1)
```

### C5 — Botón outline de tarjeta (terciario)

```
<a class="block text-center border border-white/10 py-3 text-xs uppercase tracking-widest text-white hover:bg-white hover:text-black transition-colors duration-300">
  w × h            240 × 42 px   (ancho completo de la tarjeta)
  padding          12px 0px
  background       transparente
  border           1px solid rgba(255, 255, 255, 0.1)
  color            #ffffff
  tipografía       12px / 16px · 400 · 1.2px · uppercase
  hover            background #ffffff · color #000000  (300ms)
```

### C6 — Encabezado de sección

```
<div class="mb-16">                             ← margin-bottom 64px
  <span class="text-xs uppercase tracking-[0.3em] text-gray-500 block mb-2">
    12px / 16px · 400 · letter-spacing 3.6px · uppercase
    color #6b7280 · margin-bottom 8px
  <h2 class="font-serif-luxury text-3xl text-white tracking-wide font-light">
    30px / 36px · 300 · letter-spacing 0.75px · Cinzel · color #ffffff
  <p class="text-gray-400 text-xs font-light mt-2">     ← opcional
    12px · 300 · color #9ca3af · margin-top 8px
```

Variante con acción a la derecha:
```
<div class="flex justify-between items-end mb-16">
  <div> … eyebrow + h2 + p … </div>
  <a class="text-xs uppercase tracking-widest text-white hover:text-gray-400 transition-colors border-b border-white/20 pb-1">Ver todas</a>
```

### C7 — Tarjeta editorial (3 columnas)

```
Contenedor : <div class="bg-[#0b0c10] border border-white/5 p-6 flex flex-col justify-between group hover:border-white/20 transition-all duration-300">
  w × h            389 × 405 px
  background       #0b0c10   (invierte respecto a la sección #0d0e12)
  border           1px solid rgba(255, 255, 255, 0.05)
  padding          24px
  display          flex · flex-col · justify-between
  border-radius    0px
  box-shadow       none
  transition       0.3s cubic-bezier(0.4, 0, 0.2, 1)
  hover            border-color rgba(255, 255, 255, 0.2)

Wrapper de imagen : <a class="block overflow-hidden aspect-[16/10] bg-neutral-900 mb-6">
  w × h            339 × 212 px
  background       #171717   (placeholder mientras carga)
  aspect-ratio     16/10
  overflow         hidden
  margin-bottom    24px

Imagen : <img class="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-500">
  object-fit       cover
  opacity          0.8
  transition       transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)
  group-hover      scale(1.05)

H3 : <h3 class="font-serif-luxury text-xl text-white tracking-wide mb-3">
  20px / 28px · 400 · letter-spacing 0.5px · Cinzel · #ffffff · mb 12px

Párrafo : <p class="text-gray-400 text-xs leading-relaxed font-light mb-6">
  12px / 19.5px · 300 · #9ca3af · margin-bottom 24px

CTA : <a class="text-xs uppercase tracking-widest text-white hover:text-gray-400 transition-colors self-start">
  w × h            121 × 16 px
  12px / 16px · 400 · 1.2px · uppercase · #ffffff
  hover            color #9ca3af   ← SE APAGA, no se enciende
  align-self       flex-start
  contenido        texto + &rarr;
```

### C8 — Tarjeta de solución (4 columnas)

```
Contenedor : mismas propiedades que C7 pero
  w × h            290 × 492 px
  imagen           aspect-[16/14] · opacity 0.8 · sin scale en hover
  H3               20px Cinzel 400
  párrafo          12px / 19.5px · #9ca3af · mb 24px
  CTA              botón outline C5 (no link con flecha)
```

### C9 — Bloque split de servicio

```
<div class="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
  columnas         584px × 2 · gap 64px · items-center

Columna izquierda:
  eyebrow          12px · 400 · tracking 3.6px · uppercase · #9ca3af · mb 12px
  H2               <h2 class="font-serif-luxury text-3xl md:text-5xl ... leading-tight mb-8">
                   48px / 48px · 300 · Cinzel · mb 32px
  párrafo          <p class="text-gray-400 text-sm leading-relaxed mb-8 font-light">
                   14px / 22.75px · 300 · #9ca3af · mb 32px
  CTA              botón primario C3 (inline-block)

Columna derecha:
  <div class="relative group aspect-video bg-neutral-900 overflow-hidden border border-white/10">
    aspect-ratio   16/9
    border         1px solid rgba(255, 255, 255, 0.1)
    <img class="... opacity-60 transition-transform duration-700 group-hover:scale-105">
    opacity        0.6
    transition     transform 0.7s
```

### C10 — Footer

```
<footer class="bg-[#07080a] py-16 border-t border-white/5 text-xs text-gray-500">
  w × h            1425 × 414 px
  background       #07080a   ← el negro más profundo del sitio
  padding          64px 0px
  border-top       1px rgba(255, 255, 255, 0.05)
  color base       #6b7280 · 12px

Grid : <div class="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-10 mb-12 text-left">
  w × h            1280 × 188 px
  columnas         278px × 4 · gap 40px · margin-bottom 48px

Col 1 — Marca y domicilio
  <p class="font-serif-luxury tracking-widest text-white text-sm">
    14px / 20px · 400 · letter-spacing 1.4px · Cinzel · #ffffff
    texto: "CORPORACIÓN ZAPATA"
  <p class="text-[11px] leading-relaxed font-light text-gray-400">
    11px / 17.875px · 300 · #9ca3af
  espaciado columna: space-y-4 (16px)

Col 2-4 — Títulos y listas
  título  <p class="text-gray-300 uppercase tracking-widest font-medium text-[10px]">
          10px / 16px · 500 · letter-spacing 1px · uppercase · #d1d5db
  lista   <ul class="space-y-2 font-light text-gray-400 text-[11px]">
          separación 8px
  link    11px / 16px · 300 · #9ca3af → #ffffff en hover (150ms)
  espaciado columna: space-y-3 (12px)

Barra inferior : <div class="max-w-7xl mx-auto px-6 border-t border-white/5 pt-8 text-center text-gray-600 font-light">
  w × h            1280 × 49 px
  padding          32px 24px 0px
  border-top       1px rgba(255, 255, 255, 0.05)
  color            #4b5563 · 12px · 300 · centrado
  texto            "© 2026  Zapata. Todos los derechos reservados."   (doble espacio literal)
```

### C11 — Input de formulario

```
<input class="w-full bg-[#0b0c10] border border-white/10 text-white px-3 py-2.5 text-xs focus:outline-none focus:border-white/40 transition-colors rounded-none placeholder:text-gray-700">
  width            100%
  background       #0b0c10
  border           1px solid rgba(255, 255, 255, 0.1)
  color            #ffffff
  padding          10px 12px
  tipografía       12px · Inter
  border-radius    0px  (rounded-none explícito)
  focus            outline none · border-color rgba(255, 255, 255, 0.4)
  placeholder      #374151
  atributos        required · data-sanitize="alpha|numeric|email"
```

### C12 — Checkbox de privacidad

```
<input type="checkbox" required id="privacy" class="mt-0.5 bg-[#0b0c10] border-white/10 focus:ring-0 rounded-none accent-amber-400">
  accent-color     #fbbf24   ← segundo uso del ámbar en el sistema, en formularios
  border-radius    0px
  focus-ring       ninguno
```

## 16. Estados: hover, focus, open

| Estado | Implementación | Nota |
|---|---|---|
| `:hover` | Variantes `hover:` de Tailwind, siempre con `transition` explícita | Ver tabla completa en §14 |
| `group-hover` | `group` en el contenedor de tarjeta, `group-hover:scale-105` en la imagen | Compuesto: borde 300ms + imagen 500ms simultáneos |
| `:focus` | `focus:outline-none focus:border-white/40` en inputs | **Se elimina el outline nativo y se reemplaza por cambio de borde** — ver §25 |
| `.open` | Clase alternada por JS en `#mobile-menu` y `#hamburger-btn` | Ver CSS verbatim en §14 |
| `::selection` | `selection:bg-neutral-700 selection:text-white` en `<body>` | Global |
| `:disabled` | `disabled="disabled"` en el input de modelo pre-llenado | Sin estilo visual distinto |

## 17. Comportamiento responsive

**Breakpoints (defaults de Tailwind, sin personalizar):**

| Prefijo | min-width |
|---|---|
| `sm:` | 640px |
| `md:` | 768px |
| `lg:` | 1024px |
| `xl:` | 1280px |

**Transformaciones verificadas por breakpoint:**

| Elemento | < 640px | 640–767px | 768–1023px | ≥ 1024px |
|---|---|---|---|---|
| Nav | hamburger | hamburger | links + CTA | links + CTA |
| H1 hero | 36px (`text-4xl`) | 36px | 72px (`md:text-7xl`) | 72px |
| Sub hero | 14px (`text-sm`) | 14px | 16px (`md:text-base`) | 16px |
| Botonera hero | columna, `w-full` | fila, `w-auto` | fila | fila |
| Grid comunidad/estrena | 1 col | 1 col | 3 col | 3 col |
| Grid soluciones | 1 col | 2 col | 2 col | 4 col |
| Split de servicio | 1 col | 1 col | 1 col | 2 col |
| Grid de footer | 1 col | 1 col | 4 col | 4 col |
| H2 de servicio | 30px | 30px | 48px (`md:text-5xl`) | 48px |

**Observación:** el grid de soluciones salta 1 → 2 → 4 sin pasar por 3, y lo hace en `sm` y
`lg`. El grid de comunidad salta 1 → 3 directamente en `md`. No hay un patrón responsive
unificado; cada grid define el suyo. **[Es una inconsistencia real del sistema, no un error de
medición — se documenta como es.]**

**Altura de página completa medida:**

| Viewport | scrollHeight |
|---|---|
| 1440 × 900 | 4621px |
| 768 × 1024 | (ver captura de referencia) |
| 390 × 844 | (ver captura de referencia) |

---

# PARTE V — Arquitectura de información

## 18. Inventario completo de páginas

78 páginas alcanzables con HTTP 200 desde un crawl de profundidad 2 partiendo de la raíz, la
navegación, el footer y el sitemap.

### Navegación principal (4 items)
`/marcas` · `/estrena` · `/accesorios` · `/citas-de-servicio`
CTA persistente: `/citas-de-servicio`

### Corporativo
| Ruta | Generación |
|---|---|
| `/` | 2026 |
| `/quienes-somos` | 2026 |
| `/nuestra-comunidad` | legacy |
| `/directorio` | legacy |
| `/buscador` | legacy |
| `/aviso-de-privacidad` | 2026 |
| `/aviso-de-privacidad/buses` | legacy |
| `/formulario-derechos-arco` | legacy |

### Comercial
| Ruta | Generación |
|---|---|
| `/marcas` | 2026 |
| `/estrena` | 2026 |
| `/estrena/detalle/ventas/{marca}/localidad/{modelo}-{mes}-{marca}` (21 páginas) | 2026 |
| `/promociones-zapatacamiones` | 2026 |
| `/accesorios` | 2026 |
| `/automoviles-camionetas` | legacy |
| `/maquinaria-pesada` | 2026 |

### Distribuidoras
`/distribuidora-ford` · `/distribuidora-mazda` · `/distribuidora-jac` · `/distribuidora-nissan` — todas 2026

### Postventa — citas de servicio (14 páginas, todas 2026)
```
/citas-de-servicio                                        (hub)
/cita-de-servicio/ford
/cita-de-servicio/mazda
/cita-de-servicio/jac
/cita-de-servicio/lincoln
/cita-de-servicio/nissan
/cita-de-servicio/nissan/coacalco
/cita-de-servicio/nissan/ecatepec
/cita-de-servicio/nissan/zona-esmeralda
/camiones/cita-de-servicio/freightliner
/camiones/cita-de-servicio/freightliner/{aeropuerto|celaya|guadalajara|
    guadalajara-r-michel|leon|monterrey|queretaro|tampico|tlalnepantla}
/camiones/cita-de-servicio/mercedes-benz-buses
```

### Freightliner (legacy)
`/freightliner` · `/freightliner/catalogo` · `/freightliner/distribuidoras` ·
`/freightliner/unidad/{cascadia|m2-35k|114sd|fl-360}`

### Autobuses Mercedes-Benz (legacy)
`/autobuses` · `/autobuses/mercedes-benz/catalogo-de-modelos` ·
`/autobuses/mercedes-benz/cotizacion` · `/autobuses/mercedes-benz/distribuidoras` ·
`/autobuses/mercedes-benz/postventa` · `/autobuses/mercedes-benz/tecnologia/safety-bus`

### Great Dane (legacy con tokens propios)
`/greatdane` · `/greatdane/accesorios` · `/greatdane/contacto` · `/greatdane/distribuidoras`

### Otros
`/collision-center` (legacy) · `/vanes/mercedes-benz`

### Rutas de acción (POST, no páginas)
```
/save-promocion                              21 formularios
/save-cita-servicio-camiones                 11 formularios
/{marca}/confirmacion-de-cita-de-servicio     8 formularios (nissan×4, mazda, lincoln, jac, ford)
/freightliner/guardar-cotizacion              4 formularios
/guardar-cotizacion-autobuses                 1
/greatdane/contacto                           1
/guardar-datos-arco                           1
/buscador                                     1
```

### Dominios satélite
```
https://go-on.mx/                                       Autos y SUVs
https://www.zapataseminuevos.mx/                        Seminuevos
https://www.subastasv4b.com.mx/                         Subastas V4B
https://lincolnzapatazonaesmeralda.mx/                  Lincoln
https://www.mercedes-benz-zapatavanes.com.mx/           Vanes Sprinter
https://www.talentozapata.com.mx/bolsa-de-trabajo       RRHH
```

### Redes sociales
```
X/Twitter  https://twitter.com/GrupoZapataMX
Instagram  https://www.instagram.com/grupo_zapata_mx/
LinkedIn   https://mx.linkedin.com/company/zapata-camiones-s-a-de-c-v-
Facebook   https://www.facebook.com/GrupoZapata
YouTube    https://www.youtube.com/user/grupozapata
```

**Nota:** los handles son inconsistentes — `GrupoZapataMX`, `grupo_zapata_mx`, `GrupoZapata`,
`grupozapata`, y en LinkedIn la razón social `zapata-camiones-s-a-de-c-v-`. El sitio se llama
"Zapata" pero las redes dicen "Grupo Zapata". **[Es una fricción de marca real y observable.]**

## 19. Arquetipos de página

**A1 — Home** (`/`)
`nav → header(hero) → section#comunidad → section#estrena → section#soluciones → section#servicio → footer`
Único con 4 secciones temáticas y hero de 100vh.

**A2 — Landing de catálogo** (`/estrena`)
`nav → header → section#catalogo → footer`
Hero corto + grid de fichas de producto en `aspect-[4/4]`.

**A3 — Detalle de promoción** (`/estrena/detalle/...`, 21 páginas)
`nav → header → main(imagen + specs + formulario Salesforce) → footer`
El formulario lleva ~15 campos ocultos de atribución. Es el arquetipo de conversión.

**A4 — Cita de servicio** (14 páginas)
`nav → main → header → section#step1 → section#step2 → section#step3 → footer`
Flujo de tres pasos. Ver §20.

**A5 — Página de distribuidora** (`/distribuidora-{marca}`)
`nav → header → footer` con contenido en `main`. 74-81 KB — las páginas más pesadas de la
generación 2026, por listados de modelos e inventario.

**A6 — Institucional** (`/quienes-somos`)
`nav → header → section#proposito → section#stakeholders → footer`

**A7 — Legacy** (22 páginas)
Estructura Bootstrap con `.header .navbar-nav`, `.btn-theme`, DM Sans / Oswald / Space Grotesk.
Ver §21.

## 20. Flujos de usuario

### F1 — Flujo de cita de servicio (el flujo principal del sitio)

```
Entrada
  ├── Nav → "Servicio"           (persistente en las 78 páginas)
  ├── Nav → CTA "Cita de Servicio"
  └── Home → §servicio → "Agenda tu cita de servicio"
        ↓
  /citas-de-servicio  (hub, 7 destinos por marca)
        ├── Ford      → /cita-de-servicio/ford
        ├── Mazda     → /cita-de-servicio/mazda
        ├── JAC       → /cita-de-servicio/jac
        ├── Lincoln   → /cita-de-servicio/lincoln
        ├── Nissan    → /cita-de-servicio/nissan  → {coacalco|ecatepec|zona-esmeralda}
        ├── Freightliner → /camiones/cita-de-servicio/freightliner → {9 sucursales}
        └── MB Buses  → /camiones/cita-de-servicio/mercedes-benz-buses
        ↓
  Formulario de 3 pasos (H1: "Agenda tu Cita de Servicio")

  ┌─ Paso 1 • Información del vehículo ────────────────┐
  │  Marca · Modelo · Año · Agencia · Placa ·          │
  │  Servicio Mantenimiento                            │
  └────────────────────────────────────────────────────┘
  ┌─ Paso 2 • Selecciona fecha y horario ──────────────┐
  │  Calendario con navegación ◀ ▶                     │
  └────────────────────────────────────────────────────┘
  ┌─ Paso 3 • Información de contacto ─────────────────┐
  │  Nombre Completo · Teléfono Móvil ·                │
  │  Correo Electrónico ·                              │
  │  Comentarios Operativos u Observaciones            │
  └────────────────────────────────────────────────────┘
        ↓
  POST → /{marca}/confirmacion-de-cita-de-servicio
     o → /save-cita-servicio-camiones
        ↓
  reCAPTCHA v3 (interceptor global de submit)
        ↓
  Salesforce
```

**Campos verificados del formulario de cita:** `plate`, `model`, `dealer`, `input_marca`,
`input_agencia`, `notes`, `coupon`, `url_agencia`, `name`, `phone`, `email`, `_token`.

**Nota de arquitectura del flujo:** el orden es *vehículo → fecha → contacto*. Es decir, pide
los datos personales **al final**. Esto reduce fricción inicial y aumenta la tasa de
finalización, y es la decisión correcta. El paso 3 incluye "Comentarios Operativos u
Observaciones" — de nuevo el vocabulario operativo, incluso en un formulario de auto particular.

### F2 — Flujo de promoción → lead

```
Home → §estrena → "Ver catálogo"
   o   Nav → "Estrena"
        ↓
  /estrena  (catálogo de promociones vigentes)
        ↓
  /estrena/detalle/ventas/{marca}/localidad/{modelo}-{mes}-{marca}
        ↓
  Formulario de contacto sobre el modelo
     visible : first_name · last_name · phone · email · checkbox privacidad
     oculto  : ~15 campos Salesforce + UTM  (ver §23)
        ↓
  POST /save-promocion  →  reCAPTCHA v3  →  Salesforce
        ↓
  retURL: https://www.zapata.com.mx/estrena
```

### F3 — Flujo de exploración de portafolio

```
Home → §soluciones (7 tarjetas)
  ├── Autos Seminuevos      → zapataseminuevos.mx      (externo)
  ├── Camiones Freightliner → /freightliner            (interno, legacy)
  ├── Autobuses             → /autobuses               (interno, legacy)
  ├── Vanes Mercedes-Benz   → mercedes-benz-zapatavanes.com.mx (externo)
  ├── Remolques             → /greatdane               (interno, legacy)
  ├── Subastas V4B          → subastasv4b.com.mx       (externo)
  └── Autos y SUVs          → go-on.mx                 (externo)
```

**Observación de UX:** 4 de 7 tarjetas de la sección principal de portafolio llevan a dominios
externos, y las 3 internas llevan a páginas legacy. El usuario que explora el portafolio desde
el home **sale del sistema de diseño 2026 en el primer click, siempre**. Es la fricción de
identidad más importante del sitio.

## 21. Las dos generaciones de diseño

Este es el hallazgo estructural más relevante para cualquiera que trabaje sobre este sitio.

| | Generación 2026 | Legacy |
|---|---|---|
| **Páginas** | 56 | 22 |
| **Detección** | contiene `.font-serif-luxury` | no la contiene |
| **Tipografía** | Cinzel + Inter | DM Sans / Oswald / Space Grotesk / Montserrat / Work Sans |
| **CSS** | Tailwind CDN + `<style>` inline | Plantilla tipo Bootstrap (`.header .navbar-nav`, `.btn-theme`, `.bg-theme-color-2`) |
| **Paleta** | `#0b0c10` / `#0d0e12` / `#07080a` + ámbar | `#000`, `#c5c5c5`, `#8d8b86`, `#00a1eb`, `#FFA500` |
| **Radio** | 0px | variable |
| **Nav** | fija, blur, hamburger custom | navbar de plantilla |
| **Tags** | GTM + GA4 | GTM + GA4 + UA + Meta Pixel + TikTok + Clarity |

**Páginas legacy (22):**
```
/autobuses                          /freightliner
/autobuses/mercedes-benz/*  (4)     /freightliner/catalogo
/automoviles-camionetas             /freightliner/unidad/*  (4)
/aviso-de-privacidad/buses          /greatdane
/buscador                           /greatdane/accesorios
/collision-center                   /greatdane/contacto
/directorio                         /greatdane/distribuidoras
/formulario-derechos-arco           /nuestra-comunidad
```

**Interpretación.** El rediseño 2026 se ejecutó por prioridad de conversión: home, catálogos de
promoción, distribuidoras y **todo el flujo de citas de servicio** (14/14 páginas migradas). Lo
que quedó atrás son las verticales pesadas (Freightliner, Autobuses, Great Dane) y las páginas
de baja frecuencia (directorio, buscador, ARCO). Es una secuencia de migración racional. La
consecuencia es la fricción descrita en F3.

**Regla para el sistema de diseño:** *la generación 2026 es la identidad canónica.* El legacy
es deuda, no referencia. Todo lo que se construya nuevo se construye sobre 2026.

---

# PARTE VI — Infraestructura e ingeniería

## 22. Stack y hosting

### Servidor

```http
HTTP/1.1 200 OK
Server: nginx
Content-Type: text/html; charset=UTF-8
Cache-Control: no-cache, private
Content-Security-Policy: frame-ancestors 'self';
X-Frame-Options: SAMEORIGIN
Set-Cookie: XSRF-TOKEN=...; expires=+2h; path=/; secure; samesite=lax
Set-Cookie: zapata_session=...; expires=+2h; path=/; secure; httponly; samesite=lax
```

| Capa | Tecnología | Evidencia |
|---|---|---|
| Servidor web | **nginx** | header `Server: nginx` |
| Framework | **Laravel (PHP)** | cookies `XSRF-TOKEN` + `zapata_session`, `<meta name="csrf-token">`, campo `_token`, blade-style rutas |
| Sesión | 2 horas (`Max-Age=7200`) | `Set-Cookie` |
| CSS | **Tailwind CSS vía CDN** (`cdn.tailwindcss.com`) | 66 de 78 páginas |
| Iconos | **Font Awesome 6.5.1** (cdnjs) | 78 de 78 páginas |
| Tipografía | **Google Fonts** | 72 de 78 páginas |
| JS legacy | jQuery | 12 páginas |
| Anti-bot | **reCAPTCHA v3** | 57 páginas (site key `6LfkAb0rAAAAAM-tEHZyFW8QkVd3Wpa0rzuv9SQd`) |
| CRM | **Salesforce** (Web-to-Lead) | 21 formularios |
| Canonical | `www.zapata.com.mx` | `retURL`, sitemap |

### Sobre Tailwind CDN en producción

`cdn.tailwindcss.com` es el compilador JIT ejecutándose **en el navegador del usuario**. La
documentación oficial de Tailwind lo desaconseja explícitamente para producción. Implicaciones
medibles:

- El CSS se genera en cliente en cada carga → costo de CPU y riesgo de FOUC
- Dependencia de un tercero para que el sitio se vea correctamente
- Sin purga: se evalúa el árbol completo de utilidades
- Peso: ~90 KB de JS antes de que se pinte un solo estilo

**Para el clon esto es una ventaja**, no un problema: usar exactamente el mismo CDN garantiza
que las utilidades se resuelvan con los mismos valores que en el original. Cualquier
compilación local introduciría riesgo de desviación. **El clon replica el CDN.**

### Convención de assets

```
https://zapata.com.mx/public/images/...
```
El prefijo `/public/` expuesto indica que el document root de nginx apunta a la raíz del
proyecto Laravel en lugar de a `public/`. Es una desviación de la convención estándar de
Laravel. Está en `Disallow: /public/` del robots.txt, lo que sugiere conciencia del tema pero
no corrección.

Estructura de carpetas observada, con estratificación temporal visible:
```
/public/images/zapata.ico
/public/images/home/logo-zapata-white.png
/public/images/home/2026/{header,accesorios,go-on,freightliner,bus,van,cajas,suv}.jpeg
/public/images/home_content/home_nuestra_comunidad.jpg
/public/images/IMAGENES_WEB/CUADROS/{quienes-somos-zapata-2026.jpg,soluciones_zapata.jpeg}
/public/images/v2/home/subastas-v4b-v2.jpeg
/public/images/{zapata_estrena,zapata_camiones_freightliner,zapata_servicio}.jpeg
```
Cuatro convenciones distintas conviviendo (`home/2026/`, `IMAGENES_WEB/CUADROS/`, `v2/home/`,
raíz) — capas arqueológicas de rediseños sucesivos.

**Pesos de imagen sin optimizar:**

| Archivo | Peso |
|---|---|
| `quienes-somos-zapata-2026.jpg` | **1.15 MB** |
| `home_nuestra_comunidad.jpg` | 398 KB |
| `soluciones_zapata.jpeg` | 336 KB |
| `header.jpeg` (hero, above the fold) | 326 KB |
| `zapata_camiones_freightliner.jpeg` | 281 KB |
| `zapata_servicio.jpeg` | 185 KB |
| Total home | **~3.3 MB** |

Todo JPEG. Sin WebP, sin AVIF, sin `srcset`, sin `loading="lazy"`, sin `width`/`height`
declarados. El hero de 326 KB se sirve a 40% de opacidad y con `brightness(75%)` — se está
pagando ancho de banda por píxeles que se atenúan en el render.

## 23. Integración con Salesforce

**Este es el hallazgo de ingeniería más relevante para el proyecto Agentforce del repositorio.**

Los formularios de promoción postean a un endpoint interno de Laravel que reenvía a Salesforce
Web-to-Lead. La estructura de campos está completamente expuesta en el HTML del cliente.

### Organización

```
oid    = 00D8V000000jL31       ← Organization ID de Salesforce
retURL = https://www.zapata.com.mx/estrena
action = https://zapata.com.mx/save-promocion   (proxy Laravel)
```

### Mapa completo de campos personalizados

| ID de campo | Valor de ejemplo | Significado inferido |
|---|---|---|
| `00NNv0000004jGH` | `Pagina Web` | Origen del lead / canal |
| `00N8V00000Hhzyf` | `Marketing Corporativo` | Unidad de negocio / campaña |
| `00N8V00000OglCS` | `Automóvil` | Tipo de vehículo |
| `00N8V00000OhGqv` | `Mazda` | Marca |
| `00N8V00000OhEvT` | `Mazda CX-5` | Modelo |
| `00NNv000000NWQb` | `1102` | Código de sucursal / agencia |
| `00NNv000000NWOz` | *(vacío)* | Campo de 10 caracteres, sin poblar |
| `00NNv000000RHG5` | *(vacío)* | Campo de 20 caracteres, sin poblar |
| `ZPT_Comentarios__c` | — | Campo custom con prefijo propio `ZPT_` |
| `utm_source__c` | *(vacío)* | Atribución |
| `utm_medium__c` | *(vacío)* | Atribución |
| `utm_campaign__c` | *(vacío)* | Atribución |

**Dos observaciones importantes:**

1. **Hay dos prefijos de Org ID conviviendo:** `00NNv...` y `00N8V...`. Corresponden a dos
   generaciones de campos personalizados en la misma Org. Consistente con la historia de
   rediseños del sitio.

2. **Los campos `utm_*__c` llegan vacíos.** Existen tres variantes en el formulario:
   `utm_source` / `utm_medium` / `utm_campaign` (los estándar del proxy Laravel) y
   `utm_source__c` / `utm_medium__c` / `utm_campaign__c` (los de Salesforce). En la carga en
   frío que capturé, **ambos conjuntos están vacíos**. Se pueblan sólo si hay parámetros UTM en
   la URL de llegada — lo que significa que **todo tráfico directo, orgánico o de referencia
   entra a Salesforce sin atribución**. Ver §27.

### Campos de negocio en claro

```
url_promo   = https://zapata.com.mx/estrena/detalle/ventas/mazda/localidad/cx-5-febrero-mazda
modelo      = "Mazda CX-5 - Mazda"      (disabled, sólo display)
interes     = "Mazda CX-5"
folio       = " Folio"                  ← valor placeholder sin sustituir, con espacio inicial
id_marca    = 3                         (Mazda)
marca       = Mazda
url-marca   = mazda
tipo        = suv
localidad   = —
```

### Campos visibles

```
first_name  required · data-sanitize="alpha"
last_name   required · data-sanitize="alpha"
phone       required · data-sanitize="numeric"  · placeholder "(55) 0000 0000"
email       required · data-sanitize="email"    · placeholder "tu@correo.com"
privacy     checkbox required · accent-amber-400
```

El atributo `data-sanitize` es una convención propia del equipo para validación en cliente.

### Relevancia para el proyecto Agentforce

Este mapa establece que **Zapata ya tiene Salesforce como sistema de registro de leads y de
citas de servicio**, con:
- Org ID `00D8V000000jL31`
- Convención de campos custom con prefijo `ZPT_`
- Códigos numéricos de agencia/sucursal (ej. `1102`)
- Códigos numéricos de marca (`id_marca=3` → Mazda)
- Un flujo de cita de servicio que ya captura placa, modelo, agencia, fecha y contacto

Los objetos del proyecto (`Unidad_Varada__c`, `Slot_Taller__c`, `Sesion_Diagnostico__c`,
`Modelo_Sucursal__c`, `Regla_Cobertura__c`) se insertan sobre una Org que **ya tiene**
identidad de sucursal, marca y modelo modeladas. El campo `dealer` / `input_agencia` /
`00NNv000000NWQb=1102` del formulario web es, con alta probabilidad, el mismo eje por el que se
debe indexar `Modelo_Sucursal__c`. **[inferencia — verificable directo en la Org]**

## 24. Seguridad y cabeceras

### Presentes

| Cabecera / mecanismo | Valor | Evaluación |
|---|---|---|
| `Content-Security-Policy` | `frame-ancestors 'self'` | Parcial — sólo anti-clickjacking |
| `X-Frame-Options` | `SAMEORIGIN` | Correcto (redundante con lo anterior) |
| Cookie de sesión | `secure; httponly; samesite=lax` | **Correcto** |
| Cookie XSRF | `secure; samesite=lax` (sin httponly, por diseño de Laravel) | Correcto |
| CSRF | Token en `<meta>` + `_token` en cada formulario | Correcto |
| reCAPTCHA v3 | Interceptor global de `submit` | Correcto |
| HTTPS | Forzado | Correcto |

### Ausentes

| Cabecera | Impacto |
|---|---|
| `Strict-Transport-Security` | Sin HSTS — ventana para downgrade en la primera visita |
| `X-Content-Type-Options: nosniff` | Sin protección contra MIME sniffing |
| `Referrer-Policy` | Referrer completo se filtra a terceros (GTM, cdnjs, Google Fonts, TikTok) |
| `Permissions-Policy` | Sin restricción de APIs del navegador |
| CSP de `script-src` / `style-src` | **La CSP sólo cubre `frame-ancestors`.** No hay control sobre orígenes de script. Con 5+ CDNs de terceros ejecutando JS, la superficie es amplia |
| SRI (`integrity`) en CDNs | Ni Tailwind, ni Font Awesome, ni Google Fonts llevan hash de integridad |

**Interceptor de reCAPTCHA — código verbatim:**
```js
document.addEventListener('submit', function(e){
  e.preventDefault();
  grecaptcha.ready(function() {
    grecaptcha.execute('6LfkAb0rAAAAAM-tEHZyFW8QkVd3Wpa0rzuv9SQd', {action: 'submit'})
      .then(function(token) {
        let form = e.target;
        let input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'g-recaptcha-response';
        input.value = token;
        form.appendChild(input);
        form.submit();
      });
  });
});
```
Es un interceptor **global** en `document`: captura todo `submit` de la página. Funciona, pero
significa que cualquier formulario nuevo queda automáticamente acoplado a reCAPTCHA, y que un
fallo de carga de `grecaptcha` bloquea **todos** los formularios de la página sin fallback.

*(El site key de reCAPTCHA, los IDs de GTM/GA/pixeles y el Org ID de Salesforce son valores
públicos por diseño: viajan en el HTML que recibe cualquier visitante. No son secretos y su
inclusión aquí no expone nada que no esté ya expuesto.)*

## 25. Deuda técnica observable

Ordenada por impacto:

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| 1 | **Sin `<meta name="description">` ni Open Graph** en la generación 2026 | Verificado en `/`, `/estrena`, `/marcas` | SEO y previsualización social. Ver §28 |
| 2 | **Tailwind CDN en producción** | 66 páginas | Rendimiento, dependencia de tercero, FOUC |
| 3 | **Imágenes sin optimizar** | 3.3 MB en el home; una de 1.15 MB | LCP, consumo de datos móviles |
| 4 | **Dos sistemas de diseño en producción** | 56 vs 22 páginas | Incoherencia de marca en el primer click (§F3) |
| 5 | **`focus:outline-none` sin reemplazo equivalente** | Todos los inputs | El borde pasa de `white/10` a `white/40`: contraste ~1.4:1. Insuficiente para navegación por teclado |
| 6 | **Sitemap desactualizado** | 22 de 29 URLs devuelven 404 | Presupuesto de rastreo desperdiciado, señales de calidad negativas |
| 7 | **Sin `loading="lazy"`, `srcset`, ni `width`/`height`** | Todas las imágenes | CLS y carga innecesaria |
| 8 | **`folio = " Folio"`** | Formularios de promoción | Placeholder sin sustituir llegando a Salesforce |
| 9 | **Cinzel 300 solicitado, no cargado** | `document.fonts` | Peso sintetizado por el navegador |
| 10 | **Sin SRI en CDNs de terceros** | Tailwind, FA, Fonts | Riesgo de cadena de suministro |
| 11 | **Document root apunta a la raíz, no a `public/`** | `/public/images/...` en todas las URLs | Desviación de convención Laravel; superficie potencialmente expuesta |
| 12 | **Handles de redes inconsistentes** | 5 variantes del nombre | Fricción de marca |
| 13 | **`robots.txt` con reglas agresivas** | `Disallow: /*1` … `/*9`, `Disallow: /*?` | Bloquea cualquier URL que contenga un dígito. **Esto potencialmente desindexa páginas legítimas** con números en la ruta |

**El #13 merece énfasis.** Las reglas
```
Disallow: /*1
Disallow: /*2
…
Disallow: /*9
```
no son "URLs que terminan en dígito" — sin `$`, `Disallow: /*1` bloquea **cualquier URL que
contenga un `1` en cualquier posición**. Eso incluye `/freightliner/unidad/114sd`,
`/freightliner/unidad/m2-35k`, `/estrena/detalle/.../cx-30-febrero-mazda`, y cualquier ruta con
un año o código. Combinado con `Disallow: /*?` (bloquea todo query string), la superficie
indexable real del sitio es mucho menor de lo que la estructura sugiere.

---

# PARTE VII — Marketing y capa de datos

## 26. Pixeles, tags e identificadores

| Plataforma | Identificador | Páginas | Generación |
|---|---|---|---|
| **Google Tag Manager** | `GTM-TX58NXQ` | **78/78** | ambas |
| **Google Analytics 4** | `G-NE1E20JTEF` | 24 | ambas |
| **Google Ads** | `AW-857619182` | (vía GTM) | — |
| **Universal Analytics** | `UA-53950733-1` | 12 | **legacy** |
| **Meta Pixel** | `662452220789361` | 6 | legacy |
| **TikTok Pixel** | `CP1SD13C77UF6DC1O7DG` | 12 | legacy |
| **Microsoft Clarity** | `k1aqafx9xn` | 6 | legacy |
| **reCAPTCHA v3** | `6LfkAb0rAAAAAM-tEHZyFW8QkVd3Wpa0rzuv9SQd` | 57 | ambas |
| **DoubleClick** | conversión `857619182` | (vía Google Ads) | — |

### El hallazgo de marketing más importante

**La generación 2026 perdió instrumentación.** Los pixeles de Meta, TikTok y Clarity, y el UA
legacy, sobreviven **sólo en las páginas viejas**. Las páginas nuevas — home, catálogos de
promoción, distribuidoras y las 14 páginas de cita de servicio — llevan únicamente GTM + GA4.

Consecuencia directa y medible:

- **Meta y TikTok no reciben eventos de las páginas de mayor intención comercial.** El
  remarketing de esas plataformas está ciego sobre el flujo de conversión completo.
- **Clarity no graba sesiones del flujo de citas de servicio**, que es exactamente el flujo
  donde más valdría ver dónde abandona la gente (es un formulario de 3 pasos).
- **UA-53950733-1 sigue disparando** en 12 páginas. Universal Analytics dejó de procesar datos
  en 2024. Son llamadas de red sin destino útil.

Esto es corregible en GTM sin tocar el sitio: los tags de Meta, TikTok y Clarity pueden
dispararse desde el contenedor `GTM-TX58NXQ` que ya está en las 78 páginas. Es probablemente el
arreglo de mayor retorno y menor esfuerzo de todo este análisis.

## 27. Modelo de atribución

### Cómo funciona hoy

```
Usuario llega a /estrena/detalle/... con ?utm_source=X&utm_medium=Y&utm_campaign=Z
    ↓
JS lee los parámetros y puebla:
    utm_source     / utm_medium     / utm_campaign        (proxy Laravel)
    utm_source__c  / utm_medium__c  / utm_campaign__c     (Salesforce)
    ↓
POST /save-promocion  →  Salesforce Lead con atribución
```

```
Usuario llega SIN parámetros UTM  (directo, orgánico, referral, marcador)
    ↓
Los seis campos quedan vacíos
    ↓
Salesforce Lead con:
    00NNv0000004jGH = "Pagina Web"          ← única señal de origen
    00N8V00000Hhzyf = "Marketing Corporativo"
```

### El problema

Todo lead que no venga de una campaña con UTM entra a Salesforce con la misma etiqueta genérica
"Pagina Web". Eso significa que en el CRM **no se puede distinguir** entre:
- un lead de búsqueda orgánica de marca,
- un lead que vino de la ficha de Google Maps de una sucursal,
- un lead que llegó desde `go-on.mx` o desde una de las páginas de sub-marca,
- un lead que tecleó el dominio directo.

Todos se ven idénticos. Y como el `retURL` apunta a `www.zapata.com.mx` mientras el sitio sirve
en `zapata.com.mx`, hay además un salto de host en el retorno post-conversión.

### Lo que sí está bien resuelto

- `url_promo` guarda la URL exacta de la promoción → se puede reconstruir qué modelo generó el lead
- `id_marca`, `marca`, `interes`, `tipo` dan segmentación de producto limpia
- El código de agencia (`00NNv000000NWQb=1102`) permite atribuir a sucursal
- El flujo de citas captura `dealer` e `input_agencia` explícitos

Es decir: **la atribución de producto y de sucursal es sólida; la atribución de canal es
prácticamente inexistente fuera de campañas pagadas.**

## 28. SEO: estado real

| Elemento | Estado |
|---|---|
| `<title>` | `"Zapata"` — **el mismo en toda la generación 2026** |
| `<meta name="description">` | **Ausente** |
| Open Graph (`og:*`) | **Ausente** |
| Twitter Card | **Ausente** |
| `<html lang="es">` | ✅ Presente |
| Canonical | ❌ Ausente |
| Datos estructurados (JSON-LD) | ❌ Ausente |
| Sitemap | Presente pero **22/29 URLs son 404** |
| robots.txt | Presente, con las reglas problemáticas de §25 #13 |
| Jerarquía de encabezados | Correcta (un H1 por página, H2/H3 anidados) |
| Texto alternativo | ✅ Todas las imágenes del home tienen `alt` descriptivo — con una excepción: `alt="logo_zapata"` (snake_case técnico en vez de texto humano) y dos `alt="Accesorios"` duplicados donde uno corresponde a "Estrena ahora" |

**Un `<title>` de "Zapata" en 56 páginas** significa que en resultados de búsqueda y en pestañas
del navegador, la página de cita de servicio de Freightliner Monterrey y el home son
indistinguibles. Combinado con la ausencia total de `meta description`, Google construye los
snippets a partir del primer texto que encuentra en la página.

La ausencia de Open Graph significa que **cualquier link compartido en WhatsApp, Facebook,
LinkedIn o Slack se previsualiza sin imagen y sin descripción.** Para un grupo automotriz cuyo
tráfico social es relevante, es una pérdida directa de CTR.

Contraste notable: el sitio invierte en un rediseño visual cuidado (Cinzel, tokens nombrados,
easing único, micro-interacciones pulidas) y simultáneamente omite los metadatos que determinan
cómo se ve ese diseño cuando alguien lo comparte. **[observación, no juicio: es un patrón común
cuando el rediseño lo ejecuta un equipo de front-end sin un checklist de SEO técnico.]**

---

# PARTE VIII — Protocolo de clonado

## 29. Estrategia de fidelidad

**Decisión: clon de máxima fidelidad usando la misma cadena de herramientas que el original.**

Razonamiento: el objetivo declarado es "clonar a la perfección, no sólo el HTML". La forma de
maximizar la fidelidad no es reimplementar en otro stack (Next.js, CSS compilado), sino
**replicar el entorno de render**. Si el original resuelve `py-24` a 96px vía el JIT de
`cdn.tailwindcss.com`, el clon debe resolverlo por el mismo camino. Cualquier compilación local
introduce riesgo de desviación por versión de Tailwind, configuración de preflight o purga.

| Aspecto | Decisión |
|---|---|
| CSS | `cdn.tailwindcss.com` — idéntico al original |
| Fuentes | Google Fonts, **misma URL exacta** (Cinzel 400,600 + Inter 300,400,500,600) — se replica la anomalía de Cinzel 300 |
| Iconos | Font Awesome 6.5.1 desde cdnjs, misma URL |
| `<style>` inline | Copiado verbatim, incluyendo el CSS del menú móvil |
| JS | Copiado verbatim (toggle del hamburger, listeners de outside-click y Escape) |
| Imágenes | Descargadas localmente y servidas desde `assets/` con rutas relativas |
| Analytics | **Eliminados.** GTM, GA4, pixeles y reCAPTCHA se retiran del clon — enviarían datos falsos a las propiedades reales de Zapata |
| Formularios | Sin `action` funcional. No se postea a endpoints reales |
| Dominio | Local (`file://` o servidor estático). **No se despliega públicamente** |

## 30. Criterios de aceptación

El clon se considera terminado cuando **todos** estos checks pasan:

**Estructura**
- [ ] Mismo orden y anidamiento de secciones: `nav → header → #comunidad → #estrena → #soluciones → #servicio → footer`
- [ ] Todo el texto verbatim, incluyendo el doble espacio en `"© 2026  Zapata."`
- [ ] Los 4 links de nav, los 5 links del menú móvil, las 7 marcas del footer, los 7 links de interés, los 5 links sociales

**Tokens computados** — medidos con `getComputedStyle()` en el clon y comparados uno a uno
- [ ] `body` background = `rgb(11, 12, 16)`
- [ ] `#comunidad` background = `rgb(13, 14, 18)`; `#estrena` = `rgb(11, 12, 16)`; `#soluciones` = `rgb(13, 14, 18)`; `#servicio` = `rgb(11, 12, 16)`
- [ ] `footer` background = `rgb(7, 8, 10)`
- [ ] `nav` background = `rgba(11, 12, 16, 0.8)`, `backdrop-filter: blur(12px)`, altura 81px
- [ ] Eyebrow del hero = `rgba(251, 191, 36, 0.8)`, `letter-spacing: 6px`, y **es el único ámbar de la página**
- [ ] H1 = `72px / 72px`, weight 300, `letter-spacing: 1.8px`, Cinzel
- [ ] H2 de sección = `30px / 36px`, weight 300, `letter-spacing: 0.75px`, Cinzel
- [ ] H3 de tarjeta = `20px / 28px`, weight 400, Cinzel
- [ ] Párrafo de tarjeta = `12px / 19.5px`, weight 300, `rgb(156, 163, 175)`
- [ ] Contenedor: `max-width: 1280px`, `padding-left: 24px`
- [ ] Secciones: `padding: 96px 0`; footer: `64px 0`
- [ ] `border-radius: 0px` en **todos** los componentes
- [ ] `box-shadow: none` en **todos** los componentes
- [ ] Bordes de tarjeta = `1px solid rgba(255, 255, 255, 0.05)`
- [ ] Grids: comunidad/estrena `389.33px × 3` gap 32px; soluciones `290px × 4` gap 24px; servicio `584px × 2` gap 64px; footer `278px × 4` gap 40px

**Movimiento**
- [ ] Todas las transiciones usan `cubic-bezier(0.4, 0, 0.2, 1)`
- [ ] Hover de tarjeta: borde `.05 → .2` en 300ms **e** imagen `scale(1.05)` en 500ms, simultáneos
- [ ] CTA de tarjeta se **oscurece** en hover (`#fff → #9ca3af`)
- [ ] Botón primario: `#fff → #e5e5e5` en 300ms
- [ ] Menú móvil: `translateY(-100%) → 0` en 400ms, con `visibility` de delay asimétrico
- [ ] Hamburger: líneas de 22×1.5px, rotación ±45° con `translateY(±7px)` en 350ms
- [ ] Stagger de links móviles: 0.12 / 0.18 / 0.24 / 0.30 / 0.36s

**Responsive**
- [ ] A 390px: hamburger visible, H1 a 36px, grids a 1 columna, botones a ancho completo
- [ ] A 768px: links de nav visibles, H1 a 72px, comunidad/estrena a 3 columnas, soluciones a 2, footer a 4
- [ ] A 1440px: layout completo, soluciones a 4 columnas, servicio a 2

**Verificación visual**
- [ ] Captura de página completa a 1440 / 768 / 390 comparada contra
      `evidencia/zapata-original-{1440,768,390}.png`
- [ ] Diferencia de altura total de documento < 1% en cada viewport
- [ ] Sin diferencias visibles en revisión sección por sección

---

## Anexo A — Manifiesto de assets

| Archivo local | Origen | Peso |
|---|---|---|
| `assets/public/images/home/logo-zapata-white.png` | wordmark "ZAPATA ///" | 3.7 KB |
| `assets/public/images/zapata.ico` | favicon | 15.7 KB |
| `assets/public/images/home/2026/header.jpeg` | hero | 326 KB |
| `assets/public/images/home_content/home_nuestra_comunidad.jpg` | tarjeta comunidad | 398 KB |
| `assets/public/images/IMAGENES_WEB/CUADROS/quienes-somos-zapata-2026.jpg` | tarjeta quiénes somos | 1.15 MB |
| `assets/public/images/IMAGENES_WEB/CUADROS/soluciones_zapata.jpeg` | tarjeta soluciones | 336 KB |
| `assets/public/images/zapata_estrena.jpeg` | tarjeta estrena | 71 KB |
| `assets/public/images/home/2026/accesorios.jpeg` | tarjeta accesorios | 90 KB |
| `assets/public/images/zapata_camiones_freightliner.jpeg` | tarjeta camiones del mes | 281 KB |
| `assets/public/images/home/2026/go-on.jpeg` | solución seminuevos | 72 KB |
| `assets/public/images/home/2026/freightliner.jpeg` | solución Freightliner | 54 KB |
| `assets/public/images/home/2026/bus.jpeg` | solución autobuses | 71 KB |
| `assets/public/images/home/2026/van.jpeg` | solución vanes | 71 KB |
| `assets/public/images/home/2026/cajas.jpeg` | solución remolques | 72 KB |
| `assets/public/images/v2/home/subastas-v4b-v2.jpeg` | solución V4B | 98 KB |
| `assets/public/images/home/2026/suv.jpeg` | solución autos y SUVs | 65 KB |
| `assets/public/images/zapata_servicio.jpeg` | bloque de servicio | 185 KB |

**Total: 17 archivos, 3.3 MB.**

## Anexo B — Estructura de este proyecto

```
reto-agentforce/identidad-zapata/
├── IDENTIDAD-ZAPATA-COMPLETA.md      ← este documento
├── recon/
│   ├── crawl.sh                       script de crawl acotado
│   ├── home.html, marcas.html, ...    descargas iniciales
│   ├── sitemap.xml
│   └── pages/                         78 páginas del crawl
├── assets/public/images/...           17 assets descargados
├── evidencia/
│   ├── zapata-original-1440.png       referencia maestra desktop
│   ├── zapata-original-768.png        referencia maestra tablet
│   └── zapata-original-390.png        referencia maestra móvil
└── clone/                             clon verificado
```

## Anexo C — Fuentes

**Investigación de método**
- [`Angelov1314/web-clone-skill`](https://github.com/Angelov1314/web-clone-skill)
- [`Varalix-Digitech-Solutions/clone-team`](https://github.com/Varalix-Digitech-Solutions/clone-team)
- [`byosamah/ok-skills`](https://github.com/byosamah/ok-skills)
- [`HossamNomad/clone-any-site`](https://github.com/HossamNomad/clone-any-site)
- [`Mood-Global-Services/How-to-Clone-Website---Claude-Skills`](https://github.com/Mood-Global-Services/How-to-Clone-Website---Claude-Skills)
- [Guía de brand kit para Claude Design (aimaker)](https://aimaker.substack.com/p/claude-design-brand-system-skill-guide)
- [Website Cloner skill (mcpmarket)](https://mcpmarket.com/tools/skills/pixel-perfect-website-cloner)
- [Clone Website skill (claudemarketplaces)](https://claudemarketplaces.com/skills/jcodesmore/ai-website-cloner-template/clone-website)

**Objeto de estudio**
- [`https://zapata.com.mx`](https://zapata.com.mx) — 78 páginas, extracción del 5 de agosto de 2026

**Contexto corporativo**
- [Zapata Camiones en LinkedIn](https://mx.linkedin.com/company/zapata-camiones-s-a-de-c-v-)
- [Motor a Diesel — Zapata Camiones Tlalnepantla y Daimler Truck](https://motoradiesel.com/dev/2025/09/zapata-camiones-tlalnepantla-un-referente-de-grupo-zapata-y-de-la-red-de-daimler-truck/)
- [Zapata Aeropuerto](https://www.zapataaeropuerto.com/)
- [Selectrucks Zapata](https://selectruckszapata.com/)
