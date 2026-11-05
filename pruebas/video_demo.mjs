// Graba la demo del README fotograma a fotograma, con la extensión cargada y como un usuario:
// panel → Capturar área → rectángulo → captura (acelerada) → terminado → visor girando.
// Las capturas de pantalla no muestran el ratón: se dibuja un puntero en la página (solo para el vídeo).
// Deja los fotogramas en <salida>/fotogramas, la lista con la duración de cada uno (lista.txt, para FFmpeg)
// y los tramos con su rótulo (tramos.json). El vídeo lo monta hacer_videos.mjs.
// Uso: node video_demo.mjs [salida]   (por defecto out/demo)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { closeEarthDialog } from './earth_aviso.mjs';
const EXT = path.resolve(import.meta.dirname, '../extension');
const OUT = path.resolve(process.argv[2] || path.join('out', 'demo'));
const FR = path.join(OUT, 'fotogramas');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(FR, { recursive: true });
const PROFILE = path.resolve('profile_demo'); fs.rmSync(PROFILE, { recursive: true, force: true });
const LAT = 40.41553, LON = -3.70742, AREA_W = 300, AREA_H = 220;
const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', pipe: true, enableExtensions: [EXT], userDataDir: PROFILE,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--window-size=1440,900', '--lang=es-ES'],
  defaultViewport: null,
});
// fotogramas y tramos
const list = []; const tramos = []; let tVideo = 0, nF = 0;
async function frame(page, dur, opts = {}) {
  const f = String(nF++).padStart(4, '0') + '.jpg';
  await page.screenshot(Object.assign({ path: path.join(FR, f), type: 'jpeg', quality: 88, captureBeyondViewport: false }, opts)); // (sin tocar el tamaño de la página: si no, choca con el de la extensión)
  list.push(`file 'fotogramas/${f}'`, `duration ${dur.toFixed(3)}`); tVideo += dur;
}
const tramo = (texto) => { if (tramos.length) tramos[tramos.length - 1].fin = tVideo; tramos.push({ texto, inicio: tVideo }); };
// puntero dibujado (encima de todo, también del panel)
const CURSOR = `(() => { if (document.getElementById('demo-cursor')) return 1; const d = document.createElement('div'); d.id = 'demo-cursor';
  d.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:none;';
  d.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(d); return 1; })()`;
