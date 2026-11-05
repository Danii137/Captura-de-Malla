// Captar malla — gancho WebGL.
// Se inyecta (vía chrome.debugger) al principio de cada página, iframe y worker de la pestaña
// en modo captura. Vigila las llamadas WebGL y, cuando se le pide, registra un fotograma:
// geometría (bytes de los atributos), índices, uniforms, bloques de uniforms y texturas.
// No interpreta nada: eso lo hace el visor (lib/decode.js).
(function () {
  'use strict';
  const G = self;
  if (G.__captarMalla) return;
  const VERSION = 1;
  const WGL1 = G.WebGLRenderingContext;
  const WGL2 = G.WebGL2RenderingContext;
  const REALM = (typeof document !== 'undefined') ? 'página' : 'worker';

  // ---------------------------------------------------------------- constantes GL
  const ARRAY_BUFFER = 0x8892, ELEMENT_ARRAY_BUFFER = 0x8893;
  const BINDING_OF = {
    0x8892: 0x8894, 0x8893: 0x8895, 0x8F36: 0x8F36, 0x8F37: 0x8F37,
    0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8C8E: 0x8C8F, 0x8A11: 0x8A28,
  };
  const COPY_READ_BUFFER = 0x8F36, BUFFER_SIZE = 0x8764;
  const CURRENT_PROGRAM = 0x8B8D;
  const VA_ENABLED = 0x8622, VA_SIZE = 0x8623, VA_STRIDE = 0x8624, VA_TYPE = 0x8625, VA_NORMALIZED = 0x886A,
    VA_BUFFER = 0x889F, VA_POINTER = 0x8645, VA_DIVISOR = 0x88FE, VA_INTEGER = 0x88FD, VA_CURRENT = 0x8626;
  const TEXTURE_2D = 0x0DE1, TEXTURE_BINDING_2D = 0x8069, ACTIVE_TEXTURE = 0x84E0, TEXTURE0 = 0x84C0;
  const FRAMEBUFFER = 0x8D40, READ_FRAMEBUFFER = 0x8CA8, DRAW_FRAMEBUFFER = 0x8CA9,
    FRAMEBUFFER_BINDING = 0x8CA6, READ_FRAMEBUFFER_BINDING = 0x8CAA, COLOR_ATTACHMENT0 = 0x8CE0, FRAMEBUFFER_COMPLETE = 0x8CD5;
  const RGBA = 0x1908, UNSIGNED_BYTE = 0x1401;
  const PACK_ALIGNMENT = 0x0D05, PACK_ROW_LENGTH = 0x0D02, PACK_SKIP_ROWS = 0x0D03, PACK_SKIP_PIXELS = 0x0D04,
    PIXEL_PACK_BUFFER = 0x88EB, PIXEL_PACK_BUFFER_BINDING = 0x88ED;
  const VIEWPORT = 0x0BA2, DEPTH_TEST = 0x0B71, BLEND = 0x0BE2, DEPTH_WRITEMASK = 0x0B72, CULL_FACE = 0x0B44;
  const ACTIVE_UNIFORMS = 0x8B86, ACTIVE_ATTRIBUTES = 0x8B89, ACTIVE_UNIFORM_BLOCKS = 0x8A36;
  const UNIFORM_BLOCK_INDEX = 0x8A3A, UNIFORM_OFFSET = 0x8A3B, UNIFORM_ARRAY_STRIDE = 0x8A3C,
    UNIFORM_MATRIX_STRIDE = 0x8A3D, UNIFORM_IS_ROW_MAJOR = 0x8A3E, UNIFORM_BLOCK_BINDING = 0x8A3F, UNIFORM_BLOCK_DATA_SIZE = 0x8A40;
  const UNIFORM_BUFFER_BINDING = 0x8A28, UNIFORM_BUFFER_START = 0x8A29, UNIFORM_BUFFER_SIZE = 0x8A2A;
  const SAMPLER_2D = 0x8B5E;
  const SAMPLER_TYPES = new Set([0x8B5E, 0x8B5F, 0x8B60, 0x8B62, 0x8DC1, 0x8DC4, 0x8DC5, 0x8DCA, 0x8DCB, 0x8DCC, 0x8DCF, 0x8DD2, 0x8DD3, 0x8DD4, 0x8DD7, 0x8D66]);
  const COMP_BYTES = { 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2 };
  const PACKED_TYPES = new Set([0x8D9F, 0x8368]);
  const INDEX_BYTES = { 0x1401: 1, 0x1403: 2, 0x1405: 4 };
  // Formatos comprimidos que el visor sabe descomprimir (S3TC / DXT1-3-5, normales y sRGB)
  const DECODABLE_COMPRESSED = new Set([0x83F0, 0x83F1, 0x83F2, 0x83F3, 0x8C4C, 0x8C4D, 0x8C4E, 0x8C4F]);
  // Formatos de textura comprimidos (S3TC, RGTC, BPTC, ETC, ASTC, PVRTC)
  function isCompressedFmt(f) {
    return (f >= 0x83F0 && f <= 0x83F3) || (f >= 0x8C4C && f <= 0x8C4F) || (f >= 0x8DBB && f <= 0x8DBE) || (f >= 0x8E8C && f <= 0x8E8F) ||
      (f >= 0x9270 && f <= 0x9279) || f === 0x8D64 || (f >= 0x93B0 && f <= 0x93BD) || (f >= 0x93D0 && f <= 0x93DD) || (f >= 0x8C00 && f <= 0x8C03);
  }
  const MAT_ATTR_COLS = { 0x8B5A: 2, 0x8B5B: 3, 0x8B5C: 4, 0x8B65: 2, 0x8B66: 2, 0x8B67: 3, 0x8B68: 3, 0x8B69: 4, 0x8B6A: 4 };

  // ---------------------------------------------------------------- utilidades
  let nextId = 1;
  const ids = new WeakMap();
  function oid(o) { if (!o) return 0; let i = ids.get(o); if (!i) { i = nextId++; ids.set(o, i); } return i; }
  const isGL2 = (gl) => !!(WGL2 && gl instanceof WGL2);

  const ctxInfo = new WeakMap();     // gl -> info
  const allCtx = [];                 // WeakRef de contextos (para estado)
  function C(gl) {
    let c = ctxInfo.get(gl);
    if (!c) {
      c = {
        id: oid(gl), gl2: isGL2(gl),
        // (WeakMap por objeto: si la página suelta un búfer o una textura, su copia se libera sola)
        shadows: new WeakMap(),      // WebGL1: búfer -> Uint8Array (copia de los datos del búfer)
        bufVer: new WeakMap(),       // búfer -> versión (cambia al escribir el búfer)
        tex: new WeakMap(),          // textura -> {w,h,ifmt,fmt,type,data}
        texVer: new WeakMap(),       // textura -> versión (cambia al volver a subir su nivel 0)
        canvas: gl.canvas ? { w: gl.canvas.width, h: gl.canvas.height } : null,
        draws: 0,
      };
      ctxInfo.set(gl, c);
      try { allCtx.push(new WeakRef(gl)); } catch (e) { }
    }
    return c;
  }
  const shaderSrc = new WeakMap();   // WebGLShader -> fuente GLSL
  const progSrc = new WeakMap();     // WebGLProgram -> {vs, fs}
  const locInfo = new WeakMap();     // WebGLUniformLocation -> {pid, name}
  const progMeta = new WeakMap();    // WebGLProgram -> metadatos (atributos, uniforms, bloques)
  const blockBindingOverride = new WeakMap(); // program -> Map(blockIndex -> binding)

  // ---------------------------------------------------------------- estado de captura
  let cap = null;                    // captura en curso
  const done = new Map();            // id -> {blob, summary}
  let totalDraws = 0;
  let lastDrawTime = 0;
  let lastActivity = 0;              // último dibujo de la página (para saber cuándo ha terminado de cargar)
  // Dibujos del globo de Google Earth (programas de las teselas 3D). Sirve para saber cuándo ha
  // terminado de cargar sin contar la interfaz: un aviso animado de Earth («Novedades») hacía que la
  // página no dejara nunca de dibujar.
  const GLOBE_MARK = 'uMeshToWorldMatrix';
  const globeProg = new WeakSet();   // programas que dibujan teselas
  let globeDraws = 0;

  function boundBuffer(gl, target) {
    const b = BINDING_OF[target];
    return b ? gl.getParameter(b) : null;
  }
  function bump(gl, buf) {
    if (!buf) return;
    const c = C(gl);
    c.bufVer.set(buf, (c.bufVer.get(buf) || 0) + 1);
  }
  // Las páginas pueden reutilizar una textura para otra imagen: la versión distingue cada contenido
  function bumpTex(gl, t) {
    if (!t) return;
    const c = C(gl);
    c.texVer.set(t, (c.texVer.get(t) || 0) + 1);
  }
  function viewBytes(data, srcOffset, length) {
    // Devuelve un Uint8Array (vista, sin copiar) de los datos que se suben
    if (data == null) return null;
    if (data instanceof ArrayBuffer || (G.SharedArrayBuffer && data instanceof SharedArrayBuffer)) {
      return new Uint8Array(data);
    }
    if (ArrayBuffer.isView(data)) {
      const bpe = data.BYTES_PER_ELEMENT || 1;
      let off = data.byteOffset, len = data.byteLength;
      if (srcOffset) { off += srcOffset * bpe; len -= srcOffset * bpe; }
      if (length) { len = Math.min(len, length * bpe); }
      if (len < 0) len = 0;
      return new Uint8Array(data.buffer, off, len);
    }
    return null;
  }

  // ---------------------------------------------------------------- envolver funciones
  function wrap(proto, name, makeWrapper) {
    const orig = proto && proto[name];
    if (typeof orig !== 'function' || orig.__cm) return;
    const w = makeWrapper(orig);
    try { Object.defineProperty(w, 'name', { value: name }); } catch (e) { }
    try { Object.defineProperty(w, 'toString', { value: () => Function.prototype.toString.call(orig) }); } catch (e) { }
    w.__cm = true;
    proto[name] = w;
  }
  function safe(fn) { try { return fn(); } catch (e) { if (cap) cap.errors.push(String(e && e.stack || e).slice(0, 300)); } }

  // ---------------------------------------------------------------- lienzos
  for (const K of [G.HTMLCanvasElement, G.OffscreenCanvas]) {
    if (!K) continue;
    wrap(K.prototype, 'getContext', (orig) => function (type) {
      const r = orig.apply(this, arguments);
      if (r && typeof type === 'string' && /webgl/i.test(type)) safe(() => C(r));
      return r;
    });
  }

  function hookContext(P) {
    if (!P) return;
    const proto = P.prototype;

    // --- shaders y programas
    wrap(proto, 'shaderSource', (orig) => function (sh, src) { safe(() => shaderSrc.set(sh, String(src))); return orig.apply(this, arguments); });
    wrap(proto, 'linkProgram', (orig) => function (p) {
      safe(() => {
        const shs = this.getAttachedShaders(p) || [];
        const srcs = shs.map((s) => shaderSrc.get(s) || '');
        progSrc.set(p, { vs: srcs.find((s) => /gl_Position/.test(s)) || '', fs: srcs.find((s) => !/gl_Position/.test(s)) || '' });
        progMeta.delete(p);
        blockBindingOverride.delete(p);
        if (srcs.some((s) => s.includes(GLOBE_MARK))) globeProg.add(p); else globeProg.delete(p);
      });
      return orig.apply(this, arguments);
    });
    wrap(proto, 'useProgram', (orig) => function (p) {
      const c = ctxInfo.get(this); if (c) c.globe = !!(p && globeProg.has(p));
      return orig.apply(this, arguments);
    });
    wrap(proto, 'getUniformLocation', (orig) => function (p, name) {
      const loc = orig.apply(this, arguments);
      if (loc) safe(() => locInfo.set(loc, { pid: oid(p), name: String(name) }));
      return loc;
    });
    wrap(proto, 'uniformBlockBinding', (orig) => function (p, idx, binding) {
      safe(() => { let m = blockBindingOverride.get(p); if (!m) { m = new Map(); blockBindingOverride.set(p, m); } m.set(idx, binding); });
      return orig.apply(this, arguments);
    });

    // --- uniforms: solo se anotan durante la captura
    const UNI = [
      ['uniform1f', 'f', 1], ['uniform2f', 'f', 2], ['uniform3f', 'f', 3], ['uniform4f', 'f', 4],
      ['uniform1i', 'i', 1], ['uniform2i', 'i', 2], ['uniform3i', 'i', 3], ['uniform4i', 'i', 4],
      ['uniform1ui', 'u', 1], ['uniform2ui', 'u', 2], ['uniform3ui', 'u', 3], ['uniform4ui', 'u', 4],
    ];
    for (const [name, kind, n] of UNI) {
      wrap(proto, name, (orig) => function (loc) {
        if (cap && !cap.stopped && (cap.recordThis || !cap.opts.manual) && loc) { const a = arguments; safe(() => recordUniform(this, loc, kind, Array.prototype.slice.call(a, 1, 1 + n))); }
        return orig.apply(this, arguments);
      });
    }
    const UNIV = [['uniform1fv', 'f'], ['uniform2fv', 'f'], ['uniform3fv', 'f'], ['uniform4fv', 'f'],
      ['uniform1iv', 'i'], ['uniform2iv', 'i'], ['uniform3iv', 'i'], ['uniform4iv', 'i'],
      ['uniform1uiv', 'u'], ['uniform2uiv', 'u'], ['uniform3uiv', 'u'], ['uniform4uiv', 'u']];
    for (const [name, kind] of UNIV) {
      wrap(proto, name, (orig) => function (loc, data, srcOffset, srcLength) {
        if (cap && !cap.stopped && (cap.recordThis || !cap.opts.manual) && loc) safe(() => recordUniform(this, loc, kind, sliceArr(data, srcOffset, srcLength)));
        return orig.apply(this, arguments);
      });
    }
    for (const name of ['uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv', 'uniformMatrix2x3fv', 'uniformMatrix2x4fv',
      'uniformMatrix3x2fv', 'uniformMatrix3x4fv', 'uniformMatrix4x2fv', 'uniformMatrix4x3fv']) {
      wrap(proto, name, (orig) => function (loc, transpose, data, srcOffset, srcLength) {
        if (cap && !cap.stopped && (cap.recordThis || !cap.opts.manual) && loc) safe(() => recordUniform(this, loc, transpose ? 'fT' : 'f', sliceArr(data, srcOffset, srcLength)));
        return orig.apply(this, arguments);
      });
    }

    // --- búferes
    wrap(proto, 'bufferData', (orig) => function (target, src, usage, srcOffset, length) {
      const r = orig.apply(this, arguments);
      safe(() => {
        const buf = boundBuffer(this, target);
        if (!buf) return;
        const c = C(this);
        if (!c.gl2) {
          let copy;
          if (typeof src === 'number') copy = new Uint8Array(src);
          else { const v = viewBytes(src, srcOffset, length); copy = v ? v.slice() : new Uint8Array(0); }
          c.shadows.set(buf, copy);
        }
        bump(this, buf);
      });
      return r;
    });
    wrap(proto, 'bufferSubData', (orig) => function (target, dstOffset, src, srcOffset, length) {
      const r = orig.apply(this, arguments);
      safe(() => {
        const buf = boundBuffer(this, target);
        if (!buf) return;
        const c = C(this);
        if (!c.gl2) {
          const v = viewBytes(src, srcOffset, length);
          if (!v) return;
          let sh = c.shadows.get(buf);
          if (!sh || sh.length < dstOffset + v.length) {
            const n = new Uint8Array(Math.max(dstOffset + v.length, sh ? sh.length : 0));
            if (sh) n.set(sh);
            sh = n;
          }
          sh.set(v, dstOffset);
          c.shadows.set(buf, sh);
        }
        bump(this, buf);
      });
      return r;
    });
    wrap(proto, 'copyBufferSubData', (orig) => function (readTarget, writeTarget) {
      const r = orig.apply(this, arguments);
      safe(() => bump(this, boundBuffer(this, writeTarget)));
      return r;
    });
    wrap(proto, 'deleteBuffer', (orig) => function (buf) {
      safe(() => { if (buf) { const c = C(this); c.shadows.delete(buf); c.bufVer.delete(buf); } });
      return orig.apply(this, arguments);
    });

    // --- texturas (tamaño y formato; los datos comprimidos se copian)
    function texTarget(gl, target) { return target === TEXTURE_2D ? gl.getParameter(TEXTURE_BINDING_2D) : null; }
    function srcSize(s) {
      if (!s) return [0, 0];
      const w = s.videoWidth || s.naturalWidth || s.displayWidth || s.codedWidth || s.width || 0;
      const h = s.videoHeight || s.naturalHeight || s.displayHeight || s.codedHeight || s.height || 0;
      return [w, h];
    }
    wrap(proto, 'texImage2D', (orig) => function (target, level, ifmt) {
      const r = orig.apply(this, arguments);
      if (level === 0) safe(() => {
        const t = texTarget(this, target); if (!t) return;
        const a = arguments; let w, h, fmt, type;
        if (a.length >= 8) { w = a[3]; h = a[4]; fmt = a[6]; type = a[7]; } else { [w, h] = srcSize(a[5]); fmt = a[3]; type = a[4]; }
        C(this).tex.set(t, { w, h, ifmt, fmt, type });
        bumpTex(this, t);
      });
      return r;
    });
    for (const name of ['texSubImage2D', 'copyTexSubImage2D']) {
      wrap(proto, name, (orig) => function (target, level) {
        const r = orig.apply(this, arguments);
        if (level === 0) safe(() => bumpTex(this, texTarget(this, target)));
        return r;
      });
    }
    wrap(proto, 'texStorage2D', (orig) => function (target, levels, ifmt, w, h) {
      const r = orig.apply(this, arguments);
      safe(() => {
        const t = texTarget(this, target); if (!t) return;
        bumpTex(this, t);
        const info = { w, h, ifmt, storage: true };
        // almacenamiento inmutable comprimido (DXT): reservar el nivel 0, que se rellena con compressedTexSubImage2D
        if (DECODABLE_COMPRESSED.has(ifmt) && w > 0 && h > 0 && w * h <= 8192 * 8192) {
          const bs = (ifmt === 0x83F0 || ifmt === 0x83F1 || ifmt === 0x8C4C || ifmt === 0x8C4D) ? 8 : 16;
          info.compressed = true; info.data = new Uint8Array(Math.ceil(w / 4) * Math.ceil(h / 4) * bs);
        } else if (isCompressedFmt(ifmt)) {
          info.compressed = true; // BC7, ETC, ASTC…: no se puede leer ni descomprimir aquí
        }
        C(this).tex.set(t, info);
      });
      return r;
    });
    wrap(proto, 'copyTexImage2D', (orig) => function (target, level, ifmt, x, y, w, h) {
      const r = orig.apply(this, arguments);
      if (level === 0) safe(() => { const t = texTarget(this, target); if (t) { C(this).tex.set(t, { w, h, ifmt }); bumpTex(this, t); } });
      return r;
    });
    wrap(proto, 'compressedTexImage2D', (orig) => function (target, level, ifmt, w, h, border, data, srcOffset, srcLen) {
      const r = orig.apply(this, arguments);
      if (level === 0) safe(() => {
        const t = texTarget(this, target); if (!t) return;
        bumpTex(this, t);
        const info = { w, h, ifmt, compressed: true };
        if (DECODABLE_COMPRESSED.has(ifmt) && data && typeof data !== 'number') {
          const v = viewBytes(data, srcOffset, srcLen);
          if (v) info.data = v.slice();
        }
        C(this).tex.set(t, info);
      });
      return r;
    });
    wrap(proto, 'deleteTexture', (orig) => function (t) {
      safe(() => { if (t) C(this).tex.delete(t); });
      return orig.apply(this, arguments);
    });
    wrap(proto, 'compressedTexSubImage2D', (orig) => function (target, level, xoff, yoff, w, h, fmt, data, srcOffset, srcLen) {
      const r = orig.apply(this, arguments);
      if (level === 0) safe(() => {
        const t = texTarget(this, target); if (!t) return;
        const info = C(this).tex.get(t);
        if (!info || !info.data || typeof data === 'number') return;
        // si una captura ya se llevó estos datos, se escribe en una copia (lo entregado no debe cambiar)
        if (info.shared) { info.data = info.data.slice(); info.shared = false; }
        bumpTex(this, t);
        const v = viewBytes(data, srcOffset, srcLen); if (!v) return;
        const bs = (fmt === 0x83F0 || fmt === 0x83F1 || fmt === 0x8C4C || fmt === 0x8C4D) ? 8 : 16;
        const bw = Math.ceil(info.w / 4), sbw = Math.ceil(w / 4), sbh = Math.ceil(h / 4);
        const bx = xoff >> 2, by = yoff >> 2;
        for (let j = 0; j < sbh; j++) {
          const dst = ((by + j) * bw + bx) * bs, src = j * sbw * bs;
          if (dst + sbw * bs <= info.data.length && src + sbw * bs <= v.length) info.data.set(v.subarray(src, src + sbw * bs), dst);
        }
      });
      return r;
    });

    // --- llamadas de dibujo
    const DRAWS = {
      drawArrays: (a) => ({ mode: a[0], first: a[1], count: a[2], inst: 0 }),
      drawElements: (a) => ({ mode: a[0], count: a[1], type: a[2], offset: a[3], inst: 0 }),
      drawArraysInstanced: (a) => ({ mode: a[0], first: a[1], count: a[2], inst: a[3] }),
      drawElementsInstanced: (a) => ({ mode: a[0], count: a[1], type: a[2], offset: a[3], inst: a[4] }),
      drawRangeElements: (a) => ({ mode: a[0], count: a[3], type: a[4], offset: a[5], inst: 0 }),
    };
    for (const name in DRAWS) {
      const parse = DRAWS[name];
      wrap(proto, name, (orig) => function () {
        totalDraws++;
        lastActivity = performance.now();
        { const c = ctxInfo.get(this); if (c && c.globe) globeDraws++; }
        if (cap) { const a = arguments; const gl = this; safe(() => onDraw(gl, parse(a))); }
        return orig.apply(this, arguments);
      });
    }

    // --- extensiones (instanciado en WebGL1, multi-draw)
    wrap(proto, 'getExtension', (orig) => function (name) {
      const ext = orig.apply(this, arguments);
      if (ext) safe(() => hookExtension(this, String(name), ext));
      return ext;
    });
  }

  const hookedExt = new WeakSet();
  function hookExtension(gl, name, ext) {
    if (hookedExt.has(ext)) return;
    hookedExt.add(ext);
    const n = name.toUpperCase();
    if (n === 'ANGLE_INSTANCED_ARRAYS') {
      C(gl).angle = true;
      wrap(ext, 'drawArraysInstancedANGLE', (orig) => function (mode, first, count, prim) {
        totalDraws++; lastActivity = performance.now(); { const c = ctxInfo.get(gl); if (c && c.globe) globeDraws++; }
        if (cap) safe(() => onDraw(gl, { mode, first, count, inst: prim }));
        return orig.apply(this, arguments);
      });
      wrap(ext, 'drawElementsInstancedANGLE', (orig) => function (mode, count, type, offset, prim) {
        totalDraws++; lastActivity = performance.now(); { const c = ctxInfo.get(gl); if (c && c.globe) globeDraws++; }
        if (cap) safe(() => onDraw(gl, { mode, count, type, offset, inst: prim }));
        return orig.apply(this, arguments);
      });
    } else if (n === 'WEBGL_MULTI_DRAW') {
      wrap(ext, 'multiDrawArraysWEBGL', (orig) => function (mode, firsts, fo, counts, co, dc) {
        totalDraws++; lastActivity = performance.now(); { const c = ctxInfo.get(gl); if (c && c.globe) globeDraws++; }
        if (cap) safe(() => { for (let i = 0; i < dc && cap && !cap.truncated; i++) onDraw(gl, { mode, first: firsts[fo + i], count: counts[co + i], inst: 0, multi: i }); });
        return orig.apply(this, arguments);
      });
      wrap(ext, 'multiDrawElementsWEBGL', (orig) => function (mode, counts, co, type, offsets, oo, dc) {
        totalDraws++; lastActivity = performance.now(); { const c = ctxInfo.get(gl); if (c && c.globe) globeDraws++; }
        if (cap) safe(() => { for (let i = 0; i < dc && cap && !cap.truncated; i++) onDraw(gl, { mode, count: counts[co + i], type, offset: offsets[oo + i], inst: 0, multi: i }); });
        return orig.apply(this, arguments);
      });
      wrap(ext, 'multiDrawArraysInstancedWEBGL', (orig) => function (mode, firsts, fo, counts, co, ics, io, dc) {
        totalDraws++; lastActivity = performance.now(); { const c = ctxInfo.get(gl); if (c && c.globe) globeDraws++; }
        if (cap) safe(() => { for (let i = 0; i < dc && cap && !cap.truncated; i++) onDraw(gl, { mode, first: firsts[fo + i], count: counts[co + i], inst: ics[io + i], multi: i }); });
        return orig.apply(this, arguments);
      });
      wrap(ext, 'multiDrawElementsInstancedWEBGL', (orig) => function (mode, counts, co, type, offsets, oo, ics, io, dc) {
        totalDraws++; lastActivity = performance.now(); { const c = ctxInfo.get(gl); if (c && c.globe) globeDraws++; }
        if (cap) safe(() => { for (let i = 0; i < dc && cap && !cap.truncated; i++) onDraw(gl, { mode, count: counts[co + i], type, offset: offsets[oo + i], inst: ics[io + i], multi: i }); });
        return orig.apply(this, arguments);
      });
    }
  }

  hookContext(WGL1);
  hookContext(WGL2);

  // ---------------------------------------------------------------- uniforms
  function sliceArr(data, off, len) {
    if (data == null) return [];
    if (off || len) {
      const start = off || 0;
      const end = len ? start + len : data.length;
      return Array.prototype.slice.call(data, start, end);
    }
    return Array.prototype.slice.call(data);
  }
  function parseUName(name) {
    const m = /^(.*)\[(\d+)\]$/.exec(name);
    return m ? { base: m[1], idx: +m[2] } : { base: name, idx: 0 };
  }
  function recordUniform(gl, loc, kind, values) {
    const li = locInfo.get(loc);
    if (!li) return;
    const { base, idx } = parseUName(li.name);
    const key = li.pid + '|' + base;
    let transpose = false;
    if (kind === 'fT') { kind = 'f'; transpose = true; }
    const prev = cap.uvals.get(key);
    // (los uniforms se escriben en el programa activo)
    const cp = gl.getParameter(CURRENT_PROGRAM);
    const pm = cap.progByPid.get(li.pid) || (cp && oid(cp) === li.pid ? getProgMeta(gl, cp) : null);
    const u = pm && pm.uniforms.find((x) => x.base === base);
    const full = u ? u.comps * Math.max(1, u.size) : values.length;
    let arr;
    if (idx === 0 && values.length >= (prev ? prev.d.length : full)) arr = values.slice();
    else {
      // escribir uno o varios elementos de un array de uniforms
      const per = u ? u.comps : values.length;
      // sin valor previo: partir del valor real del programa (si no, quedarían huecos)
      let base0 = prev || cap.uinit.get(key);
      if (base0 === undefined && cp && u) { base0 = readUniform(gl, cp, u) || false; cap.uinit.set(key, base0); }
      arr = base0 && base0.d ? base0.d.slice() : [];
      for (let i = 0; i < values.length; i++) arr[idx * per + i] = values[i];
    }
    cap.uvals.set(key, { t: kind, d: arr, tr: transpose || undefined });
  }
  const UTYPE_COMPS = { 0x1406: 1, 0x8B50: 2, 0x8B51: 3, 0x8B52: 4, 0x1404: 1, 0x8B53: 2, 0x8B54: 3, 0x8B55: 4, 0x8B56: 1, 0x8B57: 2, 0x8B58: 3, 0x8B59: 4,
    0x8B5A: 4, 0x8B5B: 9, 0x8B5C: 16, 0x1405: 1, 0x8DC6: 2, 0x8DC7: 3, 0x8DC8: 4, 0x8B65: 6, 0x8B66: 8, 0x8B67: 6, 0x8B68: 12, 0x8B69: 8, 0x8B6A: 12 };
  const UTYPE_KIND = (t) => (t === 0x1404 || t === 0x8B53 || t === 0x8B54 || t === 0x8B55 || t === 0x8B56 || t === 0x8B57 || t === 0x8B58 || t === 0x8B59 || SAMPLER_TYPES.has(t)) ? 'i'
    : (t === 0x1405 || t === 0x8DC6 || t === 0x8DC7 || t === 0x8DC8) ? 'u' : 'f';

  function toArr(v) {
    if (v == null) return null;
    if (typeof v === 'number') return [v];
    if (typeof v === 'boolean') return [v ? 1 : 0];
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x));
    if (ArrayBuffer.isView(v)) return Array.prototype.slice.call(v);
    return null;
  }

  // ---------------------------------------------------------------- metadatos del programa
  function getProgMeta(gl, p) {
    let m = progMeta.get(p);
    if (m) return m;
    const pid = oid(p);
    m = { pid, attribs: [], uniforms: [], blocks: [], samplers: [] };
    const na = gl.getProgramParameter(p, ACTIVE_ATTRIBUTES) || 0;
    for (let i = 0; i < na; i++) {
      const a = gl.getActiveAttrib(p, i); if (!a) continue;
      const loc = gl.getAttribLocation(p, a.name);
      if (loc < 0 || /^gl_/.test(a.name)) continue;
      m.attribs.push({ name: a.name, type: a.type, size: a.size, loc, cols: MAT_ATTR_COLS[a.type] || 1 });
    }
    m.attribs.sort((x, y) => x.loc - y.loc);
    const nu = gl.getProgramParameter(p, ACTIVE_UNIFORMS) || 0;
    const list = [];
    for (let i = 0; i < nu; i++) { const u = gl.getActiveUniform(p, i); if (u) list.push({ i, name: u.name, type: u.type, size: u.size }); }
    let blockIdx = null, offs = null, astr = null, mstr = null, rowm = null;
    if (isGL2(gl) && list.length) {
      const idxs = list.map((u) => u.i);
      blockIdx = gl.getActiveUniforms(p, idxs, UNIFORM_BLOCK_INDEX);
      offs = gl.getActiveUniforms(p, idxs, UNIFORM_OFFSET);
      astr = gl.getActiveUniforms(p, idxs, UNIFORM_ARRAY_STRIDE);
      mstr = gl.getActiveUniforms(p, idxs, UNIFORM_MATRIX_STRIDE);
      rowm = gl.getActiveUniforms(p, idxs, UNIFORM_IS_ROW_MAJOR);
      const nb = gl.getProgramParameter(p, ACTIVE_UNIFORM_BLOCKS) || 0;
      for (let b = 0; b < nb; b++) {
        m.blocks.push({ index: b, name: gl.getActiveUniformBlockName(p, b), size: gl.getActiveUniformBlockParameter(p, b, UNIFORM_BLOCK_DATA_SIZE), binding: gl.getActiveUniformBlockParameter(p, b, UNIFORM_BLOCK_BINDING) });
      }
    }
    list.forEach((u, k) => {
      const bi = blockIdx ? blockIdx[k] : -1;
      const { base } = parseUName(u.name);
      const ent = { name: u.name, base, type: u.type, size: u.size, comps: UTYPE_COMPS[u.type] || 1, block: bi };
      if (bi >= 0) { ent.offset = offs[k]; ent.arrayStride = astr[k]; ent.matrixStride = mstr[k]; ent.rowMajor = !!rowm[k]; }
      if (SAMPLER_TYPES.has(u.type)) { ent.sampler = true; m.samplers.push(ent); }
      m.uniforms.push(ent);
    });
    const src = progSrc.get(p) || {};
    m.vs = src.vs || '';
    m.fs = src.fs || '';
    progMeta.set(p, m);
    return m;
  }

  // ---------------------------------------------------------------- lectura de búferes
  function bufBytes(gl, buf, start, len) {
    // Devuelve Uint8Array con [start, start+len) del búfer (o lo que haya)
    const c = C(gl), id = oid(buf);
    if (!c.gl2) {
      const sh = c.shadows.get(buf);
      if (!sh) return null;
      const s = Math.max(0, Math.min(start, sh.length)), e = Math.max(s, Math.min(sh.length, start + len));
      return sh.subarray(s, e);
    }
    const ver = c.bufVer.get(buf) || 0;
    const key = c.id + ':' + id + '@' + ver;
    let ent = cap.rb.get(key);
    // El enlace COPY_READ_BUFFER de la página se restaura siempre, aunque algo falle
    const prev = gl.getParameter(COPY_READ_BUFFER);
    try {
      if (!ent) {
        gl.bindBuffer(COPY_READ_BUFFER, buf);
        const size = gl.getBufferParameter(COPY_READ_BUFFER, BUFFER_SIZE) || 0;
        ent = { size, whole: null, parts: new Map() };
        // búfer entero en memoria solo si es razonable (≤ 48 MB y ≤ 512 MB acumulados en la captura)
        if (size <= 48 * 1024 * 1024 && cap.rbBytes + size <= 512 * 1024 * 1024) {
          ent.whole = new Uint8Array(size);
          if (size) gl.getBufferSubData(COPY_READ_BUFFER, 0, ent.whole);
          cap.rbBytes += size;
        }
        cap.rb.set(key, ent);
      }
      const s = Math.max(0, Math.min(start, ent.size)), e = Math.max(s, Math.min(ent.size, start + len));
      if (ent.whole) return ent.whole.subarray(s, e);
      const pk = s + ':' + e;
      let part = ent.parts.get(pk);
      if (!part) {
        part = new Uint8Array(e - s);
        gl.bindBuffer(COPY_READ_BUFFER, buf);
        gl.getBufferSubData(COPY_READ_BUFFER, s, part);
        ent.parts.set(pk, part);
      }
      return part;
    } finally {
      gl.bindBuffer(COPY_READ_BUFFER, prev);
    }
  }
  function bufKey(gl, buf) { const c = C(gl); return oid(buf) + '@' + (c.bufVer.get(buf) || 0); }

  // ---------------------------------------------------------------- registro de un dibujo
  function onDraw(gl, d) {
    if (!cap || cap.stopped) return;
    lastDrawTime = performance.now();
    if (!cap.armed || !cap.recordThis) return; // aún no empieza el fotograma, o en "grabar" este no toca
    const c = C(gl);
    const o = cap.opts;
    const prog = gl.getParameter(CURRENT_PROGRAM);
    if (!prog) return;
    const pm = getProgMeta(gl, prog);
    // solo los programas que usan un uniform concreto (p. ej. las teselas 3D de Google Earth);
    // los demás dibujos (interfaz, textos) ni se guardan ni cuentan como fotograma
    if (o.onlyUniform && !pm.uniforms.some((u) => u.base === o.onlyUniform)) return;
    c.draws++;
    cap.frameHasDraws = true;
    if (cap.draws.length >= cap.maxDraws) { cap.truncated = true; return; }
    // medida rápida: la escala mínima de una matriz (tamaño de la tesela más fina dibujada)
    if (o.statsUniform) {
      const un = pm.uniforms.find((u) => u.base === o.statsUniform);
      const v = un ? uniformValue(gl, prog, pm, un) : null;
      if (v && v.d && v.d.length >= 16) {
        const s = Math.hypot(v.d[0], v.d[1], v.d[2]);
        if (s > 0 && (!(cap.stats.minScale > 0) || s < cap.stats.minScale)) cap.stats.minScale = s;
        cap.stats.n++;
      }
    }
    if (o.statsOnly) return;
    const pkey = c.id + ':' + pm.pid;
    if (!cap.progs.has(pkey)) { cap.progs.set(pkey, pm); cap.progByPid.set(pm.pid, pm); }

    const mode = d.mode;
    const count = d.count | 0;
    if (count <= 0) return;
    const inst = d.inst | 0;
    const nInst = Math.min(Math.max(inst, 1), cap.maxInstances);
    if (inst > cap.maxInstances) cap.truncated = true;

    // --- índices
    let idxKey = '', localIdx = null, verts = null;
    if (d.type !== undefined) {
      const ib = gl.getParameter(0x8895);
      if (!ib) return;
      const ibytes = INDEX_BYTES[d.type] || 2;
      const raw = bufBytes(gl, ib, d.offset, count * ibytes);
      if (!raw) return;
      idxKey = 'i' + bufKey(gl, ib) + ':' + d.offset + ':' + count + ':' + d.type;
      const n = Math.floor(raw.length / ibytes);
      const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const restart = ibytes === 1 ? 0xFF : ibytes === 2 ? 0xFFFF : 0xFFFFFFFF;
      const src = new Uint32Array(n);
      for (let i = 0; i < n; i++) src[i] = ibytes === 1 ? raw[i] : ibytes === 2 ? dv.getUint16(i * 2, true) : dv.getUint32(i * 4, true);
      // vértices usados (sin repetir, ordenados) y reasignación
      let vmin = 0xFFFFFFFF, vmax = 0;
      for (let i = 0; i < n; i++) { const v = src[i]; if (c.gl2 && v === restart) continue; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
      if (vmin > vmax) return;
      const span = vmax - vmin + 1;
      if (span <= 8 * 1024 * 1024) {
        const map = new Int32Array(span).fill(-1);
        let k = 0;
        for (let i = 0; i < n; i++) { const v = src[i]; if (c.gl2 && v === restart) continue; if (map[v - vmin] < 0) map[v - vmin] = 1; }
        for (let j = 0; j < span; j++) if (map[j] >= 0) map[j] = k++;
        verts = new Uint32Array(k);
        for (let j = 0; j < span; j++) if (map[j] >= 0) verts[map[j]] = j + vmin;
        localIdx = new Uint32Array(n);
        for (let i = 0; i < n; i++) { const v = src[i]; localIdx[i] = (c.gl2 && v === restart) ? 0xFFFFFFFF : map[v - vmin]; }
      } else {
        const m = new Map(); const vl = [];
        localIdx = new Uint32Array(n);
        for (let i = 0; i < n; i++) {
          const v = src[i];
          if (c.gl2 && v === restart) { localIdx[i] = 0xFFFFFFFF; continue; }
          let li = m.get(v); if (li === undefined) { li = vl.length; vl.push(v); m.set(v, li); }
          localIdx[i] = li;
        }
        verts = Uint32Array.from(vl);
      }
    } else {
      idxKey = 'a' + d.first + ':' + count;
      verts = new Uint32Array(count);
      for (let i = 0; i < count; i++) verts[i] = d.first + i;
    }

    // --- atributos
    const attrs = [];
    let gkey = c.id + '|' + mode + '|' + idxKey + '|' + nInst;
    for (const a of pm.attribs) {
      for (let col = 0; col < a.cols; col++) {
        const loc = a.loc + col;
        const ent = { name: a.cols > 1 ? a.name + '#' + col : a.name, atype: a.type, loc };
        const enabled = gl.getVertexAttrib(loc, VA_ENABLED);
        if (!enabled) {
          ent.constant = toArr(gl.getVertexAttrib(loc, VA_CURRENT));
          gkey += '|' + ent.name + '@' + loc + ':k' + (ent.constant || []).join(',');
          attrs.push(ent);
          continue;
        }
        const buf = gl.getVertexAttrib(loc, VA_BUFFER);
        if (!buf) continue;
        const size = gl.getVertexAttrib(loc, VA_SIZE), type = gl.getVertexAttrib(loc, VA_TYPE);
        const norm = !!gl.getVertexAttrib(loc, VA_NORMALIZED);
        const integer = c.gl2 ? !!gl.getVertexAttrib(loc, VA_INTEGER) : false;
        let divisor = 0;
        // (en WebGL1 solo se pregunta si la página activó la extensión: si no, generaría un error GL)
        if (c.gl2 || c.angle) { try { divisor = gl.getVertexAttrib(loc, VA_DIVISOR) || 0; } catch (e) { divisor = 0; } }
        const offset = gl.getVertexAttribOffset(loc, VA_POINTER);
        const elem = PACKED_TYPES.has(type) ? 4 : size * (COMP_BYTES[type] || 4);
        const stride = gl.getVertexAttrib(loc, VA_STRIDE) || elem;
        Object.assign(ent, { size, type, norm, integer, divisor, elem });
        gkey += '|' + ent.name + '@' + loc + ':' + bufKey(gl, buf) + ':' + offset + ':' + stride + ':' + size + ':' + type + ':' + (norm ? 1 : 0) + ':' + divisor;
        ent._buf = buf; ent._offset = offset; ent._stride = stride;
        attrs.push(ent);
      }
    }

    // --- geometría (se reutiliza si es idéntica)
    let gid = cap.geomIndex.get(gkey);
    if (gid === undefined) {
      const g = { ctx: c.id, mode, nVerts: verts.length, nInst, idx: null, attrs: [] };
      if (localIdx) g.idx = cap.addBin(new Uint8Array(localIdx.buffer));
      for (const a of attrs) {
        const ga = { name: a.name, atype: a.atype, loc: a.loc };
        if (a.constant) { ga.constant = a.constant; g.attrs.push(ga); continue; }
        if (o.skipAttrs && o.skipAttrs.includes(a.name)) { ga.skipped = true; g.attrs.push(ga); continue; }
        Object.assign(ga, { size: a.size, type: a.type, norm: a.norm, integer: a.integer || undefined, divisor: a.divisor || undefined, elem: a.elem });
        const list = a.divisor ? null : verts;
        const n = a.divisor ? Math.ceil(nInst / a.divisor) : verts.length;
        const out = new Uint8Array(n * a.elem);
        let lo, hi;
        if (list) { lo = list[0]; hi = list[list.length - 1]; for (let i = 0; i < list.length; i++) { const v = list[i]; if (v < lo) lo = v; if (v > hi) hi = v; } }
        else { lo = 0; hi = n - 1; }
        const base = a._offset + lo * a._stride;
        const span = (hi - lo) * a._stride + a.elem;
        const src = bufBytes(gl, a._buf, base, span);
        if (!src) continue;
        for (let i = 0; i < n; i++) {
          const v = list ? list[i] : i;
          const s = (v - lo) * a._stride;
          if (s + a.elem <= src.length) out.set(src.subarray(s, s + a.elem), i * a.elem);
        }
        ga.bin = cap.addBin(out);
        g.attrs.push(ga);
      }
      gid = cap.geoms.length;
      cap.geoms.push(g);
      cap.geomIndex.set(gkey, gid);
      cap.vertTotal += verts.length;
    }

    // --- uniforms (valores en el momento del dibujo)
    const u = {};
    for (const un of pm.uniforms) {
      if (un.block >= 0) continue;
      const val = uniformValue(gl, prog, pm, un);
      if (val) u[un.base] = cap.valId(val);
    }
    // --- bloques de uniforms (WebGL2)
    let blocks = null;
    if (pm.blocks.length) {
      blocks = {};
      const ov = blockBindingOverride.get(prog);
      for (const b of pm.blocks) {
        const binding = ov && ov.has(b.index) ? ov.get(b.index) : b.binding;
        const ub = gl.getIndexedParameter(UNIFORM_BUFFER_BINDING, binding);
        if (!ub) continue;
        const start = gl.getIndexedParameter(UNIFORM_BUFFER_START, binding) || 0;
        const k = 'b' + c.id + ':' + bufKey(gl, ub) + ':' + start + ':' + b.size;
        let bin = cap.blockIndex.get(k);
        if (bin === undefined) {
          const bytes = bufBytes(gl, ub, start, b.size);
          bin = bytes ? cap.addBin(bytes.slice()) : -1;
          cap.blockIndex.set(k, bin);
        }
        if (bin >= 0) blocks[b.name] = bin;
      }
    }
    // --- texturas 2D enlazadas a los samplers
    let tex = null;
    if (pm.samplers.length) {
      tex = {};
      const saveUnit = gl.getParameter(ACTIVE_TEXTURE);
      if (c.maxUnits === undefined) c.maxUnits = gl.getParameter(0x8B4D) || 8; // MAX_COMBINED_TEXTURE_IMAGE_UNITS
      try {
        for (const s of pm.samplers) {
          if (s.type !== SAMPLER_2D) continue;
          const val = uniformValue(gl, prog, pm, s);
          const unit = val && val.d ? (val.d[0] | 0) : 0;
          if (unit < 0 || unit >= c.maxUnits) continue; // valor raro: no tocar (generaría un error GL)
          gl.activeTexture(TEXTURE0 + unit);
          const t = gl.getParameter(TEXTURE_BINDING_2D);
          if (t) {
            const tid = oid(t);
            const tk = c.id + ':' + tid + '@' + (c.texVer.get(t) || 0);
            tex[s.base] = tk;
            if (!cap.textures.has(tk)) cap.textures.set(tk, { gl, t, tid, ctx: c.id });
          }
        }
      } finally {
        gl.activeTexture(saveUnit);
      }
    }
    // --- estado útil para clasificar (pasadas, interfaz 2D…)
    const fb = gl.getParameter(FRAMEBUFFER_BINDING);
    const vp = gl.getParameter(VIEWPORT);
    const rec = {
      g: gid, p: pkey, m: mode, n: count, ic: inst || undefined, u, b: blocks || undefined, t: tex || undefined,
      fb: fb ? oid(fb) : 0, vp: vp ? [vp[0], vp[1], vp[2], vp[3]] : undefined,
      dt: gl.isEnabled(DEPTH_TEST) ? 1 : 0, dw: gl.getParameter(DEPTH_WRITEMASK) ? 1 : 0, bl: gl.isEnabled(BLEND) ? 1 : 0,
      f: cap.frame, md: d.multi,
    };
    cap.draws.push(rec);
  }

  // Valor actual de un uniform: el último escrito durante la captura o, si no, el que tenía el programa
  // (leído una sola vez por captura; "false" marca que no se pudo leer, para no repetir la consulta)
  function uniformValue(gl, prog, pm, un) {
    const key = pm.pid + '|' + un.base;
    const v = cap.uvals.get(key);
    if (v) return v;
    let i = cap.uinit.get(key);
    if (i === undefined) { i = readUniform(gl, prog, un) || false; cap.uinit.set(key, i); }
    return i || null;
  }
  function readUniform(gl, prog, un) {
    try {
      const kind = UTYPE_KIND(un.type);
      if (un.size > 1) {
        if (un.size * un.comps > 4096) return null;
        const out = [];
        for (let i = 0; i < un.size; i++) {
          const loc = getLoc(gl, prog, un.base + '[' + i + ']');
          const v = loc ? toArr(gl.getUniform(prog, loc)) : null;
          for (let k = 0; k < un.comps; k++) out.push(v ? (v[k] || 0) : 0);
        }
        return { t: kind, d: out };
      }
      const loc = getLoc(gl, prog, un.name) || getLoc(gl, prog, un.base);
      if (!loc) return null;
      const v = toArr(gl.getUniform(prog, loc));
      return v ? { t: kind, d: v } : null;
    } catch (e) { return null; }
  }
  const locCache = new WeakMap();
  function getLoc(gl, prog, name) {
    let m = locCache.get(prog);
    if (!m) { m = new Map(); locCache.set(prog, m); }
    if (m.has(name)) return m.get(name);
    let l = null;
    try { l = gl.getUniformLocation(prog, name); } catch (e) { l = null; }
    m.set(name, l);
    return l;
  }

  // ---------------------------------------------------------------- lectura de texturas
  // Toma las texturas usadas que aún no se han leído. Las comprimidas (DXT) ya tienen copia y se
  // toman tal cual; las demás se leen de la tarjeta gráfica. En la sesión por pasos se llama al acabar
  // cada fotograma, antes de que la página pueda borrar esas texturas.
  function grabTextures(my) {
    for (const [key, info] of my.textures) {
      if (my.texDone.has(key)) continue;
      const { gl, t } = info;
      const ti = C(gl).tex.get(t);
      const ent = { key, w: ti ? ti.w : 0, h: ti ? ti.h : 0, ifmt: ti ? ti.ifmt : 0 };
      my.texDone.set(key, ent);
      if (!ti || !ti.w || !ti.h) { ent.skip = 'tamaño desconocido'; continue; }
      if (ti.w > 8192 || ti.h > 8192) { ent.skip = 'demasiado grande'; continue; }
      if (ti.compressed) {
        if (ti.data) { ent.kind = 'bc'; ent.bin = my.addBin(ti.data); ti.shared = true; }
        else ent.skip = 'formato comprimido no soportado (0x' + (ti.ifmt || 0).toString(16) + ')';
        continue;
      }
      if (my.texBudget <= 0) { ent.skip = 'límite de memoria de texturas'; continue; }
      const px = safe(() => readTexturePixels(gl, t, ti.w, ti.h));
      if (!px) { ent.skip = 'no legible'; continue; }
      my.texBudget -= px.length;
      ent.pending = encodeImage(px, ti.w, ti.h).then((r) => { if (r) { ent.kind = r.kind; ent.bin = my.addBin(r.bytes); } else ent.skip = 'no codificable'; });
    }
  }
  async function readTextures(my) {
    grabTextures(my);
    const out = [...my.texDone.values()];
    for (const e of out) { if (e.pending) { await e.pending; delete e.pending; } }
    return out;
  }
  function readTexturePixels(gl, t, w, h) {
    const gl2 = isGL2(gl);
    const saveDraw = gl.getParameter(FRAMEBUFFER_BINDING);
    const saveRead = gl2 ? gl.getParameter(READ_FRAMEBUFFER_BINDING) : null;
    const savePack = gl.getParameter(PACK_ALIGNMENT);
    let savePBO = null, saveRL = 0, saveSR = 0, saveSP = 0;
    if (gl2) {
      savePBO = gl.getParameter(PIXEL_PACK_BUFFER_BINDING);
      saveRL = gl.getParameter(PACK_ROW_LENGTH); saveSR = gl.getParameter(PACK_SKIP_ROWS); saveSP = gl.getParameter(PACK_SKIP_PIXELS);
      if (savePBO) gl.bindBuffer(PIXEL_PACK_BUFFER, null);
      gl.pixelStorei(PACK_ROW_LENGTH, 0); gl.pixelStorei(PACK_SKIP_ROWS, 0); gl.pixelStorei(PACK_SKIP_PIXELS, 0);
    }
    gl.pixelStorei(PACK_ALIGNMENT, 1);
    const fb = gl.createFramebuffer();
    let px = null;
    try {
      gl.bindFramebuffer(FRAMEBUFFER, fb);
      gl.framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(FRAMEBUFFER) === FRAMEBUFFER_COMPLETE) {
        // vaciar errores GL pendientes (de la página o anteriores) para no confundirlos con el nuestro
        for (let k = 0; k < 8 && gl.getError() !== 0; k++) { /* nada */ }
        px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, RGBA, UNSIGNED_BYTE, px);
        if (gl.getError() !== 0) px = null;
      }
    } finally {
      gl.bindFramebuffer(FRAMEBUFFER, saveDraw);
      if (gl2) {
        gl.bindFramebuffer(READ_FRAMEBUFFER, saveRead);
        if (savePBO) gl.bindBuffer(PIXEL_PACK_BUFFER, savePBO);
        gl.pixelStorei(PACK_ROW_LENGTH, saveRL); gl.pixelStorei(PACK_SKIP_ROWS, saveSR); gl.pixelStorei(PACK_SKIP_PIXELS, saveSP);
      }
      gl.pixelStorei(PACK_ALIGNMENT, savePack);
      gl.deleteFramebuffer(fb);
    }
    return px;
  }
  async function encodeImage(px, w, h) {
    // fila 0 de readPixels = t=0 de la textura → fila 0 (arriba) de la imagen
    let opaque = true;
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) { opaque = false; break; }
    try {
      if (!G.OffscreenCanvas) throw new Error('sin OffscreenCanvas');
      const cv = new OffscreenCanvas(w, h);
      const cx = cv.getContext('2d');
      cx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, px.byteLength), w, h), 0, 0);
      const type = opaque ? 'image/jpeg' : 'image/png';
      const blob = await cv.convertToBlob(opaque ? { type, quality: 0.92 } : { type });
      return { kind: opaque ? 'jpeg' : 'png', bytes: new Uint8Array(await blob.arrayBuffer()) };
    } catch (e) {
      return { kind: 'rgba', bytes: px };
    }
  }

  // ---------------------------------------------------------------- captura
  function newCapture(opts) {
    const bins = [];
    const vals = []; const valIds = new Map();
    return {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      opts, started: performance.now(), frame: 0, framesDone: 0, frameHasDraws: false, stopped: false,
      draws: [], geoms: [], geomIndex: new Map(), progs: new Map(), progByPid: new Map(),
      uvals: new Map(), uinit: new Map(), blockIndex: new Map(), textures: new Map(),
      rb: new Map(), rbBytes: 0, errors: [], truncated: false, vertTotal: 0,
      maxDraws: opts.maxDraws || 60000, maxInstances: opts.maxInstances || 4096, texBudget: (opts.texBudgetMB || 768) * 1024 * 1024,
      texDone: new Map(), stats: { minScale: 0, n: 0 }, snaps: [], snapReq: null, stopReq: false,
      bins, vals,
      addBin(u8) { bins.push(u8); return bins.length - 1; },
      valId(v) { let i = valIds.get(v); if (i === undefined) { i = vals.length; vals.push(v); valIds.set(v, i); } return i; },
    };
  }

  // Modos:
  //  - normal: registra `frames` fotogramas seguidos (o, con durationMs, uno cada intervalMs durante ese tiempo);
  //  - manual: sesión por pasos; no registra nada hasta que se pide snap(), y termina con stop().
  //    La usa la captura de áreas de Google Earth: mover la cámara, esperar, snap(), y así en cada posición.
  function capture(opts) {
    opts = Object.assign({ frames: 1, durationMs: 0, waitMs: 15000, textures: true, intervalMs: 400 }, opts || {});
    if (cap) return Promise.reject(new Error('Ya hay una captura en curso'));
    cap = newCapture(opts);
    const my = cap;
    const accumulate = opts.durationMs > 0;
    const manual = !!opts.manual;
    if (manual) my.maxDraws = opts.maxDraws || 400000;
    const p = new Promise((resolve) => {
      const hasRAF = typeof G.requestAnimationFrame === 'function';
      let finished = false;
      let lastRec = -Infinity;
      let guard = 0;
      const finish = (reason) => {
        if (finished) return; finished = true;
        clearTimeout(guard);
        my.stopped = true; my.reason = reason;
        if (my.snapReq) { const s = my.snapReq; my.snapReq = null; s.resolve({ ok: false, reason: 'captura terminada' }); }
        setTimeout(() => pack(my).then(resolve, (e) => resolve({ error: String(e && e.message || e) })), 0);
      };
      my.finish = finish;
      // Seguridad: aunque requestAnimationFrame no llegue (pestaña oculta o minimizada), la captura termina
      // En la sesión por pasos el límite es de inactividad: si nadie pregunta por ella en 3 minutos
      // (se desactivó el modo captura, se cerró el proceso de fondo…), se descarta para liberar memoria.
      if (manual) {
        my.touch = () => { clearTimeout(guard); guard = setTimeout(() => { if (cap === my) abort(); }, opts.idleMs || 3 * 60000); };
        my.touch();
      } else guard = setTimeout(() => finish(my.framesDone ? 'límite' : 'sin dibujos'), Math.max(opts.waitMs, opts.durationMs) + 30000);
      // Con rAF se empieza a registrar en el siguiente fotograma completo (no a medias); sin rAF, desde ya
      my.armed = !hasRAF && !manual;
      my.recordThis = !manual;
      const check = () => {
        if (finished) return;
        const now = performance.now(), el = now - my.started;
        if (manual) {
          if (my.stopReq) return finish('detenida');
          const s = my.snapReq;
          if (s && !my.recordThis) {
            // empieza a registrar en este límite de fotograma
            my.recordThis = true; my.armed = true; my.frameHasDraws = false;
            s.firstDraw = my.draws.length; s.armedAt = now;
            my.stats = { minScale: 0, n: 0 };
            // los uniforms se anotan solo durante el fotograma del paso; lo que no se escriba en él
            // se lee del programa en el momento del dibujo
            my.uvals.clear(); my.uinit.clear();
          } else if (s && my.recordThis && my.frameHasDraws) {
            // fotograma completo: se cierra el paso y se toman sus texturas
            my.recordThis = false; my.frameHasDraws = false;
            my.snapReq = null; clearTimeout(s.timer);
            const info = { ok: true, frame: my.frame, draws: my.draws.length - s.firstDraw, tag: s.tag };
            my.snaps.push(info);
            my.framesDone++; my.frame++;
            my.rb.clear(); my.rbBytes = 0;
            try { if (opts.textures) grabTextures(my); } catch (e) { my.errors.push(String(e).slice(0, 300)); }
            info.textures = my.texDone.size; info.bins = my.bins.length;
            s.resolve(Object.assign({ minScale: my.stats.minScale }, info));
          }
          return schedule();
        }
        if (!my.armed) { my.armed = true; my.frameHasDraws = false; return schedule(); }
        if (my.frameHasDraws) { my.framesDone++; my.frame++; my.frameHasDraws = false; lastRec = now; }
        if (accumulate) {
          if (el >= opts.durationMs && my.framesDone > 0) return finish('tiempo');
          // en modo "grabar" se registra un fotograma cada intervalMs (no todos: serían repeticiones)
          my.recordThis = now - lastRec >= opts.intervalMs;
        } else if (my.framesDone >= opts.frames) return finish('fotogramas');
        if (my.framesDone === 0 && el > opts.waitMs + opts.durationMs) return finish('sin dibujos');
        schedule();
      };
      const schedule = () => {
        if (hasRAF) G.requestAnimationFrame(check);
        else setTimeout(() => { if (performance.now() - lastDrawTime > 25) check(); else schedule(); }, 16);
      };
      schedule();
      // Muchos visores solo dibujan cuando algo cambia: un "resize" suele provocar un fotograma nuevo
      if (!manual && typeof G.dispatchEvent === 'function' && typeof Event === 'function' && typeof document !== 'undefined') {
        setTimeout(() => { if (!finished && !my.frameHasDraws && my.framesDone === 0) { try { G.dispatchEvent(new Event('resize')); } catch (e) { } } }, 250);
      }
    });
    my.promise = p;
    return p;
  }

  // Sesión por pasos: registra el siguiente fotograma completo. Quien llama debe provocar que la página
  // dibuje (mover la cámara) justo después. Devuelve {ok, frame, draws, minScale…} o {ok:false, reason}.
  function snap(opts) {
    opts = opts || {};
    const my = cap;
    if (!my || !my.opts.manual || my.stopped) return Promise.reject(new Error('No hay una sesión de captura abierta'));
    if (my.snapReq) return Promise.reject(new Error('Ya hay un paso pendiente'));
    return new Promise((resolve) => {
      const s = { tag: opts.tag, resolve };
      s.timer = setTimeout(() => {
        if (my.snapReq !== s) return;
        my.snapReq = null;
        // si llegó a empezar, se descarta lo registrado a medias
        if (my.recordThis) { my.recordThis = false; if (s.firstDraw !== undefined) my.draws.length = s.firstDraw; }
        resolve({ ok: false, reason: 'sin dibujos' });
      }, opts.timeoutMs || 8000);
      my.snapReq = s;
    });
  }
  function stop() {
    const my = cap;
    if (!my || !my.opts.manual) return Promise.reject(new Error('No hay una sesión de captura abierta'));
    my.stopReq = true;
    my.finish('detenida');
    return my.promise;
  }
  function abort() {
    const my = cap;
    if (!my) return false;
    my.stopReq = true; my.aborted = true;
    if (my.finish) my.finish('cancelada');
    cap = null; // libre ya: se puede abrir otra captura enseguida
    return true;
  }

  async function pack(my) {
    try {
      if (my.aborted) return { aborted: true };
      const textures = my.opts.textures ? await readTextures(my) : [];
      const programs = {};
      const usedProg = new Set(my.draws.map((d) => d.p));
      for (const [k, pm] of my.progs) {
        if (!usedProg.has(k)) continue;
        programs[k] = { attribs: pm.attribs, uniforms: pm.uniforms.map((u) => { const o = Object.assign({}, u); return o; }), blocks: pm.blocks, vs: pm.vs, fs: pm.fs.length > 60000 ? pm.fs.slice(0, 60000) : pm.fs };
      }
      const contexts = [];
      for (const r of allCtx) { const gl = r.deref && r.deref(); if (!gl) continue; const c = C(gl); contexts.push({ id: c.id, gl2: c.gl2, w: gl.drawingBufferWidth, h: gl.drawingBufferHeight, draws: c.draws }); }
      const header = {
        format: 'captar-malla', version: VERSION, realm: REALM, url: String(G.location && G.location.href || ''),
        time: new Date().toISOString(), reason: my.reason, frames: my.framesDone, truncated: my.truncated,
        contexts, programs, geoms: my.geoms, draws: my.draws, values: my.vals, textures: textures.map((t) => { const o = Object.assign({}, t); delete o.pending; return o; }),
        errors: my.errors.slice(0, 50), bins: [], snaps: my.snaps, stats: my.stats,
      };
      // binarios alineados a 4 bytes
      let off = 0;
      for (const b of my.bins) { header.bins.push([off, b.byteLength]); off += (b.byteLength + 3) & ~3; }
      const hjson = new TextEncoder().encode(JSON.stringify(header));
      const pre = new Uint8Array(12);
      const dv = new DataView(pre.buffer);
      pre.set([0x43, 0x4D, 0x41, 0x4C]); // "CMAL"
      dv.setUint32(4, VERSION, true);
      dv.setUint32(8, hjson.byteLength, true);
      const parts = [pre, hjson];
      const padH = (4 - ((12 + hjson.byteLength) & 3)) & 3;
      if (padH) parts.push(new Uint8Array(padH));
      for (const b of my.bins) { parts.push(b); const p = (4 - (b.byteLength & 3)) & 3; if (p) parts.push(new Uint8Array(p)); }
      const blob = new Blob(parts);
      const summary = {
        id: my.id, realm: REALM, url: header.url, reason: my.reason, frames: my.framesDone,
        draws: my.draws.length, geoms: my.geoms.length, verts: my.vertTotal, textures: textures.filter((t) => t.bin !== undefined).length,
        bytes: blob.size, truncated: my.truncated, errors: my.errors.length, stats: my.stats, snaps: my.snaps.length,
      };
      // en una medida rápida no hay nada que recoger
      if (my.opts.statsOnly) return summary;
      done.set(my.id, { blob, summary });
      // si nadie la recoge (pestaña cerrada, error al copiar), se libera sola a los 10 minutos
      setTimeout(() => done.delete(my.id), 10 * 60 * 1000);
      return summary;
    } finally {
      if (cap === my) cap = null;
    }
  }

  function chunk(id, offset, length) {
    const e = done.get(id);
    if (!e) return Promise.reject(new Error('Captura no encontrada: ' + id));
    const part = e.blob.slice(offset, offset + length);
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => { const s = String(fr.result); res(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(part);
    });
  }

  function status() {
    if (cap && cap.touch) cap.touch(); // la sesión sigue viva mientras alguien pregunte
    const contexts = [];
    for (const r of allCtx) {
      const gl = r.deref && r.deref(); if (!gl) continue;
      const c = C(gl);
      const e = { id: c.id, gl2: c.gl2, w: gl.drawingBufferWidth, h: gl.drawingBufferHeight, draws: c.draws };
      // posición del lienzo en la página (para pasar un rectángulo de pantalla a metros)
      try { const cv = gl.canvas; if (cv && cv.getBoundingClientRect && cv.isConnected) { const b = cv.getBoundingClientRect(); e.rect = [b.left, b.top, b.width, b.height]; } } catch (er) { }
      contexts.push(e);
    }
    const now = performance.now();
    return {
      version: VERSION, realm: REALM, url: String(G.location && G.location.href || ''), contexts, totalDraws, globeDraws, capturing: !!cap,
      idleMs: lastActivity ? Math.round(now - lastActivity) : -1,
      visible: typeof document !== 'undefined' ? document.visibilityState : 'visible',
      session: cap && cap.opts.manual ? { snaps: cap.snaps.length, bins: cap.bins.length, draws: cap.draws.length, textures: cap.texDone.size } : null,
    };
  }

  Object.defineProperty(G, '__captarMalla', {
    value: Object.freeze({ version: VERSION, capture, snap, stop, abort, chunk, status, free: (id) => done.delete(id) }),
    enumerable: false, configurable: false, writable: false,
  });
})();
