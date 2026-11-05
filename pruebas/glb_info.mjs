// Analiza un GLB: cabecera, JSON, bbox, materiales, imágenes, nodos.
import fs from 'node:fs';
const f = process.argv[2];
const b = fs.readFileSync(f);
const magic = b.toString('ascii', 0, 4), ver = b.readUInt32LE(4), len = b.readUInt32LE(8);
console.log('archivo', f, 'tam', b.length, 'magic', magic, 'ver', ver, 'len cabecera', len, len === b.length ? 'OK' : 'NO COINCIDE');
let off = 12; const chunks = [];
while (off < b.length) {
  const cl = b.readUInt32LE(off), ct = b.toString('ascii', off + 4, off + 8);
  chunks.push({ ct, cl, off: off + 8 }); off += 8 + cl;
}
console.log('chunks', chunks.map(c => c.ct + ':' + c.cl));
const J = JSON.parse(b.toString('utf8', chunks[0].off, chunks[0].off + chunks[0].cl));
const bin = chunks[1] ? b.subarray(chunks[1].off, chunks[1].off + chunks[1].cl) : null;
console.log('asset', JSON.stringify(J.asset));
console.log('scenes', JSON.stringify(J.scenes), 'scene', J.scene);
console.log('nodes', J.nodes.length, 'meshes', J.meshes.length, 'materials', (J.materials || []).length, 'textures', (J.textures || []).length, 'images', (J.images || []).length, 'accessors', J.accessors.length);
console.log('extras', JSON.stringify(J.extras || J.scenes?.[0]?.extras || null).slice(0, 500));
console.log('nodo 0', JSON.stringify(J.nodes[0]).slice(0, 300));
const root = J.nodes.filter(n => n.children);
console.log('nodos con hijos', root.length, root.slice(0, 2).map(n => JSON.stringify({ name: n.name, t: n.translation, r: n.rotation, s: n.scale, m: n.matrix, nch: n.children.length })));
// bbox global de POSITION (min/max de accessors)
let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
let tris = 0, verts = 0;
for (const m of J.meshes) for (const p of m.primitives) {
  const a = J.accessors[p.attributes.POSITION];
  verts += a.count;
  if (p.indices !== undefined) tris += J.accessors[p.indices].count / 3;
  for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a.min[i]); mx[i] = Math.max(mx[i], a.max[i]); }
}
console.log('bbox POSITION (local)', mn.map(v => v.toFixed(1)), mx.map(v => v.toFixed(1)), 'tris', tris, 'verts', verts);
console.log('material 0', JSON.stringify(J.materials?.[0]));
const mimes = {}; for (const im of J.images || []) mimes[im.mimeType] = (mimes[im.mimeType] || 0) + 1;
console.log('imágenes por tipo', JSON.stringify(mimes));
// comprobar que las imágenes empiezan por la firma correcta y estadística de color
let blackish = 0, checked = 0;
for (const [i, im] of (J.images || []).entries()) {
  const bv = J.bufferViews[im.bufferView];
  const s = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const sig = s.subarray(0, 4).toString('hex');
  const okSig = (im.mimeType === 'image/jpeg' && sig.startsWith('ffd8')) || (im.mimeType === 'image/png' && sig === '89504e47');
  if (!okSig) console.log('imagen', i, 'firma rara', sig, im.mimeType);
  checked++;
}
console.log('imágenes con firma revisada', checked);
// atributos usados
const attrs = {}; for (const m of J.meshes) for (const p of m.primitives) for (const k of Object.keys(p.attributes)) attrs[k] = (attrs[k] || 0) + 1;
console.log('atributos', JSON.stringify(attrs));
fs.writeFileSync(f + '.json', JSON.stringify(J, null, 1));
