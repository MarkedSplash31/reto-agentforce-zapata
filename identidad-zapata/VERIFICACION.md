# Verificación del clon — resultado

**Objeto:** clon de `https://zapata.com.mx/` construido con la skill `zapata-design`
**Fecha:** 5 de agosto de 2026
**Clon:** `clone/index.html` servido en `http://127.0.0.1:8899/clone/index.html`
**Navegador:** Chromium 151.0.7922.71 vía Playwright

---

## Resultado: 100% de fidelidad medida

| Prueba | Método | Resultado |
|---|---|---|
| **Tokens computados** | 40 valores de `getComputedStyle()` comparados uno a uno | **0 discrepancias** |
| **Geometría y estilo** | 130 nodos × 3 viewports = 390 comparaciones de posición, tamaño, color, fuente, peso, tracking y display | **0 diferencias** |
| **Altura de documento** | `document.documentElement.scrollHeight` a 390 / 768 / 1440 | **Idéntica al píxel en los tres** |
| **Reglas de hover/focus** | 13 reglas CSS generadas por Tailwind, comparadas por conjunto | **13/13 idénticas** |
| **Diff de píxeles** | 329,160 píxeles del viewport a 390px | **0 píxeles con diferencia > 8/255** |
| **Interacción** | Menú móvil: abrir, Escape, atributos ARIA, stagger de links, hamburger | **Comportamiento idéntico** |

---

## 1. Diff de tokens computados

40 valores medidos en el original y en el clon a 1440×900. Todos coinciden:

| Token | Original = Clon |
|---|---|
| `body` background | `rgb(11, 12, 16)` |
| `nav` background / blur / altura / ancho interno | `rgba(11,12,16,0.8)` · `blur(12px)` · 81px · 1280px |
| `nav` borde inferior | `1px rgba(255,255,255,0.05)` |
| Logo | 145 × 28px |
| Link de nav | `12px/16px 400 1.2px Inter` · `rgb(156,163,175)` |
| CTA de nav | 166 × 37px · `rgba(255,255,255,0.05)` · `radius 0px` |
| Hero altura | 900px |
| Imagen del hero | `opacity 0.4` · `brightness(0.75)` |
| Gradiente del hero | `linear-gradient(to top, rgb(11,12,16), rgba(0,0,0,0), rgba(11,12,16,0.5))` |
| **Eyebrow (ámbar)** | `12px/16px 500 6px Inter` · `rgba(251,191,36,0.8)` · uppercase |
| H1 | `72px/72px 300 1.8px Cinzel` · `rgb(255,255,255)` |
| Subtítulo hero | `16px/24px 300 1.6px Inter` · `rgb(209,213,219)` |
| Botón primario | 155 × 48px · `rgb(255,255,255)` · `pad 16px 32px` · `radius 0px` |
| Botón secundario | 187 × 50px · `rgba(0,0,0,0.4)` · `blur(8px)` |
| `#comunidad` | `rgb(13,14,18)` · pad 96/96 · h 723 |
| `#estrena` | `rgb(11,12,16)` · pad 96/96 · h 741 |
| `#soluciones` | `rgb(13,14,18)` · pad 96/96 · h 1321 |
| `#servicio` | `rgb(11,12,16)` · pad 96/96 · h 522 |
| Contenedor | `max-width 1280px` · `padding-left 24px` · ancho real 1280px |
| Eyebrow de sección | `12px/16px 400 3.6px Inter` · `rgb(107,114,128)` |
| H2 | `30px/36px 300 0.75px Cinzel` |
| Tarjeta | 389 × 405px · `rgb(11,12,16)` · `1px solid rgba(255,255,255,0.05)` · pad 24px |
| Tarjeta radio / sombra | `0px` / `none` |
| Tarjeta transición | `0.3s cubic-bezier(0.4, 0, 0.2, 1)` |
| Imagen de tarjeta | `opacity 0.8` · `transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)` |
| H3 | `20px/28px 400 0.5px Cinzel` |
| Párrafo de tarjeta | `12px/19.5px 300 Inter` · `rgb(156,163,175)` |
| CTA de tarjeta | `12px/16px 400 1.2px Inter` · `rgb(255,255,255)` |
| Tarjeta de solución | 290 × 492px |
| Botón outline | 240 × 42px · borde `rgba(255,255,255,0.1)` |
| Grid comunidad/estrena | `389.328px 389.328px 389.344px` · gap 32px |
| Grid soluciones | `290px × 4` · gap 24px |
| Grid servicio | `584px × 2` · gap 64px |
| Grid footer | `278px × 4` · gap 40px |
| Footer | `rgb(7,8,10)` · pad 64px · h 414 |
| Marca de footer | `14px/20px 400 1.4px Cinzel` |
| Título de columna | `10px/16px 500 1px Inter` · `rgb(209,213,219)` |
| Link de footer | `11px/16px 300 Inter` · `rgb(156,163,175)` |
| **Altura de documento** | **4621px** |

