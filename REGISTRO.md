# Registro — Captar malla

## 5/11/2026 · Versión 2.0.0 — solo Google Earth, captura automática de un área

### Encargo
El usuario probó la versión 1 y «no le terminaba». Pidió:
1. que la extensión sea solo para Google Earth;
2. que el botón sea más automático: marcar un rectángulo y que capture esa área en segundo plano, con el máximo detalle, y la guarde;
3. revisar un archivo de 31 MB descargado que en los visores salía todo negro.

### El archivo negro (un GLB de 31 MB en Descargas)
- **Qué era**: no era Google Earth, sino **Google Maps en vista 3D** (cerca de Toledo), capturado en modo «Grabar 5 s».
  - Se comprobó sacando la captura original del almacén interno de Chrome, solo lectura, con `pruebas/idb_extract.mjs`.
- **Por qué salía negro**:
  - Maps 3D usa nombres de datos cifrados («F», «n»…), y la versión 1 no reconocía la posición ni las coordenadas de textura. Las piezas venían desmarcadas con el aviso «no se reconoce qué atributo es la posición», pero se marcaron y exportaron igualmente.
  - Además había un fallo del exportador: ponía la textura a piezas sin coordenadas de textura. El GLB tenía 234 texturas y ninguna `TEXCOORD_0`, y eso los visores lo pintan negro.
- **El archivo no estaba dañado**: se descargó entero, con la cabecera y la longitud correctas.
- **Corregido**:
  - el exportador ya no pone nunca textura a una pieza sin coordenadas (`noTexWithoutUV` en `lib/exporters.js`);
  - la extensión ya no se usa fuera de Google Earth.

### Lo que se encontró sobre Google Earth web (comprobado en un Chrome de pruebas, noviembre de 2026)
| Hallazgo | Cómo se comprobó |
|---|---|
| La cámara se mueve cambiando la dirección (`…/@lat,lon,Aa,Dd,35y,Hh,Tt,0r`) con `history.pushState` + `popstate`, sin recargar | Capturas de pantalla antes y después: desplazamiento de 200 m al este (`pruebas/earth_nav.mjs`) |
| Cuando ha cargado todo, Earth deja de dibujar (0 dibujos por segundo) | Contador de dibujos del gancho |
| Para que dibuje un fotograma hay que mover la vista de verdad: un giro de 2° y vuelta. El cambio de tamaño simulado no sirve | `pruebas/earth_lod.mjs`: con el giro, 5 de 5 capturas; con los otros métodos, la mayoría vacías |
| Tesela más fina en Madrid y en Toledo: **9,85 m**. No hay más detalle a 15 m de distancia | `pruebas/earth_lod.mjs` y `tiles.mjs` (tamaño de tesela sacado de `uMeshToWorldMatrix`) |
| El detalle depende de los **píxeles de la vista**, no de la densidad de píxeles de la pantalla. Con 3840×2400 px, la tesela de 9,9 m llega desde unos 200 m | Pruebas a 1400×900, 2560×1600 y 3840×2400 |
| Earth cambia su origen interno en cada posición, y pasa el centro de la Tierra en coma flotante de 32 bits: **cada posición sale desplazada 0,3–0,7 m** | La misma tesela vista desde dos posiciones: desfase medio 26–30 cm, máximo 73 cm |
| Con la vista inclinada, la dirección de Earth puede guardar `a` = altitud de la cámara y `d` = 14 m, no la distancia al suelo | Prueba de extremo a extremo: el rectángulo medía 30 veces menos. Corregido midiendo el suelo |

### Lo que se ha hecho
- **Panel dentro de Google Earth** (`panel.js`). Botón **Capturar área**:
  1. pone la vista cenital con el norte arriba;
  2. mide el suelo bajo el centro;
  3. deja dibujar el rectángulo y da medida, posiciones, tiempo y peso estimados;
  4. muestra el progreso y el resultado, con **Ver en 3D** y **Abrir carpeta**;
  5. tiene también **Captura rápida de la vista**.
