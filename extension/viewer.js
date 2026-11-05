// Captar malla — visor: vista 3D de la captura, selección, recorte y descarga.
import * as THREE from './lib/three.module.min.js';
import { OrbitControls } from './lib/OrbitControls.js';
import { parsePart, buildScene, packFile, unpackFile } from './lib/decode.js';
import * as X from './lib/exporters.js';
import { listCaptures, loadCapture, deleteCapture, saveCapture, updateMeta } from './lib/store.js';

// Codificar y decodificar imágenes con el navegador (JPEG para fotos: archivos mucho más ligeros)
X.setImageCodec({
  async encode(rgba, w, h, { opaque, quality }) {
    const cv = new OffscreenCanvas(w, h);
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4), w, h), 0, 0);
    const type = opaque ? 'image/jpeg' : 'image/png';
    const blob = await cv.convertToBlob(opaque ? { type, quality: quality || 0.9 } : { type });
    return { kind: opaque ? 'jpeg' : 'png', bytes: new Uint8Array(await blob.arrayBuffer()) };
  },
  async decode(bytes, kind) {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/' + kind }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const cv = new OffscreenCanvas(bmp.width, bmp.height); const cx = cv.getContext('2d');
    cx.drawImage(bmp, 0, 0); bmp.close();
    return new Uint8Array(cx.getImageData(0, 0, cv.width, cv.height).data.buffer);
  },
});
const params = new URLSearchParams(location.search);

const $ = (id) => document.getElementById(id);
const fmtN = (n) => Math.round(n).toLocaleString('es-ES');
const fmtMB = (b) => (b / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' MB';

const S = {
  id: null, meta: null, scene: null, up: 'Y', geo: false,
  groupsOn: new Set(), hidden: new Set(), hideSmall: true,
  crop: { on: false, center: [0, 0, 0], radius: 250 },
  objs: new Map(), // meshId -> THREE.Mesh
  tex: new Map(), showTex: true, wire: false, selected: null,
  bbox: null, area: null, previewMax: 0,
};

// ------------------------------------------------------------------ 3D
const canvas = $('lienzo');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene3 = new THREE.Scene();
scene3.background = new THREE.Color(0x2a3138);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1e7);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
scene3.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(1, 2, 3); scene3.add(sun);
const root = new THREE.Group(); scene3.add(root);
let grid = null, ring = null;
let needsRender = true;
const requestRender = () => { needsRender = true; };
controls.addEventListener('change', requestRender);
function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); requestRender();
}
window.addEventListener('resize', resize);
(function loop() { if (needsRender) { needsRender = false; renderer.render(scene3, camera); } requestAnimationFrame(loop); })();

function upVec() { return S.up === 'Z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0); }
// OrbitControls fija su eje de giro al crearse: hay que recalcularlo si la escena tiene Z arriba
function setUpAxis() {
  camera.up.copy(upVec());
  if (controls._quat) {
    controls._quat.setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
    controls._quatInverse.copy(controls._quat).invert();
  }
}
function frameAll(top = false) {
  const box = new THREE.Box3();
  for (const o of S.objs.values()) if (o.visible && o.geometry.boundingBox) box.union(o.geometry.boundingBox);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.6 || 10;
  setUpAxis();
  const dist = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
  let dir;
  if (top) dir = upVec().clone().add(S.up === 'Z' ? new THREE.Vector3(0, -0.001, 0) : new THREE.Vector3(0, 0, 0.001));
  else dir = S.up === 'Z' ? new THREE.Vector3(0.6, -0.9, 0.7) : new THREE.Vector3(0.7, 0.6, 0.9);
  dir.normalize();
  camera.position.copy(c).addScaledVector(dir, dist);
  camera.near = Math.max(0.01, dist / 2000); camera.far = dist * 50 + r * 10; camera.updateProjectionMatrix();
  controls.target.copy(c); controls.update(); requestRender();
}
function updateGridAndRing() {
  if (grid) { scene3.remove(grid); grid.geometry.dispose(); grid = null; }
  if (ring) { scene3.remove(ring); ring.geometry.dispose(); ring = null; }
  const box = new THREE.Box3();
  for (const o of S.objs.values()) if (o.visible && o.geometry.boundingBox) box.union(o.geometry.boundingBox);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, S.up === 'Z' ? size.y : size.z);
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(1e-3, span / 10))));
  const n = Math.min(400, Math.ceil(span / step) + 2);
  grid = new THREE.GridHelper(n * step, n, 0x5d6b77, 0x3b454e);
  const base = S.up === 'Z' ? box.min.z : box.min.y;
  const c = box.getCenter(new THREE.Vector3());
  if (S.up === 'Z') { grid.rotation.x = Math.PI / 2; grid.position.set(Math.round(c.x / step) * step, Math.round(c.y / step) * step, base); }
  else grid.position.set(Math.round(c.x / step) * step, base, Math.round(c.z / step) * step);
  scene3.add(grid);
  if (S.crop.on) {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = i / 96 * Math.PI * 2, r = S.crop.radius, [cx, cy, cz] = S.crop.center;
      pts.push(S.up === 'Z' ? new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), base + 0.05) : new THREE.Vector3(cx + r * Math.cos(a), base + 0.05, cz + r * Math.sin(a)));
    }
    ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffb020 }));
    scene3.add(ring);
  }
  requestRender();
}

