// Capturas de pantalla del flujo para el README (docs/img), con la extensión cargada, como un usuario:
// panel → rectángulo → capturando → terminado → visor. Guarda también el GLB y el STL de la prueba para
// renderizarlos luego en Blender (blender_render.py y blender_stl_check.py).
// Uso: node capturas_readme.mjs [carpeta_salida]   (por defecto out/readme)
import puppeteer from 'puppeteer-core';
import jpeg from 'jpeg-js';
import fs from 'node:fs';
import path from 'node:path';
const EXT = path.resolve(import.meta.dirname, '../extension');
const OUT = path.resolve(process.argv[2] || path.join('out', 'readme'));
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const PROFILE = path.resolve('profile_readme'); fs.rmSync(PROFILE, { recursive: true, force: true });
// Plaza Mayor de Madrid: vista inclinada para la primera imagen; el área marcada, unos 300 × 220 m
const LAT = 40.41553, LON = -3.70742, AREA_W = 300, AREA_H = 220;
const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', pipe: true, enableExtensions: [EXT], userDataDir: PROFILE,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--window-size=1440,900', '--lang=es-ES'],
  defaultViewport: null,
});
const jpg = (n) => path.join(OUT, n + '.jpg');
// El aviso «Novedades de Google Earth» (interfaz dibujada, sin elementos de la página que pulsar): se busca
// en la imagen un recuadro blanco grande en el centro y se pulsa su ✕ (esquina superior derecha).
// (Esc no sirve: saca a Earth del mapa.)
async function closeEarthDialog(page) {
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
    console.log(t(), 'aviso de Earth en pantalla: se cierra', JSON.stringify({ top, bottom, right }));
    await page.mouse.click(right - 44, top + 43);
    await sleep(1500);
  }
  return true;
}
try {
  const bcdp = await browser.target().createCDPSession();
  await bcdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true });
  const page = (await browser.pages())[0] || await browser.newPage();
  const url = `https://earth.google.com/web/@${LAT},${LON},650a,520d,35y,25h,58t,0r`;
  // primera carga: cookies y avisos de bienvenida; la segunda ya sale limpia (o se cierra el aviso)
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=submit]')].find((b) => /rechazar todo|reject all/i.test((b.innerText || b.value || ''))); if (b) b.click(); }).catch(() => { });
  await sleep(12000);
  await closeEarthDialog(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(16000);
  await closeEarthDialog(page);
  await sleep(2000);
  const P = (expr) => page.evaluate(`(() => { const r = document.querySelector('#captar-malla-panel'); if (!r) return null; const $ = (id) => r.shadowRoot.getElementById(id); return (${expr}); })()`);
  // opciones: GLB + STL, detalle máximo
  await P(`(() => { for (const cb of r.shadowRoot.querySelectorAll('.fmt')) { cb.checked = ['glb', 'stl'].includes(cb.value); cb.dispatchEvent(new Event('change')); } $('detalle').value = 'max'; $('detalle').dispatchEvent(new Event('change')); return 1; })()`);
  await sleep(500);
  await page.screenshot({ path: jpg('01_panel'), type: 'jpeg', quality: 85 });
  console.log(t(), '01 panel');
  await P(`$('bArea').click()`);
  let ok = false;
  for (let i = 0; i < 120 && !ok; i++) { await sleep(1000); ok = await P(`!$('capa').hidden && !$('sMarcar').hidden`).catch(() => false); }
  if (!ok) throw new Error('no entró en modo rectángulo');
  await sleep(1500);
  // tras la recarga de enganche puede volver el aviso: se aparta un momento la capa de dibujo para cerrarlo
  await P(`$('capa').style.display = 'none'`);
  await closeEarthDialog(page);
  await P(`$('capa').style.display = ''`);
  await sleep(500);
  // rectángulo de AREA_W × AREA_H m centrado en el lienzo (metros por píxel de la vista cenital)
  const vista = JSON.parse(await page.evaluate(() => document.querySelector('#captar-malla-panel').dataset.vista));
  const [cx, cy, cw, ch] = vista.canvas;
  const mpp = 2 * vista.view.d * Math.tan(vista.view.fov * Math.PI / 360) / ch;
  const w = AREA_W / mpp, h = AREA_H / mpp;
  const X0 = cx + cw / 2 - w / 2, Y0 = cy + ch / 2 - h / 2, X1 = X0 + w, Y1 = Y0 + h;
  console.log(t(), 'vista', JSON.stringify(vista.view), 'rectángulo px', [X0, Y0, X1, Y1].map(Math.round).join(','));
  await page.mouse.move(X0, Y0); await page.mouse.down();
  for (let k = 1; k <= 24; k++) { await page.mouse.move(X0 + (X1 - X0) * k / 24, Y0 + (Y1 - Y0) * k / 24); await sleep(25); }
  await sleep(900);
  await page.screenshot({ path: jpg('02_rectangulo'), type: 'jpeg', quality: 85 });
  console.log(t(), '02 rectángulo:', await P(`$('medida').textContent`));
  await page.mouse.up();
  // durante la captura la página se pone a 3840×2400 (reducida): se recorta la esquina con el panel a tamaño real
  for (let i = 0; i < 60; i++) { await sleep(1000); const s = await P(`$('corTxt').textContent`).catch(() => ''); if (/posición 2/.test(s || '')) break; }
  await sleep(1500);
  await page.screenshot({ path: jpg('03_capturando'), type: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: 1000, height: 620 } });
  console.log(t(), '03 capturando:', await P(`$('corTxt').textContent`));
  let fin = false;
  for (let i = 0; i < 600 && !fin; i++) { await sleep(1000); fin = await P(`!$('sFin').hidden`).catch(() => false); }
  await sleep(1500);
  await page.screenshot({ path: jpg('04_terminado'), type: 'jpeg', quality: 85 });
  console.log(t(), '04 terminado:', (await P(`$('sFin').innerText`)).replace(/\n/g, ' | '));
  // visor (abierto en segundo plano por la extensión)
  const viewer = (await browser.pages()).find((p) => p.url().includes('viewer.html'));
  if (viewer) {
    await viewer.bringToFront(); await sleep(2500);
    await viewer.evaluate(() => window.__captarMallaVisor.frameAll(false)); await sleep(2500);
    await viewer.screenshot({ path: jpg('05_visor'), type: 'jpeg', quality: 85 });
    console.log(t(), '05 visor');
  }
  // archivos descargados (Chrome los guarda con nombre interno): GLB y STL con nombre legible
  for (const f of fs.readdirSync(OUT)) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(f)) continue;
    const head = fs.readFileSync(path.join(OUT, f)).subarray(0, 32).toString('latin1');
    const dest = head.startsWith('glTF') ? 'plaza_mayor.glb' : head.startsWith('Captar malla') ? 'plaza_mayor_imprimir.stl' : null;
    if (dest) fs.renameSync(path.join(OUT, f), path.join(OUT, dest));
  }
  console.log(t(), 'archivos:', fs.readdirSync(OUT).join(', '));
} finally {
  await browser.close();
}
