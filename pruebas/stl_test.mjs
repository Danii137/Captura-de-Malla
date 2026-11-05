// Comprueba el STL para imprimir de una captura de área: sólido cerrado, base, tamaño y peso.
// Uso: node stl_test.mjs out/area/madrid [escala] [base_mm] [rejilla_mm]   (lee .cmal y .json)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const EXT = path.resolve(import.meta.dirname, '../extension');
const imp = (p) => import(pathToFileURL(path.join(EXT, p)).href);
const D = await imp('lib/decode.js');
const X = await imp('lib/exporters.js');
const [, , base, SCALE = '0', BASE = '3', RES = '0.3'] = process.argv;
const area = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
let t0 = Date.now();
const sc = D.buildScene([D.parsePart(new Uint8Array(fs.readFileSync(base + '.cmal')))], { area });
console.log('escena', Date.now() - t0, 'ms;', sc.meshes.length, 'mallas;', sc.meshes.reduce((a, m) => a + m.nTris, 0), 'triángulos; eje', sc.info.upAxis, 'origen', sc.info.origin.join(','));
const o = sc.info.origin;
const rect = { x0: area.rect.e0 - o[0], y0: area.rect.n0 - o[1], x1: area.rect.e1 - o[0], y1: area.rect.n1 - o[1] };
t0 = Date.now();
const r = X.exportPrintSTL(sc.meshes, rect, { scale: +SCALE, baseMM: +BASE, resMM: +RES });
const ms = Date.now() - t0;
t0 = Date.now();
const chk = X.checkClosed(r.solid.positions, r.solid.indices);
console.log(`STL 1:${r.scale}: ${r.size.map((x) => x.toFixed(1)).join(' × ')} mm; rejilla ${r.cellReal.toFixed(3)} m reales; ${r.triangles} triángulos; ${(r.bytes.length / 1048576).toFixed(1)} MB; ${ms} ms`);
console.log(`  alturas ${r.zmin.toFixed(1)}–${r.zmax.toFixed(1)} m; nudos sin malla rellenados ${(r.filled * 100).toFixed(2)} %`);
console.log(`  cerrada: ${chk.closed} (aristas ${chk.edges}, mal ${chk.badEdges}, degenerados ${chk.degenerate}, volumen ${(chk.volume / 1000).toFixed(1)} cm³) · ${Date.now() - t0} ms`);
// grosor mínimo de la base: del fondo (z = 0) al punto más bajo del relieve
let zminTop = Infinity; const p = r.solid.positions; const NV = (r.solid.nx + 1) * (r.solid.ny + 1);
for (let k = 0; k < NV; k++) zminTop = Math.min(zminTop, p[k * 3 + 2]);
console.log(`  base: del fondo al punto más bajo ${zminTop.toFixed(2)} mm`);
const out = `${base}_imprimir_1-${r.scale}.stl`;
fs.writeFileSync(out, r.bytes);
console.log('  guardado', out);
