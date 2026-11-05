// Experimento: ¿cómo mover la cámara de Google Earth web sin recargar? ¿cuándo deja de dibujar?
import { launchChrome } from './cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const EXT = path.resolve(import.meta.dirname, '../extension');
const { createInjector } = await import(pathToFileURL(path.join(EXT, 'lib/injector.js')).href);
const hookSource = fs.readFileSync(path.join(EXT, 'hook.js'), 'utf8');
const OUT = path.resolve('out', 'nav'); fs.mkdirSync(OUT, { recursive: true });
const cdp0 = await launchChrome({ headless: !process.env.HEADFUL, profile: 'profile_probe' });
const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const send0 = (m, p, s) => Promise.race([cdp0.send(m, p, s), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + m)), 60000))]);
const { targetId } = await send0('Target.createTarget', { url: 'about:blank' });
const { sessionId: S } = await send0('Target.attachToTarget', { targetId, flatten: true });
await send0('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, S);
const inj = createInjector({ send: (sid, m, p) => send0(m, p, sid || S), hookSource, b64decode: (s) => new Uint8Array(Buffer.from(s, 'base64')) });
cdp0.on((method, params, sid) => { if (!sid) return; inj.onEvent(sid === S ? '' : sid, method, params); });
await inj.setupRoot();
const ev = async (expr) => { const r = await send0('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, S); return r.result ? r.result.value : r; };
const shot = async (n) => { const s = await send0('Page.captureScreenshot', { format: 'jpeg', quality: 60 }, S); fs.writeFileSync(path.join(OUT, n + '.jpg'), Buffer.from(s.data, 'base64')); };
const draws = async () => ev('self.__captarMalla ? self.__captarMalla.status().totalDraws : -1');
async function watch(label, secs) {
  let prev = await draws();
  const line = [];
  for (let i = 0; i < secs; i++) { await new Promise((r) => setTimeout(r, 1000)); const d = await draws(); line.push(d - prev); prev = d; }
  console.log(t(), label, 'dibujos por segundo:', line.join(' '));
}
const A = 'https://earth.google.com/web/@40.4153,-3.7074,650a,300d,35y,0h,0t,0r';
await send0('Page.navigate', { url: A }, S);
await new Promise((r) => setTimeout(r, 6000));
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => /rechazar todo|reject all/i.test(b.innerText||'')); if (b) b.click(); })()`).catch(() => { });
await watch('carga A', 16);
console.log(t(), 'href', await ev('location.href'));
await shot('A');
// Prueba 1: pushState + popstate
const B = 'https://earth.google.com/web/@40.4153,-3.70504,650a,300d,35y,0h,0t,0r';
await ev(`history.pushState(null, '', ${JSON.stringify(B)}); dispatchEvent(new PopStateEvent('popstate', { state: null })); 1`);
await watch('tras popstate', 6);
console.log(t(), 'href', await ev('location.href'));
await shot('B_popstate');
// Prueba 2: atrás del historial (si Earth guarda entradas)
await ev(`history.back(); 1`);
await watch('tras back', 5);
console.log(t(), 'href', await ev('location.href'));
await shot('C_back');
// Prueba 3: ¿hay campo de búsqueda?
console.log(t(), 'inputs', await ev(`JSON.stringify([...document.querySelectorAll('input')].map(i => ({id: i.id, ph: i.placeholder, type: i.type})).slice(0, 10))`));
console.log(t(), 'custom elements', await ev(`JSON.stringify([...new Set([...document.querySelectorAll('*')].map(e => e.tagName.toLowerCase()).filter(n => n.includes('-')))].slice(0, 60))`));
cdp0.proc.kill();
process.exit(0);
