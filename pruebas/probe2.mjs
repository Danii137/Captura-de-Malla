// Sonda 2: engancha página, iframes y workers (como DevTools) y registra el uso de WebGL.
import { launchChrome } from './cdp.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('probe_out'); fs.mkdirSync(OUT, { recursive: true });
const url = process.argv[2] || 'https://www.google.com/maps/@40.4153,-3.7074,350a,35y,45t/data=!3m1!1e3?hl=es';
const tag = process.argv[3] || 'maps3d';
const headless = process.argv[4] !== 'headful';

const PROBE = `(() => {
  const G = self; if (G.__probe) return;
  const log = G.__probe = { where: (typeof document !== 'undefined') ? 'doc:' + location.href.slice(0, 80) : 'worker:' + location.href.slice(0, 80), ctx: [], shaders: [], programs: [], draws: 0, drawsByProg: {}, offscreen: 0 };
  if (G.HTMLCanvasElement && HTMLCanvasElement.prototype.transferControlToOffscreen) {
    const t = HTMLCanvasElement.prototype.transferControlToOffscreen;
    HTMLCanvasElement.prototype.transferControlToOffscreen = function() { log.offscreen++; return t.apply(this, arguments); };
  }
  for (const C of [G.HTMLCanvasElement, G.OffscreenCanvas]) {
    if (!C) continue; const og = C.prototype.getContext;
    C.prototype.getContext = function(type, attrs) { const c = og.apply(this, arguments); if (c && /webgl/i.test(type)) log.ctx.push({ type, w: this.width, h: this.height, cls: C.name }); return c; };
  }
  for (const P of [G.WebGLRenderingContext, G.WebGL2RenderingContext]) {
    if (!P) continue; const proto = P.prototype;
    const ss = proto.shaderSource;
    proto.shaderSource = function(sh, src) { if (log.shaders.length < 600) log.shaders.push(src); return ss.apply(this, arguments); };
    const lp = proto.linkProgram;
    proto.linkProgram = function(p) {
      const r = lp.apply(this, arguments);
      try {
        const gl = this, info = { ctx: P.name, attribs: [], uniforms: [], blocks: [] };
        const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); info.attribs.push([a.name, a.type, a.size, gl.getAttribLocation(p, a.name)]); }
        const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < nu; i++) { const u = gl.getActiveUniform(p, i); info.uniforms.push([u.name, u.type, u.size]); }
        if (P.name === 'WebGL2RenderingContext') { const nb = gl.getProgramParameter(p, 0x8A36); for (let i = 0; i < nb; i++) info.blocks.push(gl.getActiveUniformBlockName(p, i)); }
        const sh = gl.getAttachedShaders(p) || [];
        const srcs = sh.map(s => gl.getShaderSource(s));
        info.vs = srcs.find(s => s && /gl_Position/.test(s)) || null;
        info.fs = srcs.find(s => s && !/gl_Position/.test(s)) || null;
        p.__pid = log.programs.length; log.programs.push(info);
      } catch (e) { log.err = String(e); }
      return r;
    };
    for (const fn of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) {
      const f = proto[fn]; if (!f) continue;
      proto[fn] = function() {
        log.draws++;
        try { const p = this.getParameter(this.CURRENT_PROGRAM); const k = fn + ':p' + (p && p.__pid) + ':mode' + arguments[0]; log.drawsByProg[k] = (log.drawsByProg[k] || 0) + 1; } catch (e) { }
        return f.apply(this, arguments);
      };
    }
  }
})();`;

const cdp0 = await launchChrome({ headless });
const T0 = Date.now();
const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
// envoltorio con tiempo límite para que nada se quede colgado
const cdp = { ...cdp0, send: (m, p, s) => Promise.race([cdp0.send(m, p, s), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + m)), 15000))]) };
const sessions = new Map(); // sessionId -> info
async function setupSession(sessionId, info) {
  sessions.set(sessionId, info);
  try {
    if (info.type === 'page' || info.type === 'iframe') {
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE }, sessionId);
    } else {
      // worker: pausar antes del primer script, inyectar y seguir
      await cdp.send('Debugger.enable', {}, sessionId);
      await cdp.send('Debugger.setInstrumentationBreakpoint', { instrumentation: 'beforeScriptExecution' }, sessionId);
    }
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  } catch (e) { console.log(t(), 'setup err', info.type, e.message); }
  try { await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId); } catch { }
}
cdp0.on(async (method, params, sessionId) => {
  if (method === 'Target.attachedToTarget') {
    const ti = params.targetInfo;
    console.log(t(), 'attached', ti.type, ti.url.slice(0, 90));
    setupSession(params.sessionId, { type: ti.type, url: ti.url });
  } else if (method === 'Debugger.paused' && params.reason === 'instrumentation') {
    const info = sessions.get(sessionId) || {};
    try {
      if (!info.injected) {
        info.injected = true;
        const r = await cdp.send('Runtime.evaluate', { expression: PROBE + ';"ok"', returnByValue: true }, sessionId);
        console.log(t(), 'inyectado en worker', info.url && info.url.slice(0, 60), r.result && r.result.value);
        await cdp.send('Debugger.removeInstrumentationBreakpoint', { instrumentation: 'beforeScriptExecution' }, sessionId).catch(() => { });
      }
    } catch (e) { console.log(t(), 'inject err', e.message); }
    try { await cdp.send('Debugger.resume', {}, sessionId); } catch (e) { }
    try { await cdp.send('Debugger.disable', {}, sessionId); } catch (e) { }
  }
});
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await setupSession(sessionId, { type: 'page', url: 'about:blank' });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await cdp.send('Page.navigate', { url }, sessionId);
await new Promise(r => setTimeout(r, 5000));
// consentimiento
await cdp.send('Runtime.evaluate', { expression: `(() => { const b = [...document.querySelectorAll('button,input[type=submit]')].find(b => /rechazar todo|reject all/i.test((b.innerText||b.value||''))); if (b) { b.click(); return 'click'; } return 'no'; })()`, returnByValue: true }, sessionId).then(r => console.log('consent', r.result.value));
await new Promise(r => setTimeout(r, 10000));
// inclinar la vista: Ctrl + arrastrar hacia arriba (modifiers 2 = Ctrl)
for (let rep = 0; rep < 2; rep++) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 760, y: 600, button: 'left', clickCount: 1, modifiers: 2 }, sessionId);
  for (let i = 1; i <= 15; i++) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 760, y: 600 - i * 12, button: 'left', buttons: 1, modifiers: 2 }, sessionId);
    await new Promise(r => setTimeout(r, 40));
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 760, y: 420, button: 'left', clickCount: 1, modifiers: 2 }, sessionId);
  await new Promise(r => setTimeout(r, 1500));
}
await new Promise(r => setTimeout(r, 12000));
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(shot.data, 'base64'));
const results = [];
for (const [sid, info] of sessions) {
  try {
    const r = await cdp.send('Runtime.evaluate', { expression: 'self.__probe ? JSON.stringify(self.__probe) : null', returnByValue: true }, sid);
    if (r.result.value) { const p = JSON.parse(r.result.value); results.push({ info, ...p }); }
  } catch (e) { }
}
fs.writeFileSync(path.join(OUT, tag + '_info.json'), JSON.stringify(results, null, 1));
for (const r of results) console.log(r.info.type, r.where, 'ctx', JSON.stringify(r.ctx), 'programs', r.programs.length, 'draws', r.draws, 'offscreen', r.offscreen);
cdp.proc.kill();
process.exit(0);
