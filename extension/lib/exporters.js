// Captar malla — preparación y exportación (GLB, OBJ+MTL en ZIP, FBX binario, STL).
// Sin dependencias: funciona en el visor (navegador) y en Node (pruebas).
import { decodeBC } from './bc.js';

const enc = new TextEncoder();

// ------------------------------------------------------------------ selección, recorte, unión
// up: 'Z' (escenas geográficas ENU) o 'Y' (escenas WebGL normales)
export function cropMesh(m, crop, up) {
  if (!crop || !(crop.radius > 0)) return m;
  const p = m.positions, idx = m.indices;
  const [cx, cy, cz] = crop.center;
  const r2 = crop.radius * crop.radius;
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const x = (p[a] + p[b] + p[c]) / 3;
    const h = up === 'Z' ? (p[a + 1] + p[b + 1] + p[c + 1]) / 3 : (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    const dx = x - cx, dh = h - (up === 'Z' ? cy : cz);
    if (dx * dx + dh * dh <= r2) keep.push(i);
  }
  if (keep.length === idx.length / 3) return m;
  if (!keep.length) return null;
  return compact(m, keep);
}
function compact(m, triStarts) {
  const remap = new Int32Array(m.positions.length / 3).fill(-1);
  let n = 0;
  const nIdx = new Uint32Array(triStarts.length * 3);
  let k = 0;
  for (const t of triStarts) for (let j = 0; j < 3; j++) { const v = m.indices[t + j]; if (remap[v] < 0) remap[v] = n++; nIdx[k++] = remap[v]; }
  const pos = new Float32Array(n * 3), uv = m.uvs ? new Float32Array(n * 2) : null, col = m.colors ? new Float32Array(n * 4) : null;
  for (let v = 0; v < remap.length; v++) {
    const r = remap[v]; if (r < 0) continue;
    pos[r * 3] = m.positions[v * 3]; pos[r * 3 + 1] = m.positions[v * 3 + 1]; pos[r * 3 + 2] = m.positions[v * 3 + 2];
    if (uv) { uv[r * 2] = m.uvs[v * 2]; uv[r * 2 + 1] = m.uvs[v * 2 + 1]; }
    if (col) for (let c = 0; c < 4; c++) col[r * 4 + c] = m.colors[v * 4 + c];
  }
  return Object.assign({}, m, { positions: pos, indices: nIdx, uvs: uv, colors: col });
}
export function materialKey(m) {
  if (m.texKey) return 't:' + m.texKey;
  if (m.colors) return 'v:' + (m.color ? m.color.map((x) => x.toFixed(3)).join(',') : '');
  return 'c:' + (m.color ? m.color.map((x) => x.toFixed(3)).join(',') : 'gris');
}
// Una pieza sin coordenadas de textura no puede llevar textura (saldría negra en los visores)
export function noTexWithoutUV(meshes) {
  return meshes.map((m) => (m.texKey && !m.uvs ? Object.assign({}, m, { texKey: null }) : m));
}
export function mergeByMaterial(meshes) {
  meshes = noTexWithoutUV(meshes);
  const groups = new Map();
  for (const m of meshes) { const k = materialKey(m); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
  const out = [];
  for (const [k, list] of groups) {
    if (list.length === 1) { out.push(list[0]); continue; }
    let nv = 0, ni = 0; for (const m of list) { nv += m.positions.length / 3; ni += m.indices.length; }
    const hasUV = list.every((m) => m.uvs), hasCol = list.some((m) => m.colors);
    const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni), uv = hasUV ? new Float32Array(nv * 2) : null, col = hasCol ? new Float32Array(nv * 4) : null;
    let vo = 0, io = 0;
    for (const m of list) {
      const n = m.positions.length / 3;
      pos.set(m.positions, vo * 3);
      if (uv) uv.set(m.uvs, vo * 2);
      if (col) { if (m.colors) col.set(m.colors, vo * 4); else for (let i = 0; i < n; i++) col.set(m.color || [0.8, 0.8, 0.8, 1], (vo + i) * 4); }
      for (let i = 0; i < m.indices.length; i++) idx[io + i] = m.indices[i] + vo;
      vo += n; io += m.indices.length;
    }
    out.push(Object.assign({}, list[0], { name: list[0].name + '_x' + list.length, positions: pos, indices: idx, uvs: uv, colors: col }));
  }
  return out;
}
export function mergeAll(meshes) {
  if (meshes.length <= 1) return meshes;
  const m = mergeByMaterial(meshes.map((x) => Object.assign({}, x, { texKey: null, colors: null, color: null })));
  return m;
}
// Cambio de eje vertical, escala y desplazamiento. from/to: 'Y' o 'Z'
export function transformPositions(meshes, { from = 'Y', to = 'Y', scale = 1, offset = [0, 0, 0] } = {}) {
  return meshes.map((m) => {
    const p = m.positions, o = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      let x = (p[i] + offset[0]) * scale, y = (p[i + 1] + offset[1]) * scale, z = (p[i + 2] + offset[2]) * scale;
      if (from === 'Z' && to === 'Y') { const t = y; y = z; z = -t; }
      else if (from === 'Y' && to === 'Z') { const t = z; z = y; y = -t; }
      o[i] = x; o[i + 1] = y; o[i + 2] = z;
    }
    return Object.assign({}, m, { positions: o });
  });
}
export function convertPoint([x, y, z], from, to) {
  if (from === 'Z' && to === 'Y') return [x, z, -y];
  if (from === 'Y' && to === 'Z') return [x, -z, y];
  return [x, y, z];
}

