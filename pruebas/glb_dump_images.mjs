// Extrae las primeras N imágenes de un GLB a una carpeta
import fs from 'node:fs'; import path from 'node:path';
const [f, outDir, nStr] = process.argv.slice(2); const N = +(nStr || 6);
const b = fs.readFileSync(f);
const jl = b.readUInt32LE(12); const J = JSON.parse(b.toString('utf8', 20, 20 + jl));
const binOff = 20 + jl + 8;
fs.mkdirSync(outDir, { recursive: true });
const pick = [0, 1, 2, 50, 100, 200].slice(0, N);
for (const i of pick) {
  const im = J.images[i]; if (!im) continue; const bv = J.bufferViews[im.bufferView];
  const s = b.subarray(binOff + (bv.byteOffset || 0), binOff + (bv.byteOffset || 0) + bv.byteLength);
  fs.writeFileSync(path.join(outDir, im.name), s);
  // IHDR del PNG: ancho, alto, tipo de color
  if (s.readUInt32BE(12) === 0x49484452) console.log(im.name, 'w', s.readUInt32BE(16), 'h', s.readUInt32BE(20), 'bitdepth', s[24], 'colortype', s[25]);
}
