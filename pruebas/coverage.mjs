// Cobertura real en planta: rasteriza cada triángulo (proyectado) sobre una rejilla de 1 m dentro del rectángulo.
// Uso: node coverage.mjs out/area/madrid_alto
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const D = await import(pathToFileURL(path.resolve(import.meta.dirname, '../extension/lib/decode.js')).href);
const base = process.argv[2];
const area = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
const sc = D.buildScene([D.parsePart(new Uint8Array(fs.readFileSync(base + '.cmal')))], { area });
const W = area.W, H = area.H, cs = 1, nx = Math.ceil(W / cs), ny = Math.ceil(H / cs);
const grid = new Uint8Array(nx * ny);
for (const m of sc.meshes) {
  const p = m.positions, I = m.indices;
  for (let i = 0; i < I.length; i += 3) {
    const ax = p[I[i] * 3] + W / 2, ay = p[I[i] * 3 + 1] + H / 2, bx = p[I[i + 1] * 3] + W / 2, by = p[I[i + 1] * 3 + 1] + H / 2, cx = p[I[i + 2] * 3] + W / 2, cy = p[I[i + 2] * 3 + 1] + H / 2;
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) / cs)), x1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx) / cs));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) / cs)), y1 = Math.min(ny - 1, Math.floor(Math.max(ay, by, cy) / cs));
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const px = (gx + 0.5) * cs, py = (gy + 0.5) * cs;
      const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d, l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) grid[gy * nx + gx] = 1;
    }
  }
}
let empty = 0; const holes = [];
for (let gy = 0; gy < ny; gy++) for (let gx = 0; gx < nx; gx++) if (!grid[gy * nx + gx]) { empty++; if (holes.length < 8) holes.push(`(${(gx * cs - W / 2).toFixed(0)},${(gy * cs - H / 2).toFixed(0)})`); }
console.log(path.basename(base), `cobertura en planta (celdas de ${cs} m): ${(100 - empty / grid.length * 100).toFixed(3)} %, ${empty} vacías de ${grid.length}`, holes.join(' '));