// ------------------------------------------------------------------ texturas
async function getTexture(key) {
  if (S.tex.has(key)) return S.tex.get(key);
  const p = (async () => {
    const t = S.scene.textures.get(key);
    if (!t) return null;
    let tex;
    if (t.kind === 'jpeg' || t.kind === 'png') {
      const o = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
      // atlas grandes: en pantalla basta una copia reducida (el archivo guardado lleva la original)
      if (S.previewMax && Math.max(t.w, t.h) > S.previewMax) { const k = S.previewMax / Math.max(t.w, t.h); o.resizeWidth = Math.round(t.w * k); o.resizeHeight = Math.round(t.h * k); o.resizeQuality = 'high'; }
      const bmp = await createImageBitmap(new Blob([t.bytes], { type: 'image/' + t.kind }), o);
      tex = new THREE.Texture(bmp);
    } else {
      const rgba = X.textureRGBA(t);
      if (!rgba) return null;
      tex = new THREE.DataTexture(rgba, t.w, t.h, THREE.RGBAFormat);
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    }
    tex.flipY = false; // la fila 0 de la imagen es t=0, igual que en la página original
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  })();
  S.tex.set(key, p);
  return p;
}

// ------------------------------------------------------------------ mallas
function geometryFor(m) {
  const src = S.crop.on ? X.cropMesh(m, S.crop, S.up) : m;
  if (!src) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(src.positions, 3));
  if (src.uvs) g.setAttribute('uv', new THREE.BufferAttribute(src.uvs, 2));
  if (src.colors) g.setAttribute('color', new THREE.BufferAttribute(src.colors, 4));
  g.setIndex(new THREE.BufferAttribute(src.indices, 1));
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.tris = src.indices.length / 3;
  return g;
}
function plainMaterial(m) {
  if (m.colors) return new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const c = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(0.75, 0.75, 0.75);
  return new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide, transparent: !!(m.color && m.color[3] < 0.99), opacity: m.color ? m.color[3] : 1 });
}
function buildObjects() {
  for (const o of S.objs.values()) { root.remove(o); o.geometry.dispose(); }
  S.objs.clear();
  for (const m of S.scene.meshes) {
    const g = geometryFor(m);
    if (!g) continue;
    const plain = plainMaterial(m);
    const obj = new THREE.Mesh(g, plain);
    obj.userData = { mesh: m, plain, textured: null };
    if (m.texKey) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      obj.userData.textured = mat;
      getTexture(m.texKey).then((t) => { if (t) { mat.map = t; mat.needsUpdate = true; applyMaterial(obj); requestRender(); } });
    }
    applyMaterial(obj);
    root.add(obj);
    S.objs.set(m.id, obj);
  }
  updateVisibility();
}
function applyMaterial(obj) {
  const u = obj.userData;
  const mat = S.showTex && u.textured && u.textured.map ? u.textured : u.plain;
  obj.material = mat;
  mat.wireframe = S.wire;
  const sel = S.selected === obj;
  if (mat.isMeshBasicMaterial) mat.color.set(sel ? 0xffa060 : 0xffffff);
  else mat.emissive && mat.emissive.set(sel ? 0x884400 : 0x000000);
}
function isVisible(m) {
  return S.groupsOn.has(m.group) && !S.hidden.has(m.id) && !(S.hideSmall && m.small);
}
function updateVisibility() {
  let n = 0, t = 0;
  for (const [id, o] of S.objs) {
    const v = isVisible(o.userData.mesh);
    o.visible = v;
    if (v) { n++; t += o.geometry.userData.tris; }
  }
  $('cuenta').textContent = `Se exportará: ${fmtN(n)} pieza${n === 1 ? '' : 's'} · ${fmtN(t)} triángulos`;
  for (const b of document.querySelectorAll('button.fmt')) b.disabled = n === 0;
  $('mostrarTodo').disabled = S.hidden.size === 0;
  $('mostrarTodo').textContent = S.hidden.size ? `Mostrar todo (${S.hidden.size} oculta${S.hidden.size > 1 ? 's' : ''})` : 'Mostrar todo';
  updateGridAndRing();
  requestRender();
}
let cropTimer = null;
function rebuildCrop() {
  clearTimeout(cropTimer);
  cropTimer = setTimeout(() => {
    for (const [id, o] of S.objs) {
      const g = geometryFor(o.userData.mesh);
      o.geometry.dispose();
      o.geometry = g || new THREE.BufferGeometry();
      if (!g) { o.geometry.userData.tris = 0; o.geometry.boundingBox = null; }
    }
    updateVisibility();
  }, 150);
}