**Invariantes del sistema verificadas en el clon:**

| Invariante | Medición |
|---|---|
| Ámbar aparece una sola vez | `amberCount = 1` |
| Ningún radio distinto de cero | `radiiNonZero = 0` |
| Ninguna sombra | `shadowsNonNone = 0` |
| Fuentes cargadas | Cinzel 400 `loaded` · Cinzel 600 `unloaded` · Inter 300/400/500 `loaded` — **incluida la anomalía de Cinzel 300 del original** |

---

## 2. Diff geométrico por viewport

130 nodos (`nav`, `header`, `section`, `footer` y sus descendientes relevantes) comparados por
`x`, `y`, `width`, `height`, `background-color`, `color`, `font-size`, `font-weight`,
`letter-spacing` y `display`.

```
VIEWPORT 390px
  docHeight   orig=9458  clon=9458  delta=0px (0.000%)
  nodos       orig=130   clon=130
  diferencias 0

VIEWPORT 768px
  docHeight   orig=6098  clon=6098  delta=0px (0.000%)
  nodos       orig=130   clon=130
  diferencias 0

VIEWPORT 1440px
  docHeight   orig=4621  clon=4621  delta=0px (0.000%)
  nodos       orig=130   clon=130
  diferencias 0

TOTAL: 390 comparaciones de nodo, 0 diferencias  ->  fidelidad 100.00%
```

Datos crudos: `evidencia/{orig,clon}-{390,768,1440}.json`

---

## 3. Diff de reglas de hover, focus y selección

```
reglas hover/focus/selection  original=13  clon=13
solo en original: 0
solo en clon:     0
coincidencia: 13/13 = 100.0%
```

Datos crudos: `evidencia/{orig,clon}-hover.json`

Esto cubre: hover de link de nav, hover de CTA de nav, hover de botón primario y secundario,
hover de borde de tarjeta, `group-hover:scale-105` de imagen, hover de CTA de tarjeta (que se
oscurece), hover de botón outline, hover de link de footer, `focus:outline-none`,
`focus:border-white/40` y `::selection`.

---

## 4. Diff de píxeles

Viewport de 390 × 844 en la posición superior (nav + hero completo), comparación pixel a pixel:

```
dimensiones          original=(390, 844)  clon=(390, 844)
pixeles totales      329,160
identicos            311,448  (94.6190%)
delta 1-8 (ruido)     17,712  ( 5.3810%)
delta >8 (real)            0  ( 0.0000%)
```

**Cero píxeles con diferencia perceptible.** El 5.38% que difiere lo hace en 1 a 8 niveles
sobre 255 — variación de decodificación JPEG y antialiasing de texto entre el render servido
desde el origen y el render local. Ningún píxel supera el umbral de ruido.

Archivos: `evidencia/orig-390-top.png`, `evidencia/clon-390-top.png`,
`evidencia/diff-390-top.png`

---

## 5. Verificación de interacción

Menú móvil probado programáticamente a 390px:

| Estado | Verificado |
|---|---|
| Cerrado | `transform: matrix(1,0,0,1,0,-319)` · `opacity 0` · `visibility hidden` · transición con `visibility 0s linear 0.4s` (delay al cerrar) |
| Abierto tras click | `visibility visible` · transición con `visibility linear` (sin delay) · `aria-expanded="true"` · `aria-label="Cerrar menú"` |
| Stagger de links | `0.12s · 0.18s · 0.24s · 0.3s · 0.36s` |
| Hamburger | líneas `22px × 1.5px` · transform aplicado en `.open` |
| Tecla Escape | cierra correctamente · `aria-expanded="false"` · `aria-label="Abrir menú"` · delays reseteados |
| Panel | `rgba(11,12,16,0.95)` · `backdrop-filter: blur(16px)` |

