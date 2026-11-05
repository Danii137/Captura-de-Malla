// Captar malla — captura automática de un área de Google Earth (web) con el máximo detalle.
//
// Cómo funciona (todo comprobado en Google Earth web, noviembre de 2026):
//  - La cámara se mueve cambiando la dirección de la página (…/@lat,lon,Aa,Dd,35y,Hh,Tt,0r) con
//    history.pushState + popstate: Earth vuela hasta ahí sin recargar.
//  - Earth deja de dibujar cuando ha cargado todo lo que ve: eso marca el momento de capturar.
//  - Para que vuelva a dibujar un fotograma completo se gira la vista 2° y se devuelve a 0°.
//  - El detalle depende de los píxeles de la vista y de la distancia: con una vista de 3840×2400
//    las teselas más finas (≈9,9 m en Madrid) llegan hasta unos 200 m de distancia (≈20 × tesela).
//  - Se recorre el rectángulo en cuadrícula, vista cenital y norte arriba; cada posición se queda
//    luego solo con los triángulos de su celda (lib/decode.js, modo área).
export const EARTH_R = 6371010;
export const VIEW = { w: 3840, h: 2400, fov: 35 };
export const TILE_UNIFORM = 'uMeshToWorldMatrix';
export const SKIP_ATTRS = ['aNormal', 'aDrapedTexCoord_LayerId'];
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ direcciones de Earth
export function parseEarthUrl(href) {
  let u;
  try { u = new URL(href); } catch (e) { return null; }
  if (!/(^|\.)earth\.google\.com$/.test(u.hostname)) return null;
  const m = /^(.*\/)@([^/]+)(\/.*)?$/.exec(u.pathname);
  if (!m) return null;
  const tok = m[2].split(',');
  const lat = parseFloat(tok[0]), lon = parseFloat(tok[1]);
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const v = { lat, lon, a: 0, d: 1000, y: 35, h: 0, t: 0, r: 0 };
  for (const t of tok.slice(2)) { const mm = /^(-?[\d.]+(?:e-?\d+)?)([adyhtr])$/i.exec(t); if (mm) v[mm[2].toLowerCase()] = parseFloat(mm[1]); }
  v.prefix = u.origin + m[1];
  v.suffix = (m[3] || '') + u.search + u.hash;
  return v;
}
const num = (x, n) => String(Number((+x).toFixed(n)));
export function earthUrl(v) {
  return `${v.prefix}@${num(v.lat, 8)},${num(v.lon, 8)},${num(v.a, 2)}a,${num(v.d, 2)}d,${num(v.y, 2)}y,${num(v.h, 4)}h,${num(v.t, 4)}t,0r${v.suffix || ''}`;
}
// Desplazamiento en metros (este, norte) sobre la esfera de Earth
export function offsetLatLon(lat, lon, e, n) {
  return { lat: lat + (n / EARTH_R) / DEG, lon: lon + (e / (EARTH_R * Math.cos(lat * DEG))) / DEG };
}
// Huella en el suelo de la vista cenital a distancia D (metros)
export function footprint(D, fov = VIEW.fov, aspect = VIEW.w / VIEW.h) {
  const h = 2 * D * Math.tan(fov * DEG / 2);
  return { w: h * aspect, h };
}

