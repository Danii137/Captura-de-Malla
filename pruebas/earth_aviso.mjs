// Cierra el aviso «Novedades de Google Earth» si está en pantalla. Earth lo dibuja con su interfaz (no hay
// elementos de la página que pulsar): se busca en una captura un recuadro blanco grande en el centro y se
// pulsa su ✕ (esquina superior derecha). Esc no sirve: saca a Earth del mapa.
import jpeg from 'jpeg-js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function closeEarthDialog(page, log = () => { }) {
  for (let k = 0; k < 3; k++) {
    const img = jpeg.decode(await page.screenshot({ type: 'jpeg', quality: 80 }), { useTArray: true });
    const { width: W, height: H, data } = img;
    const white = (x, y) => { const i = (y * W + x) * 4; return data[i] > 236 && data[i + 1] > 236 && data[i + 2] > 236; };
    const x0 = Math.round(W * 0.42), x1 = Math.round(W * 0.58);
    let top = -1, bottom = -1;
    for (let y = 0; y < H; y++) {
      let n = 0; for (let x = x0; x < x1; x++) if (white(x, y)) n++;
      if (n / (x1 - x0) > 0.97) { if (top < 0) top = y; bottom = y; } else if (top >= 0 && y - bottom > 3) { if (bottom - top > 200) break; top = bottom = -1; }
    }
    if (top < 0 || bottom - top < 200) return k > 0;
    let right = Math.round(W / 2); while (right < W - 1 && white(right + 1, top + 12)) right++;
    log('aviso de Earth en pantalla: se cierra', JSON.stringify({ top, bottom, right }));
    await page.mouse.click(right - 44, top + 43);
    await sleep(1500);
  }
  return true;
}