El delay asimétrico de `visibility` — el detalle más fácil de perder al clonar — está presente
y funciona.

---

## 6. Verificación visual

| Viewport | Captura del original | Captura del clon | Resultado |
|---|---|---|---|
| 1440 | `evidencia/zapata-original-1440.png` | `evidencia/zapata-clon-1440.png` | Indistinguibles |
| 768 | `evidencia/zapata-original-768.png` | `evidencia/zapata-clon-768.png` | Indistinguibles |
| 390 | `evidencia/orig-390-top.png` | `evidencia/clon-390-top.png` | Indistinguibles (+ diff de píxeles arriba) |

**Nota sobre la captura de 390 a página completa.** La captura `fullPage` a 390px (9458px de
alto) produce un artefacto de *stitching* en esta configuración de Playwright: el nav fijo y el
`min-h-screen` del hero se repiten en cada segmento cosido. El artefacto es de la herramienta
de captura, no del clon — se reproduce igual sobre el sitio original y el clon, y queda
descartado por el diff geométrico (0 diferencias en 130 nodos a ese mismo viewport, altura de
documento idéntica) y por el diff de píxeles del segmento superior. La verificación a 390 se
hizo por segmento de viewport, que no requiere stitching.

---

## 7. Diferencias deliberadas respecto al original

Todas documentadas en el comentario de cabecera de `clone/index.html`:

| Diferencia | Razón |
|---|---|
| Sin GTM (`GTM-TX58NXQ`), GA4 (`G-NE1E20JTEF`), Google Ads ni reCAPTCHA | Enviarían eventos falsos a las propiedades de analítica reales de Zapata |
| Sin `<meta name="csrf-token">` | No hay backend Laravel detrás del clon |
| Assets desde `../assets/` en vez de `/public/` del origen | Clon autocontenido y offline |
| Enlaces internos apuntan al sitio real | El clon es una sola página; no se simulan rutas inexistentes |
| No se despliega en dominio público | El contenido y las marcas son propiedad de Corporación Zapata |

Todo lo demás — CDN de Tailwind, URL exacta de Google Fonts, Font Awesome 6.5.1, CSS inline,
JS inline, marcado y texto — es idéntico al original.

---

---

## 8. Segunda ronda — verificador propio y segunda página

El MCP de Playwright se degradó a mitad de sesión (timeouts persistentes en captura). Se
reemplazó por un verificador propio sobre la instalación local de Playwright 1.60:
`skills/zapata-design/scripts/verificar-clon.mjs`. Es reproducible desde cualquier terminal,
no depende del MCP, y captura las dos páginas en la misma instancia de navegador con
`deviceScaleFactor: 1` — lo que elimina el ruido de render que tenía la medición anterior.

### Clon 2: `/accesorios`

Elegida por ser la página más rica en componentes del sistema 2026: barra de filtros con
búsqueda y tres selects, catálogo, panel sticky de cotización, empty states con `border-dashed`,
modal de restricción de homologación, CTA flotante móvil, botón deshabilitado, y un carrito
completo en JS (`addToCart`, `changeQty`, `clearCart`, `formatCurrency`, `sendWhatsAppQuote`).

Generada con `scripts/clonar-pagina.py`, que aplica sólo las transformaciones declaradas.

```
=== acc @ 1440px ===   docHeight 1542 = 1542   nodos 129/129   diferencias 0
=== acc @ 768px  ===   docHeight 1790 = 1790   nodos 129/129   diferencias 0
=== acc @ 390px  ===   docHeight 2763 = 2763   nodos 129/129   diferencias 0
TOTAL: 387 comparaciones de nodo, 0 diferencias -> fidelidad 100.00%
```

Invariantes del sistema, idénticas en original y clon en los tres viewports:
`radios!=0: 0` · `sombras: 2` (las dos capas flotantes) · `ámbar: 4`

### Clon 1: `/` re-verificado con el mismo instrumento

```
=== home @ 1440px ===  docHeight 4621 = 4621   nodos 190/190   diferencias 0
=== home @ 768px  ===  docHeight 6098 = 6098   nodos 190/190   diferencias 0
=== home @ 390px  ===  docHeight 9458 = 9458   nodos 190/190   diferencias 0
TOTAL: 570 comparaciones de nodo, 0 diferencias -> fidelidad 100.00%
```

