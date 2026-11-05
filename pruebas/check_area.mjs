// Comprueba una captura de área: encaje entre posiciones, y exporta GLB con atlas (como el visor).
// Uso: node check_area.mjs out/area/madrid  (lee .cmal y .json)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import jpeg from 'jpeg-js';
const EXT = path.resolve(import.meta.dirname, '../extension');
const imp = (p) => import(pathToFileURL(path.join(EXT, p)).href);
const D = await imp('lib/decode.js');
const X = await imp('lib/exporters.js');
const base = process.argv[2];
const bytes = new Uint8Array(fs.readFileSync(base + '.cmal'));
const area = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
const part = D.parsePart(bytes);
// 1) encaje: la misma geometría dibujada en dos posiciones debe caer en el mismo sitio
const all = { lat: area.lat, lon: area.lon, cells: area.cells.map((c) => ({ f: c.f, e0: -1e9, n0: -1e9, e1: 1e9, n1: 1e9 })) };
const sc0 = D.buildScene([part], { area: all });
const byG = new Map();
for (const m of sc0.meshes) { const g = part.header.draws[m.drawIndex].g; if (!byG.has(g)) byG.set(g, []); byG.get(g).push(m); }
let pairs = 0, maxd = 0, sum = 0;
for (const list of byG.values()) {
  if (list.length < 2) continue;
  const a = list[0];
  for (const b of list.slice(1)) {
    if (a.frame === b.frame || a.positions.length !== b.positions.length) continue;
    // mismos vértices (solo si no se recortaron distinto por la máscara de octantes)
    if (a.nTris !== b.nTris) continue;
    let d = 0; for (let i = 0; i < a.positions.length; i += 3) d = Math.max(d, Math.hypot(a.positions[i] - b.positions[i], a.positions[i + 1] - b.positions[i + 1], a.positions[i + 2] - b.positions[i + 2]));
    pairs++; sum += d; maxd = Math.max(maxd, d);
  }
}
console.log(`encaje entre posiciones: ${pairs} parejas de la misma tesela; desfase medio ${(sum / Math.max(1, pairs) * 1000).toFixed(1)} mm, máximo ${(maxd * 1000).toFixed(1)} mm`);
// 2) escena del área y atlas
let t0 = Date.now();
const sc = D.buildScene([part], { area });
console.log('escena', Date.now() - t0, 'ms', sc.meshes.length, 'mallas', 'registro', JSON.stringify(sc.info.registration));
X.setImageCodec({
  async encode(rgba, w, h, { opaque, quality }) {
    if (!opaque) return null;
    const r = jpeg.encode({ data: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), width: w, height: h }, Math.round((quality || 0.9) * 100));
    return { kind: 'jpeg', bytes: new Uint8Array(r.data) };
  },
});
t0 = Date.now();
const enabled = sc.meshes.filter((m) => sc.groups.find((g) => g.key === m.group && g.enabled));
const at = await X.buildAtlases(enabled, sc.textures, { size: 4096, pad: 4, quality: 0.9 });
console.log('atlas', Date.now() - t0, 'ms:', at.atlases, 'atlas;', at.packed, 'de', at.total, 'texturas dentro');
const merged = X.mergeByMaterial(at.meshes);
let tris = 0; for (const m of merged) tris += m.indices.length / 3;
console.log('piezas unidas', merged.length, 'triángulos', tris);
const ready = X.transformPositions(merged, { from: 'Z', to: 'Y' });
t0 = Date.now();
const glb = await X.exportGLB(ready, at.textures, { sceneName: path.basename(base), extras: { georreferencia: sc.info.geo } });
fs.writeFileSync(base + '.glb', glb);
console.log('GLB', (glb.length / 1048576).toFixed(1), 'MB en', Date.now() - t0, 'ms');
const tex = [...at.textures.values()].filter((t) => t.kind === 'jpeg');
console.log('atlas JPEG: total', (tex.reduce((a, t) => a + t.bytes.length, 0) / 1048576).toFixed(1), 'MB; tamaños', tex.map((t) => t.w + 'x' + t.h).join(' '));
