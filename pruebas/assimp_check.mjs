// Lee FBX y OBJ con Assimp (lector independiente, el que usan muchos programas 3D) y resume.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const assimpjs = require('assimpjs');
const ajs = await assimpjs();
function unzip(buf) {
  // ZIP sin compresión (el nuestro): recorrer cabeceras locales
  const out = []; const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); let o = 0;
  while (o + 30 <= buf.length && dv.getUint32(o, true) === 0x04034b50) {
    const n = dv.getUint16(o + 26, true), x = dv.getUint16(o + 28, true), sz = dv.getUint32(o + 18, true);
    const name = new TextDecoder().decode(buf.subarray(o + 30, o + 30 + n));
    out.push({ name, data: buf.subarray(o + 30 + n + x, o + 30 + n + x + sz) }); o += 30 + n + x + sz;
  }
  return out;
}
for (const f of process.argv.slice(2)) {
  const list = new ajs.FileList();
  const buf = new Uint8Array(fs.readFileSync(f));
  if (f.endsWith('.zip')) for (const e of unzip(buf)) list.AddFile(e.name, e.data);
  else list.AddFile(path.basename(f), buf);
  const r = ajs.ConvertFileList(list, 'assjson');
  if (!r.IsSuccess() || r.FileCount() === 0) { console.log(f, 'ERROR', r.GetErrorCode()); continue; }
  const j = JSON.parse(new TextDecoder().decode(r.GetFile(0).GetContent()));
  const nv = j.meshes.reduce((a, m) => a + m.vertices.length / 3, 0);
  const nf = j.meshes.reduce((a, m) => a + m.faces.length, 0);
  const uv = j.meshes.filter((m) => m.texturecoords && m.texturecoords.length).length;
  const texMats = (j.materials || []).filter((m) => m.properties.some((p) => p.key === '$tex.file')).length;
  console.log(`${path.basename(f)}: mallas=${j.meshes.length} vértices=${nv} caras=${nf} con_UV=${uv} materiales=${(j.materials || []).length} con_textura=${texMats} texturas_incrustadas=${(j.textures || []).length}`);
}
