// Prueba del trabajo de área (lib/earth.js) sin la interfaz: Chrome de pruebas + mismo gancho e inyector.
// Uso: node area_test.mjs <lat> <lon> <W> <H> [detalle] [nombre]
import { launchChrome } from './cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const EXT = path.resolve(import.meta.dirname, '../extension');
const imp = (p) => import(pathToFileURL(path.join(EXT, p)).href);
const { createInjector } = await imp('lib/injector.js');
const D = await imp('lib/decode.js');
const E = await imp('lib/earth.js');
const hookSource = fs.readFileSync(path.join(EXT, 'hook.js'), 'utf8');
const [, , LAT = '40.4153', LON = '-3.7074', W = '300', H = '200', DET = 'max', NAME = 'area'] = process.argv;
const OUT = path.resolve('out', 'area'); fs.mkdirSync(OUT, { recursive: true });
const cdp0 = await launchChrome({ headless: !process.env.HEADFUL, profile: process.env.PROFILE || 'profile_probe' });
const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const send0 = (m, p, s) => Promise.race([cdp0.send(m, p, s), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + m)), 300000))]);
const { targetId } = await send0('Target.createTarget', { url: 'about:blank' });
const { sessionId: S } = await send0('Target.attachToTarget', { targetId, flatten: true });
const inj = createInjector({ send: (sid, m, p) => send0(m, p, sid || S), hookSource, b64decode: (s) => new Uint8Array(Buffer.from(s, 'base64')) });
cdp0.on((method, params, sid) => {
  if (!sid) return;
  // retransmisión que mantiene a Earth dibujando en segundo plano: confirmar cada fotograma
  if (method === 'Page.screencastFrame') { cdp0.send('Page.screencastFrameAck', { sessionId: params.sessionId }, sid).catch(() => { }); return; }
  inj.onEvent(sid === S ? '' : sid, method, params);
});
await inj.setupRoot();
await send0('Page.navigate', { url: `https://earth.google.com/web/@${LAT},${LON},650a,500d,35y,0h,0t,0r` }, S);
await new Promise((r) => setTimeout(r, 7000));
await send0('Runtime.evaluate', { expression: `(() => { const b = [...document.querySelectorAll('button')].find(b => /rechazar todo|reject all/i.test(b.innerText||'')); if (b) b.click(); })()` }, S).catch(() => { });
// ANIM=1: un lienzo WebGL animado sin parar encima de Earth (como el aviso «Novedades», que no deja de dibujar)
if (process.env.ANIM) await send0('Runtime.evaluate', { expression: `(() => { const c = document.createElement('canvas'); c.width = 120; c.height = 80; c.style.cssText = 'position:fixed;right:10px;bottom:60px;z-index:99999'; document.body.appendChild(c); const g = c.getContext('webgl'); let t = 0; (function f() { t += 0.03; g.clearColor(0.5 + 0.5 * Math.sin(t), 0.3, 0.6, 1); g.clear(g.COLOR_BUFFER_BIT); g.drawArrays(g.POINTS, 0, 0); requestAnimationFrame(f); })(); return 1; })()` }, S);
const job = E.createEarthJob({
  inj, cdp: (m, p) => send0(m, p, S), decode: D,
  bg: process.env.BG ? JSON.parse(process.env.BG) : {}, // p. ej. BG='{"screencast":false}'
  progress: (txt, f) => console.log(t(), '·', txt, f !== undefined ? Math.round(f * 100) + '%' : ''),
  log: (...a) => console.log(t(), '  ', ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))),
});
await job.waitIdle({ maxMs: 30000 });
const td = await job.topDown();
const { overview, ...tdv } = td;
console.log(t(), 'vista cenital', JSON.stringify(tdv), 'alturas guardadas:', overview ? overview.pts.length / 3 : 0, 'puntos');
const shot = await send0('Page.captureScreenshot', { format: 'jpeg', quality: 60 }, S); fs.writeFileSync(path.join(OUT, NAME + '_antes.jpg'), Buffer.from(shot.data, 'base64'));
const res = await job.runArea({ lat: +LAT, lon: +LON, W: +W, H: +H, a: td.view.a }, { detail: DET, overview: process.env.SIN_VISTA ? null : overview });
console.log(t(), 'resultado', JSON.stringify({ s: res.seconds, bytes: res.bytes.length, avisos: res.warnings, area: Object.assign({}, res.area, { cells: res.area.cells.length }) }));
fs.writeFileSync(path.join(OUT, NAME + '.cmal'), res.bytes);
fs.writeFileSync(path.join(OUT, NAME + '.json'), JSON.stringify(res.area, null, 1));
console.log(t(), 'celdas', res.area.cells.map((c) => `f${c.f}:${c.tile.toFixed(1)}m`).join(' '));
cdp0.proc.kill();
// --- comprobación del montaje
const T1 = Date.now();
const part = D.parsePart(new Uint8Array(res.bytes));
console.log('parte: dibujos', part.header.draws.length, 'geometrías', part.header.geoms.length, 'texturas', part.header.textures.length, 'fotogramas', part.header.frames, 'pasos', JSON.stringify(part.header.snaps.map((s) => [s.frame, s.draws])));
const sc = D.buildScene([part], { area: res.area });
console.log('buildScene', Date.now() - T1, 'ms', JSON.stringify(sc.info));
let tris = 0; for (const m of sc.meshes) tris += m.nTris;
console.log('mallas', sc.meshes.length, 'triángulos', tris, 'texturas', sc.textures.size, 'sin textura', sc.meshes.filter((m) => !m.texKey).length);
// centros del globo distintos por fotograma
const gcs = new Map(); for (const m of sc.meshes) if (m.gc) gcs.set(m.frame, m.gc.map((x) => x.toFixed(9)).join(','));
console.log('centro del globo por fotograma', [...new Set(gcs.values())].length, 'distintos');
// cobertura: rejilla de 2 m dentro del rectángulo con algún triángulo (por centroide)
const cs = 2, nx = Math.ceil(+W / cs), ny = Math.ceil(+H / cs), grid = new Uint8Array(nx * ny);
const o = sc.info.origin;
for (const m of sc.meshes) { const p = m.positions, I = m.indices; for (let i = 0; i < I.length; i += 3) { const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3; const x = (p[a] + p[b] + p[c]) / 3 + o[0] + W / 2, y = (p[a + 1] + p[b + 1] + p[c + 1]) / 3 + o[1] + H / 2; const gx = Math.floor(x / cs), gy = Math.floor(y / cs); if (gx >= 0 && gy >= 0 && gx < nx && gy < ny) grid[gy * nx + gx] = 1; } }
let empty = 0; for (const v of grid) if (!v) empty++;
console.log(`cobertura en celdas de ${cs} m: ${(100 - empty / grid.length * 100).toFixed(2)} % (${empty} vacías de ${grid.length})`);
// caja
const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const m of sc.meshes) for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], m.bbox[k] + o[k]); bb[k + 3] = Math.max(bb[k + 3], m.bbox[k + 3] + o[k]); }
console.log('caja', bb.map((v) => v.toFixed(1)).join(', '));
process.exit(0);