// ------------------------------------------------------------------ plan
// tile: tamaño de la tesela más fina disponible (m). detail: 'max' o 'alto' (una tesela el doble).
export function planArea({ W, H, tile = 9.9, detail = 'max' }) {
  const t = detail === 'alto' ? tile * 2 : tile;
  const D = Math.min(4000, Math.max(40, 20 * t));
  const fp = footprint(D);
  const cw0 = fp.w * 0.8, ch0 = fp.h * 0.8;
  const nx = Math.max(1, Math.ceil(W / cw0)), ny = Math.max(1, Math.ceil(H / ch0));
  const n = nx * ny;
  // estimaciones (medidas en Madrid, Plaza Mayor, 300 × 200 m: máximo 6 posiciones, 70 s, GLB de 94 MB;
  // alto 2 posiciones, 59 s, GLB de 37 MB)
  const seconds = Math.round(30 + n * 8 + (W * H) / 1e4 * 4);
  // MB por hectárea medidos: 15,7 con teselas de 9,85 m y 6,2 con las de 19,7 m (≈ tesela^-1,32)
  const mb = Math.round((W * H) / 1e4 * 15.7 * Math.pow(9.85 / t, 1.32) + 1);
  return { tile: t, D, nx, ny, n, cellW: W / nx, cellH: H / ny, seconds, mb };
}
// Celdas en orden de recorrido (filas de norte a sur, en zigzag). e/n respecto al centro del área.
export function cellsOf(plan, W, H) {
  const out = [];
  for (let j = 0; j < plan.ny; j++) {
    const n1 = H / 2 - j * plan.cellH, n0 = n1 - plan.cellH;
    const cols = [...Array(plan.nx).keys()];
    if (j % 2) cols.reverse();
    for (const i of cols) {
      const e0 = -W / 2 + i * plan.cellW, e1 = e0 + plan.cellW;
      out.push({ i, j, e0, e1, n0, n1, ce: (e0 + e1) / 2, cn: (n0 + n1) / 2 });
    }
  }
  return out;
}

