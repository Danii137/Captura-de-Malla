// Experimento: detalle (tamaño de tesela) según la distancia de la cámara, vista cenital.
import { launchChrome } from './cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tileStats } from './tiles.mjs';
const EXT = path.resolve(import.meta.dirname, '../extension');
const { createInjector } = await import(pathToFileURL(path.join(EXT, 'lib/injector.js')).href);
const D = await import(pathToFileURL(path.join(EXT, 'lib/decode.js')).href);
const hookSource = fs.readFileSync(path.join(EXT, 'hook.js'), 'utf8');
const OUT = path.resolve('out', 'lod'); fs.mkdirSync(OUT, { recursive: true });
const cdp0 = await launchChrome({ headless: !process.env.HEADFUL, profile: 'profile_probe' });
const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const send0 = (m, p, s) => Promise.race([cdp0.send(m, p, s), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + m)), 120000))]);
const { targetId } = await send0('Target.createTarget', { url: 'about:blank' });
const { sessionId: S } = await send0('Target.attachToTarget', { targetId, flatten: true });
await send0('Emulation.setDeviceMetricsOverride', { width: +(process.env.W || 1400), height: +(process.env.H || 900), deviceScaleFactor: +(process.env.DPR || 1), mobile: false }, S);
const inj = createInjector({ send: (sid, m, p) => send0(m, p, sid || S), hookSource, b64decode: (s) => new Uint8Array(Buffer.from(s, 'base64')) });
cdp0.on((method, params, sid) => { if (!sid) return; inj.onEvent(sid === S ? '' : sid, method, params); });
await inj.setupRoot();
const ev = async (expr) => { const r = await send0('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, S); return r.result ? r.result.value : r; };
const draws = async () => ev('self.__captarMalla ? self.__captarMalla.status().totalDraws : -1');
const LAT = 40.4153, LON = -3.7074, ALT = 650;
const url = (d, h = 0) => `https://earth.google.com/web/@${LAT},${LON},${ALT}a,${d}d,35y,${h}h,0t,0r`;
async function go(u) { await ev(`history.pushState(null, '', ${JSON.stringify(u)}); dispatchEvent(new PopStateEvent('popstate', { state: null })); 1`); }
async function waitIdle(quietMs = 2500, maxMs = 40000) {
  const t0 = Date.now(); let prev = await draws(), last = Date.now();
  while (Date.now() - t0 < maxMs) { await new Promise((r) => setTimeout(r, 250)); const d = await draws(); if (d !== prev) { prev = d; last = Date.now(); } else if (Date.now() - last >= quietMs) return Date.now() - t0; }
  return -1;
}
await send0('Page.navigate', { url: url(600) }, S);
await new Promise((r) => setTimeout(r, 6000));
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => /rechazar todo|reject all/i.test(b.innerText||'')); if (b) b.click(); })()`).catch(() => { });
console.log(t(), 'inicio, quieto en', await waitIdle());
const dists = (process.env.DISTS || '600,300,150,80,40').split(',').map(Number);
let k = 0;
for (const d of dists) {
  const HD = +(process.env.HD || 2);
  await go(url(d, HD));
  const idle = await waitIdle();
  // captura: armar y provocar fotogramas devolviendo el giro a 0°
  const realm = { sid: '', contextId: null, label: 'página' };
  const capP = send0('Runtime.evaluate', { expression: `self.__captarMalla.capture(${JSON.stringify({ frames: 1, waitMs: 8000, textures: false })})`, awaitPromise: true, returnByValue: true }, S)
    .then((x) => { const s = x.result.value; return { parts: s && s.draws ? [{ realm, summary: s }] : [], all: [{ summary: s }] }; });
  await new Promise((r) => setTimeout(r, 100));
  await go(url(d, 0));
  const r = await capP;
  await waitIdle(1500, 15000);
  const s = r.parts[0]?.summary;
  console.log(t(), `d=${d}: quieto tras ${idle} ms; captura`, s ? `${s.draws} dibujos ${s.reason}` : JSON.stringify(r.all.map((x) => x.summary || x.error)));
  if (!r.parts.length) continue;
  const bytes = await inj.pull(r.parts[0]); await inj.free(r.parts[0]);
  fs.writeFileSync(path.join(OUT, `d${d}.cmal`), bytes);
  const { tiles } = tileStats(D.parsePart(bytes));
  const near = tiles.filter((x) => x.dist < Math.max(30, d * 0.25));
  const finT = tiles.filter((x) => x.ext < Math.min(...tiles.map((y) => y.ext)) * 1.2);
  const ex = finT.reduce((a, x) => [Math.min(a[0], x.enu[0]), Math.min(a[1], x.enu[1]), Math.max(a[2], x.enu[0]), Math.max(a[3], x.enu[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  console.log(`   zona con la más fina (centros de tesela): este ${ex[0].toFixed(0)}..${ex[2].toFixed(0)}, norte ${ex[1].toFixed(0)}..${ex[3].toFixed(0)} m; triángulos ${JSON.parse(JSON.stringify(s)).verts} vértices`);
  const fin = Math.min(...tiles.map((x) => x.ext));
  const hist = {}; for (const x of tiles) { const e = x.ext.toFixed(1); hist[e] = (hist[e] || 0) + 1; }
  console.log(`   más fina ${fin.toFixed(1)} m; cerca del centro: ${[...new Set(near.map((x) => x.ext.toFixed(1)))].join(', ')}; teselas ${tiles.length}; por tamaño ${JSON.stringify(hist)}`);
  const sh = await send0('Page.captureScreenshot', { format: 'jpeg', quality: 50 }, S); fs.writeFileSync(path.join(OUT, `d${d}.jpg`), Buffer.from(sh.data, 'base64'));
}
cdp0.proc.kill();
process.exit(0);
