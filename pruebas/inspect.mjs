// Decodifica partes .cmal con lib/decode.js y resume las mallas (para comprobar medidas).
// Uso: node inspect.mjs out/three_0.cmal [out/three_1.cmal ...]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const EXT = path.resolve(import.meta.dirname, '../extension');
const D = await import(pathToFileURL(path.join(EXT, 'lib/decode.js')).href);
const files = process.argv.slice(2);
const parts = files.map((f) => D.parsePart(new Uint8Array(fs.readFileSync(f))));
for (const p of parts) console.log('parte', p.header.realm, p.header.url.slice(0, 80), 'draws', p.header.draws.length, 'geoms', p.header.geoms.length, 'progs', Object.keys(p.header.programs).length, 'tex', p.header.textures.length, 'motivo', p.header.reason, 'errores', p.header.errors.length, p.header.errors.slice(0, 3));
const t0 = Date.now();
const sc = D.buildScene(parts);
console.log('buildScene', Date.now() - t0, 'ms; mallas', sc.meshes.length, 'texturas', sc.textures.size);
console.log('info', JSON.stringify(sc.info));
for (const g of sc.groups) console.log(g.enabled ? '[x]' : '[ ]', g.key, '|', g.label, '| draws', g.draws, 'mallas', g.meshes, 'tris', g.tris, g.reason ? '| ' + g.reason : '', g.dupes ? '| dupl ' + g.dupes : '');
const o = sc.info.origin;
const show = process.env.ALL ? sc.meshes : sc.meshes.slice(0, 25);
for (const m of show) {
  const b = m.bbox.map((v, k) => (v + o[k % 3]).toFixed(3));
  console.log(` ${m.name} grp=${m.group} tf=${m.transformKind} v=${m.nVerts} t=${m.nTris} tex=${m.texKey || '-'} col=${m.color ? m.color.map((x) => x.toFixed(2)).join(',') : '-'} uv=${m.uvs ? Array.from(m.uvs.slice(0, 4)).map((x) => x.toFixed(3)).join(',') : '-'} bbox=[${b.slice(0, 3).join(', ')}] → [${b.slice(3).join(', ')}]`);
}
for (const [k, t] of sc.textures) if (process.env.TEX) console.log('tex', k, t.kind, t.w, t.h, t.bytes.length);
// caja total de las mallas activas y comprobación de un punto conocido (CHECK="lat,lon")
const en = new Set(sc.groups.filter((g) => g.enabled).map((g) => g.key));
const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const m of sc.meshes) if (en.has(m.group)) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], m.bbox[k] + o[k]); bb[k + 3] = Math.max(bb[k + 3], m.bbox[k + 3] + o[k]); }
console.log('caja mallas activas', bb.map((v) => v.toFixed(1)).join(', '));
if (process.env.CHECK && sc.info.geo) {
  const [lat, lon] = process.env.CHECK.split(',').map(Number);
  // distancia este/norte aproximada en la esfera
  const R = 6371010, dLat = (lat - sc.info.geo.lat) * Math.PI / 180, dLon = (lon - sc.info.geo.lon) * Math.PI / 180;
  console.log(`punto ${lat},${lon} en ENU ≈ este ${(dLon * R * Math.cos(lat * Math.PI / 180)).toFixed(1)} m, norte ${(dLat * R).toFixed(1)} m`);
  // altura del terreno cerca de ese punto: vértices a menos de 30 m en planta
  let zs = [];
  const ex = dLon * R * Math.cos(lat * Math.PI / 180), ny = dLat * R;
  for (const m of sc.meshes) { if (!en.has(m.group)) continue; const p = m.positions; for (let i = 0; i < p.length; i += 3) if (Math.hypot(p[i] + o[0] - ex, p[i + 1] + o[1] - ny) < 30) zs.push(p[i + 2] + o[2]); }
  zs.sort((a, b) => a - b);
  if (zs.length) console.log(`cerca del punto: ${zs.length} vértices, z mín ${zs[0].toFixed(1)}, mediana ${zs[zs.length >> 1].toFixed(1)}, máx ${zs[zs.length - 1].toFixed(1)}`);
}