// ------------------------------------------------------------------ texturas a archivo
// En el navegador el visor instala un codificador JPEG/PNG (OffscreenCanvas) y un decodificador de
// imágenes; en Node (pruebas) se usa el PNG propio y las imágenes JPEG/PNG no se decodifican.
const codec = { encode: null, decode: null };
export function setImageCodec({ encode, decode } = {}) { codec.encode = encode || null; codec.decode = decode || null; }
function isOpaque(rgba) { for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false; return true; }
async function encodeRGBA(rgba, w, h, quality = 0.9) {
  const opaque = isOpaque(rgba);
  if (codec.encode) {
    const r = await codec.encode(rgba, w, h, { opaque, quality });
    if (r) return r.kind === 'jpeg' ? { mime: 'image/jpeg', ext: 'jpg', bytes: r.bytes } : { mime: 'image/png', ext: 'png', bytes: r.bytes };
  }
  return { mime: 'image/png', ext: 'png', bytes: await encodePNG(rgba, w, h) };
}
export async function textureFile(tex) {
  if (!tex) return null;
  if (tex.kind === 'jpeg') return { mime: 'image/jpeg', ext: 'jpg', bytes: tex.bytes };
  if (tex.kind === 'png') return { mime: 'image/png', ext: 'png', bytes: tex.bytes };
  let rgba = null;
  if (tex.kind === 'bc') rgba = decodeBC(tex.bytes, tex.w, tex.h, tex.ifmt);
  else if (tex.kind === 'rgba') rgba = tex.bytes;
  if (!rgba) return null;
  return encodeRGBA(rgba, tex.w, tex.h);
}
// Píxeles RGBA de cualquier textura capturada (o null si no se puede en este entorno)
export async function texturePixels(tex) {
  if (!tex) return null;
  if (tex.kind === 'bc') return decodeBC(tex.bytes, tex.w, tex.h, tex.ifmt);
  if (tex.kind === 'rgba') return tex.bytes;
  if ((tex.kind === 'jpeg' || tex.kind === 'png') && codec.decode) return codec.decode(tex.bytes, tex.kind, tex.w, tex.h);
  return null;
}

