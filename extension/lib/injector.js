// Captar malla — inyección por el protocolo de DevTools (CDP).
// Engancha la página, sus iframes y sus workers antes de que ejecuten su código,
// lanza las capturas en todos ellos y descarga los resultados por trozos.
// Lo usa la extensión (chrome.debugger) y también las pruebas en Node (WebSocket).

export function createInjector({ send, hookSource, log = () => { }, b64decode }) {
  // send(sessionId | null, method, params) -> Promise<result>
  const sessions = new Map(); // sid ('' = raíz) -> { type, url, contexts: Map(id -> {frameId, origin}) }

  async function trySend(sid, method, params) {
    try { return await send(sid || null, method, params || {}); } catch (e) { log('aviso', method, String(e && e.message || e)); return null; }
  }

  async function setupPageLike(sid, type, url) {
    sessions.set(sid, { type, url, contexts: new Map() });
    await trySend(sid, 'Page.enable');
    await trySend(sid, 'Page.addScriptToEvaluateOnNewDocument', { source: hookSource });
    await trySend(sid, 'Runtime.enable');
    await trySend(sid, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    if (sid) await trySend(sid, 'Runtime.runIfWaitingForDebugger');
  }
  async function setupWorker(sid, type, url) {
    sessions.set(sid, { type, url, contexts: new Map([[0, { frameId: null }]]) });
    // Pausar justo antes de su primer script, inyectar el gancho y continuar
    await trySend(sid, 'Debugger.enable');
    const bp = await trySend(sid, 'Debugger.setInstrumentationBreakpoint', { instrumentation: 'beforeScriptExecution' });
    const s = sessions.get(sid); if (s && bp) s.bp = bp.breakpointId;
    await trySend(sid, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await trySend(sid, 'Runtime.runIfWaitingForDebugger');
  }

  async function setupRoot() {
    await setupPageLike('', 'page', '');
  }

  async function onEvent(sid, method, params) {
    sid = sid || '';
    if (method === 'Target.attachedToTarget') {
      const ti = params.targetInfo || {};
      const csid = params.sessionId;
      if (ti.type === 'iframe' || ti.type === 'page') await setupPageLike(csid, ti.type, ti.url);
      else if (ti.type === 'worker' || ti.type === 'shared_worker') await setupWorker(csid, ti.type, ti.url);
      else await trySend(csid, 'Runtime.runIfWaitingForDebugger');
      log('enganchado', ti.type, (ti.url || '').slice(0, 100));
    } else if (method === 'Target.detachedFromTarget') {
      sessions.delete(params.sessionId);
    } else if (method === 'Debugger.paused') {
      const s = sessions.get(sid);
      if (s && params.reason === 'instrumentation' && !s.injected) {
        s.injected = true;
        await trySend(sid, 'Runtime.evaluate', { expression: hookSource + '\n;0' });
        if (s.bp) await trySend(sid, 'Debugger.removeBreakpoint', { breakpointId: s.bp });
      }
      await trySend(sid, 'Debugger.resume');
      if (s && s.injected) await trySend(sid, 'Debugger.disable');
    } else if (method === 'Runtime.executionContextCreated') {
      const s = sessions.get(sid);
      const c = params.context || {};
      if (s && c.auxData && c.auxData.isDefault) s.contexts.set(c.id, { frameId: c.auxData.frameId, origin: c.origin });
    } else if (method === 'Runtime.executionContextDestroyed') {
      const s = sessions.get(sid);
      if (s) s.contexts.delete(params.executionContextId);
    } else if (method === 'Runtime.executionContextsCleared') {
      const s = sessions.get(sid);
      if (s) s.contexts.clear();
    }
  }

  // Ejecuta una expresión en cada "reino" (marco o worker) enganchado
  function realms() {
    const out = [];
    for (const [sid, s] of sessions) {
      if (s.type === 'worker' || s.type === 'shared_worker') out.push({ sid, contextId: null, label: 'worker', url: s.url });
      else for (const [cid, c] of s.contexts) out.push({ sid, contextId: cid, label: sid ? 'iframe' : 'página', url: c.origin });
    }
    return out;
  }
  // Los workers de cálculo (hilos de WebAssembly) pueden estar siempre ocupados y no contestar:
  // por eso cada consulta lleva un tiempo máximo y se pregunta a todos a la vez.
  async function evalIn(realm, expression, awaitPromise = true, timeoutMs = 60000) {
    const params = { expression, awaitPromise, returnByValue: true };
    if (realm.contextId) params.contextId = realm.contextId;
    let timer;
    const r = await Promise.race([
      send(realm.sid || null, 'Runtime.evaluate', params),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('sin respuesta')), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    if (r && r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'error');
    return r && r.result ? r.result.value : undefined;
  }

  // Hilos que no contestaron: no se les vuelve a preguntar en 30 s (las preguntas se les acumularían)
  const busyUntil = new Map(); // sid -> instante
  async function status({ force = false, timeoutMs = 1500 } = {}) {
    const now = Date.now();
    return Promise.all(realms().map(async (realm) => {
      if (!force && realm.sid && (busyUntil.get(realm.sid) || 0) > now) return { realm, st: null, error: 'ocupado' };
      try {
        const st = await evalIn(realm, 'self.__captarMalla ? self.__captarMalla.status() : null', false, timeoutMs);
        if (realm.sid) busyUntil.delete(realm.sid);
        return { realm, st };
      } catch (e) {
        if (realm.sid) busyUntil.set(realm.sid, Date.now() + 30000);
        return { realm, st: null, error: String(e.message || e) };
      }
    }));
  }

  async function captureAll(opts) {
    opts = opts || {};
    let sts = await status({ force: true });
    const hasGL = (x) => x.st && x.st.contexts && x.st.contexts.length && x.st.totalDraws > 0;
    // Si no aparece WebGL y hay hilos que no contestaron, se les da más margen una vez
    if (!sts.some(hasGL) && sts.some((x) => !x.st)) sts = await status({ force: true, timeoutMs: 6000 });
    const targets = sts.filter(hasGL);
    const hooked = sts.filter((x) => x.st).length;
    const silent = sts.filter((x) => !x.st).length;
    if (!targets.length) return { parts: [], hooked, realms: sts.length, silent, all: [] };
    const limit = (opts.waitMs || 15000) + (opts.durationMs || 0) + 180000;
    const res = await Promise.all(targets.map(async ({ realm }) => {
      try {
        const summary = await evalIn(realm, 'self.__captarMalla.capture(' + JSON.stringify(opts) + ')', true, limit);
        return { realm, summary };
      } catch (e) { return { realm, error: String(e.message || e) }; }
    }));
    return { parts: res.filter((r) => r.summary && !r.summary.error && r.summary.draws > 0), all: res, hooked, realms: sts.length, silent };
  }

  async function pull(part, onProgress) {
    const size = part.summary.bytes;
    const out = new Uint8Array(size);
    const CH = 6 * 1024 * 1024;
    for (let off = 0; off < size; off += CH) {
      const b64 = await evalIn(part.realm, `self.__captarMalla.chunk(${JSON.stringify(part.summary.id)}, ${off}, ${CH})`, true, 120000);
      const bytes = b64decode(b64);
      out.set(bytes, off);
      if (onProgress) onProgress(Math.min(size, off + CH), size);
    }
    return out;
  }
  async function free(part) {
    try { await evalIn(part.realm, `self.__captarMalla && self.__captarMalla.free(${JSON.stringify(part.summary.id)})`, false, 5000); } catch (e) { }
  }

  // El "reino" (marco o worker) donde más dibuja WebGL: en Google Earth, la página principal
  async function glRealm() {
    const sts = await status({ force: true });
    let best = null;
    for (const x of sts) {
      if (!x.st || !x.st.contexts || !x.st.contexts.length) continue;
      if (!best || x.st.totalDraws > best.st.totalDraws) best = x;
    }
    return best;
  }

  return { setupRoot, onEvent, status, captureAll, pull, free, sessions, realms, evalIn, glRealm };
}
