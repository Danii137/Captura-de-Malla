// Cliente CDP mínimo (sesiones planas) para lanzar Chrome de pruebas y hablar con él.
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import path from 'node:path';
import fs from 'node:fs';

export async function launchChrome({ port = 9333, profile = 'profile_probe', headless = true, extraArgs = [] } = {}) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.resolve(profile)}`,
    '--no-first-run', '--no-default-browser-check', '--lang=es-ES',
    '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11',
    '--window-size=1400,900',
    ...(headless ? ['--headless=new'] : []),
    ...extraArgs,
    'about:blank',
  ];
  const proc = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', args, { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await new Promise(r => setTimeout(r, 200));
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); wsUrl = (await r.json()).webSocketDebuggerUrl; } catch { }
  }
  if (!wsUrl) throw new Error('Chrome no arrancó');
  const cdp = await connect(wsUrl);
  cdp.proc = proc;
  return cdp;
}

export function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { maxPayload: 1024 * 1024 * 1024 });
    let id = 0; const pending = new Map(); const listeners = [];
    ws.on('open', () => resolve(api));
    ws.on('error', reject);
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message + ' ' + (msg.error.data || ''))); else res(msg.result);
      } else if (msg.method) {
        for (const l of listeners) { try { l(msg.method, msg.params || {}, msg.sessionId); } catch (e) { console.error(e); } }
      }
    });
    const api = {
      send(method, params = {}, sessionId) {
        const mid = ++id;
        ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((res, rej) => pending.set(mid, { res, rej }));
      },
      on(fn) { listeners.push(fn); },
      close() { try { ws.close(); } catch { } },
    };
  });
}