// ------------------------------------------------------------------ atlas de texturas
// Junta muchas texturas pequeñas (las teselas de Google Earth: cientos o miles) en pocas imágenes
// grandes, y recoloca las coordenadas de textura. Menos materiales = archivos que se abren y se
// manejan mucho mejor en Blender, 3ds Max, SketchUp, Twinmotion…
// Solo entran las piezas cuyas coordenadas de textura están dentro de [0,1] (si se repiten, no se puede).
// Cada textura lleva un margen de `pad` píxeles copiando su borde, para que no se mezclen al filtrar.
export async function buildAtlases(meshes, textures, opts = {}) {
  const size = opts.size || 4096, pad = opts.pad ?? 4, quality = opts.quality ?? 0.9;
  const onProgress = opts.onProgress || (() => { });
  meshes = noTexWithoutUV(meshes);
  // texturas candidatas: todas sus piezas con UV dentro de [0,1]
  const ok = new Map(); // texKey -> bool
  for (const m of meshes) {
    if (!m.texKey) continue;
    let inside = ok.has(m.texKey) ? ok.get(m.texKey) : true;
    if (inside) { const u = m.uvs; for (let i = 0; i < u.length; i++) { const v = u[i]; if (!(v >= -0.002 && v <= 1.002)) { inside = false; break; } } }
    ok.set(m.texKey, inside);
  }
  const items = [];
  for (const [key, inside] of ok) {
    const t = textures.get(key);
    if (!inside || !t || !(t.w > 0 && t.h > 0) || t.w + 2 * pad > size || t.h + 2 * pad > size) continue;
    items.push({ key, w: t.w, h: t.h });
  }
  // estanterías: de más alta a más baja
  items.sort((a, b) => b.h - a.h || b.w - a.w);
  const pages = [];
  let page = null;
  for (const it of items) {
    const W = it.w + 2 * pad, H = it.h + 2 * pad;
    let placed = false;
    for (const pg of pages.slice(-1)) {
      if (pg.x + W <= size) { it.page = pg.i; it.x = pg.x; it.y = pg.y; pg.x += W; pg.shelfH = Math.max(pg.shelfH, H); placed = true; }
      else if (pg.y + pg.shelfH + H <= size) { pg.y += pg.shelfH; pg.x = 0; pg.shelfH = H; it.page = pg.i; it.x = 0; it.y = pg.y; pg.x = W; placed = true; }
    }
    if (!placed) { page = { i: pages.length, x: W, y: 0, shelfH: H, items: [] }; pages.push(page); it.page = page.i; it.x = 0; it.y = 0; }
    pages[it.page].items.push(it);
  }
  const outTex = new Map();
  const where = new Map(); // texKey -> {atlasKey, x, y, w, h, pw, ph}
  let done = 0;
  for (const pg of pages) {
    // alto real de la página (múltiplo de 4), ancho completo
    const usedH = Math.min(size, pg.items.reduce((a, it) => Math.max(a, it.y + it.h + 2 * pad), 0));
    // lados en potencia de 2 (algunos programas lo prefieren); el fondo negro apenas pesa en JPEG
    let ph = 4; while (ph < usedH) ph *= 2;
    ph = Math.min(size, ph); const pw = size;
    const rgba = new Uint8Array(pw * ph * 4);
    // fondo negro opaco (si quedara transparente, el atlas tendría que ir en PNG: 5-10 veces más pesado)
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    const okItems = [];
    for (const it of pg.items) {
      const px = await texturePixels(textures.get(it.key));
      done++;
      if (!px || px.length < it.w * it.h * 4) continue;
      blit(rgba, pw, px, it.w, it.h, it.x + pad, it.y + pad, pad);
      okItems.push(it);
      if (done % 64 === 0) { onProgress(done, items.length); await yieldNow(); }
    }
    if (!okItems.length) continue;
    const atlasKey = 'atlas:' + pg.i;
    const f = await encodeRGBA(rgba, pw, ph, quality);
    outTex.set(atlasKey, { key: atlasKey, kind: f.mime === 'image/jpeg' ? 'jpeg' : 'png', w: pw, h: ph, bytes: f.bytes });
    for (const it of okItems) where.set(it.key, { atlasKey, x: it.x + pad, y: it.y + pad, w: it.w, h: it.h, pw, ph });
  }
  onProgress(items.length, items.length);
  // piezas: UV recolocadas en su atlas; las demás conservan su textura
  const outMeshes = meshes.map((m) => {
    const loc = m.texKey ? where.get(m.texKey) : null;
    if (!loc) { if (m.texKey && !outTex.has(m.texKey)) outTex.set(m.texKey, textures.get(m.texKey)); return m; }
    const uv = new Float32Array(m.uvs.length);
    for (let i = 0; i < uv.length; i += 2) {
      uv[i] = (loc.x + Math.min(1, Math.max(0, m.uvs[i])) * loc.w) / loc.pw;
      uv[i + 1] = (loc.y + Math.min(1, Math.max(0, m.uvs[i + 1])) * loc.h) / loc.ph;
    }
    return Object.assign({}, m, { uvs: uv, texKey: loc.atlasKey });
  });
  return { meshes: outMeshes, textures: outTex, atlases: [...outTex.keys()].filter((k) => k.startsWith('atlas:')).length, packed: where.size, total: ok.size };
}
// Ceder el turno sin setTimeout (en una pestaña oculta Chrome lo retrasa hasta 1 s o 1 min)
function yieldNow() {
  if (typeof MessageChannel !== 'function') return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });
}
// Copia una imagen w×h en (dx,dy) y rellena `pad` píxeles alrededor repitiendo el borde
function blit(dst, dw, src, w, h, dx, dy, pad) {
  for (let y = -pad; y < h + pad; y++) {
    const sy = Math.min(h - 1, Math.max(0, y));
    const rowS = sy * w * 4, rowD = ((dy + y) * dw + dx) * 4;
    dst.set(src.subarray(rowS, rowS + w * 4), rowD);
    for (let x = 1; x <= pad; x++) {
      const l = rowD - x * 4, r = rowD + (w - 1 + x) * 4, e = rowS + (w - 1) * 4;
      dst[l] = src[rowS]; dst[l + 1] = src[rowS + 1]; dst[l + 2] = src[rowS + 2]; dst[l + 3] = src[rowS + 3];
      dst[r] = src[e]; dst[r + 1] = src[e + 1]; dst[r + 2] = src[e + 2]; dst[r + 3] = src[e + 3];
    }
  }
}
export function textureRGBA(tex) {
  if (tex.kind === 'bc') return decodeBC(tex.bytes, tex.w, tex.h, tex.ifmt);
  if (tex.kind === 'rgba') return tex.bytes;
  return null;
}

// PNG sin pérdidas (RGBA 8 bits) con CompressionStream('deflate') = formato zlib
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8, crc = 0) { let c = (crc ^ 0xFFFFFFFF) >>> 0; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function deflate(u8) {
  const cs = new CompressionStream('deflate');
  const blob = new Blob([u8]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(blob).arrayBuffer());
}
export async function encodePNG(rgba, w, h) {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1); }
  const z = await deflate(raw);
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(enc.encode(type), 4); out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))]);
}
export function concat(list) {
  let n = 0; for (const a of list) n += a.byteLength;
  const out = new Uint8Array(n); let o = 0;
  for (const a of list) { out.set(a instanceof Uint8Array ? a : new Uint8Array(a.buffer || a, a.byteOffset || 0, a.byteLength), o); o += a.byteLength; }
  return out;
}

// ------------------------------------------------------------------ ZIP (sin compresión)
export function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.bytes;
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length); const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(8, 0, true);
    l.setUint16(10, dosTime, true); l.setUint16(12, dosDate, true); l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, name.length, true); l.setUint16(28, 0, true);
    lh.set(name, 30);
    parts.push(lh, data);
    const ch = new Uint8Array(46 + name.length); const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true); ch.set(name, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const cd = concat(central);
  const end = new Uint8Array(22); const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cd.length, true); e.setUint32(16, offset, true);
  return concat([...parts, cd, end]);
}

