// Prueba de extremo a extremo de la EXTENSIÓN en Google Earth, usando el panel como un usuario:
// Capturar área → arrastrar rectángulo → Capturar → archivos en <descargas>/Captar malla.
// Uso: node e2e_area.mjs <nombre> [x0 y0 x1 y1] [formatos] [detalle]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const EXT = path.resolve(import.meta.dirname, '../extension');
const [, , name = 'e2e_area', X0 = '520', Y0 = '330', X1 = '880', Y1 = '570', FMTS = 'glb', DET = 'max'] = process.argv;
const OUT = path.resolve('out', name); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const PROFILE = path.resolve('profile_e2e'); fs.rmSync(PROFILE, { recursive: true, force: true });
const T0 = Date.now(); const t = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: process.env.HEADFUL ? false : 'new', pipe: true, enableExtensions: [EXT], userDataDir: PROFILE,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--window-size=1400,900', '--lang=es-ES'],
  defaultViewport: null,
});
const shot = async (page, n) => { try { await page.screenshot({ path: path.join(OUT, n + '.png') }); } catch (e) { console.log('captura de pantalla falló', n, e.message); } };
try {
  const bcdp = await browser.target().createCDPSession();
  await bcdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT, eventsEnabled: true });
  const swT = await browser.waitForTarget((x) => x.type() === 'service_worker' && x.url().endsWith('background.js'), { timeout: 15000 });
  const sw = await swT.worker();
  sw.on('console', (m) => { if (/\[captar\]/.test(m.text())) console.log(t(), 'SW', m.text().slice(0, 300)); });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.goto('https://earth.google.com/web/@40.4153,-3.7074,650a,600d,35y,20h,45t,0r', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=submit]')].find((b) => /rechazar todo|reject all/i.test((b.innerText || b.value || ''))); if (b) b.click(); }).catch(() => { });
  await new Promise((r) => setTimeout(r, 8000));
  const P = (expr) => page.evaluate(`(() => { const r = document.querySelector('#captar-malla-panel'); if (!r) return null; const $ = (id) => r.shadowRoot.getElementById(id); return (${expr}); })()`);
  const visible = (id) => P(`!$('${id}').hidden`);
  console.log(t(), 'panel presente:', await P('true'));
  await shot(page, '1_panel');
  // opciones: formatos y detalle
  await P(`(() => { for (const cb of r.shadowRoot.querySelectorAll('.fmt')) cb.checked = ${JSON.stringify(FMTS.split(','))}.includes(cb.value); $('detalle').value = '${DET}'; $('detalle').dispatchEvent(new Event('change')); return 1; })()`);
  if (process.env.RAPIDA) {
    await P(`$('bRapida').click()`);
    console.log(t(), 'pulsado Captura rápida');
    let v = null;
    for (let i = 0; i < 150 && !v; i++) { await new Promise((r) => setTimeout(r, 1000)); v = (await browser.pages()).find((p) => p.url().includes('viewer.html?id=')); }
    if (!v) throw new Error('no se abrió el visor');
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1000)); const txt = await v.evaluate(() => document.getElementById('resumen').innerText).catch(() => ''); if (txt) { console.log(t(), 'visor:', txt.split('\n').join(' | ')); break; } }
    await new Promise((r) => setTimeout(r, 3000));
    await v.screenshot({ path: path.join(OUT, 'rapida_visor.png') });
    console.log(t(), 'grupos:', (await v.evaluate(() => document.getElementById('grupos').innerText)).split('\n').join(' | ').slice(0, 400));
    console.log(t(), 'panel:', (await P(`r.shadowRoot.querySelector('.cuerpo').innerText`)).split('\n').join(' | '));
    // STL para imprimir de la vista (zona = cuadrado del recorte)
    const stl = await v.evaluate(() => window.__captarMallaVisor.doExport('stl'));
    console.log(t(), 'STL de la vista:', JSON.stringify(stl), '|', await v.evaluate(() => document.getElementById('estadoExport').textContent));
    await new Promise((r) => setTimeout(r, 1500));
    await browser.close();
    process.exit(0);
  }
  await P(`$('bArea').click()`);
  console.log(t(), 'pulsado Capturar área');
  // tras la recarga, el panel vuelve y entra en modo rectángulo
  let ok = false;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { if (await P(`!$('capa').hidden && !$('sMarcar').hidden`)) { ok = true; break; } } catch (e) { }
  }
  console.log(t(), 'modo rectángulo:', ok);
  if (!ok) { await shot(page, 'x_sin_rect'); console.log('texto panel:', await P(`r.shadowRoot.querySelector('.cuerpo').innerText`).catch(() => '')); throw new Error('no entró en modo rectángulo'); }
  await shot(page, '2_cenital');
  console.log(t(), 'vista recibida por el panel:', await page.evaluate(() => document.querySelector('#captar-malla-panel').dataset.vista));
  console.log(t(), 'ventana:', await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio, location.href]));
  await page.mouse.move(+X0, +Y0); await page.mouse.down();
  for (let k = 1; k <= 20; k++) { await page.mouse.move(+X0 + (X1 - X0) * k / 20, +Y0 + (Y1 - Y0) * k / 20); await new Promise((r) => setTimeout(r, 30)); }
  await new Promise((r) => setTimeout(r, 400));
  console.log(t(), 'medida mientras se arrastra:', await P(`$('medida').textContent`));
  await shot(page, '3_rectangulo');
  if (process.env.STOP) throw new Error('parada pedida (STOP)');
  await page.mouse.up();
  const T1 = Date.now();
  // al soltar empieza sola (sin confirmación, salvo áreas que pasan de los límites)
  for (let i = 0; i < 20 && !(await visible('sCorre')) && !(await visible('sConf')); i++) await new Promise((r) => setTimeout(r, 250));
  if (await visible('sConf')) { console.log(t(), 'confirmación (área grande):', await P(`$('confTxt').innerText.replace(/\\n/g, ' | ')`)); await shot(page, '4_confirmar'); await P(`$('bIr').click()`); }
  console.log(t(), 'capturando:', await visible('sCorre'));
  // OCULTA=1: cambiar a otra pestaña nada más empezar y no volver hasta el final
  let other = null;
  if (process.env.OCULTA) { other = await browser.newPage(); await other.goto('about:blank'); await other.bringToFront(); console.log(t(), 'otra pestaña delante'); }
  let last = '';
  let fin = null;
  for (let i = 0; i < 1200; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await P(`({ corre: !$('sCorre').hidden, txt: $('corTxt').textContent, fin: !$('sFin').hidden, finTxt: $('sFin').innerText, vis: document.visibilityState })`).catch(() => null);
    if (!s) continue;
    if (s.corre && s.txt !== last) { last = s.txt; if (!/Copiando/.test(s.txt) || /269|de \d+ MB…$/.test(s.txt)) console.log(t(), 'panel:', s.txt, other ? `(pestaña de Earth: ${s.vis})` : ''); }
    if (i === 25 && !other) await shot(page, '5_capturando');
    if (s.fin) { fin = s.finTxt; break; }
  }
  console.log(t(), `FIN (${((Date.now() - T1) / 1000).toFixed(1)} s desde soltar el rectángulo) panel:\n` + fin);
  if (other) await page.bringToFront();
  // DOS=1: «Capturar otra área» y el mismo rectángulo otra vez (la zona ya está medida: sin sonda)
  if (process.env.DOS) {
    await new Promise((r) => setTimeout(r, 2000));
    await P(`$('bNueva').click()`);
    let ok2 = false;
    for (let i = 0; i < 60 && !ok2; i++) { await new Promise((r) => setTimeout(r, 1000)); ok2 = await P(`!$('capa').hidden && !$('sMarcar').hidden`).catch(() => false); }
    console.log(t(), 'segunda: modo rectángulo', ok2);
    await page.mouse.move(+X0, +Y0); await page.mouse.down();
    for (let k = 1; k <= 20; k++) { await page.mouse.move(+X0 + (X1 - X0) * k / 20, +Y0 + (Y1 - Y0) * k / 20); await new Promise((r) => setTimeout(r, 30)); }
    await page.mouse.up();
    const T2 = Date.now(); let fin2 = null;
    for (let i = 0; i < 1200; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const s = await P(`({ fin: !$('sFin').hidden && !$('sCorre').hidden === false, finTxt: $('sFin').innerText, corre: !$('sCorre').hidden })`).catch(() => null);
      if (s && !s.corre && s.fin && i > 3) { fin2 = s.finTxt; break; }
    }
    console.log(t(), `SEGUNDA FIN (${((Date.now() - T2) / 1000).toFixed(1)} s desde soltar) panel:\n` + fin2);
  }
  await shot(page, '6_fin');
  const log = await sw.evaluate(() => (self.__captarLog || []).join('\n'));
  fs.writeFileSync(path.join(OUT, 'registro_sw.txt'), log);
  const dir = path.join(OUT, 'Captar malla');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => ({ f, mb: (fs.statSync(path.join(dir, f)).size / 1048576).toFixed(1) })) : [];
  console.log(t(), 'archivos:', JSON.stringify(files));
  // visor abierto en segundo plano
  const pages = await browser.pages();
  const viewer = pages.find((p) => p.url().includes('viewer.html'));
  if (viewer) { await viewer.bringToFront(); await new Promise((r) => setTimeout(r, 3000)); await viewer.screenshot({ path: path.join(OUT, '7_visor.png') }); console.log(t(), 'visor:', (await viewer.evaluate(() => document.getElementById('resumen').innerText)).replace(/\n/g, ' | ')); }
} finally {
  await browser.close();
}
