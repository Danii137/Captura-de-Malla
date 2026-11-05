// Captar malla — proceso de fondo (solo Google Earth).
// Activa el modo captura en la pestaña de Earth (chrome.debugger + gancho en la página y sus workers),
// lleva la captura automática de un área (lib/earth.js) o la captura rápida de la vista,
// guarda el resultado y abre el visor, que prepara y guarda los archivos.
import { createInjector } from './lib/injector.js';
import { saveCapture } from './lib/store.js';
import * as decode from './lib/decode.js';
import { createEarthJob, planArea } from './lib/earth.js';

const EARTH_RE = /^https:\/\/earth\.google\.com\/web\b/;
const tabs = new Map(); // tabId -> { inj, capturing, progress, job, pending, viewerTab, result }
let hookSource = null;
async function getHook() {
  if (!hookSource) hookSource = await (await fetch(chrome.runtime.getURL('hook.js'))).text();
  return hookSource;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function b64decode(s) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s);
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function badge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text: text || '' }).catch(() => { });
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => { });
}
// Mensajes al panel de la pestaña de Earth (contenido) y a la ventana del botón
function toPanel(tabId, msg) { chrome.tabs.sendMessage(tabId, msg).catch(() => { }); }
function progress(tabId, text, extra = {}) {
  const t = tabs.get(tabId); if (t) { t.progress = text; t.frac = extra.frac; }
  const m = Object.assign({ type: 'progreso', tabId, text }, extra);
  chrome.runtime.sendMessage(m).catch(() => { });
  toPanel(tabId, Object.assign({}, m, { type: 'earth-progreso' }));
}
const LOG = (self.__captarLog = self.__captarLog || []);
function log(...a) {
  const s = new Date().toISOString().slice(11, 19) + ' ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log('[captar]', s); LOG.push(s); if (LOG.length > 300) LOG.splice(0, LOG.length - 300);
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const t = tabs.get(source.tabId);
  if (t) t.inj.onEvent(source.sessionId || '', method, params).catch(() => { });
});
chrome.debugger.onDetach.addListener((source, reason) => {
  const t = tabs.get(source.tabId);
  if (!t) return;
  if (t.job) t.job.cancel();
  tabs.delete(source.tabId); keepAlive(); badge(source.tabId, '');
  progress(source.tabId, 'Modo captura desactivado (' + reason + ').', { done: true, ok: false });
  toPanel(source.tabId, { type: 'earth-estado', armed: false });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  const t = tabs.get(tabId); if (t && t.job) t.job.cancel(); tabs.delete(tabId); keepAlive();
  // si se cierra el visor antes de terminar de guardar los archivos, el panel no se queda esperando
  for (const [et, x] of tabs) {
    if (x.viewerTab === tabId && x.awaitingFiles) {
      x.awaitingFiles = false;
      x.result = { ok: false, error: 'Se cerró el visor antes de terminar de guardar los archivos. La captura está guardada: ábrela en «Capturas guardadas» y guarda desde allí.' };
      toPanel(et, Object.assign({ type: 'earth-fin' }, x.result));
    }
  }
});

// Mientras haya pestañas en modo captura, el proceso de fondo no debe dormirse
let keepTimer = null;
function keepAlive() {
  if (tabs.size && !keepTimer) keepTimer = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => { }); }, 20000);
  else if (!tabs.size && keepTimer) { clearInterval(keepTimer); keepTimer = null; }
}
// Si el proceso de fondo se reinició con el depurador puesto (se perdió su estado), se suelta
(async () => {
  try {
    for (const tg of await chrome.debugger.getTargets()) {
      if (tg.type === 'page' && tg.attached && tg.tabId !== undefined && !tabs.has(tg.tabId)) {
        try { await chrome.debugger.detach({ tabId: tg.tabId }); badge(tg.tabId, ''); } catch (e) { /* lo tenía otro (DevTools) */ }
      }
    }
  } catch (e) { }
})();

