// Tamaño de las teselas de Google Earth en una captura (de uMeshToWorldMatrix) y distancia al centro de la vista.
// Uso: node tiles.mjs out/x.cmal [...]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const EXT = path.resolve(import.meta.dirname, '../extension');
const D = await import(pathToFileURL(path.join(EXT, 'lib/decode.js')).href);
const R = 6371010;
export function tileStats(part) {
  const { header } = part;
  const out = [];
  let C = null;
  for (const d of header.draws) {
    const pr = header.programs[d.p]; if (!pr || !pr.uniforms.some((u) => u.base === 'uMeshToWorldMatrix')) continue;
    const mv = header.values[d.u.uMeshToWorldMatrix]; if (!mv) continue;
    const M = mv.d.map(Number);
    const view = header.values[d.u.uModelviewMatrix]?.d.map(Number);
    const wo = header.values[d.u.uWorldOriginInEye]?.d.map(Number);
    if (!C && view && wo) { const iV = D.M4.inv(view); const c = D.M4.tp(iV, wo[0], wo[1], wo[2], 1); C = [c[0] / c[3], c[1] / c[3], c[2] / c[3]]; }
    const s = [0, 1, 2].map((c) => Math.hypot(M[c * 4], M[c * 4 + 1], M[c * 4 + 2]) * 255 * R);
    // centro del bloque de bytes (127.5,127.5,127.5)
    const cx = M[0] * 127.5 + M[4] * 127.5 + M[8] * 127.5 + M[12], cy = M[1] * 127.5 + M[5] * 127.5 + M[9] * 127.5 + M[13], cz = M[2] * 127.5 + M[6] * 127.5 + M[10] * 127.5 + M[14];
    out.push({ ext: Math.max(...s), sizes: s, kc: [cx, cy, cz], om: M[15], g: d.g });
  }
  // a ENU respecto al ancla de la URL
  const anchor = D.urlAnchor([header.url]);
  const E = D.sphereEnu(anchor.lat, anchor.lon);
  for (const t of out) {
    const [x, y, z] = t.kc; const kx = x - C[0], ky = y - C[1], kz = z - C[2];
    const e = [-kz * R, -kx * R, ky * R];
    t.enu = [0, 1, 2].map((r) => E[r] * e[0] + E[4 + r] * e[1] + E[8 + r] * e[2] + E[12 + r]);
    t.dist = Math.hypot(t.enu[0], t.enu[1]);
  }
  return { tiles: out, anchor, url: header.url };
}
if (process.argv[1] && process.argv[1].endsWith('tiles.mjs')) {
  for (const f of process.argv.slice(2)) {
    const p = D.parsePart(new Uint8Array(fs.readFileSync(f)));
    const { tiles, url } = tileStats(p);
    console.log(path.basename(f), url.slice(28, 110), 'teselas', tiles.length);
    const byExt = new Map();
    for (const t of tiles) { const k = Math.round(Math.log2(t.ext)); const e = byExt.get(k) || { n: 0, dmin: Infinity, dmax: 0 }; e.n++; e.dmin = Math.min(e.dmin, t.dist); e.dmax = Math.max(e.dmax, t.dist); byExt.set(k, e); }
    for (const k of [...byExt.keys()].sort((a, b) => a - b)) { const e = byExt.get(k); console.log(`  tesela ≈ ${2 ** k} m: ${e.n} piezas, a ${e.dmin.toFixed(0)}–${e.dmax.toFixed(0)} m del centro`); }
    const near = tiles.filter((t) => t.dist < 60).map((t) => t.ext.toFixed(1));
    console.log('  teselas a < 60 m del centro:', near.join(' '));
  }
}
