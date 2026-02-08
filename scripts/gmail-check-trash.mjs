#!/usr/bin/env node
const CDP_BASE = `http://localhost:${process.env.CDP_PORT || '9222'}`;
const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
const targets = await res.json();
const gmail = targets.find(t => t.type === 'page' && t.url.includes('mail.google.com'));
if (!gmail) { console.error('No Gmail'); process.exit(1); }
const ws = new WebSocket(gmail.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
  ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
  ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('err')); });
});
let _id = 0;
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++_id;
  const t = setTimeout(() => reject(new Error('timeout')), 30000);
  const handler = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id === id) { clearTimeout(t); ws.removeEventListener('message', handler); resolve(msg.result); }
  };
  ws.addEventListener('message', handler);
  ws.send(JSON.stringify({ id, method, params }));
});
await cdp('Runtime.enable');
const evaluate = async (js) => (await cdp('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true })).result?.value;

// Navigate to trash
await evaluate("window.location.hash = '#trash'; 'ok'");
await new Promise(r => setTimeout(r, 3000));
const title = await evaluate('document.title');
console.log('Title:', title);

const info = await evaluate(`
  (() => {
    const rows = document.querySelectorAll('tr.zA');
    const dj = document.querySelector('.Dj');
    const tc = document.querySelector('.TC');
    return JSON.stringify({
      rows: rows.length,
      status: dj ? dj.textContent.trim() : '',
      empty: tc ? tc.textContent.trim().slice(0, 100) : '',
    });
  })()
`);
console.log('Info:', info);
ws.close();