async function arm(tabId) {
  if (tabs.has(tabId)) return { ok: true, already: true };
  const tab = await chrome.tabs.get(tabId);
  if (!EARTH_RE.test(tab.url || '')) throw new Error('Captar malla solo funciona en Google Earth (earth.google.com/web).');
  await chrome.debugger.attach({ tabId }, '1.3');
  try {
    const inj = createInjector({
      send: (sid, method, params) => chrome.debugger.sendCommand(sid ? { tabId, sessionId: sid } : { tabId }, method, params || {}),
      hookSource: await getHook(),
      b64decode,
    });
    tabs.set(tabId, { inj, capturing: false });
    keepAlive();
    await inj.setupRoot();
    await chrome.debugger.sendCommand({ tabId }, 'Page.reload', {});
  } catch (e) {
    tabs.delete(tabId); keepAlive();
    try { await chrome.debugger.detach({ tabId }); } catch (er) { }
    throw e;
  }
  badge(tabId, 'ON', '#2f6f4f');
  return { ok: true, reloading: true };
}
async function disarm(tabId) {
  const t = tabs.get(tabId);
  if (t && t.job) t.job.cancel();
  // cerrar en la página cualquier sesión de captura abierta (si no, guardaría memoria unos minutos)
  if (t) { try { const r = await t.inj.glRealm(); if (r) await t.inj.evalIn(r.realm, 'self.__captarMalla && self.__captarMalla.abort()', false, 3000); } catch (e) { } }
  tabs.delete(tabId);
  keepAlive();
  try { await chrome.debugger.detach({ tabId }); } catch (e) { }
  badge(tabId, '');
  toPanel(tabId, { type: 'earth-estado', armed: false });
  return { ok: true };
}
async function state(tabId) {
  const t = tabs.get(tabId);
  if (!t) return { armed: false };
  const st = await t.inj.status();
  const realms = st.filter((x) => x.st).map((x) => ({ label: x.realm.label, url: x.st.url, contexts: x.st.contexts, draws: x.st.totalDraws }));
  const webgl = realms.filter((r) => r.contexts.length);
  return { armed: true, capturing: t.capturing, progress: t.progress || '', realms: realms.length, webgl, busy: st.filter((x) => !x.st).length };
}
// Espera a que Google Earth esté dibujando (tras activar, la página se recarga)
async function earthReady(t, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await t.inj.glRealm().catch(() => null);
    if (r && r.st.totalDraws > 50) return r;
    await sleep(700);
  }
  throw new Error('Google Earth no ha terminado de cargar. Espera un poco y vuelve a pulsar.');
}
function newJob(tabId, t, kind = '') {
  return createEarthJob({
    inj: t.inj,
    cdp: (method, params) => chrome.debugger.sendCommand({ tabId }, method, params || {}),
    decode,
    progress: (text, frac) => progress(tabId, text, { frac, kind }),
    log,
  });
}

// ------------------------------------------------------------------ captura rápida (lo que se ve)
async function capture(tabId) {
  const t = tabs.get(tabId);
  if (!t) throw new Error('Activa primero el modo captura en esta pestaña.');
  if (t.capturing) throw new Error('Ya hay una captura en marcha.');
  t.capturing = true;
  try {
    badge(tabId, 'REC', '#b3261e');
    progress(tabId, 'Capturando lo que se ve…');
    await earthReady(t);
    const job = newJob(tabId, t);
    const r = await job.quick();
    log('captura rápida', { draws: r.summary.draws, bytes: r.bytes.length });
    const tab = await chrome.tabs.get(tabId);
    const id = await saveCapture({ title: 'Google Earth · vista', url: tab.url, parts: [r.bytes], summary: [r.summary], extra: { kind: 'vista' } });
    progress(tabId, 'Captura guardada. Abriendo el visor…', { done: true, ok: true, id });
    toPanel(tabId, { type: 'earth-rapida-hecha' });
    await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html?id=' + encodeURIComponent(id)), index: tab.index + 1 });
    return { ok: true, id };
  } catch (e) {
    const msg = String(e && e.message || e);
    progress(tabId, 'Error: ' + msg, { done: true, ok: false });
    toPanel(tabId, { type: 'earth-fin', ok: false, error: msg });
    return { ok: false, error: msg };
  } finally {
    t.capturing = false;
    if (tabs.has(tabId)) badge(tabId, 'ON', '#2f6f4f');
  }
}

