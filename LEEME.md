# Captar malla 2 · Google Earth

Extensión de Chrome que funciona **solo en Google Earth web**.

1. **Marcas un rectángulo** sobre el mapa. Al soltarlo, empieza sola.
2. La extensión **recorre esa zona sola**, con el **máximo detalle** disponible. **Sigue aunque cambies de pestaña o minimices Chrome**, y te avisa al terminar.
3. **Guarda la malla 3D con texturas** en `Descargas\Captar malla\`, en metros y en el formato que elijas: **GLB, FBX u OBJ**.
   - O un **STL listo para imprimir**: sólido cerrado, con base y en milímetros a escala.

Sustituye el proceso de antes: acceso directo de Chrome trucado → RenderDoc → `.rdc` → Blender con MapsModelsImporter → exportar.

---

## 1. Instalar (una sola vez)

1. En Chrome, escribe `chrome://extensions` en la barra de direcciones.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. **Si ya la tenías cargada**, pulsa el botón de recargar (↻) de **Captar malla**.
   Si no, pulsa **Cargar descomprimida** y elige la carpeta `extension` de este proyecto.
4. Comprueba que pone **versión 2.1.0**.
5. Recarga las pestañas de Google Earth que tuvieras abiertas.

> No muevas ni borres la carpeta `extension`: Chrome la lee de ahí.

## 2. Capturar un área

1. Abre **Google Earth** (`earth.google.com/web`) y ve a la zona que quieras.
2. A la izquierda verás el panel **Captar malla**. Pulsa **▭ Capturar área**.
   - La primera vez en esa pestaña, la página se recarga para engancharse.
   - Arriba sale el aviso amarillo *«Captar malla ha empezado a depurar este navegador»*. Es normal: **no lo cierres**.
3. La vista se pone **cenital y con el norte arriba**. **Arrastra con el ratón** el rectángulo que quieras capturar. Mientras arrastras ves, junto al rectángulo:
   - su medida en metros;
   - cuántas posiciones de cámara hacen falta;
   - cuánto tardará y cuánto pesará, aproximadamente.
4. **Suelta: la captura empieza sola.**
   - Solo si el área es demasiado grande para el detalle máximo, el panel pide confirmación antes.
5. Mientras captura **puedes cambiar de pestaña, usar otro programa o minimizar Chrome**: la captura sigue igual de rápido. No cierres la pestaña de Earth.
   - Si te quedas mirando, verás que la vista se mueve y se ve más pequeña: es normal.
6. Al terminar, el panel muestra los archivos guardados en **Descargas › Captar malla**. Si no estabas mirando la pestaña, Windows muestra un aviso; al pulsarlo se abre la carpeta. En el panel tienes:
   - **▭ Capturar otra área**: vuelve directamente a marcar;
   - **Ver en 3D**: abre el visor;
   - **Abrir carpeta**;
   - **Opciones**: detalle y formatos.

### Opciones del panel

| Opción | Qué hace |
|---|---|
| **Detalle: Máximo** | Las teselas más finas que tiene Google Earth en esa zona (en Madrid, de 9,9 m, unos 4 cm por píxel de textura). |
| **Detalle: Alto** | Una tesela el doble de grande: unas 4 veces más rápido y menos pesado. |
| **Guardar GLB / FBX / OBJ / STL** | Los formatos que se guardan solos al terminar. Desde el visor puedes sacar los demás cuando quieras. |
| **STL para imprimir: escala y base** | Aparece al marcar STL. Escala 1:N (en blanco = automática, para que el lado mayor quepa en 200 mm) y grosor de la base en mm. Ver el apartado 3. |
| **Captura rápida de la vista** | Guarda solo lo que se ve en ese momento (sin recorrer el área) y abre el visor. |

### Cuánto tarda y cuánto pesa (medido en Madrid, Plaza Mayor, versión 2.1)

