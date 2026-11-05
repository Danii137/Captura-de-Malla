# Captar malla · Google Earth

Extensión de Chrome para **Google Earth web**. Marcas un rectángulo sobre el mapa, la extensión recorre esa zona sola con el máximo detalle disponible y guarda la malla 3D con texturas en **GLB, FBX, OBJ o STL**, en metros.

Sustituye el flujo manual de RenderDoc → `.rdc` → Blender (MapsModelsImporter) → exportar. No necesita ni RenderDoc ni Blender.

## Instalar

1. Descarga este repositorio (**Code › Download ZIP**) y descomprímelo, o clónalo.
2. En Chrome, abre `chrome://extensions` y activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y elige la carpeta `extension`.
4. Abre `earth.google.com/web`: a la izquierda aparece el panel **Captar malla**.

## Usar

1. **▭ Capturar área** → la vista se pone cenital con el norte arriba.
2. Arrastra el rectángulo. El panel da las posiciones de cámara, el tiempo y el peso estimados.
3. **Capturar**, y deja la pestaña a la vista hasta que termine.
4. Los archivos quedan en `Descargas/Captar malla/`.

Guía completa, opciones, tiempos medidos y solución de problemas: **[LEEME.md](LEEME.md)**.

## Ejemplo medido

Madrid, Plaza Mayor, 296 × 166 m con detalle máximo:
- 4 posiciones de cámara;
- unos 100 s en total;
- teselas de 9,85 m;
- GLB de 73 MB, sin errores en el validador de Khronos.

Detalle de las pruebas en [REGISTRO.md](REGISTRO.md).

## Cómo funciona

- Se engancha a la pestaña de Earth con `chrome.debugger`, como DevTools.
- Registra la geometría, las matrices y las texturas de WebGL de cada fotograma (`extension/hook.js`).
- Mueve la cámara por una cuadrícula de posiciones (`extension/lib/earth.js`).
- Encaja las posiciones entre sí y las recorta sin huecos ni repetidos (`extension/lib/decode.js`).
- Exporta con atlas de texturas (`extension/lib/exporters.js`).

Todo ocurre en el propio equipo: la extensión no envía nada a internet.

## Carpetas

| Carpeta | Contenido |
|---|---|
| `extension/` | La extensión (lo que se carga en Chrome) |
| `pruebas/` | Pruebas automáticas con un Chrome de perfil temporal (`npm install` dentro de la carpeta) |

## Condiciones de uso

**Las condiciones de servicio de Google Earth limitan copiar y reutilizar su contenido.**
- Esta herramienta está pensada como referencia de trabajo.
- Quien la use es responsable de respetar esas condiciones.
- La vía oficial de Google para usar sus modelos 3D es la API *Photorealistic 3D Tiles*.

Incluye [three.js](https://threejs.org/) (licencia MIT, `extension/lib/three.LICENSE.txt`).
