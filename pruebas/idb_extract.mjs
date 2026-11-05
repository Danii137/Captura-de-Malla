// Saca las partes .cmal de un blob de IndexedDB de Chrome (valor V8 comprimido con Snappy).
// Uso: node idb_extract.mjs <blob> <salidaPrefijo>
import fs from 'node:fs';
const [f, outPrefix] = process.argv.slice(2);
const b = fs.readFileSync(f);
function varint(buf, p) { let v = 0, s = 0, c; do { c = buf[p++]; v += (c & 0x7f) * 2 ** s; s += 7; } while (c & 0x80); return [v, p]; }
function snappy(src, p) {
  let n; [n, p] = varint(src, p);
  const out = Buffer.alloc(n); let o = 0;
  while (p < src.length && o < n) {
    const tag = src[p++]; const t = tag & 3;
    if (t === 0) {
      let len = tag >> 2;
      if (len >= 60) { const nb = len - 59; len = 0; for (let i = 0; i < nb; i++) len |= src[p++] << (8 * i); }
      len += 1; src.copy(out, o, p, p + len); p += len; o += len;
    } else {
      let len, off;
      if (t === 1) { len = 4 + ((tag >> 2) & 7); off = ((tag >> 5) << 8) | src[p++]; }
      else if (t === 2) { len = (tag >> 2) + 1; off = src[p] | (src[p + 1] << 8); p += 2; }
      else { len = (tag >> 2) + 1; off = src.readUInt32LE(p); p += 4; }
      for (let i = 0; i < len; i++) { out[o] = out[o - off]; o++; }
    }
  }
  return out;
}
let raw;
if (b[0] === 0xff && b[2] === 0x02) raw = snappy(b, 3); else raw = b;
console.log('descomprimido', raw.length);
let k = 0, from = 0;
for (;;) {
  const i = raw.indexOf('CMAL', from, 'latin1'); if (i < 0) break;
  // la longitud del ArrayBuffer va justo antes: 'B' + varint
  let j = i - 1; while (j > 0 && raw[j] & 0x80 || (raw[j - 1] & 0x80)) j--; // retroceder hasta el inicio del varint
  let st = i - 1; while (raw[st - 1] & 0x80) st--; // primer byte del varint
  const [len] = varint(raw, st);
  const tagByte = String.fromCharCode(raw[st - 1]);
  const part = raw.subarray(i, i + len);
  fs.writeFileSync(`${outPrefix}_${k}.cmal`, part);
  console.log('parte', k, 'en', i, 'etiqueta', tagByte, 'longitud', len);
  k++; from = i + len;
}
// metadatos legibles (JSON pequeño antes de las partes)
console.log('inicio', raw.subarray(0, 120).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