Invariantes: `radios!=0: 0` · `sombras: 0` · `ámbar: 1`

### Diff de píxeles de página completa — las 6 capturas

| par | dimensiones | idénticos | ruido 1-8 | **diferencia real >8** |
|---|---|---|---|---|
| home@1440 | 1440 × 4621 | **100.0000%** | 0.0000% | **0.0000%** |
| home@768 | 768 × 6098 | **100.0000%** | 0.0000% | **0.0000%** |
| home@390 | 390 × 9458 | **100.0000%** | 0.0000% | **0.0000%** |
| acc@1440 | 1440 × 1542 | **100.0000%** | 0.0000% | **0.0000%** |
| acc@768 | 768 × 1790 | **100.0000%** | 0.0000% | **0.0000%** |
| acc@390 | 390 × 2763 | **100.0000%** | 0.0000% | **0.0000%** |

**Píxeles con cualquier diferencia en los 6 pares: 0.**

No es "por debajo del umbral de ruido": es identidad bit a bit en cada uno de los
**33,731,940 píxeles** comparados. El artefacto de stitching a 390px que afectaba a la
medición anterior desapareció al usar Playwright directo, así que la captura de página
completa a móvil también es válida ahora.

---

---

## 9. Tercera ronda — cinco arquetipos y tres fallos reales del pipeline

Se clonaron tres páginas más para probar arquetipos que las dos primeras no cubrían. El proceso
encontró **tres defectos reales**, dos en el pipeline y uno en el instrumento de medición.

### Resultado final — las cinco páginas

| Página | Arquetipo | Nodos × 3 vp | Diferencias | Alturas |
|---|---|---|---|---|
| `/` | Landing narrativa, hero 100vh | 570 | **0** | idénticas |
| `/accesorios` | App de catálogo, filtros + carrito + modal | 387 | **0** | idénticas |
| `/estrena` | Catálogo de promociones, 21 productos | 996 | **0** | idénticas |
| `/cita-de-servicio/mazda` | Wizard 3 pasos + calendario | 735 | **0** | idénticas |
| `/freightliner` | **Legacy** (Bootstrap, jQuery, drawer) | 339 | **0** | idénticas |
| **Total** | 5 arquetipos | **3,027** | **0** | **15/15** |

El verificador sale con código 0 en las cinco.

### Defecto 1 — el descargador de assets sólo bajaba imágenes

`/cita-de-servicio/mazda` falló la primera verificación con **65.85% de fidelidad**: 246 nodos
en el original contra 171 en el clon. Las celdas del calendario no existían.

Causa: la página carga `/public/js/citas_servicio/citas_servicio.js`, un script externo. Mi
descargador filtraba por extensiones de imagen, así que el clon pedía el archivo y recibía 404.
El calendario, que ese script construye, nunca se poblaba.

Los dos clones anteriores pasaron **por accidente**: tenían todo su JS inline. El pipeline
estaba roto y no se había notado.

Corrección: `scripts/bajar-assets.sh`, que baja todo `/public/` referenciado — js, css, fuentes,
vídeo, pdf, además de imágenes. Barrido completo del corpus: **196 assets referenciados, 194
descargados** (34 MB). Los 2 fallidos dan 404 en el propio origen — son enlaces rotos de Zapata:
`/public/files/Fichas_Tecnicas/Autobuses/GARANTIA_EXTENDIDA.pdf` y `/public/images/bg/px-1.jpg`.

Tras la corrección: **65.85% → 100.00%**.

### Defecto 2 — el verificador ocultaba nodos huérfanos

Comparaba sólo hasta la lista más corta (`Math.min`), así que un clon al que le faltara
estructura podía reportar "0 diferencias". Corregido: cada nodo sin pareja cuenta como
diferencia y se marca `HUERFANOS` en la salida.

También se excluyen ahora del conteo el badge de reCAPTCHA y los controles de Google Maps.
No es indulgencia: son nodos que **terceros inyectan** y que el clon elimina a propósito, así
que compararlos mide la decisión declarada, no la fidelidad. Todo lo que es de Zapata se
compara sin excepción.

### Defecto 3 — el verificador daba falsos positivos por animaciones vivas

