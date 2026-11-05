// Descompresión de texturas S3TC (DXT1 / DXT3 / DXT5) a RGBA de 8 bits.
// Fila 0 del resultado = fila t=0 de la textura (igual que las texturas leídas con readPixels).
const DXT1 = new Set([0x83F0, 0x83F1, 0x8C4C, 0x8C4D]);
const DXT3 = new Set([0x83F2, 0x8C4E]);
const DXT5 = new Set([0x83F3, 0x8C4F]);

function c565(c) { return [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0]; }

export function decodeBC(data, w, h, fmt) {
  const out = new Uint8Array(w * h * 4);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  const isDXT1 = DXT1.has(fmt), isDXT3 = DXT3.has(fmt), isDXT5 = DXT5.has(fmt);
  if (!isDXT1 && !isDXT3 && !isDXT5) return null;
  const bs = isDXT1 ? 8 : 16;
  const pal = [[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]];
  const alpha = new Uint8Array(16);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let o = (by * bw + bx) * bs;
    if (o + bs > data.length) continue;
    if (isDXT3) {
      for (let i = 0; i < 8; i++) { const b = data[o + i]; alpha[i * 2] = (b & 15) * 17; alpha[i * 2 + 1] = (b >> 4) * 17; }
      o += 8;
    } else if (isDXT5) {
      const a0 = data[o], a1 = data[o + 1];
      const ap = [a0, a1];
      if (a0 > a1) for (let i = 1; i < 7; i++) ap.push(((7 - i) * a0 + i * a1) / 7 | 0);
      else { for (let i = 1; i < 5; i++) ap.push(((5 - i) * a0 + i * a1) / 5 | 0); ap.push(0, 255); }
      // 48 bits de índices de 3 bits
      let bits = 0, nb = 0, p = o + 2;
      for (let i = 0; i < 16; i++) {
        if (nb < 3) { bits |= data[p++] << nb; nb += 8; }
        alpha[i] = ap[bits & 7]; bits >>= 3; nb -= 3;
      }
      o += 8;
    }
    const c0 = dv.getUint16(o, true), c1 = dv.getUint16(o + 2, true);
    const a = c565(c0), b = c565(c1);
    pal[0] = [a[0], a[1], a[2], 255]; pal[1] = [b[0], b[1], b[2], 255];
    if (c0 > c1 || !isDXT1) {
      pal[2] = [(2 * a[0] + b[0]) / 3 | 0, (2 * a[1] + b[1]) / 3 | 0, (2 * a[2] + b[2]) / 3 | 0, 255];
      pal[3] = [(a[0] + 2 * b[0]) / 3 | 0, (a[1] + 2 * b[1]) / 3 | 0, (a[2] + 2 * b[2]) / 3 | 0, 255];
    } else {
      pal[2] = [(a[0] + b[0]) / 2 | 0, (a[1] + b[1]) / 2 | 0, (a[2] + b[2]) / 2 | 0, 255];
      pal[3] = [0, 0, 0, (fmt === 0x83F0 || fmt === 0x8C4C) ? 255 : 0];
    }
    const idx = dv.getUint32(o + 4, true);
    for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px, y = by * 4 + py;
      if (x >= w || y >= h) continue;
      const k = py * 4 + px;
      const c = pal[(idx >>> (2 * k)) & 3];
      const q = (y * w + x) * 4;
      out[q] = c[0]; out[q + 1] = c[1]; out[q + 2] = c[2];
      out[q + 3] = (isDXT3 || isDXT5) ? alpha[k] : c[3];
    }
  }
  return out;
}
