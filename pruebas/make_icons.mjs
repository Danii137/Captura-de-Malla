// Genera los iconos PNG de la extensión: cuadrado redondeado azul petróleo con una malla blanca.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const EXT = path.resolve(import.meta.dirname, '../extension');
const X = await import(pathToFileURL(path.join(EXT, 'lib/exporters.js')).href);

function render(S) {
  const SS = 4, N = S * SS;
  const out = new Uint8Array(S * S * 4);
  const bg = [31, 95, 116], fg = [255, 255, 255], acc = [255, 176, 32];
  // malla: triángulo subdividido (coordenadas 0..1)
  const P = { a: [0.5, 0.17], b: [0.16, 0.8], c: [0.84, 0.8] };
  const mid = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
  const ab = mid(P.a, P.b), bc = mid(P.b, P.c), ca = mid(P.c, P.a);
  const segs = [[P.a, P.b], [P.b, P.c], [P.c, P.a], [ab, bc], [bc, ca], [ca, ab]];
  const verts = [P.a, P.b, P.c, ab, bc, ca];
  const lw = S <= 16 ? 0.075 : S <= 32 ? 0.055 : 0.04, vr = S <= 16 ? 0 : 0.055;
  const dseg = (p, [u, v]) => { const dx = v[0] - u[0], dy = v[1] - u[1]; const t = Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dy); };
  const rr = 0.2; // radio de las esquinas
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let acc4 = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const p = [(x * SS + sx + 0.5) / N, (y * SS + sy + 0.5) / N];
      const qx = Math.max(Math.abs(p[0] - 0.5) - (0.5 - rr), 0), qy = Math.max(Math.abs(p[1] - 0.5) - (0.5 - rr), 0);
      if (Math.hypot(qx, qy) > rr) continue;
      let c = bg;
      if (segs.some((s) => dseg(p, s) < lw / 2)) c = fg;
      if (vr && verts.some((v) => Math.hypot(p[0] - v[0], p[1] - v[1]) < vr)) c = acc;
      acc4[0] += c[0]; acc4[1] += c[1]; acc4[2] += c[2]; acc4[3] += 255;
    }
    const n = SS * SS, a = acc4[3] / n;
    const k = (y * S + x) * 4;
    if (a > 0) { out[k] = acc4[0] / (acc4[3] / 255); out[k + 1] = acc4[1] / (acc4[3] / 255); out[k + 2] = acc4[2] / (acc4[3] / 255); }
    out[k + 3] = a;
  }
  return out;
}
for (const s of [16, 32, 48, 128]) {
  const png = await X.encodePNG(render(s), s, s);
  fs.writeFileSync(path.join(EXT, 'icons', `icon${s}.png`), png);
  console.log('icono', s, png.length, 'bytes');
}
