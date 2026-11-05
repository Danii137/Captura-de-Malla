// Captura de pantalla de la ventana del botón, antes y después de activar el modo captura.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const EXT = path.resolve(import.meta.dirname, '../extension');
const SITE = path.resolve('testsite');
const THREE = path.join(EXT, 'lib/three.module.min.js');
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = p === '/three.module.js' ? THREE : path.join(SITE, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
}).listen(8765, '127.0.0.1');
fs.rmSync(path.resolve('profile_e2e'), { recursive: true, force: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', pipe: true, enableExtensions: [EXT], userDataDir: path.resolve('profile_e2e'), args: ['--use-angle=d3d11', '--enable-gpu'] });
try {
  const swT = await browser.waitForTarget((x) => x.type() === 'service_worker' && x.url().endsWith('background.js'));
  const sw = await swT.worker(); const extId = new URL(swT.url()).host;
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:8765/three.html'); await new Promise((r) => setTimeout(r, 1500));
  const tabId = await sw.evaluate(async () => { const ts = await chrome.tabs.query({}); return ts.filter((x) => /^http/.test(x.url)).sort((a, b) => b.id - a.id)[0].id; });
  const pop = await browser.newPage(); await pop.setViewport({ width: 340, height: 560 });
  await pop.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`); await new Promise((r) => setTimeout(r, 1200));
  await pop.screenshot({ path: 'out/popup_inactivo.png' });
  await pop.click('#activar'); await new Promise((r) => setTimeout(r, 5000));
  await pop.screenshot({ path: 'out/popup_activo.png' });
  console.log('ok');
} catch (e) { console.log('ERROR', e.message); }
await browser.close(); srv.close();
