// Captar malla — capturas guardadas (IndexedDB de la extensión; solo en este equipo).
// Las partes grandes se guardan en trozos de 64 MB (registros "<id>#p<i>#c<j>"), para no depender
// del tamaño máximo de un solo registro. Las capturas antiguas (partes enteras) se siguen leyendo.
const DB = 'captar-malla', VER = 1;
const CHUNK = 64 * 1024 * 1024;
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(db, stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('transacción cancelada'));
    out = fn(t);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const toBuf = (u8) => (u8.byteOffset === 0 && u8.buffer.byteLength === u8.byteLength ? u8.buffer : u8.slice().buffer);

export async function saveCapture({ title, url, parts, summary, extra }) {
  const db = await open();
  const id = 'cap-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
  const size = parts.reduce((a, p) => a + p.byteLength, 0);
  // cada trozo en su propia transacción (menos memoria a la vez)
  const desc = [];
  try {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const n = Math.max(1, Math.ceil(p.byteLength / CHUNK));
      desc.push({ size: p.byteLength, chunks: n });
      for (let j = 0; j < n; j++) {
        const piece = p.subarray(j * CHUNK, Math.min(p.byteLength, (j + 1) * CHUNK));
        await tx(db, ['data'], 'readwrite', (t) => { t.objectStore('data').put({ id: `${id}#p${i}#c${j}`, buf: piece.slice().buffer }); });
      }
    }
    await tx(db, ['meta', 'data'], 'readwrite', (t) => {
      t.objectStore('meta').put(Object.assign({ id, date: new Date().toISOString(), title: title || '', url: url || '', size, summary: summary || null, name: '' }, extra || {}));
      t.objectStore('data').put({ id, parts: desc });
    });
  } catch (e) {
    // no dejar trozos sueltos si falla a medias (p. ej. disco lleno)
    try { await tx(db, ['data'], 'readwrite', (t) => { t.objectStore('data').delete(IDBKeyRange.bound(id + '#', id + '#\uffff')); }); } catch (er) { }
    db.close();
    throw e;
  }
  db.close();
  return id;
}
export async function listCaptures() {
  const db = await open();
  let all = [];
  await tx(db, ['meta'], 'readonly', (t) => { req(t.objectStore('meta').getAll()).then((v) => { all = v; }); });
  db.close();
  return all.sort((a, b) => (a.date < b.date ? 1 : -1));
}
export async function loadMeta(id) {
  const db = await open();
  let meta = null;
  await tx(db, ['meta'], 'readonly', (t) => { req(t.objectStore('meta').get(id)).then((v) => { meta = v; }); });
  db.close();
  return meta;
}
export async function loadCapture(id) {
  const db = await open();
  let meta = null, data = null;
  await tx(db, ['meta', 'data'], 'readonly', (t) => {
    req(t.objectStore('meta').get(id)).then((v) => { meta = v; });
    req(t.objectStore('data').get(id)).then((v) => { data = v; });
  });
  if (!meta || !data) { db.close(); return null; }
  const parts = [];
  for (let i = 0; i < data.parts.length; i++) {
    const d = data.parts[i];
    if (d instanceof ArrayBuffer) { parts.push(new Uint8Array(d)); continue; } // formato antiguo
    const out = new Uint8Array(d.size);
    let o = 0;
    for (let j = 0; j < d.chunks; j++) {
      let rec = null;
      await tx(db, ['data'], 'readonly', (t) => { req(t.objectStore('data').get(`${id}#p${i}#c${j}`)).then((v) => { rec = v; }); });
      if (!rec) throw new Error('Falta un trozo de la captura guardada');
      out.set(new Uint8Array(rec.buf), o); o += rec.buf.byteLength;
    }
    parts.push(out);
  }
  db.close();
  return { meta, parts };
}
export async function deleteCapture(id) {
  const db = await open();
  await tx(db, ['meta', 'data'], 'readwrite', (t) => {
    t.objectStore('meta').delete(id);
    t.objectStore('data').delete(id);
    t.objectStore('data').delete(IDBKeyRange.bound(id + '#', id + '#\uffff'));
  });
  db.close();
}
export async function updateMeta(id, patch) {
  const db = await open();
  await tx(db, ['meta'], 'readwrite', (t) => {
    const s = t.objectStore('meta');
    req(s.get(id)).then((m) => { if (m) s.put(Object.assign(m, patch)); });
  });
  db.close();
}
export async function renameCapture(id, name) { return updateMeta(id, { name }); }
export { toBuf };