// ------------------------------------------------------------------ utilidades
const safeName = (s) => String(s || 'malla').replace(/[^A-Za-z0-9_\-]+/g, '_').slice(0, 60) || 'malla';
function bounds(p) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { mn, mx };
}
function triNormal(p, a, b, c) {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
// Prepara las texturas usadas (una sola vez cada una)
async function collectTextures(meshes, textures) {
  const map = new Map();
  for (const m of meshes) {
    if (!m.texKey || map.has(m.texKey)) continue;
    const f = await textureFile(textures.get(m.texKey));
    map.set(m.texKey, f ? Object.assign(f, { name: 'tex_' + String(map.size).padStart(4, '0') + '.' + f.ext }) : null);
  }
  return map;
}

// ------------------------------------------------------------------ GLB (glTF 2.0 binario, Y arriba)
export async function exportGLB(meshes, textures, opts = {}) {
  meshes = noTexWithoutUV(meshes);
  const texFiles = await collectTextures(meshes, textures);
  const json = {
    asset: { version: '2.0', generator: 'Captar malla (AGOIN)' },
    scene: 0, scenes: [{ name: opts.sceneName || 'captura', nodes: [0] }],
    nodes: [{ name: opts.sceneName || 'captura', children: [] }],
    meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
  };
  if (opts.rootTranslation) json.nodes[0].translation = opts.rootTranslation;
  if (opts.extras) json.nodes[0].extras = opts.extras;
  const chunks = []; let byteLen = 0;
  const addView = (u8, target) => {
    const pad = (4 - (byteLen % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
    const bv = { buffer: 0, byteOffset: byteLen, byteLength: u8.byteLength };
    if (target) bv.target = target;
    json.bufferViews.push(bv);
    chunks.push(u8); byteLen += u8.byteLength;
    return json.bufferViews.length - 1;
  };
  const addAccessor = (arr, type, compType, extra = {}) => {
    const view = addView(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), extra.indices ? 34963 : 34962);
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: view, componentType: compType, count: arr.length / comps, type };
    if (extra.min) { acc.min = extra.min; acc.max = extra.max; }
    json.accessors.push(acc);
    return json.accessors.length - 1;
  };
  // materiales
  const matIndex = new Map(); const imgIndex = new Map();
  const getMaterial = (m) => {
    const k = materialKey(m);
    if (matIndex.has(k)) return matIndex.get(k);
    const mat = { name: 'mat_' + json.materials.length, doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 1 } };
    const tf = m.texKey ? texFiles.get(m.texKey) : null;
    if (tf) {
      if (!imgIndex.has(m.texKey)) {
        json.images = json.images || []; json.textures = json.textures || []; json.samplers = json.samplers || [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
        const bv = addView(tf.bytes);
        json.images.push({ name: tf.name, bufferView: bv, mimeType: tf.mime });
        json.textures.push({ sampler: 0, source: json.images.length - 1 });
        imgIndex.set(m.texKey, json.textures.length - 1);
      }
      mat.pbrMetallicRoughness.baseColorTexture = { index: imgIndex.get(m.texKey) };
      mat.name = 'mat_' + tf.name.replace(/\.\w+$/, '');
    } else if (m.color) {
      mat.pbrMetallicRoughness.baseColorFactor = [m.color[0], m.color[1], m.color[2], m.color[3] ?? 1].map((x) => Math.min(1, Math.max(0, x)));
    } else mat.pbrMetallicRoughness.baseColorFactor = [0.8, 0.8, 0.8, 1];
    json.materials.push(mat);
    matIndex.set(k, json.materials.length - 1);
    return json.materials.length - 1;
  };
  for (const m of meshes) {
    if (!m.indices.length) continue;
    const b = bounds(m.positions);
    const attributes = { POSITION: addAccessor(m.positions, 'VEC3', 5126, { min: b.mn, max: b.mx }) };
    if (m.uvs && m.texKey && texFiles.get(m.texKey)) attributes.TEXCOORD_0 = addAccessor(m.uvs, 'VEC2', 5126);
    if (m.colors) attributes.COLOR_0 = addAccessor(m.colors, 'VEC4', 5126);
    const indices = addAccessor(m.indices, 'SCALAR', 5125, { indices: true });
    json.meshes.push({ name: safeName(m.name), primitives: [{ attributes, indices, material: getMaterial(m), mode: 4 }] });
    json.nodes.push({ name: safeName(m.name), mesh: json.meshes.length - 1 });
    json.nodes[0].children.push(json.nodes.length - 1);
  }
  const pad = (4 - (byteLen % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
  json.buffers[0].byteLength = byteLen;
  if (!json.materials.length) delete json.materials;
  let jb = enc.encode(JSON.stringify(json));
  const jpad = (4 - (jb.length % 4)) % 4;
  if (jpad) jb = concat([jb, enc.encode(' '.repeat(jpad))]);
  const head = new Uint8Array(20); const hv = new DataView(head.buffer);
  const total = 12 + 8 + jb.length + 8 + byteLen;
  hv.setUint32(0, 0x46546C67, true); hv.setUint32(4, 2, true); hv.setUint32(8, total, true);
  hv.setUint32(12, jb.length, true); hv.setUint32(16, 0x4E4F534A, true);
  const binHead = new Uint8Array(8); const bhv = new DataView(binHead.buffer);
  bhv.setUint32(0, byteLen, true); bhv.setUint32(4, 0x004E4942, true);
  return concat([head, jb, binHead, ...chunks]);
}

// ------------------------------------------------------------------ OBJ + MTL + texturas (ZIP)
export async function exportOBJ(meshes, textures, opts = {}) {
  meshes = noTexWithoutUV(meshes);
  const texFiles = await collectTextures(meshes, textures);
  const base = safeName(opts.baseName || 'captura');
  const lines = [`# Captar malla (AGOIN) - ${new Date().toISOString()}`];
  if (opts.comment) lines.push('# ' + opts.comment);
  lines.push(`mtllib ${base}.mtl`);
  const mtl = ['# Captar malla (AGOIN)'];
  const mats = new Map();
  const matName = (m) => {
    const k = materialKey(m);
    if (mats.has(k)) return mats.get(k);
    const name = 'mat_' + mats.size;
    mats.set(k, name);
    mtl.push('', `newmtl ${name}`, 'Ka 0 0 0', 'Ks 0 0 0', 'Ns 0', 'illum 1');
    const tf = m.texKey ? texFiles.get(m.texKey) : null;
    if (tf) mtl.push('Kd 1 1 1', `map_Kd textures/${tf.name}`);
    else { const c = m.color || [0.8, 0.8, 0.8, 1]; mtl.push(`Kd ${c[0].toFixed(4)} ${c[1].toFixed(4)} ${c[2].toFixed(4)}`); if (c[3] < 1) mtl.push(`d ${c[3].toFixed(3)}`); }
    return name;
  };
  const f = (x) => { const s = x.toFixed(5); return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; };
  let vBase = 1, tBase = 1;
  // (cada pieza se pasa a bytes por separado: un único texto de cientos de MB no cabe en una cadena)
  const out = [enc.encode(lines.join('\n') + '\n')];
  for (const m of meshes) {
    if (!m.indices.length) continue;
    const buf = [];
    buf.push(`o ${safeName(m.name)}`);
    const p = m.positions, n = p.length / 3;
    const hasT = !!(m.uvs && m.texKey && texFiles.get(m.texKey));
    for (let i = 0; i < n; i++) {
      let s = `v ${f(p[i * 3])} ${f(p[i * 3 + 1])} ${f(p[i * 3 + 2])}`;
      if (m.colors) s += ` ${f(m.colors[i * 4])} ${f(m.colors[i * 4 + 1])} ${f(m.colors[i * 4 + 2])}`;
      buf.push(s);
    }
    if (hasT) for (let i = 0; i < n; i++) buf.push(`vt ${f(m.uvs[i * 2])} ${f(1 - m.uvs[i * 2 + 1])}`);
    buf.push(`usemtl ${matName(m)}`);
    const I = m.indices;
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i] + vBase, b = I[i + 1] + vBase, c = I[i + 2] + vBase;
      if (hasT) { const ta = I[i] + tBase, tb = I[i + 1] + tBase, tc = I[i + 2] + tBase; buf.push(`f ${a}/${ta} ${b}/${tb} ${c}/${tc}`); }
      else buf.push(`f ${a} ${b} ${c}`);
    }
    vBase += n; if (hasT) tBase += n;
    out.push(enc.encode(buf.join('\n') + '\n'));
  }
  const files = [{ name: `${base}.obj`, bytes: concat(out) }, { name: `${base}.mtl`, bytes: enc.encode(mtl.join('\n') + '\n') }];
  for (const tf of texFiles.values()) if (tf) files.push({ name: `textures/${tf.name}`, bytes: tf.bytes });
  return zip(files);
}

// ------------------------------------------------------------------ STL binario
export function exportSTL(meshes, opts = {}) {
  let nt = 0; for (const m of meshes) nt += m.indices.length / 3;
  const out = new Uint8Array(84 + nt * 50);
  const dv = new DataView(out.buffer);
  out.set(enc.encode(('Captar malla (AGOIN) ' + (opts.comment || '')).slice(0, 79)), 0);
  dv.setUint32(80, nt, true);
  let o = 84;
  for (const m of meshes) {
    const p = m.positions, I = m.indices;
    for (let i = 0; i < I.length; i += 3) {
      const a = I[i], b = I[i + 1], c = I[i + 2];
      const nrm = triNormal(p, a, b, c);
      dv.setFloat32(o, nrm[0], true); dv.setFloat32(o + 4, nrm[1], true); dv.setFloat32(o + 8, nrm[2], true); o += 12;
      for (const v of [a, b, c]) { dv.setFloat32(o, p[v * 3], true); dv.setFloat32(o + 4, p[v * 3 + 1], true); dv.setFloat32(o + 8, p[v * 3 + 2], true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return out;
}

// ------------------------------------------------------------------ FBX binario 7.4 (texturas incrustadas)
// Estructura mínima compatible con Blender, 3ds Max, Maya, SketchUp, Unity y el SDK de Autodesk.
class FbxNode {
  constructor(name, props = [], children = []) { this.name = name; this.props = props; this.children = children; }
  add(n) { this.children.push(n); return n; }
}
const P = {
  I: (v) => ({ t: 'I', v }), L: (v) => ({ t: 'L', v }), D: (v) => ({ t: 'D', v }), S: (v) => ({ t: 'S', v }), C: (v) => ({ t: 'C', v }),
  F: (v) => ({ t: 'F', v }), Y: (v) => ({ t: 'Y', v }), R: (v) => ({ t: 'R', v }),
  di: (v) => ({ t: 'd', v }), ii: (v) => ({ t: 'i', v }), li: (v) => ({ t: 'l', v }), fi: (v) => ({ t: 'f', v }),
};
function propBytes(p) {
  const head = enc.encode(p.t);
  switch (p.t) {
    case 'I': { const b = new Uint8Array(5); b[0] = head[0]; new DataView(b.buffer).setInt32(1, p.v, true); return b; }
    case 'Y': { const b = new Uint8Array(3); b[0] = head[0]; new DataView(b.buffer).setInt16(1, p.v, true); return b; }
    case 'C': return new Uint8Array([head[0], p.v ? 1 : 0]);
    case 'F': { const b = new Uint8Array(5); b[0] = head[0]; new DataView(b.buffer).setFloat32(1, p.v, true); return b; }
    case 'D': { const b = new Uint8Array(9); b[0] = head[0]; new DataView(b.buffer).setFloat64(1, p.v, true); return b; }
    case 'L': { const b = new Uint8Array(9); b[0] = head[0]; new DataView(b.buffer).setBigInt64(1, BigInt(p.v), true); return b; }
    case 'S': case 'R': {
      const s = p.t === 'S' ? (typeof p.v === 'string' ? enc.encode(p.v) : p.v) : p.v;
      const b = new Uint8Array(5 + s.length); b[0] = head[0]; new DataView(b.buffer).setUint32(1, s.length, true); b.set(s, 5); return b;
    }
    case 'd': case 'i': case 'l': case 'f': {
      const arr = p.v; const n = arr.length;
      const es = p.t === 'd' || p.t === 'l' ? 8 : 4;
      const b = new Uint8Array(13 + n * es); const dv = new DataView(b.buffer);
      b[0] = head[0]; dv.setUint32(1, n, true); dv.setUint32(5, 0, true); dv.setUint32(9, n * es, true);
      if (p.t === 'd') { for (let i = 0; i < n; i++) dv.setFloat64(13 + i * 8, arr[i], true); }
      else if (p.t === 'f') { for (let i = 0; i < n; i++) dv.setFloat32(13 + i * 4, arr[i], true); }
      else if (p.t === 'i') { for (let i = 0; i < n; i++) dv.setInt32(13 + i * 4, arr[i], true); }
      else { for (let i = 0; i < n; i++) dv.setBigInt64(13 + i * 8, BigInt(arr[i]), true); }
      return b;
    }
  }
  throw new Error('tipo FBX desconocido ' + p.t);
}
function writeFbxNode(node, out, offset) {
  // devuelve el nuevo desplazamiento; out es un array de Uint8Array
  const name = enc.encode(node.name);
  const props = node.props.map(propBytes);
  let plen = 0; for (const b of props) plen += b.length;
  const head = new Uint8Array(13 + name.length);
  out.push(head);
  let pos = offset + head.length;
  for (const b of props) { out.push(b); pos += b.length; }
  const needNull = node.children.length > 0 || node.props.length === 0;
  for (const c of node.children) pos = writeFbxNode(c, out, pos);
  if (needNull) { out.push(new Uint8Array(13)); pos += 13; }
  const dv = new DataView(head.buffer);
  dv.setUint32(0, pos, true); dv.setUint32(4, node.props.length, true); dv.setUint32(8, plen, true);
  head[12] = name.length; head.set(name, 13);
  return pos;
}
const P70 = (...entries) => new FbxNode('Properties70', [], entries.map((e) => new FbxNode('P', e)));
const pS = (n, t1, t2, f, ...v) => [P.S(n), P.S(t1), P.S(t2), P.S(f), ...v];
const fbxName = (name, cls) => concat([enc.encode(name), new Uint8Array([0, 1]), enc.encode(cls)]);

export async function exportFBX(meshes, textures, opts = {}) {
  meshes = noTexWithoutUV(meshes);
  const texFiles = await collectTextures(meshes, textures);
  let nextId = 1000000;
  const id = () => nextId++;
  const objects = new FbxNode('Objects');
  const conns = new FbxNode('Connections');
  const counts = { Model: 0, Geometry: 0, Material: 0, Texture: 0, Video: 0 };
  const matIds = new Map(); const texIds = new Map();
  const makeMaterial = (m) => {
    const k = materialKey(m);
    if (matIds.has(k)) return matIds.get(k);
    const mid = id(); counts.Material++;
    const name = 'mat_' + matIds.size;
    const c = m.texKey && texFiles.get(m.texKey) ? [1, 1, 1] : (m.color || [0.8, 0.8, 0.8]);
    objects.add(new FbxNode('Material', [P.L(mid), P.S(fbxName(name, 'Material')), P.S('')], [
      new FbxNode('Version', [P.I(102)]), new FbxNode('ShadingModel', [P.S('lambert')]), new FbxNode('MultiLayer', [P.I(0)]),
      P70(pS('DiffuseColor', 'Color', '', 'A', P.D(c[0]), P.D(c[1]), P.D(c[2])), pS('DiffuseFactor', 'Number', '', 'A', P.D(1)),
        pS('AmbientColor', 'Color', '', 'A', P.D(0), P.D(0), P.D(0)), pS('SpecularFactor', 'Number', '', 'A', P.D(0)),
        pS('Emissive', 'Vector3D', 'Vector', '', P.D(0), P.D(0), P.D(0)), pS('Opacity', 'double', 'Number', '', P.D(m.color && m.color[3] !== undefined && !m.texKey ? m.color[3] : 1))),
    ]));
    const tf = m.texKey ? texFiles.get(m.texKey) : null;
    if (tf) {
      let tid = texIds.get(m.texKey);
      if (!tid) {
        tid = id(); const vid = id(); counts.Texture++; counts.Video++;
        const rel = 'textures/' + tf.name;
        const base = tf.name.replace(/\.\w+$/, '');
        objects.add(new FbxNode('Video', [P.L(vid), P.S(fbxName(base, 'Video')), P.S('Clip')], [
          new FbxNode('Type', [P.S('Clip')]),
          P70(pS('Path', 'KString', 'XRefUrl', '', P.S(rel)), pS('RelPath', 'KString', 'XRefUrl', '', P.S(rel))),
          new FbxNode('UseMipMap', [P.I(0)]), new FbxNode('Filename', [P.S(rel)]), new FbxNode('RelativeFilename', [P.S(rel)]),
          ...(opts.embedTextures === false ? [] : [new FbxNode('Content', [P.R(tf.bytes)])]),
        ]));
        objects.add(new FbxNode('Texture', [P.L(tid), P.S(fbxName(base, 'Texture')), P.S('')], [
          new FbxNode('Type', [P.S('TextureVideoClip')]), new FbxNode('Version', [P.I(202)]),
          new FbxNode('TextureName', [P.S(fbxName(base, 'Texture'))]),
          P70(pS('UseMaterial', 'bool', '', '', P.I(1))),
          new FbxNode('Media', [P.S(fbxName(base, 'Video'))]), new FbxNode('FileName', [P.S(rel)]), new FbxNode('RelativeFilename', [P.S(rel)]),
          new FbxNode('ModelUVTranslation', [P.D(0), P.D(0)]), new FbxNode('ModelUVScaling', [P.D(1), P.D(1)]),
          new FbxNode('Texture_Alpha_Source', [P.S('None')]), new FbxNode('Cropping', [P.I(0), P.I(0), P.I(0), P.I(0)]),
        ]));
        conns.add(new FbxNode('C', [P.S('OO'), P.L(vid), P.L(tid)]));
        texIds.set(m.texKey, tid);
      }
      conns.add(new FbxNode('C', [P.S('OP'), P.L(tid), P.L(mid), P.S('DiffuseColor')]));
    }
    matIds.set(k, mid);
    return mid;
  };
  const used = new Set();
  for (const m of meshes) {
    if (!m.indices.length) continue;
    let nm = safeName(m.name); while (used.has(nm)) nm += '_'; used.add(nm);
    const gid = id(), mid = id(); counts.Geometry++; counts.Model++;
    const p = m.positions;
    const verts = new Float64Array(p.length); for (let i = 0; i < p.length; i++) verts[i] = p[i];
    const I = m.indices; const pvi = new Int32Array(I.length);
    for (let i = 0; i < I.length; i += 3) { pvi[i] = I[i]; pvi[i + 1] = I[i + 1]; pvi[i + 2] = ~I[i + 2]; }
    const geo = new FbxNode('Geometry', [P.L(gid), P.S(fbxName(nm, 'Geometry')), P.S('Mesh')], [
      new FbxNode('Properties70'),
      new FbxNode('GeometryVersion', [P.I(124)]),
      new FbxNode('Vertices', [P.di(verts)]),
      new FbxNode('PolygonVertexIndex', [P.ii(pvi)]),
    ]);
    const layer = new FbxNode('Layer', [P.I(0)], [new FbxNode('Version', [P.I(100)])]);
    const hasT = !!(m.uvs && m.texKey && texFiles.get(m.texKey));
    if (hasT) {
      const uv = new Float64Array(m.uvs.length);
      for (let i = 0; i < m.uvs.length; i += 2) { uv[i] = m.uvs[i]; uv[i + 1] = 1 - m.uvs[i + 1]; }
      geo.add(new FbxNode('LayerElementUV', [P.I(0)], [
        new FbxNode('Version', [P.I(101)]), new FbxNode('Name', [P.S('UVMap')]),
        new FbxNode('MappingInformationType', [P.S('ByPolygonVertex')]), new FbxNode('ReferenceInformationType', [P.S('IndexToDirect')]),
        new FbxNode('UV', [P.di(uv)]), new FbxNode('UVIndex', [P.ii(Int32Array.from(I))]),
      ]));
      layer.add(new FbxNode('LayerElement', [], [new FbxNode('Type', [P.S('LayerElementUV')]), new FbxNode('TypedIndex', [P.I(0)])]));
    }
    if (m.colors) {
      const col = new Float64Array(m.colors.length); for (let i = 0; i < col.length; i++) col[i] = m.colors[i];
      geo.add(new FbxNode('LayerElementColor', [P.I(0)], [
        new FbxNode('Version', [P.I(101)]), new FbxNode('Name', [P.S('Col')]),
        new FbxNode('MappingInformationType', [P.S('ByPolygonVertex')]), new FbxNode('ReferenceInformationType', [P.S('IndexToDirect')]),
        new FbxNode('Colors', [P.di(col)]), new FbxNode('ColorIndex', [P.ii(Int32Array.from(I))]),
      ]));
      layer.add(new FbxNode('LayerElement', [], [new FbxNode('Type', [P.S('LayerElementColor')]), new FbxNode('TypedIndex', [P.I(0)])]));
    }
    geo.add(new FbxNode('LayerElementMaterial', [P.I(0)], [
      new FbxNode('Version', [P.I(101)]), new FbxNode('Name', [P.S('')]),
      new FbxNode('MappingInformationType', [P.S('AllSame')]), new FbxNode('ReferenceInformationType', [P.S('IndexToDirect')]),
      new FbxNode('Materials', [P.ii(new Int32Array([0]))]),
    ]));
    layer.add(new FbxNode('LayerElement', [], [new FbxNode('Type', [P.S('LayerElementMaterial')]), new FbxNode('TypedIndex', [P.I(0)])]));
    geo.add(layer);
    objects.add(geo);
    objects.add(new FbxNode('Model', [P.L(mid), P.S(fbxName(nm, 'Model')), P.S('Mesh')], [
      new FbxNode('Version', [P.I(232)]),
      P70(pS('Lcl Translation', 'Lcl Translation', '', 'A', P.D(0), P.D(0), P.D(0)), pS('Lcl Rotation', 'Lcl Rotation', '', 'A', P.D(0), P.D(0), P.D(0)),
        pS('Lcl Scaling', 'Lcl Scaling', '', 'A', P.D(1), P.D(1), P.D(1)), pS('DefaultAttributeIndex', 'int', 'Integer', '', P.I(0))),
      new FbxNode('Shading', [P.C(true)]), new FbxNode('Culling', [P.S('CullingOff')]),
    ]));
    conns.add(new FbxNode('C', [P.S('OO'), P.L(mid), P.L(0)]));
    conns.add(new FbxNode('C', [P.S('OO'), P.L(gid), P.L(mid)]));
    conns.add(new FbxNode('C', [P.S('OO'), P.L(makeMaterial(m)), P.L(mid)]));
  }
  // cabecera y ajustes globales (Y arriba; 1 unidad = opts.unitCm cm, por defecto metros)
  const unitCm = opts.unitCm || 100;
  const now = new Date();
  const header = new FbxNode('FBXHeaderExtension', [], [
    new FbxNode('FBXHeaderVersion', [P.I(1003)]), new FbxNode('FBXVersion', [P.I(7400)]), new FbxNode('EncryptionType', [P.I(0)]),
    new FbxNode('CreationTimeStamp', [], [new FbxNode('Version', [P.I(1000)]), new FbxNode('Year', [P.I(now.getFullYear())]), new FbxNode('Month', [P.I(now.getMonth() + 1)]),
      new FbxNode('Day', [P.I(now.getDate())]), new FbxNode('Hour', [P.I(now.getHours())]), new FbxNode('Minute', [P.I(now.getMinutes())]),
      new FbxNode('Second', [P.I(now.getSeconds())]), new FbxNode('Millisecond', [P.I(0)])]),
    new FbxNode('Creator', [P.S('Captar malla (AGOIN)')]),
  ]);
  const globals = new FbxNode('GlobalSettings', [], [new FbxNode('Version', [P.I(1000)]), P70(
    pS('UpAxis', 'int', 'Integer', '', P.I(1)), pS('UpAxisSign', 'int', 'Integer', '', P.I(1)),
    pS('FrontAxis', 'int', 'Integer', '', P.I(2)), pS('FrontAxisSign', 'int', 'Integer', '', P.I(1)),
    pS('CoordAxis', 'int', 'Integer', '', P.I(0)), pS('CoordAxisSign', 'int', 'Integer', '', P.I(1)),
    pS('OriginalUpAxis', 'int', 'Integer', '', P.I(1)), pS('OriginalUpAxisSign', 'int', 'Integer', '', P.I(1)),
    pS('UnitScaleFactor', 'double', 'Number', '', P.D(unitCm)), pS('OriginalUnitScaleFactor', 'double', 'Number', '', P.D(unitCm)),
    pS('AmbientColor', 'ColorRGB', 'Color', '', P.D(0), P.D(0), P.D(0)), pS('DefaultCamera', 'KString', '', '', P.S('Producer Perspective')),
    pS('TimeMode', 'enum', '', '', P.I(11)), pS('TimeSpanStart', 'KTime', 'Time', '', P.L(0)), pS('TimeSpanStop', 'KTime', 'Time', '', P.L(46186158000)),
  )]);
  const docId = id();
  const documents = new FbxNode('Documents', [], [new FbxNode('Count', [P.I(1)]),
    new FbxNode('Document', [P.L(docId), P.S(''), P.S('Scene')], [P70(pS('SourceObject', 'object', '', ''), pS('ActiveAnimStackName', 'KString', '', '', P.S(''))), new FbxNode('RootNode', [P.L(0)])])]);
  const defs = new FbxNode('Definitions', [], [new FbxNode('Version', [P.I(100)])]);
  let total = 1;
  defs.add(new FbxNode('ObjectType', [P.S('GlobalSettings')], [new FbxNode('Count', [P.I(1)])]));
  for (const [k, n] of Object.entries(counts)) { if (!n) continue; total += n; defs.add(new FbxNode('ObjectType', [P.S(k)], [new FbxNode('Count', [P.I(n)])])); }
  defs.children.splice(1, 0, new FbxNode('Count', [P.I(total)]));
  const root = [
    header,
    new FbxNode('FileId', [P.R(new Uint8Array([0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1]))]),
    new FbxNode('CreationTime', [P.S('1970-01-01 10:00:00:000')]),
    new FbxNode('Creator', [P.S('Captar malla (AGOIN)')]),
    globals, documents, new FbxNode('References'), defs, objects, conns,
    new FbxNode('Takes', [], [new FbxNode('Current', [P.S('')])]),
  ];
  const out = [];
  const magic = concat([enc.encode('Kaydara FBX Binary  '), new Uint8Array([0, 0x1a, 0])]);
  const ver = new Uint8Array(4); new DataView(ver.buffer).setUint32(0, 7400, true);
  out.push(magic, ver);
  let pos = magic.length + 4;
  for (const n of root) pos = writeFbxNode(n, out, pos);
  out.push(new Uint8Array(13)); pos += 13;
  // pie del archivo (igual que el exportador de Blender)
  out.push(new Uint8Array([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e])); pos += 16;
  let pad = ((pos + 15) & ~15) - pos; if (pad === 0) pad = 16;
  out.push(new Uint8Array(pad)); pos += pad;
  out.push(ver); out.push(new Uint8Array(120));
  out.push(new Uint8Array([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]));
  return concat(out);
}