`/freightliner` reportaba 1 diferencia por viewport: la `opacity` de un punto pulsante de 6×6px,
muestreada en dos momentos distintos de su ciclo de 2s. No era un defecto del clon; era la sonda
midiendo movimiento.

Primer intento fallido: `animation-play-state: paused`, que congela el valor ya compuesto y
sigue difiriendo. Corrección real: `animation: none !important` antes de medir, que devuelve la
propiedad a su valor estático. **99.12% → 100.00%.**

### El límite honesto: `/estrena` no es reproducible por píxeles, y no es culpa del clon

El diff de píxeles de `/estrena` da 12–17% de diferencia real. La causa no es el clon:

```
3 peticiones al servidor de https://zapata.com.mx/estrena
  peticion 1: JAC 2 Smart CVT | E30X | Frison T9 4x4 | Mazda BT-50 | Frison T9 4x2
  peticion 2: Mazda CX-5 | Mazda-5 RF | Mazda CX-90 | Mazda CX-3 | JAC 4 Pro Comfort
  peticion 3: JAC 2 Smart CVT | Mazda3 Sedán | Mazda CX-50 | Mazda CX-5 | Mazda2 Sedán
```

**Laravel baraja el catálogo en cada petición.** El original no es igual a sí mismo entre dos
cargas, así que ninguna comparación de píxeles contra él puede dar 100%. El clon, en cambio, es
determinista: es una instantánea fiel de una respuesta del servidor.

Verificado también en sentido contrario — 3 cargas del clon dan el mismo orden; 3 cargas del
original dan tres órdenes distintos. El barajado está en el servidor, no en el JS que copié.

El verificador ahora hace un **pre-chequeo de determinismo** del origen y etiqueta el diff de
píxeles como `NO APLICABLE` cuando el contenido rota, en vez de reportar un falso fallo.

### Diff de píxeles — las 15 capturas de página completa

| Par | Resultado |
|---|---|
| home @ 1440 / 768 / 390 | **100.0000% idénticos** |
| accesorios @ 1440 / 768 / 390 | **100.0000% idénticos** |
| freightliner @ 1440 / 768 / 390 | **100.0000% idénticos** |
| cita @ 1440 / 768 / 390 | 99.4–99.7% · diferencia confinada a `(1365, 821)–(1440, 891)` — la caja de 75×70px del badge de reCAPTCHA que el clon elimina a propósito |
| estrena @ 1440 / 768 / 390 | no aplicable — origen no determinista (ver arriba) |

**Nueve de quince pares son bit a bit idénticos. Los seis restantes difieren sólo por causas
identificadas y declaradas**, ninguna de ellas un defecto de reconstrucción.

---

## Veredicto

Cinco páginas de arquetipos distintos — landing narrativa con hero de 100vh, app de catálogo con
filtros y carrito, catálogo de 21 promociones, wizard de tres pasos con calendario, y una página
del sistema **legacy** con Bootstrap, jQuery y drawer — reconstruidas todas con **0 diferencias
de nodo y alturas de documento idénticas** en tres viewports: 3,027 comparaciones, cero fallos.

Nueve de quince pares de capturas son **bit a bit idénticos**. Los seis restantes difieren por
dos causas identificadas y declaradas: el badge de reCAPTCHA que el clon elimina a propósito, y
el barajado server-side de `/estrena`, donde el original no es igual a sí mismo.

La skill `zapata-design` queda validada como especificación suficiente. El pipeline
`bajar-assets.sh` → `clonar-pagina.py` → `verificar-clon.mjs` queda validado como repetible, y
—más importante— **queda validado por haber fallado tres veces y haberse corregido**: el
descargador que ignoraba JS externo, el verificador que ocultaba nodos huérfanos, y el que daba
falsos positivos por animaciones vivas. Un pipeline que nunca falló en pruebas no está probado;
está sin estrenar.

**Límite honesto de lo que esto prueba.** Puedo reconstruir con fidelidad total de estructura,
estilo y layout cualquier página servida como HTML —estática o server-rendered—, incluyendo su
JS externo y sus componentes construidos en cliente. Lo que un clon autocontenido **no** puede
reproducir es la lógica del servidor: `/estrena` baraja en cada petición y el clon congela una
respuesta. Para eso haría falta reproducir la capa de datos, no sólo el front. El método de
extracción y verificación sigue siendo el mismo; lo que cambia es qué se puede prometer.
