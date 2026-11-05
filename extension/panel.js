// Captar malla — panel dentro de Google Earth (script de contenido).
// Botón «Capturar área»: pone la vista cenital, deja marcar un rectángulo con el ratón y lanza la
// captura automática (posiciones, detalle máximo, guardado en Descargas › Captar malla).
(() => {
  'use strict';
  if (window.top !== window || window.__captarMallaPanel) return;
  window.__captarMallaPanel = true;
  const R = 6371010, DEG = Math.PI / 180;
  const send = (msg) => new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r || {}); }); } catch (e) { res({ error: 'La extensión se ha actualizado: recarga la página (F5).' }); } });
  const fmtN = (n, d = 0) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });
  const fmtMB = (b) => fmtN(b / 1048576, 1) + ' MB';
  const fmtT = (s) => (s < 90 ? `${Math.round(s)} s` : `${fmtN(s / 60, s < 600 ? 1 : 0)} min`);

  // ---------------------------------------------------------------- interfaz (sombra aislada)
  const host = document.createElement('div');
  host.id = 'captar-malla-panel';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; left: 0; top: 0; width: 0; height: 0;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
  .panel { position: fixed; left: 16px; top: 96px; width: 292px; background: #fff; color: #1d2733; border-radius: 12px;
    box-shadow: 0 6px 24px rgba(0,0,0,.28); font-size: 13px; line-height: 1.4; overflow: hidden; z-index: 2; }
  .cab { display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: #14212b; color: #fff; cursor: default; }
  .cab b { flex: 1; font-size: 13.5px; letter-spacing: .2px; }
  .cab button { background: none; border: 0; color: #cfe0ea; font-size: 16px; cursor: pointer; padding: 0 4px; line-height: 1; }
  .logo { width: 16px; height: 16px; border-radius: 4px; background: linear-gradient(135deg,#3fa96b,#2a6f9e); }
  .cuerpo { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  .min .cuerpo { display: none; }
  button.prim { width: 100%; padding: 10px; border: 0; border-radius: 8px; background: #1a73e8; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  button.prim:hover { background: #1765cc; }
  button.prim:disabled { background: #9db6d8; cursor: default; }
  button.sec { padding: 7px 10px; border: 1px solid #c7d0d9; border-radius: 7px; background: #fff; color: #1d2733; cursor: pointer; font-size: 12.5px; }
  button.sec:hover { background: #f1f4f7; }
  .fila { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .fila label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; }
  select { padding: 4px 6px; border-radius: 6px; border: 1px solid #c7d0d9; font-size: 12.5px; flex: 1; }
  input.num { width: 64px; padding: 3px 5px; border-radius: 6px; border: 1px solid #c7d0d9; font-size: 12.5px; }
  input.num.corto { width: 44px; }
  .fila.stl { font-size: 12.5px; color: #33424f; gap: 6px; }
  .nota { color: #5b6b7a; font-size: 12px; }
  .enlace { color: #1a73e8; cursor: pointer; text-decoration: underline; background: none; border: 0; padding: 0; font-size: 12.5px; }
  .barra { height: 8px; background: #e3e9ef; border-radius: 4px; overflow: hidden; }
  .barra i { display: block; height: 100%; width: 0; background: #1a73e8; transition: width .4s; }
  .ok { color: #1e7a45; font-weight: 600; }
  .mal { color: #b3261e; font-weight: 600; }
  .archivos { margin: 0; padding-left: 18px; font-size: 12.5px; word-break: break-all; }
  .avisos { margin: 0; padding-left: 18px; font-size: 12px; color: #8a5a00; }
  [hidden] { display: none !important; }
  /* modo rectángulo */
  .capa { position: fixed; inset: 0; cursor: crosshair; z-index: 1; background: rgba(10,20,30,.08); }
  .ayuda { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); background: #14212b; color: #fff; padding: 8px 10px 8px 16px;
    border-radius: 8px; font-size: 14px; font-weight: 600; box-shadow: 0 4px 18px rgba(0,0,0,.35); white-space: nowrap; display: flex; gap: 12px; align-items: center; cursor: default; }
  .ayuda button { background: #33475a; color: #fff; border: 0; border-radius: 6px; padding: 5px 10px; font-size: 13px; cursor: pointer; }
  .panel.oculto { display: none; }
  .rect { position: fixed; border: 2px solid #ffb020; background: rgba(255,176,32,.14); pointer-events: none; }
  .medida { position: absolute; left: 0; top: -26px; background: #ffb020; color: #1d2733; font-weight: 700; font-size: 12.5px; padding: 2px 7px; border-radius: 5px; white-space: nowrap; }
  .bloqueo { position: fixed; inset: 0; z-index: 1; cursor: progress; }
</style>
<div class="panel" id="panel">
  <div class="cab"><span class="logo"></span><b>Captar malla</b><button id="bMin" title="Plegar / desplegar">–</button></div>
  <div class="cuerpo">
    <section id="sInicio">
      <button class="prim" id="bArea">▭ Capturar área</button>
      <div class="fila" style="margin-top:10px"><span>Detalle</span>
        <select id="detalle"><option value="max">Máximo (teselas de ~10 m)</option><option value="alto">Alto (4 veces más rápido)</option></select></div>
      <div class="fila" style="margin-top:8px"><span>Guardar</span>
        <label><input type="checkbox" value="glb" class="fmt"> GLB</label><label><input type="checkbox" value="fbx" class="fmt"> FBX</label>
        <label><input type="checkbox" value="obj" class="fmt"> OBJ</label><label title="Sólido cerrado con base, en milímetros a escala, listo para imprimir"><input type="checkbox" value="stl" class="fmt"> STL</label></div>
      <div class="fila stl" id="filaStl" hidden><span>STL para imprimir:</span>
        <label>escala 1:<input type="number" id="stlEscala" min="1" step="any" placeholder="auto" class="num"></label>
        <label>base <input type="number" id="stlBase" min="0.5" step="0.5" value="3" class="num corto"> mm</label></div>
      <div class="nota" style="margin-top:6px">Al soltar el rectángulo empieza sola. Se guarda en <b>Descargas › Captar malla</b>, con coordenadas en metros. Puedes cambiar de pestaña mientras captura.</div>
      <div class="fila" style="margin-top:8px; justify-content: space-between">
        <button class="enlace" id="bRapida" title="Guarda lo que se ve ahora y abre el visor">Captura rápida de la vista</button>
        <button class="enlace" id="bVisor">Capturas guardadas</button></div>
    </section>
    <section id="sPrep" hidden><div id="prepTxt">Preparando Google Earth…</div><div class="barra"><i style="width:30%"></i></div>
      <div class="nota">La primera vez la página se recarga para engancharse. Aparece un aviso amarillo de Chrome: es normal.</div></section>
    <section id="sMarcar" hidden><div><b>Arrastra sobre el mapa</b> para marcar el área (vista cenital, norte arriba).</div>
      <div class="nota">Esc para cancelar.</div><button class="sec" id="bCancMarcar">Cancelar</button></section>
    <section id="sConf" hidden>
      <div id="confTxt"></div>
      <ul class="avisos" id="confAvisos"></ul>
      <div class="fila" style="margin-top:8px"><button class="prim" id="bIr" style="flex:1">Capturar igualmente</button></div>
      <div class="fila" style="margin-top:6px"><button class="sec" id="bOtra">Marcar de nuevo</button><button class="sec" id="bCancConf">Cancelar</button></div>
    </section>
    <section id="sCorre" hidden><div id="corTxt">Capturando…</div><div class="barra"><i id="corBar"></i></div>
      <div class="nota" id="corNota">Puedes cambiar de pestaña o minimizar Chrome: la captura sigue y te avisa al terminar. No cierres esta pestaña.</div>
      <button class="sec" id="bCancCorre">Cancelar</button></section>
    <section id="sFin" hidden><div id="finTxt"></div><ul class="archivos" id="finArch"></ul><ul class="avisos" id="finAvisos"></ul>
      <div class="fila" style="margin-top:8px"><button class="prim" id="bNueva" style="flex:1">▭ Capturar otra área</button></div>
      <div class="fila" style="margin-top:6px"><button class="sec" id="bVer">Ver en 3D</button><button class="sec" id="bCarpeta">Abrir carpeta</button><button class="sec" id="bInicio">Opciones</button></div></section>
  </div>
</div>
<div class="capa" id="capa" hidden><div class="ayuda" id="ayuda"><span id="ayudaTxt">Arrastra para marcar el área</span><button id="bCancAyuda">Cancelar (Esc)</button></div><div class="rect" id="rect" hidden><span class="medida" id="medida"></span></div></div>
<div class="bloqueo" id="bloqueo" hidden></div>`;
  const $ = (id) => root.getElementById(id);
  const mount = () => { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); };
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: false });

  const SECS = ['sInicio', 'sPrep', 'sMarcar', 'sConf', 'sCorre', 'sFin'];
  function show(id) { for (const s of SECS) $(s).hidden = s !== id; $('panel').classList.remove('min'); }
  $('bMin').addEventListener('click', () => $('panel').classList.toggle('min'));

  // opciones guardadas (las del STL las comparte el visor)
  const opts = { detail: 'max', formats: ['glb'], stl: { scale: 0, base: 3, res: 0.3 } };
  const showStl = () => { $('filaStl').hidden = !opts.formats.includes('stl'); };
  chrome.storage.local.get('earthOpts', (r) => {
    const s = (r && r.earthOpts) || {};
    Object.assign(opts, s, { stl: Object.assign({}, opts.stl, s.stl || {}) });
    $('detalle').value = opts.detail;
    for (const cb of root.querySelectorAll('.fmt')) cb.checked = opts.formats.includes(cb.value);
    $('stlEscala').value = opts.stl.scale > 0 ? opts.stl.scale : ''; $('stlBase').value = opts.stl.base;
    showStl();
  });
  function saveOpts() {
    opts.detail = $('detalle').value;
    opts.formats = [...root.querySelectorAll('.fmt')].filter((c) => c.checked).map((c) => c.value);
    if (!opts.formats.length) { opts.formats = ['glb']; root.querySelector('.fmt[value=glb]').checked = true; }
    const num = (v, d) => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) && x > 0 ? x : d; };
    opts.stl = Object.assign({}, opts.stl, { scale: num($('stlEscala').value, 0), base: num($('stlBase').value, 3) });
    chrome.storage.local.set({ earthOpts: opts });
    showStl();
  }
  $('detalle').addEventListener('change', () => { saveOpts(); if (!$('sConf').hidden) estimate(); });
  for (const cb of root.querySelectorAll('.fmt')) cb.addEventListener('change', saveOpts);
  for (const id of ['stlEscala', 'stlBase']) $(id).addEventListener('change', saveOpts);
  // si se cambian las opciones del STL en el visor, el panel las toma (y no las pisa al guardar)
  chrome.storage.onChanged.addListener((ch, zone) => {
    const nv = zone === 'local' && ch.earthOpts && ch.earthOpts.newValue;
    if (!nv || !nv.stl) return;
    opts.stl = Object.assign({}, opts.stl, nv.stl);
    if (root.activeElement !== $('stlEscala')) $('stlEscala').value = opts.stl.scale > 0 ? opts.stl.scale : '';
    if (root.activeElement !== $('stlBase')) $('stlBase').value = opts.stl.base;
  });
  // (que las teclas del panel no muevan Google Earth)
  for (const id of ['stlEscala', 'stlBase']) $(id).addEventListener('keydown', (e) => e.stopPropagation());

  // ---------------------------------------------------------------- flujo
  let view = null, canvas = null, area = null;
  function err(text) { show('sFin'); $('finTxt').innerHTML = ''; const d = document.createElement('div'); d.className = 'mal'; d.textContent = text; $('finTxt').append(d); $('finArch').innerHTML = ''; $('finAvisos').innerHTML = ''; $('bVer').hidden = true; $('bCarpeta').hidden = true; }

  async function prepare() {
    show('sPrep'); $('prepTxt').textContent = 'Preparando Google Earth…';
    const r = await send({ cmd: 'earth-preparar' });
    if (r.reloading) { $('prepTxt').textContent = 'Recargando Google Earth para engancharse…'; return; }
    if (r.error) return err(r.error);
    if (!r.view || !r.canvas) return err('No se pudo leer la vista de Google Earth. Espera a que cargue y vuelve a probar.');
    view = r.view; canvas = r.canvas;
    host.dataset.vista = JSON.stringify(r); // (diagnóstico y pruebas)
    startDrawing();
  }
  $('bArea').addEventListener('click', () => { saveOpts(); prepare(); });
  let quickMode = false;
  async function quick() {
    quickMode = true;
    show('sPrep'); $('prepTxt').textContent = 'Capturando lo que se ve… se abrirá el visor.';
    const r = await send({ cmd: 'earth-rapida' });
    if (r.reloading) { $('prepTxt').textContent = 'Recargando Google Earth para engancharse…'; return; }
    if (r.error) { quickMode = false; return err(r.error); }
  }
  $('bRapida').addEventListener('click', quick);
  $('bVisor').addEventListener('click', () => send({ cmd: 'earth-ver', list: true }));

  // --- rectángulo
  let drag = null;
  const capa = $('capa'), rect = $('rect');
  function px2en(x, y) {
    // vista cenital: el punto mirado está en el centro del lienzo; metros por píxel en el suelo
    const [cx, cy, cw, ch] = canvas;
    const mpp = 2 * view.d * Math.tan(view.fov * DEG / 2) / ch;
    return [(x - (cx + cw / 2)) * mpp, ((cy + ch / 2) - y) * mpp];
  }
  function startDrawing() {
    area = null;
    show('sMarcar');
    capa.hidden = false; rect.hidden = true; drag = null;
    $('ayudaTxt').textContent = 'Arrastra sobre el mapa para marcar el área';
    $('panel').classList.add('oculto'); // que el panel no tape el mapa mientras se dibuja
  }
  function stopDrawing() { capa.hidden = true; rect.hidden = true; drag = null; }
  capa.addEventListener('pointerdown', (e) => { if (e.button !== 0 || e.target.closest && e.target.closest('#ayuda')) return; capa.setPointerCapture(e.pointerId); drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY }; drawRect(); e.preventDefault(); });
  capa.addEventListener('pointermove', (e) => { if (!drag) return; drag.x1 = e.clientX; drag.y1 = e.clientY; drawRect(); e.preventDefault(); });
  capa.addEventListener('pointerup', (e) => {
    if (!drag) return;
    drag.x1 = e.clientX; drag.y1 = e.clientY;
    const a = px2en(Math.min(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)), b = px2en(Math.max(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
    const W = b[0] - a[0], H = b[1] - a[1];
    if (W < 15 || H < 15) { $('ayudaTxt').textContent = 'Demasiado pequeño: arrastra un rectángulo de al menos 15 m'; drag = null; rect.hidden = true; return; }
    const ce = (a[0] + b[0]) / 2, cn = (a[1] + b[1]) / 2;
    const lat = view.lat + (cn / R) / DEG, lon = view.lon + (ce / (R * Math.cos(view.lat * DEG))) / DEG;
    area = { lat, lon, W, H, a: view.a };
    capa.hidden = true; // el rectángulo queda dibujado mientras empieza (o se confirma)
    rect.hidden = false; capa.hidden = false; capa.style.pointerEvents = 'none'; capa.style.background = 'transparent';
    $('ayuda').hidden = true; $('panel').classList.remove('oculto');
    drag = null;
    afterDraw();
  });
  // Al soltar empieza sola; solo se pide confirmación si el área pasa de los límites
  async function afterDraw() {
    saveOpts();
    const a = area;
    const p = await send({ cmd: 'earth-estimar', W: a.W, H: a.H, detail: opts.detail });
    if (area !== a) return; // se canceló (Esc) mientras tanto
    if (p.n > 80 || p.mb > 800) { confirmArea(); return; }
    start();
  }
  // Estimación mientras se arrastra (posiciones, tiempo y peso), sin saturar de mensajes
  let estBusy = false, estNext = null;
  async function liveEstimate(W, H) {
    if (estBusy) { estNext = [W, H]; return; }
    estBusy = true;
    const p = await send({ cmd: 'earth-estimar', W, H, detail: $('detalle').value });
    estBusy = false;
    if (drag && p && p.n && !estNext) $('medida').textContent = `${fmtN(W)} × ${fmtN(H)} m · ${p.n} ${p.n > 1 ? 'posiciones' : 'posición'} · unos ${fmtT(p.seconds)} · ~${fmtN(p.mb)} MB${p.n > 80 || p.mb > 800 ? ' · grande: bajará el detalle' : ''}`;
    if (estNext) { const [w, h] = estNext; estNext = null; liveEstimate(w, h); }
  }
  function drawRect() {
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    Object.assign(rect.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    rect.hidden = false;
    const a = px2en(x, y + h), b = px2en(x + w, y);
    const W = b[0] - a[0], H = b[1] - a[1];
    if (!$('medida').textContent.startsWith(`${fmtN(W)} × ${fmtN(H)} m`)) $('medida').textContent = `${fmtN(W)} × ${fmtN(H)} m`;
    if (W >= 15 && H >= 15) liveEstimate(W, H);
  }
  function resetCapa() { capa.style.pointerEvents = ''; capa.style.background = ''; $('ayuda').hidden = false; $('panel').classList.remove('oculto'); stopDrawing(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sMarcar').hidden) { area = null; resetCapa(); show('sInicio'); } }, true);
  $('bCancMarcar').addEventListener('click', () => { area = null; resetCapa(); show('sInicio'); });
  $('bCancAyuda').addEventListener('click', (e) => { e.stopPropagation(); area = null; resetCapa(); show('sInicio'); });

  async function estimate() {
    saveOpts();
    const p = await send({ cmd: 'earth-estimar', W: area.W, H: area.H, detail: opts.detail });
    const txt = $('confTxt'); txt.innerHTML = '';
    const l1 = document.createElement('div'); l1.innerHTML = `<b>${fmtN(area.W)} × ${fmtN(area.H)} m</b> (${fmtN(area.W * area.H / 10000, 2)} ha)`;
    const l2 = document.createElement('div'); l2.className = 'nota';
    l2.textContent = p.n ? `${p.n} ${p.n > 1 ? 'posiciones' : 'posición'} de cámara · unos ${fmtT(p.seconds)} · archivo de unos ${fmtN(p.mb)} MB por formato` : '';
    const l3 = document.createElement('div'); l3.className = 'nota'; l3.textContent = `Formatos: ${opts.formats.map((f) => f.toUpperCase()).join(', ')}. Detalle: ${opts.detail === 'max' ? 'máximo disponible' : 'alto'}.`;
    txt.append(l1, l2, l3);
    const av = $('confAvisos'); av.innerHTML = '';
    if (p.n > 80 || p.mb > 800) { const li = document.createElement('li'); li.textContent = 'Área grande para este detalle: se capturará con menos detalle (no más de 80 posiciones ni unos 800 MB por archivo). Para el máximo, marca un área menor.'; av.append(li); }
    else if (p.n > 30) { const li = document.createElement('li'); li.textContent = 'Área grande: tardará y el archivo pesará bastante. Puedes elegir «Alto».'; av.append(li); }
  }
  async function confirmArea() { show('sConf'); await estimate(); }
  $('bOtra').addEventListener('click', () => { resetCapa(); prepare(); });
  $('bCancConf').addEventListener('click', () => { area = null; resetCapa(); show('sInicio'); });
  async function start() {
    const a = area;
    if (!a) return;
    area = null; // (que no pueda arrancar dos veces)
    saveOpts();
    resetCapa();
    show('sCorre'); setRun('Empezando…', 0.01);
    $('bloqueo').hidden = false;
    const r = await send({ cmd: 'earth-area', area: a, detail: opts.detail, formats: opts.formats });
    if (r.error) { $('bloqueo').hidden = true; err(r.error); }
  }
  $('bIr').addEventListener('click', start);
  $('bCancCorre').addEventListener('click', async () => {
    $('corTxt').textContent = 'Cancelando…';
    await send({ cmd: 'earth-cancelar' });
    // pase lo que pase, a los 20 s la página vuelve a responder
    setTimeout(() => { if (!$('sCorre').hidden) { $('bloqueo').hidden = true; show('sInicio'); } }, 20000);
  });
  function setRun(text, frac) {
    if (text) $('corTxt').textContent = text;
    if (frac !== undefined && frac !== null) $('corBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
  }
  $('bNueva').addEventListener('click', () => { saveOpts(); prepare(); });
  $('bInicio').addEventListener('click', () => show('sInicio'));
  let lastResult = null;
  $('bVer').addEventListener('click', () => send({ cmd: 'earth-ver', viewerTab: lastResult && lastResult.viewerTab }));
  $('bCarpeta').addEventListener('click', () => send({ cmd: 'earth-carpeta', downloadId: lastResult && lastResult.files && lastResult.files[0] && lastResult.files[0].id }));

  function showResult(r) {
    lastResult = r; quickMode = false;
    $('bloqueo').hidden = true;
    if (!r.ok) { if (r.cancelled) { show('sInicio'); return; } err(r.error || 'Algo ha fallado.'); return; }
    show('sFin');
    $('bVer').hidden = false; $('bCarpeta').hidden = !(r.files && r.files.length);
    $('finTxt').innerHTML = '';
    const d = document.createElement('div'); d.className = 'ok'; d.textContent = 'Guardado en Descargas › Captar malla:'; $('finTxt').append(d);
    if (r.info) { const n = document.createElement('div'); n.className = 'nota'; n.textContent = r.info; $('finTxt').append(n); }
    $('finArch').innerHTML = '';
    for (const f of r.files || []) { const li = document.createElement('li'); li.textContent = `${f.name} (${fmtMB(f.bytes)})${f.note ? ' · ' + f.note : ''}`; $('finArch').append(li); }
    $('finAvisos').innerHTML = '';
    for (const w of r.warnings || []) { const li = document.createElement('li'); li.textContent = w; $('finAvisos').append(li); }
  }

  chrome.runtime.onMessage.addListener((m) => {
    if (!m || !m.type) return;
    if (m.type === 'earth-progreso') {
      if (m.done) return; // el final llega aparte (earth-fin)
      if (m.kind !== 'area') {
        // captura rápida (también la del atajo Alt+Mayús+M): sin bloquear la página
        if ($('sPrep').hidden) show('sPrep');
        $('prepTxt').textContent = m.text; return;
      }
      if ($('sCorre').hidden) { show('sCorre'); $('bloqueo').hidden = false; }
      setRun(m.text, m.frac);
    }
    else if (m.type === 'earth-rapida-hecha') { quickMode = false; $('bloqueo').hidden = true; show('sInicio'); }
    else if (m.type === 'earth-fin') showResult(m);
    else if (m.type === 'earth-estado' && !m.armed) { $('bloqueo').hidden = true; if (!$('sCorre').hidden || !$('sPrep').hidden) err('El modo captura se ha desactivado (¿se cerró el aviso amarillo de Chrome?). Vuelve a pulsar «Capturar área».'); }
  });

  // al cargar (también tras la recarga de enganche): ¿había algo pendiente?
  (async () => {
    const st = await send({ cmd: 'earth-hola' });
    if (st.busy) { show('sCorre'); $('bloqueo').hidden = false; setRun(st.progress || 'Capturando…', st.frac); return; }
    if (st.pending === 'rect') { prepare(); return; }
    if (st.pending === 'rapida') { quick(); return; }
    if (st.result) showResult(st.result);
  })();
})();
