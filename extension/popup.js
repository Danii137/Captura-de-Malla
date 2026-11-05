// Captar malla — ventana del botón de la extensión (solo Google Earth).
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
let tabId = null;

async function refresh() {
  if (tabId === null) return;
  const st = await send({ cmd: 'estado', tabId }).catch(() => ({}));
  $('desactivar').hidden = !(st && st.armed);
  if (st && st.capturing) $('progreso').textContent = st.progress || 'Capturando…';
}
chrome.runtime.onMessage.addListener((m) => {
  if (!m || m.type !== 'progreso' || m.tabId !== tabId) return;
  $('progreso').textContent = m.text || '';
  $('progreso').className = 'progreso' + (m.done ? (m.ok ? ' ok' : ' mal') : '');
});
$('desactivar').addEventListener('click', async () => { await send({ cmd: 'desactivar', tabId }); $('progreso').textContent = ''; refresh(); });
$('guardadas').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') }));
$('abrirEarth').addEventListener('click', () => chrome.tabs.create({ url: 'https://earth.google.com/web/' }));

(async () => {
  // (?tab=N solo se usa en las pruebas automáticas, al abrir esta ventana como pestaña)
  const forced = Number(new URLSearchParams(location.search).get('tab')) || null;
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  const isEarth = tab && /^https:\/\/earth\.google\.com\/web\b/.test(tab.url || '');
  $('earth').hidden = !isEarth; $('otra').hidden = !!isEarth;
  if (!isEarth) return;
  tabId = tab.id;
  await refresh();
  setInterval(refresh, 2000);
})();