// ------------------------------------------------------------------ selección y recorte con el ratón
const ray = new THREE.Raycaster();
function pick(ev) {
  const r = canvas.getBoundingClientRect();
  const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(p, camera);
  const vis = [...S.objs.values()].filter((o) => o.visible);
  const hit = ray.intersectObjects(vis, false)[0];
  return hit || null;
}
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || e.button !== 0) return;
  const h = pick(e);
  const prev = S.selected;
  S.selected = h ? h.object : null;
  if (prev) applyMaterial(prev);
  if (S.selected) applyMaterial(S.selected);
  const m = S.selected && S.selected.userData.mesh;
  $('selTxt').textContent = m ? `${m.name}: ${fmtN(S.selected.geometry.userData.tris)} triángulos${m.texKey ? ', con textura' : ''}.` : 'Haz clic en una pieza para seleccionarla.';
  $('ocultarSel').disabled = !m;
  requestRender();
});
canvas.addEventListener('dblclick', (e) => {
  const h = pick(e);
  if (!h) return;
  S.crop.center = [h.point.x, h.point.y, h.point.z];
  S.crop.on = true; $('recorteOn').checked = true;
  $('centroTxt').textContent = `(${h.point.x.toFixed(1)}, ${h.point.y.toFixed(1)}, ${h.point.z.toFixed(1)})`;
  rebuildCrop();
});
$('ocultarSel').addEventListener('click', () => {
  if (!S.selected) return;
  S.hidden.add(S.selected.userData.mesh.id);
  const o = S.selected; S.selected = null; applyMaterial(o);
  $('ocultarSel').disabled = true; $('selTxt').textContent = 'Pieza ocultada (no se exportará).';
  updateVisibility();
});
$('mostrarTodo').addEventListener('click', () => { S.hidden.clear(); updateVisibility(); });

