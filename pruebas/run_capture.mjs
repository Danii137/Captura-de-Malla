// Prueba de extremo a extremo SIN la extensión: usa el mismo hook.js e injector.js
// sobre un Chrome de pruebas, captura y guarda las partes en out/.
// Uso: node run_capture.mjs <url> <nombre> [esperaSeg] [headful] [accion]
import { launchChrome } from './cdp.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXT = path.resolve(import.meta.dirname, '../extension');
const { createInjector } = await import(pathToFileURL(path.join(EXT, 'lib/injector.js')).href);
const hookSource = fs.readFileSync(path.join(EXT, 'hook.js'), 'utf8');

const [, , url = 'http://127.0.0.1:8765/three.html', name = 'three', waitS = '4', mode = 'headless', action = ''] = process.argv;
const OUT = path.resolve('out'); fs.mkdirSync(OUT, { recursive: true });

// servidor estático de la web de pruebas
const SITE = path.resolve('testsite');
const THREE = path.join(EXT, 'lib/three.module.min.js');
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = p === '/three.module.js' ? THREE : path.join(SITE, p);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
}).listen(8765, '127.0.0.1');

const cdp0 = await launchChrome({ headless: mode !== 'headful', profile: process.env.PROFILE || 'profile_cap' });
const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const send0 = (m, p, s) => Promise.race([cdp0.send(m, p, s), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + m)), +(process.env.TMO || 120000)))]);
const { targetId } = await send0('Target.createTarget', { url: 'about:blank' });
const { sessionId: rootSid } = await send0('Target.attachToTarget', { targetId, flatten: true });
await send0('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, rootSid);

const inj = createInjector({
  send: (sid, m, p) => send0(m, p, sid || rootSid),
  hookSource,
  log: (...a) => { if (process.env.VERBOSE) console.log(t(), ...a); },
  b64decode: (s) => new Uint8Array(Buffer.from(s, 'base64')),
});
cdp0.on((method, params, sid) => { if (!sid) return; inj.onEvent(sid === rootSid ? '' : sid, method, params); });
await inj.setupRoot();
await send0('Page.navigate', { url }, rootSid);
console.log(t(), 'navegando', url);
await new Promise((r) => setTimeout(r, +waitS * 1000));
console.log(t(), 'espera terminada');
// consentimiento de Google si aparece
await send0('Runtime.evaluate', { expression: `(() => { const b = [...document.querySelectorAll('button,input[type=submit]')].find(b => /rechazar todo|reject all/i.test((b.innerText||b.value||''))); if (b) { b.click(); return 'click'; } return 'no'; })()`, returnByValue: true }, rootSid).catch(() => { });
console.log(t(), 'consentimiento hecho');
if (action === 'drag') {
  for (let i = 0; i < 3; i++) {
    await send0('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 450, button: 'left', clickCount: 1 }, rootSid);
    for (let k = 1; k <= 10; k++) await send0('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700 + k * 4, y: 450, button: 'left', buttons: 1 }, rootSid);
    await send0('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 740, y: 450, button: 'left', clickCount: 1 }, rootSid);
  }
}
const shot = await send0('Page.captureScreenshot', { format: 'png' }, rootSid).catch(() => null);
if (shot) fs.writeFileSync(path.join(OUT, name + '_pantalla.png'), Buffer.from(shot.data, 'base64'));

const st = await inj.status();
console.log(t(), 'reinos:', st.map((s) => `${s.realm.label} ctx=${s.st ? s.st.contexts.length : '-'} draws=${s.st ? s.st.totalDraws : '-'}`).join(' | '));
const capOpts = JSON.parse(process.env.CAPOPTS || '{"frames":1}');
const capP = inj.captureAll(capOpts);
if (action === 'dragcap') {
  // simular que el usuario mueve un poco la vista mientras se captura
  for (let rep = 0; rep < 4; rep++) {
    await new Promise((r) => setTimeout(r, 2500));
    await send0('Input.dispatchMouseEvent', { type: 'mousePressed', x: 700, y: 450, button: 'left', clickCount: 1 }, rootSid).catch(() => { });
    for (let k = 1; k <= 12; k++) { await send0('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700 + k * 2, y: 450, button: 'left', buttons: 1 }, rootSid).catch(() => { }); await new Promise((r) => setTimeout(r, 30)); }
    await send0('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 724, y: 450, button: 'left', clickCount: 1 }, rootSid).catch(() => { });
  }
}
const r = await capP;
console.log(t(), 'captura:', JSON.stringify(r.all ? r.all.map((x) => x.summary || x.error) : r));
let i = 0;
for (const part of r.parts) {
  const bytes = await inj.pull(part);
  const f = path.join(OUT, `${name}_${i++}.cmal`);
  fs.writeFileSync(f, bytes);
  console.log(t(), 'guardado', f, bytes.length, 'bytes');
  await inj.free(part);
}
cdp0.proc.kill();
srv.close();
process.exit(0);