// ------------------------------------------------------------------ trabajo
// inj: inyector (lib/injector.js) ya enganchado a la pestaña; cdp(method, params): orden a la pestaña
// (sesión raíz); decode: módulo lib/decode.js; progress(texto, fracción 0-1); log(...)
export function createEarthJob({ inj, cdp, decode, progress = () => { }, log = () => { } }) {
  let cancelled = false;
  let realm = null;
  let sessionOpen = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const check = () => { if (cancelled) throw Object.assign(new Error('Captura cancelada.'), { cancelled: true }); };

  async function ensureRealm() {
    if (realm) return realm;
    const r = await inj.glRealm();
    if (!r) throw new Error('No se encuentra Google Earth dibujando en esta pestaña. Espera a que cargue y vuelve a probar.');
    realm = r.realm;
    return realm;
  }
  const ev = async (expr, awaitPromise = true, timeoutMs = 30000) => inj.evalIn(await ensureRealm(), expr, awaitPromise, timeoutMs);
  const status = () => ev('self.__captarMalla.status()', false, 5000);
  // replaceState (no pushState): que el botón «Atrás» no recorra todas las posiciones de la captura
  async function go(v) {
    const url = earthUrl(v);
    const expr = `(history.replaceState(history.state, '', ${JSON.stringify(url)}), dispatchEvent(new PopStateEvent('popstate', { state: history.state })), 1)`;
    try { await ev(expr, false, 5000); } catch (e) { await sleep(1000); await ev(expr, false, 8000); } // un reintento si la página tarda
  }
  // Espera a que Earth termine de cargar (deja de dibujar). Si la pestaña está oculta, Chrome la
  // pausa: se espera a que vuelva a estar a la vista. Aguanta algún tiempo agotado suelto.
  async function waitIdle({ quietMs = 2000, minMs = 1200, maxMs = 30000, label = '' } = {}) {
    let t0 = Date.now(), last = Date.now(), prev = -1, hiddenSince = 0, fails = 0;
    for (;;) {
      check();
      await sleep(250);
      let s;
      try { s = await status(); fails = 0; } catch (e) { if (++fails > 4) throw new Error('Google Earth no responde: ' + (e.message || e)); continue; }
      if (s.visible !== 'visible') {
        if (!hiddenSince) { hiddenSince = Date.now(); progress('En pausa: vuelve a la pestaña de Google Earth (Chrome detiene las pestañas ocultas).'); }
        if (Date.now() - hiddenSince > 15 * 60000) throw new Error('La pestaña de Google Earth ha estado oculta demasiado tiempo.');
        t0 = Date.now(); last = Date.now(); prev = -1;
        continue;
      }
      if (hiddenSince) { hiddenSince = 0; if (label) progress(label); }
      if (s.totalDraws !== prev) { prev = s.totalDraws; last = Date.now(); }
      const el = Date.now() - t0;
      if (el >= minMs && Date.now() - last >= quietMs) return { ok: true, ms: el };
      if (el >= maxMs) return { ok: false, ms: el };
    }
  }
  // Arma la captura (o el paso de la sesión) y gira la vista de 2° a 0° para que Earth dibuje.
  async function shoot(v, expr, timeoutMs = 60000) {
    const p = ev(expr, true, timeoutMs);
    await sleep(80);
    await go(Object.assign({}, v, { h: v.h ? 0 : 2 }));
    return p;
  }
  async function emulate(on) {
    if (!on) { try { await cdp('Emulation.clearDeviceMetricsOverride', {}); } catch (e) { } return; }
    // la vista de captura es mayor que la ventana: se muestra reducida para que se vea entera
    let win = { w: 1400, h: 900 };
    try { win = await ev('({ w: innerWidth, h: innerHeight })', false, 5000); } catch (e) { }
    const scale = Math.min(1, win.w / VIEW.w, win.h / VIEW.h);
    await cdp('Emulation.setDeviceMetricsOverride', { width: VIEW.w, height: VIEW.h, deviceScaleFactor: 1, mobile: false, scale });
  }
  const tileOf = (minScale) => (minScale > 0 ? minScale * 255 * EARTH_R : 0);

  async function probe(v) {
    await go(Object.assign({}, v, { h: 2 }));
    await waitIdle({ maxMs: 30000 });
    const opts = { frames: 1, waitMs: 6000, textures: false, statsOnly: true, onlyUniform: TILE_UNIFORM, statsUniform: TILE_UNIFORM };
    const s = await shoot(Object.assign({}, v, { h: 2 }), `self.__captarMalla.capture(${JSON.stringify(opts)})`);
    return s && s.stats ? tileOf(s.stats.minScale) : 0;
  }

  // Vista cenital con el norte arriba sobre el punto que se mira (para marcar el rectángulo)
  async function topDown() {
    const s = await status();
    const v = parseEarthUrl(s.url);
    if (!v) throw new Error('Abre una vista de Google Earth (la dirección debe tener …/@latitud,longitud…).');
    const vt = Object.assign({}, v, { h: 0, t: 0, y: v.y || 35 });
    if (Math.abs(v.h) > 0.01 || Math.abs(v.t) > 0.01) { await go(vt); await waitIdle({ quietMs: 1200, maxMs: 15000 }); }
    const s2 = await status();
    const v2 = parseEarthUrl(s2.url) || vt;
    // En vista cenital el punto mirado está justo debajo de la cámara: altitud de la cámara = a + d.
    // Pero Earth no siempre pone el punto mirado en el suelo (tras una vista inclinada puede dejar
    // a = altitud de la cámara y d = 14 m). Se mide el suelo bajo el centro con una captura rápida de la geometría.
    const camAlt = v2.a + v2.d;
    let ground = null;
    try {
      const opts = { frames: 1, waitMs: 6000, textures: false, onlyUniform: TILE_UNIFORM, skipAttrs: SKIP_ATTRS };
      const sum = await shoot(Object.assign({}, v2, { h: 0 }), `self.__captarMalla.capture(${JSON.stringify(opts)})`);
      if (sum && sum.draws > 0 && !sum.error) {
        const part = { realm: await ensureRealm(), summary: sum };
        let b; try { b = await inj.pull(part); } finally { await inj.free(part); }
        const sc = decode.buildScene([decode.parsePart(b)]);
        if (sc.info.geo) { const hh = heightsIn(sc, -40, -40, 40, 40); if (hh) ground = hh.ground; }
      }
    } catch (e) { log('suelo no medido', String(e && e.message || e)); }
    if (ground === null || !(camAlt - ground > 5)) ground = v2.d > 30 ? v2.a : camAlt - 300; // sin medida: lo que diga la dirección
    const d = camAlt - ground;
    // misma cámara, con el punto mirado en el suelo (y el giro de la captura deshecho)
    const vn = Object.assign({}, v2, { a: ground, d, h: 0, t: 0 });
    await go(vn); await waitIdle({ quietMs: 1000, maxMs: 15000 });
    const s3 = await status();
    // lienzo de Earth: el contexto WebGL más grande que está en la página
    const ctx = (s3.contexts || []).filter((c) => c.rect && c.rect[2] > 100).sort((a, b) => (b.rect[2] * b.rect[3]) - (a.rect[2] * a.rect[3]))[0];
    return { view: { lat: vn.lat, lon: vn.lon, a: ground, d, fov: vn.y || 35, camAlt }, canvas: ctx ? ctx.rect : null };
  }

  // area: { lat, lon (centro), W, H (m), a (altitud del suelo aproximada) }, detail: 'max' | 'alto'
  async function runArea(area, { detail = 'max', maxCells = 80, maxMB = 800 } = {}) {
    const warnings = [];
    const T0 = Date.now();
    const s0 = await status();
    const v0 = parseEarthUrl(s0.url);
    if (!v0) throw new Error('La dirección de la pestaña no es una vista de Google Earth.');
    const base = Object.assign({}, v0, { y: 35, t: 0, r: 0 });
    const W = area.W, H = area.H, a0 = isFinite(area.a) ? area.a : v0.a;
    let bytes = null, summary = null, cells = [], plan = null;
    await emulate(true);
    try {
      // 1) vista de conjunto: alturas del terreno y de los edificios en cada zona
      progress('Vista de conjunto del área…', 0.02);
      const fp1 = footprint(1);
      const Dover = Math.min(6000, Math.max(150, 1.2 * Math.max(W / fp1.w, H / fp1.h)));
      const vo = Object.assign({}, base, { lat: area.lat, lon: area.lon, a: a0, d: Dover, h: 2 });
      await go(vo);
      await waitIdle({ maxMs: 40000, label: 'Vista de conjunto del área…' });
      const ovOpts = { frames: 1, waitMs: 8000, textures: false, onlyUniform: TILE_UNIFORM, skipAttrs: SKIP_ATTRS };
      const ov = await shoot(vo, `self.__captarMalla.capture(${JSON.stringify(ovOpts)})`);
      let ovScene = null;
      if (ov && ov.draws > 0 && !ov.error) {
        const part = { realm: await ensureRealm(), summary: ov };
        try { const b = await inj.pull(part); ovScene = decode.buildScene([decode.parsePart(b)], { area: { lat: area.lat, lon: area.lon, cells: [{ f: 0, e0: -1e9, n0: -1e9, e1: 1e9, n1: 1e9 }] } }); }
        catch (e) { log('vista de conjunto ilegible', e.message); }
        finally { await inj.free(part); }
      } else {
        if (ov && ov.id) await inj.free({ realm: await ensureRealm(), summary: ov });
        warnings.push('No se pudo leer la vista de conjunto: se usa la altitud del punto central para todo el área.');
      }
      check();

      // 2) detalle máximo disponible aquí: tamaño de la tesela más fina cerca del centro
      progress('Buscando el máximo detalle disponible…', 0.08);
      const centerH = ovScene ? heightsIn(ovScene, -W / 4, -H / 4, W / 4, H / 4) : null;
      const ac = centerH ? centerH.ground : a0;
      const vc = Object.assign({}, base, { lat: area.lat, lon: area.lon, a: ac, h: 2 });
      const t200 = await probe(Object.assign({}, vc, { d: 200 }));
      const t100 = await probe(Object.assign({}, vc, { d: 100 }));
      let tile = Math.min(...[t200, t100].filter((x) => x > 0));
      if (t100 > 0 && t200 > 0 && t100 < 0.75 * t200) { const t50 = await probe(Object.assign({}, vc, { d: 50 })); if (t50 > 0) tile = Math.min(tile, t50); }
      if (!isFinite(tile) || tile <= 0) { tile = 9.9; warnings.push('No se pudo medir el detalle disponible: se supone tesela de 9,9 m.'); }
      log('tesela más fina', tile.toFixed(2), 'm (200 m:', t200.toFixed(2), '; 100 m:', t100.toFixed(2), ')');

      // 3) plan (si salen demasiadas posiciones, se baja un nivel de detalle)
      plan = planArea({ W, H, tile, detail });
      // (límite por posiciones y por peso estimado del archivo: más allá, el navegador se queda sin memoria)
      while ((plan.n > maxCells || plan.mb > maxMB) && plan.tile < 300) { plan = planArea({ W, H, tile: plan.tile * 2, detail: 'max' }); }
      if (plan.tile > (detail === 'alto' ? tile * 2 : tile) * 1.01) warnings.push(`El área es grande para ese detalle: se ha capturado con teselas de ${String(plan.tile.toFixed(1)).replace('.', ',')} m (no más de ${maxCells} posiciones ni unos ${maxMB} MB).`);
      cells = cellsOf(plan, W, H);
      for (const c of cells) {
        const hh = ovScene ? heightsIn(ovScene, c.e0, c.n0, c.e1, c.n1) : null;
        c.ground = hh ? hh.ground : ac;
        c.top = hh ? hh.top : ac;
      }
      check();

      // 4) recorrido: una posición por celda, vista cenital a la distancia del plan
      const sessOpts = { manual: true, textures: true, onlyUniform: TILE_UNIFORM, statsUniform: TILE_UNIFORM, skipAttrs: SKIP_ATTRS };
      sessionOpen = true; // (antes de esperar: si algo falla a medias, el final la cierra igual)
      const started = await ev(`(() => { const C = self.__captarMalla; if (C.status().capturing) C.abort(); C.capture(${JSON.stringify(sessOpts)}).catch(() => { }); const s = C.status(); return !!(s.session && s.session.snaps === 0); })()`, false, 10000);
      if (!started) throw new Error('No se pudo abrir la sesión de captura en la página.');
      for (let k = 0; k < cells.length; k++) {
        check();
        const c = cells[k];
        const label = `Capturando posición ${k + 1} de ${cells.length}…`;
        progress(label, 0.12 + 0.68 * (k / cells.length));
        const ll = offsetLatLon(area.lat, area.lon, c.ce, c.cn);
        // cámara a D sobre el suelo, y siempre por encima de lo más alto de la celda
        const aCam = Math.max(c.ground, c.top + 30 - plan.D);
        const v = Object.assign({}, base, { lat: ll.lat, lon: ll.lon, a: aCam, d: plan.D, h: 2 });
        await go(v);
        const w = await waitIdle({ maxMs: 35000, label });
        if (!w.ok) warnings.push(`Posición ${k + 1}: Earth seguía cargando a los 35 s; se capturó lo que había.`);
        let r = null, h = 2, lowTried = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          r = await shoot(Object.assign({}, v, { h }), `self.__captarMalla.snap({ timeoutMs: 7000 })`);
          h = h ? 0 : 2; // el siguiente intento gira en sentido contrario
          if (r && r.ok) {
            // ¿salió con menos detalle del previsto? (Earth aún cargaba): esperar y repetir una vez
            if (!lowTried && tileOf(r.minScale) > plan.tile * 1.5 && attempt < 3) { lowTried = true; log('posición', k + 1, 'detalle bajo', tileOf(r.minScale).toFixed(1), '→ repetir'); await waitIdle({ maxMs: 25000, label }); continue; }
            break;
          }
          // sin dibujos: si la pestaña está oculta, esperar a que vuelva; si no, reintentar
          const st = await status().catch(() => null);
          if (st && st.visible !== 'visible') await waitIdle({ maxMs: 30000, label });
          else await sleep(500);
        }
        if (!r || !r.ok) { warnings.push(`Posición ${k + 1}: Earth no dibujó; esa zona se rellena con lo que vieron las posiciones vecinas.`); continue; }
        if (tileOf(r.minScale) > plan.tile * 1.5) warnings.push(`Posición ${k + 1}: salió con teselas de ${String(tileOf(r.minScale).toFixed(1)).replace('.', ',')} m (menos detalle del previsto).`);
        c.f = r.frame; c.tileGot = tileOf(r.minScale); c.draws = r.draws;
        log('posición', k + 1, 'fotograma', r.frame, 'dibujos', r.draws, 'tesela', c.tileGot.toFixed(2));
      }
      check();
      progress('Reuniendo la captura…', 0.82);
      summary = await ev('self.__captarMalla.stop()', true, 300000);
      sessionOpen = false;
      if (!summary || summary.error) throw new Error('No se pudo cerrar la captura: ' + (summary && summary.error || 'sin respuesta'));
      const part = { realm: await ensureRealm(), summary };
      try {
        check();
        bytes = await inj.pull(part, (got, total) => { check(); progress(`Copiando la captura: ${(got / 1048576).toFixed(0)} de ${(total / 1048576).toFixed(0)} MB…`, 0.82 + 0.13 * got / total); });
      } finally { await inj.free(part); }
      check();
    } finally {
      if (sessionOpen) { try { await ev('self.__captarMalla.abort()', false, 5000); } catch (e) { } sessionOpen = false; }
      await emulate(false);
      try { await go(v0); } catch (e) { }
    }
    const got = cells.filter((c) => c.f !== undefined);
    return {
      bytes, summary, warnings, seconds: Math.round((Date.now() - T0) / 1000),
      area: {
        lat: area.lat, lon: area.lon, W, H, detail, tile: plan.tile, D: plan.D, nx: plan.nx, ny: plan.ny,
        rect: { e0: -W / 2, n0: -H / 2, e1: W / 2, n1: H / 2 },
        cells: got.map((c) => ({ f: c.f, e0: c.e0, n0: c.n0, e1: c.e1, n1: c.n1, tile: c.tileGot })),
        missing: cells.length - got.length,
        missingCells: cells.filter((c) => c.f === undefined).map((c) => ({ e0: c.e0, n0: c.n0, e1: c.e1, n1: c.n1 })),
      },
    };
  }

  // Captura rápida de lo que se ve: gira 1,5° y vuelve, para que Earth dibuje un fotograma completo
  async function quick() {
    const s = await status();
    const v = parseEarthUrl(s.url);
    if (!v) throw new Error('La dirección de la pestaña no es una vista de Google Earth.');
    await go(Object.assign({}, v, { h: v.h + 1.5 }));
    await waitIdle({ quietMs: 1500, maxMs: 25000 });
    const opts = { frames: 1, waitMs: 8000, textures: true, onlyUniform: TILE_UNIFORM, skipAttrs: SKIP_ATTRS };
    const p = ev(`self.__captarMalla.capture(${JSON.stringify(opts)})`, true, 120000);
    await sleep(80);
    await go(v);
    const summary = await p;
    if (!summary || summary.error || !summary.draws) throw new Error('Earth no dibujó nada: espera a que termine de cargar y vuelve a probar.');
    const part = { realm: await ensureRealm(), summary };
    let bytes;
    try { bytes = await inj.pull(part, (got, total) => progress(`Copiando: ${(got / 1048576).toFixed(0)} de ${(total / 1048576).toFixed(0)} MB…`, got / total)); }
    finally { await inj.free(part); }
    return { bytes, summary };
  }

  return { topDown, runArea, quick, cancel() { cancelled = true; }, get cancelled() { return cancelled; }, status, go, waitIdle };
}

// Suelo (percentil 5 de las alturas) y punto más alto dentro de un rectángulo este/norte
export function heightsIn(scene, e0, n0, e1, n1) {
  const zs = [];
  let top = -Infinity;
  const o = scene.info.origin || [0, 0, 0];
  for (const m of scene.meshes) {
    if (!m.geo) continue;
    const b = m.bbox;
    if (b[3] + o[0] < e0 || b[0] + o[0] > e1 || b[4] + o[1] < n0 || b[1] + o[1] > n1) continue;
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] + o[0], y = p[i + 1] + o[1];
      if (x < e0 || x > e1 || y < n0 || y > n1) continue;
      const z = p[i + 2] + o[2];
      zs.push(z); if (z > top) top = z;
    }
  }
  if (zs.length < 10) return null;
  zs.sort((a, b) => a - b);
  return { ground: zs[Math.floor(zs.length * 0.05)], top, n: zs.length };
}