// ------------------------------------------------------------------ panel
function renderGroups() {
  const box = $('grupos'); box.innerHTML = '';
  for (const g of S.scene.groups) {
    if (!g.meshes && !g.reason) continue;
    const row = document.createElement('label'); row.className = 'grupo';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = S.groupsOn.has(g.key); cb.disabled = !g.meshes;
    cb.addEventListener('change', () => { if (cb.checked) S.groupsOn.add(g.key); else S.groupsOn.delete(g.key); updateVisibility(); });
    const txt = document.createElement('div');
    txt.innerHTML = `<div class="nom"></div><div class="dat"></div>${g.reason ? '<div class="mot"></div>' : ''}`;
    txt.querySelector('.nom').textContent = g.label + (g.realm === 'worker' ? ' (worker)' : '');
    txt.querySelector('.dat').textContent = `${fmtN(g.meshes)} pieza${g.meshes === 1 ? '' : 's'} · ${fmtN(g.tris)} triángulos${g.textured ? ' · con texturas' : ''}`;
    if (g.reason) txt.querySelector('.mot').textContent = 'Desmarcado: ' + g.reason;
    row.append(cb, txt); box.append(row);
  }
}
function renderSummary() {
  const sc = S.scene, info = sc.info;
  const nv = sc.meshes.reduce((a, m) => a + m.nVerts, 0);
  const nt = sc.meshes.reduce((a, m) => a + m.nTris, 0);
  $('resumen').innerHTML = '';
  const p = document.createElement('div');
  p.textContent = `${fmtN(sc.meshes.length)} piezas · ${fmtN(nv)} vértices · ${fmtN(nt)} triángulos · ${fmtN(sc.textures.size)} texturas`;
  const d = document.createElement('div'); d.className = 'ayuda';
  d.textContent = `Capturado el ${new Date(S.meta.date).toLocaleString('es-ES')} · ${fmtMB(S.meta.size)}`;
  const u = document.createElement('div'); u.className = 'ayuda'; u.textContent = S.meta.url;
  $('resumen').append(p, d, u);
  if (S.area) {
    const a = document.createElement('div');
    const A = S.area;
    a.innerHTML = `<b>Área ${fmtN(A.W)} × ${fmtN(A.H)} m</b> · ${A.cells.length} ${A.cells.length === 1 ? 'posición' : 'posiciones'} de cámara · teselas de ${A.tile.toLocaleString('es-ES', { maximumFractionDigits: 1 })} m` +
      (S.atlasInfo ? ` · ${S.atlasInfo.atlases} atlas de texturas` : '') + (S.meta.seconds ? ` · ${fmtN(S.meta.seconds)} s` : '');
    $('resumen').append(a);
  }
  const geo = $('geo');
  if (info.geo) {
    const lat = info.geo.lat, lon = info.geo.lon;
    geo.hidden = false;
    geo.innerHTML = '';
    const a = document.createElement('div');
    a.innerHTML = `<b>Georreferenciada</b> (${info.geo.source}). Origen en ${Math.abs(lat).toFixed(6)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(6)}° ${lon >= 0 ? 'E' : 'O'}${info.geo.areaCenter ? ' (el centro del rectángulo marcado)' : info.geo.fromUrl ? ' (el punto de la dirección de Google Earth)' : ''}.`;
    const b = document.createElement('div');
    b.textContent = 'Unidades: metros. X = este, Y = norte, Z = altitud sobre el nivel del mar' + (info.geo.model ? ` (modelo ${info.geo.model}; puede diferir unos metros de la altitud oficial).` : '.');
    geo.append(a, b);
  } else geo.hidden = true;
  const av = $('avisos'); av.innerHTML = '';
  const warn = [...info.warnings];
  if (!info.geo && sc.meshes.some((m) => m.transformKind === 'relativa')) warn.push('La página no envía la matriz de mundo: las piezas están bien colocadas entre sí, pero la escala y la orientación general pueden no ser las originales.');
  for (const w of warn) { const li = document.createElement('li'); li.textContent = w; av.append(li); }
  $('radioUd').textContent = info.geo ? 'm' : 'ud.';
  $('escalaTxt').textContent = info.geo ? '(1 = metros; 1000 = milímetros)' : '(las unidades son las del visor original)';
  $('filaOriginal').hidden = !!info.geo;
  $('filaSuelo').hidden = !info.geo;
  $('filaImprimir').hidden = !info.geo;
  if (info.geo) $('stlDesc').textContent = 'Sólido cerrado con base, en mm a escala. Para imprimir';
}
async function renderList() {
  const box = $('lista');
  let caps = [];
  try { caps = await listCaptures(); } catch (e) { box.textContent = 'No se pudo leer la lista: ' + e.message; return; }
  box.innerHTML = '';
  if (!caps.length) { box.innerHTML = '<p class="ayuda">Todavía no hay capturas.</p>'; return; }
  for (const c of caps) {
    const div = document.createElement('div'); div.className = 'cap' + (c.id === S.id ? ' actual' : '');
    const t = document.createElement('div'); t.className = 't'; t.textContent = c.title || c.url || c.id; t.title = c.url;
    const d = document.createElement('div'); d.className = 'd'; d.textContent = `${new Date(c.date).toLocaleString('es-ES')} · ${fmtMB(c.size)}`;
    const b = document.createElement('div'); b.className = 'b';
    const ab = document.createElement('button'); ab.textContent = c.id === S.id ? 'Abierta' : 'Abrir'; ab.disabled = c.id === S.id;
    ab.addEventListener('click', () => { location.search = '?id=' + encodeURIComponent(c.id); });
    const del = document.createElement('button'); del.textContent = 'Borrar';
    del.addEventListener('click', async () => {
      if (!confirm('¿Borrar esta captura de este ordenador? No se puede deshacer.')) return;
      await deleteCapture(c.id);
      if (c.id === S.id) location.search = ''; else renderList();
    });
    b.append(ab, del); div.append(t, d, b); box.append(div);
  }
}

