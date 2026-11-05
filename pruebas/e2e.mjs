// Prueba de extremo a extremo con la EXTENSIÓN cargada en Chrome (perfil temporal).
// Uso: node e2e.mjs <url> <nombre> [esperaSeg] [drag] [formatos]
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const EXT = path.resolve(import.meta.dirname, '../extension');
const [, , url = 'http://127.0.0.1:8765/three.html', name = 'e2e_three', waitS = '4', drag = '', fmts = 'glb,fbx,obj,stl'] = process.argv;
const OUT = path.resolve('out', name); fs.mkdirSync(OUT, { recursive: true });
const SITE = path.resolve('testsite');
const THREE = path.join(EXT, 'lib/three.module.min.js');
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = p === '/three.module.js' ? THREE : path.join(SITE, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
}).listen(8765, '127.0.0.1');
const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new', pipe: true, enableExtensions: [EXT],
  userDataDir: path.resolve('profile_e2e'),
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--window-size=1400,900', '--lang=es-ES'],
  defaultViewport: { width: 1400, height: 900 },
});
try {
  const swT = await browser.waitForTarget((x) => x.type() === 'service_worker' && x.url().endsWith('background.js'), { timeout: 15000 });
  const sw = await swT.worker();
  sw.on('console', (m) => { if (/\[captar\]/.test(m.text())) console.log(t(), 'SW', m.text()); });
  const extId = new URL(swT.url()).host;
  console.log(t(), 'extensión cargada', extId);
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 3000));
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=submit]')].find((b) => /rechazar todo|reject all/i.test((b.innerText || b.value || ''))); if (b) b.click(); }).catch(() => { });
  await new Promise((r) => setTimeout(r, +(process.env.PRE || 1500)));
  const tabId = await sw.evaluate(async () => { const ts = await chrome.tabs.query({}); const tt = ts.filter((x) => /^https?:/.test(x.url || '')).sort((a, b) => b.id - a.id)[0]; return tt ? tt.id : null; });
  console.log(t(), 'pestaña', tabId);
  console.log(t(), 'activar:', JSON.stringify(await sw.evaluate((id) => self.__captarMallaBG.arm(id), tabId)));
  await new Promise((r) => setTimeout(r, +waitS * 1000));
  // consentimiento de Google
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=submit]')].find((b) => /rechazar todo|reject all/i.test((b.innerText || b.value || ''))); if (b) b.click(); }).catch(() => { });
  console.log(t(), 'estado:', JSON.stringify(await sw.evaluate((id) => self.__captarMallaBG.state(id), tabId)).slice(0, 400));
  const capP = sw.evaluate((id) => self.__captarMallaBG.capture(id, { textures: true }), tabId);
  if (drag) {
    for (let rep = 0; rep < 4; rep++) {
      await new Promise((r) => setTimeout(r, 2500));
      await page.mouse.move(700, 450); await page.mouse.down();
      for (let k = 1; k <= 12; k++) { await page.mouse.move(700 + k * 2, 450); await new Promise((r) => setTimeout(r, 30)); }
      await page.mouse.up();
    }
  }
  const cap = await capP;
  console.log(t(), 'captura:', JSON.stringify(cap));
  console.log((await sw.evaluate(() => (self.__captarLog || []).join('\n'))));
  await page.screenshot({ path: path.join(OUT, 'pagina.png') });
  if (!cap.ok) throw new Error('captura fallida');
  const vT = await browser.waitForTarget((x) => x.url().includes('viewer.html?id='), { timeout: 20000 });
  const viewer = await vT.page();
  await viewer.setViewport({ width: 1400, height: 900 });
  const cdp = await viewer.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true });
  await viewer.waitForFunction(() => window.__captarMallaVisor && window.__captarMallaVisor.S.scene && document.getElementById('cargando').hidden, { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 2500));
  const info = await viewer.evaluate(() => { const S = window.__captarMallaVisor.S; return { mallas: S.scene.meshes.length, grupos: S.scene.groups.map((g) => [g.enabled, g.label, g.meshes, g.tris, g.reason]), info: S.scene.info, cuenta: document.getElementById('cuenta').textContent }; });
  console.log(t(), 'visor:', JSON.stringify(info).slice(0, 1500));
  await viewer.screenshot({ path: path.join(OUT, 'visor.png') });
  for (const f of fmts.split(',').filter(Boolean)) {
    await viewer.evaluate((ff) => window.__captarMallaVisor.doExport(ff), f);
    const st = await viewer.evaluate(() => document.getElementById('estadoExport').textContent);
    console.log(t(), 'exportar', f, '→', st);
  }
  await new Promise((r) => setTimeout(r, 3000));
  console.log(t(), 'descargas:', fs.readdirSync(OUT).join(', '));
} catch (e) {
  console.log(t(), 'ERROR', e.message);
} finally {
  await browser.close();
  srv.close();
}
