# Captar malla 2 · Google Earth

Extensión de Chrome que funciona **solo en Google Earth web**.

1. **Marcas un rectángulo** sobre el mapa.
2. La extensión **recorre esa zona sola**, con el **máximo detalle** disponible.
3. **Guarda la malla 3D con texturas** en `Descargas\Captar malla\`, en metros y en el formato que elijas: **GLB, FBX, OBJ o STL**.

Sustituye el proceso de antes: acceso directo de Chrome trucado → RenderDoc → `.rdc` → Blender con MapsModelsImporter → exportar.

---

## 1. Instalar (una sola vez)

1. En Chrome, escribe `chrome://extensions` en la barra de direcciones.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. **Si ya tenías la versión 1 cargada**, pulsa el botón de recargar (↻) de **Captar malla**.
   Si no, pulsa **Cargar descomprimida** y elige la carpeta `extension` de este proyecto.
4. Comprueba que pone **versión 2.0.0**.

> No muevas ni borres la carpeta `extension`: Chrome la lee de ahí.

## 2. Capturar un área

1. Abre **Google Earth** (`earth.google.com/web`) y ve a la zona que quieras.
2. A la izquierda verás el panel **Captar malla**. Pulsa **▭ Capturar área**.
   - La primera vez en esa pestaña, la página se recarga para engancharse.
   - Arriba sale el aviso amarillo *«Captar malla ha empezado a depurar este navegador»*. Es normal: **no lo cierres**.
3. La vista se pone **cenital y con el norte arriba**. **Arrastra con el ratón** el rectángulo que quieras capturar. Mientras arrastras ves su medida en metros.
4. El panel te dice:
   - cuántas posiciones de cámara hacen falta;
   - cuánto tardará, aproximadamente;
   - cuánto pesará el archivo, aproximadamente.

   Pulsa **Capturar**.
5. **Deja la pestaña a la vista y no muevas el mapa** hasta que termine. La vista se moverá y cambiará de tamaño sola. Chrome pausa las pestañas ocultas: si cambias de pestaña, la captura espera a que vuelvas.
6. Al terminar, el panel muestra los archivos guardados en **Descargas › Captar malla**, con dos botones:
   - **Ver en 3D**: abre el visor;
   - **Abrir carpeta**.

### Opciones del panel

| Opción | Qué hace |
|---|---|
| **Detalle: Máximo** | Las teselas más finas que tiene Google Earth en esa zona (en Madrid, de 9,9 m, unos 4 cm por píxel de textura). |
| **Detalle: Alto** | Una tesela el doble de grande: unas 4 veces más rápido y menos pesado. |
| **Guardar GLB / FBX / OBJ / STL** | Los formatos que se guardan solos al terminar. Desde el visor puedes sacar los demás cuando quieras. |
| **Captura rápida de la vista** | Guarda solo lo que se ve en ese momento (sin recorrer el área) y abre el visor. |

### Cuánto tarda y cuánto pesa (medido en Madrid, Plaza Mayor)

| Área | Detalle | Posiciones | Tiempo | GLB |
|---|---|---|---|---|
| 300 × 200 m (6 ha) | Máximo | 6 | 70 s de captura + preparar archivos | 94 MB |
| 300 × 200 m (6 ha) | Alto | 2 | 59 s de captura + preparar archivos | 37 MB |
| 296 × 166 m (5 ha), con la extensión completa | Máximo | 4 | 60 s de captura; 103 s hasta tener GLB y FBX | GLB 73 MB · FBX 101 MB |

Las cifras aproximadas que da el panel salen de estas medidas.

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
- **No muevas el mapa ni ocultes la pestaña** durante la captura.
- **Memoria**: con el modo captura activo, la pestaña de Earth gasta más memoria. Para desactivarlo, cierra el aviso amarillo o recarga la página.

## 6. Privacidad y condiciones de uso

- Todo ocurre en tu ordenador. La extensión **no envía nada a internet**.
- El permiso «debugger» solo actúa en la pestaña de Earth donde pulsas **Capturar área**.
- **Las condiciones de Google Earth limitan copiar y reutilizar su contenido.**
  - Úsalo como referencia de trabajo y respeta esas condiciones.
  - La vía oficial de Google para usar sus modelos 3D es la API *Photorealistic 3D Tiles*, con sus propias condiciones.

## 7. Si algo falla

| Síntoma | Qué hacer |
|---|---|
| No aparece el panel en Earth | Recarga la página (F5). Comprueba en `chrome://extensions` que la versión es la 2.0.0. |
| «El modo captura se ha desactivado» | Se cerró el aviso amarillo de Chrome. Pulsa otra vez **Capturar área**. |
| El rectángulo sale con medidas raras | Espera a que Earth termine de cargar antes de pulsar **Capturar área**. |
| Se queda «En pausa» | La pestaña está oculta: vuelve a ella. |
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