// ------------------------------------------------------------------ exportación
function exportList() {
  const out = [];
  for (const m of S.scene.meshes) {
    if (!isVisible(m)) continue;
    const c = S.crop.on ? X.cropMesh(m, S.crop, S.up) : m;
    if (c && c.indices.length) out.push(c);
  }
  return out;
}
// Guarda en Descargas › Captar malla (con chrome.downloads; si no está, descarga normal).
// Devuelve { id, path } cuando el archivo ya está escrito.
async function download(bytes, name, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    if (chrome.downloads && chrome.downloads.download) {
      const id = await chrome.downloads.download({ url, filename: 'Captar malla/' + name, conflictAction: 'uniquify', saveAs: false });
      const item = await new Promise((resolve) => {
        const check = async () => { const [it] = await chrome.downloads.search({ id }); if (!it || it.state !== 'in_progress') { chrome.downloads.onChanged.removeListener(on); resolve(it || null); } };
        const on = (d) => { if (d.id === id && d.state) check(); };
        chrome.downloads.onChanged.addListener(on);
        check();
      });
      if (!item || item.state !== 'complete') throw new Error('No se pudo guardar ' + name + (item && item.error ? ' (' + item.error + ')' : ''));
      return { id, path: item.filename };
    }
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    return { id: null, path: name };
  } finally { setTimeout(() => URL.revokeObjectURL(url), 120000); }
}
// ---- STL para imprimir (capturas de Google Earth): sólido cerrado con base, en mm a escala
const STL_DEF = { scale: 0, base: 3, res: 0.3 };
function readPrintOpts() {
  const num = (id, d) => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) && v > 0 ? v : d; };
  return { scale: num('stlEscala', 0), base: num('stlBase', STL_DEF.base), res: num('stlRes', STL_DEF.res) };
}
// Las opciones se guardan junto a las del panel de Earth (las usa también el guardado automático)
async function loadPrintOpts() {
  try {
    const r = await chrome.storage.local.get('earthOpts');
    const s = Object.assign({}, STL_DEF, (r && r.earthOpts && r.earthOpts.stl) || {});
    $('stlEscala').value = s.scale > 0 ? s.scale : ''; $('stlBase').value = s.base; $('stlRes').value = s.res;
  } catch (e) { }
}
async function savePrintOpts() {
  try { const r = await chrome.storage.local.get('earthOpts'); const o = (r && r.earthOpts) || {}; o.stl = readPrintOpts(); await chrome.storage.local.set({ earthOpts: o }); } catch (e) { }
}
for (const id of ['stlEscala', 'stlBase', 'stlRes']) $(id).addEventListener('change', savePrintOpts);
// Zona para imprimir: el rectángulo del área; en una vista, el cuadrado del recorte; si no, todo lo visible
function printRect(meshes) {
  const o = S.scene.info.origin || [0, 0, 0];
  if (S.area && S.area.rect) { const r = S.area.rect; return { x0: r.e0 - o[0], y0: r.n0 - o[1], x1: r.e1 - o[0], y1: r.n1 - o[1] }; }
  if (S.crop.on) { const [cx, cy] = S.crop.center, r = S.crop.radius; return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }; }
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of meshes) { const p = m.positions; for (let i = 0; i < p.length; i += 3) { if (p[i] < b[0]) b[0] = p[i]; if (p[i] > b[2]) b[2] = p[i]; if (p[i + 1] < b[1]) b[1] = p[i + 1]; if (p[i + 1] > b[3]) b[3] = p[i + 1]; } }
  return { x0: b[0], y0: b[1], x1: b[2], y1: b[3] };
}
function printSTL(base) {
  const list = S.scene.meshes.filter((m) => isVisible(m) && m.indices.length);
  if (!list.length) throw new Error('No hay nada visible que exportar.');
  const listZ = S.up === 'Z' ? list : X.transformPositions(list, { from: S.up, to: 'Z' });
  const o = readPrintOpts();
  const g = S.scene.info.geo;
  const r = X.exportPrintSTL(listZ, printRect(listZ), { scale: o.scale, baseMM: o.base, resMM: o.res, comment: g ? `${g.lat.toFixed(5)},${g.lon.toFixed(5)}` : '' });
  const mm = (x) => x.toLocaleString('es-ES', { maximumFractionDigits: 0 });
  r.name = `${base}_imprimir_1-${r.scale}.stl`;
  r.note = `${mm(r.size[0])} × ${mm(r.size[1])} × ${mm(r.size[2])} mm a escala 1:${r.scale.toLocaleString('es-ES')}, base de ${o.base.toLocaleString('es-ES')} mm`;
  return r;
}