| Área | Detalle | Posiciones | Desde soltar el rectángulo hasta tener los archivos | Archivos |
|---|---|---|---|---|
| 297 × 166 m (5 ha), primera captura en la zona | Máximo | 4 | 66 s (GLB + STL) | GLB 77 MB · STL 23,5 MB |
| El mismo, con **Capturar otra área** (zona ya medida) | Máximo | 4 | 39 s (GLB + STL) | Igual |
| 133 × 89 m (1,2 ha) | Máximo | 1 | 32 s (GLB + STL) | GLB 17 MB · STL 22,6 MB |
| 300 × 200 m (6 ha), solo la captura | Máximo | 6 | 67 s (la 2.0.0, en las mismas condiciones: 91 s) | GLB 94 MB (2.0.0) |
| 300 × 200 m (6 ha), solo la captura (2.0.0) | Alto | 2 | 59 s | GLB 37 MB |

- Casi todo el tiempo es la descarga de Earth: en cada posición pide unas 2.000 teselas. Con una conexión más lenta, tardará más.
- La primera captura en una zona mide antes el detalle disponible (unos 12 s). Durante 30 días, las siguientes capturas a menos de 1–2 km se lo saltan.
- Las cifras aproximadas que da el panel salen de estas medidas.

Un área de 1 km² con el detalle máximo saldría de unas 77 posiciones y unos 1,5 GB. Por eso:
- por encima de 80 posiciones o de unos 800 MB por archivo, la extensión baja sola un nivel de detalle y avisa;
- para zonas grandes, usa **Alto** o divídelas.

## 3. Qué lleva el archivo

- **Unidades: metros.**
- **Origen (0, 0)**: el centro del rectángulo marcado. El visor y el GLB (`extras.georreferencia`) dan su latitud y longitud.
- **Ejes**: X = este, Y = norte, Z = altitud sobre el nivel del mar.
  - GLB y FBX van con Y arriba por norma del formato; Blender y 3ds Max lo giran solos.
  - OBJ va con Y arriba y STL con Z arriba; se cambia en el visor.
- **Altitud**: aproximada.
  - Google Earth web usa una esfera de 6.371.010 m, no el elipsoide oficial.
  - En Madrid el suelo de la Plaza Mayor sale a unos 646–650 m.
  - Si prefieres el suelo a cota 0, usa **Bajar al suelo** en el visor.
- **Texturas**: juntas en pocas imágenes grandes (atlas JPEG de 4096 px), para que el archivo tenga pocos materiales. En la Plaza Mayor fueron 18 piezas en lugar de 2.400.
- **Precisión del encaje**:
  - Earth da la posición de cada vista con un error de unos decímetros.
  - La extensión encaja las posiciones entre sí usando las teselas que comparten. En la prueba, el desfase entre posiciones quedó en 0,1 mm.
  - La posición absoluta del conjunto puede tener un error del orden de medio metro.

### STL para imprimir

La malla de Google Earth es una superficie abierta, hecha de miles de trozos sueltos: tal cual no se puede imprimir. El STL de las capturas de Earth sale convertido en un **sólido cerrado**:
- **Relieve**: en una rejilla regular, la altura más alta de cada punto, como si se mirara desde arriba.
  - Lo que hay bajo aleros, soportales y árboles sale **macizo hasta el suelo**. Así se imprime de una pieza y sin soportes.
- **Huecos sin malla**: se rellenan con la altura de alrededor.
- **Paredes rectas** en el borde del rectángulo y **base plana** por debajo del punto más bajo, con el grosor que elijas (3 mm por defecto).
- **En milímetros, a la escala elegida.**
  - En blanco, la escala es automática: la primera habitual (1:500, 1:750, 1:1000, 1:1500, 1:2000…) con la que el lado mayor cabe en 200 mm.
  - El nombre del archivo lleva la escala, por ejemplo `…_imprimir_1-1500.stl`.
- **Rejilla de 0,3 mm en la pieza impresa** (en el visor se puede poner 0,15 para impresora de resina). Nunca baja de 15 cm reales: los triángulos de Earth miden unos 43 cm de mediana (medido en Madrid), y más fino no aporta.
- **Comprobado**:
  - cada arista la comparten exactamente dos triángulos;
  - sin triángulos degenerados;
  - volumen positivo;
  - Blender lo lee como sólido cerrado (0 aristas abiertas).
