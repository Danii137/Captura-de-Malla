// Exporta una captura a GLB/OBJ/FBX/STL con las mismas funciones que el visor.
// Uso: node test_export.mjs out/earth_0.cmal radio_m nombre
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const EXT = path.resolve(import.meta.dirname, '../extension');
const D = await import(pathToFileURL(path.join(EXT, 'lib/decode.js')).href);
const X = await import(pathToFileURL(path.join(EXT, 'lib/exporters.js')).href);
const [, , file, radius = '0', name = 'prueba'] = process.argv;
const sc = D.buildScene([D.parsePart(new Uint8Array(fs.readFileSync(file)))]);
const en = new Set(sc.groups.filter((g) => g.enabled).map((g) => g.key));
const up = sc.info.upAxis;
let ms = sc.meshes.filter((m) => en.has(m.group) && !m.small);
const crop = +radius > 0 ? { center: [0, 0, 0], radius: +radius } : null;
ms = ms.map((m) => X.cropMesh(m, crop, up)).filter(Boolean);
console.log('mallas', ms.length, 'triángulos', ms.reduce((a, m) => a + m.indices.length / 3, 0), 'eje', up, 'geo', JSON.stringify(sc.info.geo));
const t0 = Date.now();
const toY = X.transformPositions(ms, { from: up, to: 'Y' });
const toZ = X.transformPositions(ms, { from: up, to: 'Z' });
const glb = await X.exportGLB(toY, sc.textures, { sceneName: name }); fs.writeFileSync(`out/${name}.glb`, glb);
const obj = await X.exportOBJ(toY, sc.textures, { baseName: name }); fs.writeFileSync(`out/${name}_obj.zip`, obj);
const fbx = await X.exportFBX(toY, sc.textures, {}); fs.writeFileSync(`out/${name}.fbx`, fbx);
const stl = X.exportSTL(toZ, {}); fs.writeFileSync(`out/${name}.stl`, stl);
console.log('exportado en', Date.now() - t0, 'ms', { glb: glb.length, obj: obj.length, fbx: fbx.length, stl: stl.length });
// caja en Z arriba para comparar con Blender
const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const m of toZ) for (let i = 0; i < m.positions.length; i += 3) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], m.positions[i + k]); bb[k + 3] = Math.max(bb[k + 3], m.positions[i + k]); }
console.log('caja (Z arriba)', bb.map((v) => v.toFixed(2)).join(', '));