// ------------------------------------------------------------------ captura de un área
async function captureArea(tabId, req) {
  const t = tabs.get(tabId);
  if (!t) throw new Error('El modo captura no está activo en esta pestaña.');
  if (t.capturing) throw new Error('Ya hay una captura en marcha.');
  t.capturing = true; t.result = null;
  const job = newJob(tabId, t, 'area'); t.job = job;
  badge(tabId, 'REC', '#b3261e');
  try {
    const a = req.area;
    log('área', { W: a.W, H: a.H, lat: a.lat, lon: a.lon, detalle: req.detail });
    const res = await job.runArea(a, { detail: req.detail || 'max' });
    log('área capturada', { s: res.seconds, bytes: res.bytes && res.bytes.length, celdas: res.area.cells.length, faltan: res.area.missing, tesela: res.area.tile, avisos: res.warnings });
    if (!res.bytes) throw new Error('La captura salió vacía.');
    if (job.cancelled) throw Object.assign(new Error('Captura cancelada.'), { cancelled: true });
    progress(tabId, 'Guardando la captura…', { frac: 0.96, kind: 'area' });
    const tab = await chrome.tabs.get(tabId);
    const name = req.name || areaName(a, res.area);
    const id = await saveCapture({
      title: `Google Earth · área ${Math.round(a.W)} × ${Math.round(a.H)} m`, url: tab.url, parts: [res.bytes], summary: [res.summary],
      extra: { kind: 'area', area: res.area, warnings: res.warnings, formats: req.formats || ['glb'], fileName: name, seconds: res.seconds },
    });
    t.lastId = id;
    progress(tabId, 'Preparando los archivos (texturas y formatos)…', { frac: 0.97, kind: 'area' });
    const fm = (req.formats && req.formats.length ? req.formats : ['glb']).join(',');
    const v = await chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?id=${encodeURIComponent(id)}&auto=${fm}&tab=${tabId}`), active: false, index: tab.index + 1 });
    t.viewerTab = v.id; t.awaitingFiles = true;
    return { ok: true, id };
  } catch (e) {
    const msg = String(e && e.message || e);
    log('error área', msg);
    toPanel(tabId, { type: 'earth-fin', ok: false, cancelled: !!(e && e.cancelled), error: msg });
    progress(tabId, (e && e.cancelled ? '' : 'Error: ') + msg, { done: true, ok: false });
    return { ok: false, error: msg };
  } finally {
    t.capturing = false; t.job = null;
    if (tabs.has(tabId)) badge(tabId, 'ON', '#2f6f4f');
  }
}
function areaName(a, area) {
  const d = new Date();
  const p2 = (x) => String(x).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  const lat = `${Math.abs(a.lat).toFixed(5)}${a.lat >= 0 ? 'N' : 'S'}`, lon = `${Math.abs(a.lon).toFixed(5)}${a.lon >= 0 ? 'E' : 'O'}`;
  return `earth_${lat}_${lon}_${Math.round(a.W)}x${Math.round(a.H)}m_${stamp}`;
}

// ------------------------------------------------------------------ mensajes
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const tabId = msg && msg.tabId !== undefined ? msg.tabId : sender.tab && sender.tab.id;
    switch (msg && msg.cmd) {
      // ventana del botón
      case 'estado': return state(tabId);
      case 'activar': return arm(tabId);
      case 'desactivar': return disarm(tabId);
      case 'capturar': {
        const t = tabs.get(tabId);
        if (!t) return { error: 'Activa primero el modo captura en esta pestaña.' };
        if (t.capturing) return { error: 'Ya hay una captura en marcha.' };
        capture(tabId, msg.opts || {}).catch(() => { });
        return { ok: true, started: true };
      }
      // panel dentro de Google Earth
      case 'earth-hola': {
        const t = tabs.get(tabId);
        if (!t) return { armed: false };
        const pending = t.pending; t.pending = null;
        return { armed: true, busy: !!t.capturing, progress: t.progress || '', frac: t.frac, pending, result: t.result || null };
      }
      case 'earth-preparar': {
        let t = tabs.get(tabId);
        if (!t) { await arm(tabId); tabs.get(tabId).pending = msg.next || 'rect'; return { reloading: true }; }
        if (t.capturing) return { error: 'Ya hay una captura en marcha.' };
        await earthReady(t);
        const job = newJob(tabId, t);
        await job.waitIdle({ quietMs: 1200, minMs: 300, maxMs: 20000 });
        return await job.topDown();
      }
      case 'earth-estimar': return planArea({ W: msg.W, H: msg.H, tile: 9.9, detail: msg.detail });
      case 'earth-area': {
        const t = tabs.get(tabId);
        if (!t) return { error: 'El modo captura no está activo: vuelve a pulsar «Capturar área».' };
        if (t.capturing) return { error: 'Ya hay una captura en marcha.' };
        captureArea(tabId, msg).catch(() => { });
        return { ok: true, started: true };
      }
      case 'earth-cancelar': { const t = tabs.get(tabId); if (t && t.job) t.job.cancel(); return { ok: true }; }
      case 'earth-rapida': {
        let t = tabs.get(tabId);
        if (!t) { await arm(tabId); tabs.get(tabId).pending = 'rapida'; return { reloading: true }; }
        if (t.capturing) return { error: 'Ya hay una captura en marcha.' };
        capture(tabId).catch(() => { });
        return { ok: true, started: true };
      }
      case 'earth-ver': {
        const t = tabs.get(tabId);
        if (msg.list) { await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') }); return { ok: true }; }
        const vt = msg.viewerTab || (t && t.viewerTab);
        try { if (!vt) throw new Error('sin visor'); await chrome.tabs.update(vt, { active: true }); }
        catch (e) { await chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html' + (t && t.lastId ? '?id=' + encodeURIComponent(t.lastId) : '')) }); }
        return { ok: true };
      }
      case 'earth-carpeta': { if (msg.downloadId) chrome.downloads.show(msg.downloadId); else chrome.downloads.showDefaultFolder(); return { ok: true }; }
      case 'earth-desactivar': return disarm(tabId);
      // visor (preparación automática de los archivos)
      case 'auto-progreso': { if (msg.earthTab) toPanel(msg.earthTab, { type: 'earth-progreso', text: msg.text, frac: msg.frac }); return { ok: true }; }
      case 'auto-hecho': {
        const et = msg.earthTab; const t = tabs.get(et);
        const result = { ok: !msg.error, files: msg.files || [], error: msg.error || '', warnings: msg.warnings || [], viewerTab: sender.tab && sender.tab.id, info: msg.info || null };
        if (t) { t.result = result; t.progress = ''; t.awaitingFiles = false; }
        if (et) toPanel(et, Object.assign({ type: 'earth-fin' }, result));
        return { ok: true };
      }
      default: return { error: 'orden desconocida' };
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e && e.message || e) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'capturar' || !tab || !EARTH_RE.test(tab.url || '')) return;
  if (!tabs.has(tab.id)) { try { await arm(tab.id); tabs.get(tab.id).pending = 'rapida'; } catch (e) { } return; }
  capture(tab.id).catch(() => { });
});

// Para las pruebas automáticas (no se usa desde la interfaz)
self.__captarMallaBG = { arm, disarm, state, capture, captureArea, tabs, earthReady, newJob };