- **Recorrido automático** (`lib/earth.js`):
  1. vista de conjunto para medir alturas;
  2. sondeo del detalle máximo a 200 y 100 m;
  3. cuadrícula a 20 × tesela de distancia (unos 200 m), con una vista de 3840×2400 y celdas del 80 % de la huella;
  4. un fotograma por posición, cuando Earth termina de cargar;
  5. al final se devuelven la vista y el tamaño de la página.
- **Montaje** (`lib/decode.js`, modo área):
  - **encaje entre posiciones** por mínimos cuadrados, con las teselas compartidas: de 283–302 mm a 0,1 mm;
  - cada posición se queda solo con los triángulos de su celda, así que no hay huecos ni repetidos.
- **Atlas de texturas** (`lib/exporters.js`): las texturas de las teselas (entre 900 y 2.300 por área) se juntan en atlas JPEG de 4096×4096. Salen 8–18 materiales en vez de 1.000–2.400.
- **Guardado automático** en `Descargas\Captar malla\` (`chrome.downloads`), en los formatos elegidos, con el nombre `earth_<lat>_<lon>_<ancho>x<alto>m_<fecha>`.
- El almacén de capturas guarda en trozos de 64 MB (`lib/store.js`); las capturas de la versión 1 se siguen leyendo.
- Textura con versión en el gancho (`hook.js`), porque Earth puede reutilizar texturas. Las texturas se copian en cada posición, antes de que Earth las descarte.

### Cómo se ha comprobado
| Prueba | Resultado |
|---|---|
| Madrid, Plaza Mayor, 300 × 200 m, detalle máximo (`area_test.mjs`) | 6 posiciones, 70 s. Teselas de 9,85 m. 914.000 triángulos. Cobertura del 99,8 % en celdas de 2 m. Alturas de 643 a 693 m |
| Mismo caso, GLB con atlas (`check_area.mjs`) y Blender 4.4 (`blender_render.py`) | 94 MB, 18 piezas y 18 atlas. En planta y en perspectiva: sin costuras ni huecos, con fachadas, soportales y estatua |
| **Extensión completa como un usuario** (`e2e_area.mjs`): panel → rectángulo de 296 × 166 m → Capturar | 4 posiciones, 60 s de captura, 103 s hasta tener los archivos. GLB de 72,7 MB y FBX de 100,8 MB guardados |
| GLB de esa prueba | Validador oficial de Khronos: **0 errores, 0 avisos**. 15 materiales, todos con coordenadas de textura (`TEXCOORD_0`) |
| FBX de esa prueba | Blender 4.4: 15 objetos, 828.854 triángulos, todos con UV, 15 imágenes, la misma caja que el GLB |
| Toledo, zona de la prueba del usuario, 200 × 150 m | 4 posiciones, 54 s. Teselas de 9,85 m. Cobertura del 100 %. GLB de 42 MB. Se ve bien en Blender |
| Captura rápida de la vista | 135 piezas en 9 s. El recorte de 250 m se centra en el punto mirado (antes quedaba debajo de la cámara) |
| Madrid, 300 × 200 m, detalle **Alto** | 2 posiciones, 59 s. Teselas de 19,7 m. GLB de 37 MB |
| Cobertura real en planta: triángulos rellenados sobre una rejilla de 1 m, sin contar 3 m de borde (`coverage.mjs`) | **100 %** en Madrid máximo, Madrid alto y Toledo. Antes de la franja de costura, en Alto quedaban 31 m² sueltos en la costura entre posiciones |
| Posición perdida (simulada: se quita una de las 6 de Madrid) | Su zona la cubren las vecinas; el montaje no falla |
| Cámara calculada de una captura de la versión 1 (vista inclinada 60°, 420 m) | 363 m al sur y 210 m por encima del punto mirado, como dice la dirección de Earth |

### Revisión independiente (otro agente) y correcciones
Se revisó todo el código nuevo buscando fallos que rompan la captura, dejen Earth en mal estado, den datos erróneos o pierdan archivos. Salieron 15 puntos.

**Aplicados:**
1. La sesión de captura en la página se cerraba a los 45 min aunque siguiera trabajando, y quedaba abierta si se desactivaba a mitad. Ahora caduca tras 3 min sin actividad, y al desactivar se cierra antes de soltar el depurador.
2. La captura rápida con el atajo dejaba la página bloqueada al ratón.
3. El panel se quedaba esperando si se cerraba el visor antes de guardar. «Cancelar» no hacía nada pasado el 82 %, y ahora desbloquea siempre.
4. El guardado se repetía al recargar el visor o al restaurar Chrome.
5. Si la pestaña se ocultaba justo al capturar una posición, esa celda se perdía. Ahora espera y reintenta. Si aun así falta una celda, la cubren las vecinas.
6. El OBJ de áreas medianas podía fallar por ser un texto demasiado largo. Ahora se escribe por trozos.
7. Límite por peso estimado (800 MB por archivo), además del de 80 posiciones. En el visor se libera la captura en bruto.
8. Un tiempo agotado suelto abortaba todo el recorrido. Ahora se toleran hasta 4 seguidos y se reintenta el movimiento.
9. Se comprueba que la sesión arranca de verdad, y se cierra cualquier sesión vieja.
10. El encaje entre posiciones descarta las parejas que no son la misma pieza en el mismo sitio (dispersión mayor de 5 cm o desfase mayor de 3 m).
11. Si una posición sale con menos detalle del previsto, se espera y se repite una vez; si sigue igual, se avisa.
12. El atlas ya no se frena cuando el visor está en una pestaña oculta.
13. «Ver en 3D» y «Capturas guardadas» funcionan aunque el visor esté cerrado.
14. Los uniforms se anotan solo durante el fotograma de cada posición, no durante todo el recorrido.
15. La clave de duplicados de Earth incluye la máscara de octantes.

Además, la cámara se mueve con `replaceState`, para no llenar el historial de Atrás. Si falla a medias, el guardado no deja trozos sueltos.

**No aplicado:** la espera máxima de 5 min al cerrar la sesión. Cerrar la sesión tarda segundos; solo afectaría a áreas enormes, que ya quedan fuera por el límite de peso.

### Decisiones tomadas por Claude, para revisar (versión 2)
| # | Decisión | Motivo | Cómo cambiarla |
|---|---|---|---|
| 1 | «Que solo se vea Google Earth» se ha leído como «la extensión solo funciona en Google Earth, con su panel dentro de la página» | Encaja con el resto del encargo | `manifest.json` (`content_scripts`, `host_permissions`) |
| 2 | Detalle por defecto: **Máximo**. Si salen más de 80 posiciones o más de unos 800 MB por archivo, se baja un nivel y se avisa | Tiempo y memoria razonables: más allá, Chrome se queda sin memoria | `planArea`, `maxCells` y `maxMB` en `lib/earth.js` |
| 3 | Formato por defecto: **solo GLB**. FBX, OBJ y STL se marcan en el panel | El GLB es el más fiel y el más ligero | Casillas del panel (se recuerdan) |
| 4 | Atlas JPEG de calidad 0,90 y 4096 px | Pocos materiales y peso contenido; JPEG pierde algo de calidad, pero apenas se nota | `buildAtlases` en `lib/exporters.js` |
| 5 | Origen en el centro del rectángulo; Z = altitud real | Medidas reales, como en la versión 1 | **Bajar al suelo** en el visor |
| 6 | Durante la captura la página se pone a 3840×2400 (se ve reducida) y la vista se mueve sola | Es lo que da el máximo detalle con menos posiciones | `VIEW` en `lib/earth.js` |
| 7 | Al terminar, Earth se queda en la vista cenital del área (no vuelve a la vista inclinada de antes) | Así se ve lo capturado | `topDown` / `runArea` en `lib/earth.js` |

### Abierto / sin comprobar
- Zonas de Earth **sin malla 3D** (solo relieve con foto aérea): no probadas.
- Áreas grandes (más de 30 posiciones): no probadas; el tiempo y el peso se han extrapolado.
- La posición absoluta del conjunto tiene un error del orden de medio metro: solo se corrige el encaje entre posiciones.

## 4/11/2026 · Versión 1.0.0

### Encargo
Automatizar el flujo de RenderDoc (Chrome trucado → inyectar → capturar → `.rdc` → Blender con MapsModelsImporter → exportar) con una interfaz en el navegador que capture la malla 3D que se está viendo y la descargue en GLB, FBX, STL, etc.

### Lo que se encontró en el equipo
- RenderDoc 1.22, Blender 4.4 con **MapsModelsImporter** (importa capturas de Google Maps/Earth hechas con RenderDoc), Chrome 156.
- El acceso directo de Chrome «trucado» ya no estaba en el escritorio.
- En internet (hilo #361 de MapsModelsImporter, 2025): desde Chrome 137 la inyección de RenderDoc falla a menudo y los parámetros (`--disable-direct-composition`…) cambian con cada versión.

### Lo que se ha hecho
Una extensión de Chrome (`extension/`) que **no necesita RenderDoc ni Blender**:
1. Al activar el modo captura se engancha a la pestaña con la API `chrome.debugger`, la misma que usa DevTools. Mete un pequeño script (`hook.js`) en la página, sus iframes y sus **workers** antes de que arranquen.
   - Hace falta así porque Google Maps dibuja en un worker con OffscreenCanvas, donde una extensión normal no llega.
2. Al capturar, el script registra un fotograma de WebGL:
   - la geometría (vértices e índices);
   - las matrices y los parámetros de cada dibujo;
   - las texturas, leídas de la tarjeta gráfica.
3. El visor (`viewer.html`) lo convierte en mallas con coordenadas reales:
   - deja elegir qué incluir, recortar y ocultar piezas;
   - exporta GLB, FBX (texturas incrustadas), OBJ+MTL en ZIP y STL;
   - guarda las capturas en este ordenador y permite guardarlas o abrirlas como `.cmal`.
4. **Google Earth**:
   - se reproduce lo que hace su shader: posiciones en bytes ×255, matriz `uMeshToWorldMatrix` con la columna reutilizada, máscara de octantes para no duplicar niveles de detalle, y UV con `uTexCoordScaleBias`;
   - se georreferencia en metros, con X este, Y norte y Z altitud, origen en el punto de la URL y globo esférico de R = 6.371.010 m.

### Cómo se ha comprobado (Chrome de pruebas con perfil temporal; Blender sin ventana)
| Prueba | Resultado |
|---|---|
| Escena WebGL1 de medidas conocidas | Cubo exacto: de (10, 0, 0) a (14, 4, 4) |
| Escena three.js (caja girada con textura, esfera, 3 instancias) | Posiciones relativas exactas. Textura bien orientada. Modo «Grabar 5 s» sin duplicados |
| Google Earth, Madrid | 279 piezas y 263 texturas. Terreno de la Puerta del Sol a 648–658 m (Madrid ≈ 650 m). En planta, el norte arriba y la calle Mayor al norte de la Plaza Mayor |
| Google Maps, satélite 2D | Captura dentro del worker; la ortofoto se monta en teselas. Siguió funcionando con una versión nueva del código de Maps publicada durante las pruebas |
| `<model-viewer>` de Google (visores de producto) | Astronauta completo, con texturas bien colocadas y coordenadas absolutas |
| Extensión completa | Activar → capturar → visor → 4 descargas, en three.js, Earth y Maps. Earth: 6 s en total para 57 MB |
| GLB | Validador oficial de Khronos: 0 errores, 0 avisos |
| FBX, OBJ, STL | Blender 4.4 y Assimp los leen, con texturas y la misma caja que el GLB |

### Revisión independiente (otro agente) y correcciones
Se revisaron `hook.js`, `lib/injector.js` y `background.js` buscando qué podía romper la página o dar datos erróneos. De 15 puntos:
- **Aplicados**:
  - El proceso de fondo se mantiene despierto con pestañas activas y suelta el depurador si se reinicia o si falla al activar.
  - La captura termina aunque la pestaña esté oculta.
  - Las lecturas de búferes y texturas restauran siempre el estado de la página, y no se toca una unidad de textura inválida.
  - Antes de leer texturas se vacían los errores GL pendientes.
  - Tope de 512 MB en las lecturas de WebGL2.
  - Copias de memoria ligadas al objeto, que se liberan solas.
  - Texturas DXT con `texStorage2D`.
  - Uniforms de array completos.
  - Se reintenta con más margen si no aparece WebGL.
  - La captura empieza en un fotograma completo.
  - En «Grabar 5 s», un fotograma cada 0,4 s en vez de todos (antes, 181 fotogramas repetidos en 3 s).
  - Aviso de instancias recortadas y liberación automática de capturas no recogidas.
- **No aplicados**, con el motivo:
  - Las texturas se leen al terminar el fotograma, no en cada dibujo: hacerlo en cada dibujo es muy caro. Solo afecta a texturas que cambian dentro del fotograma (vídeo, efectos).
  - Extensiones de dibujo con *base vertex/instance*: no se han visto en las webs probadas.
  - Escrituras por *transform feedback*: no se han visto.
- Todas las pruebas se repitieron después de los cambios, con el mismo resultado.

### Decisiones tomadas por Claude, para revisar
| # | Decisión | Motivo | Cómo cambiarla |
|---|---|---|---|
| 1 | Extensión con `chrome.debugger` en vez de automatizar RenderDoc | RenderDoc + Chrome reciente es inestable, y la extensión no necesita ni RenderDoc ni Blender | — |
| 2 | Google Earth en metros, ejes ENU (este, norte, altitud), origen en el punto de la URL | Medidas reales y Z arriba como en Revit y Blender | Opción «Bajar al suelo» para Z mínima = 0 |
| 3 | Recorte por defecto de 250 m en capturas georreferenciadas | Earth carga teselas hasta el horizonte | Casilla y radio en el visor |
| 4 | GLB y FBX con Y arriba; OBJ con Y arriba; STL con Z arriba | GLB/FBX por norma; OBJ como lo importa Blender; STL como CAD e impresión 3D | Selector «Eje vertical» |
| 5 | Texturas: JPEG (calidad 0,92) si son opacas, PNG si tienen transparencia | Tamaño razonable sin perder la transparencia | `hook.js`, función `encodeImage` |
| 6 | FBX con texturas incrustadas y unidad = metro | Un solo archivo, que abre bien en Blender, 3ds Max y SketchUp | `lib/exporters.js` |
| 7 | Desmarcar por defecto interfaz, cielo, carreteras vectoriales de Maps y rectángulos sueltos | Que la descarga sea solo el modelo | Casillas en *Qué incluir* |
| 8 | Capturas guardadas en Chrome (IndexedDB) hasta borrarlas | Poder volver a exportar sin repetir la captura | Botón *Borrar* en el visor |

### Abierto / sin comprobar
- **Vista 3D de Google Maps**: no se pudo probar porque no estaba disponible en el Chrome de pruebas. La captura en worker y el motor Filament sí funcionan, pero la georreferencia de Maps 3D no está comprobada.
- Páginas con **WebGPU**: no soportadas.
- Texturas BC7, ETC y ASTC: no se recuperan.
- No probado en Sketchfab ni en visores concretos de fabricantes.
