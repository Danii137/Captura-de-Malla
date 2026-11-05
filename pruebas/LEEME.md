# Pruebas automáticas de Captar malla

Usan un Chrome de pruebas con **perfil temporal**, creado en esta carpeta (`profile_*`), sin tocar el Chrome normal ni sus sesiones. La web de prueba la sirve un servidor local en `127.0.0.1:8765`.

Preparar (una vez): abrir una consola en esta carpeta y ejecutar `npm install`.

| Script | Qué comprueba | Uso |
|---|---|---|
| `run_capture.mjs` | Captura una página con `hook.js` + `lib/injector.js` por CDP, sin la extensión, y guarda `out/<nombre>_N.cmal` | `node run_capture.mjs http://127.0.0.1:8765/three.html three 4` · Google Earth: `node run_capture.mjs "https://earth.google.com/web/@40.4153,-3.7074,660a,400d,35y,0h,60t,0r" earth 25 headless dragcap` |
| `inspect.mjs` | Decodifica un `.cmal` con `lib/decode.js` y lista grupos, mallas y cajas. Con `CHECK="lat,lon"` mide la cota del terreno en ese punto | `node inspect.mjs out/earth_0.cmal` |
| `test_export.mjs` | Exporta un `.cmal` a GLB, OBJ, FBX y STL (con recorte) | `node test_export.mjs out/earth_0.cmal 200 earth200` |
| `blender_check.py` | Importa los exportados en Blender 4.4, sin ventana, y resume objetos, caras, UV, texturas y caja | `"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe" -b --factory-startup --python blender_check.py -- <archivos>` |
| `assimp_check.mjs` | Lee FBX y OBJ con Assimp (lector independiente) | `node assimp_check.mjs out/earth200.fbx` |
| `e2e.mjs` | Flujo completo con la **extensión cargada**: activar, capturar, visor, descargas | `node e2e.mjs http://127.0.0.1:8765/three.html e2e_three 3` |
| `viewer_test.mjs` | Abre un `.cmal` en el visor y saca capturas de pantalla (perspectiva, planta, girada) | `node viewer_test.mjs out/earth_0.cmal earth` |
| `popup_test.mjs` | Capturas de pantalla de la ventana del botón | `node popup_test.mjs` |
| `probe2.mjs` | Sonda para estudiar una web nueva: qué contextos WebGL usa, en qué worker y con qué shaders | `node probe2.mjs <url> nombre` |
| `make_icons.mjs` | Regenera los iconos de la extensión | `node make_icons.mjs` |
| **Versión 2 (Google Earth, áreas)** | | |
| `e2e_area.mjs` | Flujo completo con la extensión, como un usuario: panel → **Capturar área** → arrastrar rectángulo → al soltar empieza → archivos en `out/<nombre>` (con nombres de Chrome). `OCULTA=1`: cambia a otra pestaña nada más empezar. `DOS=1`: al terminar, «Capturar otra área» y repite | `node e2e_area.mjs e2e_area 300 200 1100 650 glb,stl max` |
| `capturas_readme.mjs` | Rehace las capturas de pantalla del README (panel, rectángulo, capturando, terminado, visor) sobre la Plaza Mayor, y guarda el GLB y el STL para renderizarlos con `blender_render.py` y `blender_stl_check.py`. Cierra solo el aviso «Novedades» de Earth si aparece | `node capturas_readme.mjs out/readme` |
| `stl_test.mjs` | STL para imprimir de un área: sólido cerrado (aristas, degenerados, volumen), base, tamaño en mm y peso | `node stl_test.mjs out/area/madrid [escala] [base_mm] [rejilla_mm]` |
| `blender_stl_check.py` | Abre el STL en Blender sin ventana: aristas abiertas o no manifold, normales, volumen e imágenes | `blender -b --factory-startup -P blender_stl_check.py -- <stl> <prefijo_absoluto>` |
| `area_test.mjs` | Recorrido de un área con `lib/earth.js` por CDP, sin la interfaz; guarda `.cmal` y `.json` y mide la cobertura | `node area_test.mjs 40.4153 -3.7074 300 200 max madrid` |
| `check_area.mjs` | Encaje entre posiciones (misma tesela vista desde dos sitios), atlas y GLB, como el visor | `node check_area.mjs out/area/madrid` |
| `blender_render.py` | Abre un GLB en Blender sin ventana y saca planta, perspectiva y detalle en PNG | `blender -b --factory-startup -P blender_render.py -- <glb> <prefijo_absoluto> 1600` |
| `earth_nav.mjs`, `earth_lod.mjs`, `tiles.mjs` | Experimentos: mover la cámara de Earth sin recargar; tamaño de tesela según distancia y tamaño de vista | `node earth_lod.mjs` (variables `W`, `H`, `DISTS`) |
| `coverage.mjs` | Cobertura real en planta de un área (triángulos rellenados en una rejilla de 1 m) | `node coverage.mjs out/area/madrid` |
| `idb_extract.mjs` | Saca una captura `.cmal` del almacén interno de Chrome (blob de IndexedDB comprimido con Snappy). Solo lectura | `node idb_extract.mjs <blob> <prefijo>` |
| `glb_info.mjs`, `glb_dump_images.mjs` | Resumen de un GLB (atributos, UV, materiales, caja) y extracción de sus imágenes | `node glb_info.mjs archivo.glb` |

## Resultados de referencia (4/11/2026, Chrome 156, Intel UHD 770)

| Prueba | Resultado |
|---|---|
| Cubo WebGL1 | Cubo (bytes normalizados ×4 + traslación) de (10, 0, 0) a (14, 4, 4), exacto |
| three.js | Caja, esfera y 3 instancias en su sitio relativo exacto. Modo «Grabar»: sin duplicados |
| Google Earth (Madrid) | 279–284 piezas, 263 texturas. Origen en el punto de la URL; el terreno de la Puerta del Sol a 648–658 m |
| Google Maps (satélite 2D) | Captura dentro del worker; la ortofoto sale en teselas |
| GLB | Validador de Khronos: 0 errores, 0 avisos |
| FBX, OBJ, STL | Blender 4.4 y Assimp los leen, con la misma caja que el GLB |