- **Ejemplo**: la Plaza Mayor de Madrid, 300 × 200 m, a 1:1500, son 200 × 133 × 36 mm y 28,6 MB.

En capturas rápidas (sin rectángulo), la zona es el cuadrado del recorte. Las texturas no van en el STL.

## 4. El visor

Se abre solo, en segundo plano, al terminar una captura de área: es quien prepara y guarda los archivos. También se abre con **Ver en 3D** o con **Capturas guardadas**.

- **Guardar**: GLB, FBX, OBJ o STL, en **Descargas › Captar malla**.
- **Opciones de exportación**: nombre, escala, **Bajar al suelo**, eje vertical de OBJ y STL.
- **Capturas guardadas**:
  - cada captura queda en este ordenador, dentro de Chrome, para volver a exportarla sin repetirla;
  - **ocupan mucho** (unos 270 MB la de 6 ha): bórralas desde la lista cuando ya tengas los archivos.

## 5. Qué no hace y límites

- **Solo Google Earth web.** Ya no captura Google Maps ni otras webs.
  - La versión 1 lo intentaba, y en Maps 3D salía mal: la malla se veía negra.
- **Zonas sin 3D** (solo relieve con foto aérea): no probado.
- **Áreas muy grandes**: con más de 80 posiciones o más de unos 800 MB por archivo, la extensión baja sola el detalle y avisa.
- **No cierres la pestaña de Earth** durante la captura. Ocultarla o minimizar Chrome sí se puede.
- **La velocidad la marca Google Earth**: en cada posición Earth descarga unas 2.000 teselas, y eso es casi todo el tiempo. La extensión ya no añade esperas de más.
- **Memoria**: con el modo captura activo, la pestaña de Earth gasta más memoria. Para desactivarlo, cierra el aviso amarillo o recarga la página.

## 6. Privacidad y condiciones de uso

- Todo ocurre en tu ordenador. La extensión **no envía nada a internet**.
- El permiso «debugger» solo actúa en la pestaña de Earth donde pulsas **Capturar área**.
- El permiso «notifications» solo sirve para el aviso de «captura terminada».
- **Las condiciones de Google Earth limitan copiar y reutilizar su contenido.**
  - Úsalo como referencia de trabajo y respeta esas condiciones.
  - La vía oficial de Google para usar sus modelos 3D es la API *Photorealistic 3D Tiles*, con sus propias condiciones.

## 7. Si algo falla

| Síntoma | Qué hacer |
|---|---|
| No aparece el panel en Earth | Recarga la página (F5). Comprueba en `chrome://extensions` que la versión es la 2.0.0. |
| «El modo captura se ha desactivado» | Se cerró el aviso amarillo de Chrome. Pulsa otra vez **Capturar área**. |
| El rectángulo sale con medidas raras | Espera a que Earth termine de cargar antes de pulsar **Capturar área**. |
| Se queda «En pausa» | No debería pasar: la captura sigue aunque la pestaña esté oculta. Si pasa, vuelve a la pestaña de Earth y sigue sola. |
| No sale el aviso de Windows al terminar | Mira que las notificaciones de Chrome estén permitidas en Windows (Configuración › Sistema › Notificaciones). Solo avisa si no estabas mirando la pestaña de Earth. |
| Una posición «no dibujó» | Esa zona puede quedar con menos detalle. Repite la captura de esa parte. |
| Las capturas ocupan mucho | Bórralas en **Capturas guardadas** (visor). |

## 8. Carpetas

- `extension/` — la extensión. Es lo que se carga en Chrome.
  - `panel.js`: el panel dentro de Google Earth.
  - `lib/earth.js`: el recorrido automático del área.
  - `hook.js`: el gancho que registra la geometría.
  - `lib/decode.js`: monta las mallas en metros y encaja las posiciones.
  - `lib/exporters.js`: atlas de texturas y GLB, FBX, OBJ y STL.
  - `viewer.*`: el visor.
- `pruebas/` — las pruebas automáticas que se usaron para comprobarla.
- `REGISTRO.md` — qué se hizo, cómo se comprobó y qué queda abierto.