// Nombre con que quedó el archivo (Chrome añade « (1)» si ya existía uno igual)
function savedName(saved, name) {
  const b = String(saved && saved.path || '').split(/[\\/]/).pop();
  return b && !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(b) ? b : name; // (en las pruebas, Chrome guarda con nombres internos)
}
async function doExport(fmt, { auto = false } = {}) {
  const st = $('estadoExport');
  st.className = 'estado'; st.textContent = 'Preparando ' + fmt.toUpperCase() + '…';
  for (const b of document.querySelectorAll('button.fmt')) b.disabled = true;
  await new Promise((r) => setTimeout(r, 30));
  try {
    if (fmt === 'stl' && S.scene.info.geo) {
      const base = ($('nombre').value || 'captura').replace(/[\\/:*?"<>|]+/g, '_');
      const pr = printSTL(base);
      const saved = await download(pr.bytes, pr.name, 'model/stl');
      st.className = 'estado ok'; st.textContent = `Guardado ${savedName(saved, pr.name)} (${fmtMB(pr.bytes.length)}) en Descargas › Captar malla. Sólido cerrado de ${pr.note}.`;
      return { ok: true, name: savedName(saved, pr.name), bytes: pr.bytes.length, id: saved.id, path: saved.path, note: pr.note };
    }
    let list = exportList();
    if (!list.length) throw new Error('No hay nada visible que exportar.');
    if ($('unir').checked) list = X.mergeByMaterial(list);
    const info = S.scene.info;
    let offset = [0, 0, 0];
    if (!info.geo && $('originales').checked) offset = info.origin.slice();
    if (info.geo && $('suelo').checked) {
      let mn = Infinity; const k = S.up === 'Z' ? 2 : 1;
      for (const m of list) for (let i = k; i < m.positions.length; i += 3) if (m.positions[i] < mn) mn = m.positions[i];
      offset[k] = -mn;
    }
    const scale = parseFloat(String($('escala').value).replace(',', '.')) || 1;
    const eje = $('ejeObj').value;
    const target = fmt === 'glb' || fmt === 'fbx' ? 'Y' : eje !== 'auto' ? eje : (fmt === 'stl' ? 'Z' : 'Y');
    const ready = X.transformPositions(list, { from: S.up, to: target, scale, offset });
    const base = ($('nombre').value || 'captura').replace(/[\\/:*?"<>|]+/g, '_');
    const geoTxt = info.geo ? `origen ${info.geo.lat.toFixed(7)}, ${info.geo.lon.toFixed(7)} (${info.geo.source}); X este, Y norte, Z altitud; metros×${scale}` : '';
    let bytes, name, mime;
    if (fmt === 'glb') {
      const extras = info.geo ? { georreferencia: info.geo, nota: 'glTF tiene Y arriba: Y = altitud, -Z = norte' } : undefined;
      if (extras && S.area) extras.area = { ancho_m: S.area.W, alto_m: S.area.H, tesela_m: S.area.tile, posiciones: S.area.cells.length, desplazamiento_z_m: offset[2] || 0 };
      bytes = await X.exportGLB(ready, S.scene.textures, { sceneName: base, extras });
      name = base + '.glb'; mime = 'model/gltf-binary';
    } else if (fmt === 'fbx') {
      bytes = await X.exportFBX(ready, S.scene.textures, { unitCm: info.geo ? 100 / scale : 100 });
      name = base + '.fbx'; mime = 'application/octet-stream';
    } else if (fmt === 'obj') {
      bytes = await X.exportOBJ(ready, S.scene.textures, { baseName: base, comment: geoTxt });
      name = base + '_obj.zip'; mime = 'application/zip';
    } else {
      bytes = X.exportSTL(ready, { comment: geoTxt.slice(0, 50) });
      name = base + '.stl'; mime = 'model/stl';
    }
    const saved = await download(bytes, name, mime);
    st.className = 'estado ok'; st.textContent = `Guardado ${savedName(saved, name)} (${fmtMB(bytes.length)}) en Descargas › Captar malla.`;
    return { ok: true, name: savedName(saved, name), bytes: bytes.length, id: saved.id, path: saved.path };
  } catch (e) {
    console.error(e);
    st.className = 'estado mal'; st.textContent = 'Error: ' + (e.message || e);
    if (auto) return { ok: false, name: fmt.toUpperCase(), error: String(e.message || e) };
  } finally { updateVisibility(); }
}
for (const b of document.querySelectorAll('button.fmt')) b.addEventListener('click', () => doExport(b.dataset.fmt));

// ------------------------------------------------------------------ controles
$('ocultarPeq').addEventListener('change', (e) => { S.hideSmall = e.target.checked; updateVisibility(); });
$('recorteOn').addEventListener('change', (e) => { S.crop.on = e.target.checked; rebuildCrop(); });
const setRadius = (v) => { S.crop.radius = Math.max(1, +v || 1); $('radio').value = Math.min(+$('radio').max, S.crop.radius); $('radioNum').value = S.crop.radius; if (S.crop.on) rebuildCrop(); else updateGridAndRing(); };
$('radio').addEventListener('input', (e) => setRadius(e.target.value));
$('radioNum').addEventListener('change', (e) => setRadius(e.target.value));
$('centroOrigen').addEventListener('click', () => { S.crop.center = [0, 0, 0]; $('centroTxt').textContent = 'origen'; if (S.crop.on) rebuildCrop(); });
$('bEncuadrar').addEventListener('click', () => frameAll(false));
$('bPlanta').addEventListener('click', () => frameAll(true));
$('bTexturas').addEventListener('click', () => { S.showTex = !S.showTex; $('bTexturas').classList.toggle('on', S.showTex); for (const o of S.objs.values()) applyMaterial(o); requestRender(); });
$('bAlambre').addEventListener('click', () => { S.wire = !S.wire; $('bAlambre').classList.toggle('on', S.wire); for (const o of S.objs.values()) applyMaterial(o); requestRender(); });
$('recargarLista').addEventListener('click', renderList);
$('guardarCmal').addEventListener('click', async () => {
  if (!S.id) return;
  const st = $('estadoExport');
  try {
    const raw = S.rawParts || (await loadCapture(S.id)).parts;
    const name = ($('nombre').value || 'captura') + '.cmal'; await download(packFile(raw), name, 'application/octet-stream'); st.className = 'estado ok'; st.textContent = `Guardado ${name}.`; }
  catch (e) { st.className = 'estado mal'; st.textContent = 'Error: ' + (e.message || e); }
});
$('abrirCmal').addEventListener('click', () => $('archivoCmal').click());
$('archivoCmal').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    busy('Leyendo ' + f.name + '…');
    const parts = unpackFile(new Uint8Array(await f.arrayBuffer()));
    const first = parsePart(parts[0]).header;
    const id = await saveCapture({ title: f.name.replace(/\.cmal$/i, ''), url: first.url || '', parts, summary: null });
    location.search = '?id=' + encodeURIComponent(id);
  } catch (er) { busy(''); alert('No se pudo abrir: ' + er.message); }
});

// ------------------------------------------------------------------ arranque
function busy(text) { $('cargando').hidden = !text; $('cargandoTxt').textContent = text || ''; }
async function open(id) {
  busy('Abriendo la captura…');
  const cap = await loadCapture(id);
  if (!cap) { busy(''); $('vacio').hidden = false; $('titulo').textContent = 'Captura no encontrada'; return; }
  S.id = id; S.meta = cap.meta; S.rawParts = cap.parts;
  $('titulo').textContent = cap.meta.title || cap.meta.url;
  document.title = 'Captar malla · ' + (cap.meta.title || 'captura');
  busy('Reconstruyendo las mallas…');
  await new Promise((r) => setTimeout(r, 20));
  const parts = cap.parts.map((p) => parsePart(p));
  S.area = cap.meta.area || null;
  S.scene = buildScene(parts, S.area ? { area: S.area } : {});
  S.up = S.scene.info.upAxis;
  S.geo = !!S.scene.info.geo;
  S.groupsOn = new Set(S.scene.groups.filter((g) => g.enabled).map((g) => g.key));
  if (S.area) await prepareArea();
  const d = new Date(cap.meta.date);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const host = (() => { try { return new URL(cap.meta.url).hostname.replace(/^www\./, '').split('.')[0]; } catch (e) { return 'captura'; } })();
  $('nombre').value = cap.meta.fileName || `${host}_${stamp}`;
  for (const id2 of ['secResumen', 'secGrupos', 'secSel', 'secExport']) $(id2).hidden = false;
  $('secRecorte').hidden = !!S.area; // el área ya viene recortada al rectángulo marcado
  renderSummary(); renderGroups();
  buildObjects();
  // captura de la vista (no de un área): recorte de 250 m alrededor del punto que se miraba.
  // Ese punto sale de la cámara de la captura: rayo desde el centro de la vista hasta la malla.
  if (S.geo && !S.area) {
    let c = [0, 0, 0], txt = 'origen';
    const cam = S.scene.info.camera;
    if (cam) {
      const o = S.scene.info.origin;
      const rc = new THREE.Raycaster(new THREE.Vector3(cam.pos[0] - o[0], cam.pos[1] - o[1], cam.pos[2] - o[2]), new THREE.Vector3(...cam.dir));
      const hit = rc.intersectObjects([...S.objs.values()].filter((x) => x.visible), false)[0];
      if (hit) { c = [hit.point.x, hit.point.y, hit.point.z]; txt = 'el punto que mirabas'; }
    }
    S.crop.center = c; $('centroTxt').textContent = txt;
    S.crop.on = true; S.crop.radius = 250; $('recorteOn').checked = true; $('radio').value = 250; $('radioNum').value = 250;
    for (const o of S.objs.values()) { const g = geometryFor(o.userData.mesh); o.geometry.dispose(); o.geometry = g || new THREE.BufferGeometry(); if (!g) { o.geometry.userData.tris = 0; o.geometry.boundingBox = null; } }
    updateVisibility();
  }
  $('bTexturas').classList.toggle('on', S.showTex);
  frameAll(false);
  busy('');
  if (!S.scene.meshes.length) { $('vacio').hidden = false; $('vacio').querySelector('h2').textContent = 'La captura no contiene mallas de triángulos'; }
}

// Captura de un área: las texturas de las teselas (cientos o miles) se juntan en atlas de 4096 px
// y las piezas que comparten atlas se unen. Se hace una vez y sirve para ver y para guardar.
async function prepareArea() {
  const enabled = S.scene.meshes.filter((m) => S.groupsOn.has(m.group));
  busy(`Juntando ${fmtN(new Set(enabled.map((m) => m.texKey).filter(Boolean)).size)} texturas en atlas…`);
  autoProgress('Juntando las texturas en atlas…', 0.975);
  const at = await X.buildAtlases(enabled, S.scene.textures, {
    size: 4096, pad: 4, quality: 0.9,
    onProgress: (a, b) => { $('cargandoTxt').textContent = `Juntando texturas en atlas… ${fmtN(a)} de ${fmtN(b)}`; },
  });
  busy('Uniendo piezas…');
  await new Promise((r) => setTimeout(r, 0));
  const merged = X.mergeByMaterial(at.meshes);
  const group = enabled.length ? enabled[0].group : null;
  merged.forEach((m, i) => {
    m.id = i; m.name = `earth_${String(i).padStart(3, '0')}`; m.group = m.group || group; m.small = false;
    m.nVerts = m.positions.length / 3; m.nTris = m.indices.length / 3;
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const p = m.positions; for (let k = 0; k < p.length; k += 3) for (let c = 0; c < 3; c++) { const v = p[k + c]; if (v < b[c]) b[c] = v; if (v > b[c + 3]) b[c + 3] = v; }
    m.bbox = b;
  });
  S.scene.meshes = merged;
  S.scene.textures = at.textures;
  S.atlasInfo = { atlases: at.atlases, packed: at.packed, total: at.total };
  // la captura en bruto ya no hace falta en memoria (se vuelve a leer si se pide el .cmal)
  S.rawParts = null;
  S.previewMax = 2048;
  $('unir').checked = true;
}
function autoProgress(text, frac) {
  const et = Number(params.get('tab')) || 0;
  if (et && params.get('auto')) chrome.runtime.sendMessage({ cmd: 'auto-progreso', earthTab: et, text, frac }).catch(() => { });
}
// Al terminar una captura de área, el visor prepara y guarda solo los formatos elegidos
async function autoExport() {
  const fmts = (params.get('auto') || '').split(',').filter((f) => ['glb', 'fbx', 'obj', 'stl'].includes(f));
  const earthTab = Number(params.get('tab')) || 0;
  if (!fmts.length) return;
  // una sola vez: si se recarga el visor o Chrome restaura la pestaña, no se vuelve a guardar
  history.replaceState(null, '', 'viewer.html?id=' + encodeURIComponent(S.id));
  if (S.meta.exported) return;
  await updateMeta(S.id, { exported: new Date().toISOString() }).catch(() => { });
  const files = [];
  for (let i = 0; i < fmts.length; i++) {
    autoProgress(`Guardando ${fmts[i].toUpperCase()}…`, 0.98 + 0.02 * i / fmts.length);
    const r = await doExport(fmts[i], { auto: true });
    if (r) files.push(r);
  }
  const ok = files.filter((f) => f.ok);
  const info = S.area ? `${fmtN(S.area.W)} × ${fmtN(S.area.H)} m · ${S.area.cells.length} ${S.area.cells.length === 1 ? 'posición' : 'posiciones'} · teselas de ${S.area.tile.toLocaleString('es-ES', { maximumFractionDigits: 1 })} m · ${fmtN(S.scene.meshes.reduce((a, m) => a + m.nTris, 0))} triángulos` : '';
  const warnings = [...(S.meta.warnings || []), ...files.filter((f) => !f.ok).map((f) => `${f.name}: ${f.error}`)];
  // panel del visor
  $('secAuto').hidden = false;
  $('autoTxt').textContent = ok.length ? 'En Descargas › Captar malla:' : 'No se pudo guardar ningún archivo.';
  $('autoArch').innerHTML = '';
  for (const f of files) { const li = document.createElement('li'); li.textContent = f.ok ? `${f.name} (${fmtMB(f.bytes)})${f.note ? ' · ' + f.note : ''}` : `${f.name}: ${f.error}`; if (!f.ok) li.className = 'mal'; $('autoArch').append(li); }
  $('autoCarpeta').onclick = () => { if (ok[0] && ok[0].id) chrome.downloads.show(ok[0].id); else chrome.downloads.showDefaultFolder(); };
  if (earthTab) chrome.runtime.sendMessage({ cmd: 'auto-hecho', earthTab, files: ok.map((f) => ({ name: f.name, bytes: f.bytes, id: f.id, path: f.path, note: f.note || '' })), warnings, info, error: ok.length ? '' : (files[0] && files[0].error) || 'No se pudo guardar.' }).catch(() => { });
  return files;
}

resize();
renderList();
const printOptsReady = loadPrintOpts();
const qid = params.get('id');
if (qid) open(qid).then(() => printOptsReady).then(() => autoExport()).catch((e) => {
  busy(''); console.error(e);
  const earthTab = Number(params.get('tab')) || 0;
  if (earthTab && params.get('auto')) chrome.runtime.sendMessage({ cmd: 'auto-hecho', earthTab, files: [], error: 'No se pudieron preparar los archivos: ' + e.message }).catch(() => { });
  else alert('No se pudo abrir la captura: ' + e.message);
});
else $('vacio').hidden = false;
// para pruebas automáticas
window.__captarMallaVisor = { S, doExport, frameAll };
