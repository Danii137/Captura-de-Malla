// Abre una captura .cmal en el visor (servido por http) y saca capturas de pantalla.
// Uso: node viewer_test.mjs out/earth_0.cmal nombre [radio]
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const EXT = path.resolve(import.meta.dirname, '../extension');
const [, , file, name = 'visor', radius = ''] = process.argv;
const types = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(EXT, p === '/' ? 'viewer.html' : p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8766, '127.0.0.1');
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new',
  userDataDir: path.resolve('profile_viewer'),
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'], defaultViewport: { width: 1500, height: 950 },
});
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('consola:', m.text()); });
  page.on('pageerror', (e) => console.log('error página:', e.message));
  await page.goto('http://127.0.0.1:8766/viewer.html', { waitUntil: 'load' });
  const input = await page.$('#archivoCmal');
  await input.uploadFile(path.resolve(file));
  await page.waitForFunction(() => location.search.includes('id='), { timeout: 60000 });
  await page.waitForFunction(() => window.__captarMallaVisor && window.__captarMallaVisor.S.scene && document.getElementById('cargando').hidden, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 4000));
  if (radius) await page.evaluate((r) => { const n = document.getElementById('radioNum'); n.value = r; n.dispatchEvent(new Event('change')); }, radius);
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => window.__captarMallaVisor.frameAll(false));
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `out/${name}_perspectiva.png` });
  await page.evaluate(() => window.__captarMallaVisor.frameAll(true));
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `out/${name}_planta.png` });
  // girar con el ratón: el horizonte debe quedar nivelado
  await page.evaluate(() => window.__captarMallaVisor.frameAll(false));
  await page.mouse.move(900, 500); await page.mouse.down();
  for (let k = 1; k <= 20; k++) await page.mouse.move(900 + k * 12, 500 - k * 3);
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `out/${name}_girada.png` });
  console.log(await page.evaluate(() => document.getElementById('cuenta').textContent));
} catch (e) { console.log('ERROR', e.message); }
await browser.close(); srv.close();