const cursorAt = (page, x, y, down = false) => page.evaluate((x, y, down) => { const d = document.getElementById('demo-cursor'); if (d) { d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.transform = down ? 'scale(.85)' : ''; d.style.display = ''; } }, x, y, down);
const cursorHide = (page) => page.evaluate(() => { const d = document.getElementById('demo-cursor'); if (d) d.style.display = 'none'; });
async function glide(page, from, to, n, dur) { for (let k = 1; k <= n; k++) { const e = 0.5 - 0.5 * Math.cos(Math.PI * k / n); await cursorAt(page, from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e); await frame(page, dur); } }
try {
  const bcdp = await browser.target().createCDPSession();
  await bcdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true });
  const page = (await browser.pages())[0] || await browser.newPage();
  const url = `https://earth.google.com/web/@${LAT},${LON},650a,520d,35y,25h,58t,0r`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=submit]')].find((b) => /rechazar todo|reject all/i.test((b.innerText || b.value || ''))); if (b) b.click(); }).catch(() => { });
  await sleep(12000);
  await closeEarthDialog(page, (...a) => console.log(t(), ...a));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(16000);
  await closeEarthDialog(page, (...a) => console.log(t(), ...a));
  await sleep(2000);
  const P = (expr) => page.evaluate(`(() => { const r = document.querySelector('#captar-malla-panel'); if (!r) return null; const $ = (id) => r.shadowRoot.getElementById(id); return (${expr}); })()`);
  await P(`(() => { for (const cb of r.shadowRoot.querySelectorAll('.fmt')) { cb.checked = ['glb', 'stl'].includes(cb.value); cb.dispatchEvent(new Event('change')); } $('detalle').value = 'max'; $('detalle').dispatchEvent(new Event('change')); return 1; })()`);
  // 1) el panel en Earth; el puntero va a «Capturar área»
  await page.evaluate(CURSOR);
  const b = await P(`(() => { const r2 = $('bArea').getBoundingClientRect(); return [r2.left + r2.width / 2, r2.top + r2.height / 2]; })()`);
  tramo('Captar malla, dentro de Google Earth');
  await cursorAt(page, 760, 470); await frame(page, 1.6);
  await glide(page, [760, 470], b, 14, 0.06);
  await cursorAt(page, b[0], b[1], true); await frame(page, 0.5);
  await P(`$('bArea').click()`);
  let ok = false;
  for (let i = 0; i < 120 && !ok; i++) { await sleep(1000); ok = await P(`!$('capa').hidden && !$('sMarcar').hidden`).catch(() => false); }
  if (!ok) throw new Error('no entró en modo rectángulo');
  await sleep(1500);
  await P(`$('capa').style.display = 'none'`); await closeEarthDialog(page, (...a) => console.log(t(), ...a)); await P(`$('capa').style.display = ''`);
  await sleep(500);
  // 2) rectángulo (la página se recargó: el puntero se vuelve a poner)
  await page.evaluate(CURSOR);
  const vista = JSON.parse(await page.evaluate(() => document.querySelector('#captar-malla-panel').dataset.vista));
  const [cx, cy, cw, ch] = vista.canvas;
  const mpp = 2 * vista.view.d * Math.tan(vista.view.fov * Math.PI / 360) / ch;
  const w = AREA_W / mpp, h = AREA_H / mpp;
  const X0 = cx + cw / 2 - w / 2, Y0 = cy + ch / 2 - h / 2, X1 = X0 + w, Y1 = Y0 + h;
  tramo('Arrastra un rectángulo: medida, posiciones, tiempo y peso al momento');
  await cursorAt(page, X0 - 120, Y0 + 140); await frame(page, 0.9);
  await glide(page, [X0 - 120, Y0 + 140], [X0, Y0], 10, 0.05);
  await page.mouse.move(X0, Y0); await page.mouse.down();
  for (let k = 1; k <= 30; k++) {
    const e = 0.5 - 0.5 * Math.cos(Math.PI * k / 30);
    const x = X0 + (X1 - X0) * e, y = Y0 + (Y1 - Y0) * e;
    await page.mouse.move(x, y); await cursorAt(page, x, y, true); await sleep(k === 30 ? 900 : 60);
    await frame(page, k === 30 ? 1.8 : 0.07);
  }
  await page.mouse.up();
  console.log(t(), 'rectángulo:', await P(`$('medida').textContent`));
  await cursorHide(page);
  // 3) captura: la página pasa a 3840×2400 (reducida); se graba la esquina con el panel a tamaño real
  tramo('Al soltar, captura sola con el máximo detalle (acelerado)');
  const clip = { x: 0, y: 0, width: 1424, height: 749 };
  for (let i = 0; i < 400; i++) {
    const s = await P(`({ corre: !$('sCorre').hidden, fin: !$('sFin').hidden })`).catch(() => null);
    if (s && s.fin) break;
    if (s && s.corre) await frame(page, 0.11, { clip }).catch(() => { });
    await sleep(900);
  }
  await sleep(1200);
  // 4) terminado
  tramo('Listo: GLB con texturas y STL para imprimir en Descargas');
  await page.evaluate(CURSOR); await cursorAt(page, 700, 460);
  await frame(page, 1.2);
  const v = await P(`(() => { const r2 = $('bVer').getBoundingClientRect(); return [r2.left + r2.width / 2, r2.top + r2.height / 2]; })()`);
  await glide(page, [700, 460], v, 12, 0.06);
  await cursorAt(page, v[0], v[1], true); await frame(page, 1.4);
  console.log(t(), 'terminado:', (await P(`$('sFin').innerText`)).replace(/\n/g, ' | ').slice(0, 300));
  // 5) visor: el modelo girando (arrastrando con el ratón)
  const viewer = (await browser.pages()).find((p) => p.url().includes('viewer.html'));
  if (viewer) {
    await viewer.bringToFront(); await sleep(2500);
    await viewer.evaluate(() => window.__captarMallaVisor.frameAll(false)); await sleep(2000);
    await viewer.evaluate(CURSOR);
    tramo('Visor 3D incluido');
    const c = await viewer.evaluate(() => { const r2 = document.getElementById('lienzo').getBoundingClientRect(); return [r2.left + r2.width / 2, r2.top + r2.height / 2]; });
    await cursorAt(viewer, c[0], c[1] + 120); await frame(viewer, 1.0);
    await viewer.mouse.move(c[0], c[1] + 120); await viewer.mouse.down();
    for (let k = 1; k <= 60; k++) { const x = c[0] + 6 * k, y = c[1] + 120 - 0.6 * k; await viewer.mouse.move(x, y); await cursorAt(viewer, x, y, true); await sleep(40); await frame(viewer, 0.06); }
    await viewer.mouse.up(); await cursorHide(viewer); await frame(viewer, 1.6);
  }
  tramos[tramos.length - 1].fin = tVideo;
  fs.writeFileSync(path.join(OUT, 'lista.txt'), list.join('\n') + '\n' + list[list.length - 2] + '\n');
  fs.writeFileSync(path.join(OUT, 'tramos.json'), JSON.stringify(tramos, null, 1));
  console.log(t(), `fotogramas ${nF}, vídeo de ${tVideo.toFixed(1)} s, tramos:`, JSON.stringify(tramos.map((x) => [x.inicio.toFixed(1), x.fin.toFixed(1)])));
} finally {
  await browser.close();
}
