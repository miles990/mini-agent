#!/usr/bin/env node
/**
 * Resize browser viewport via CDP Emulation and extract page content.
 * Usage: node cdp-resize-and-fetch.mjs <targetId> [width] [height]
 */

const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
const targetId = process.argv[2];
const width = parseInt(process.argv[3] || '1920');
const height = parseInt(process.argv[4] || '1080');

if (!targetId) {
  console.error('Usage: node cdp-resize-and-fetch.mjs <targetId> [width] [height]');
  process.exit(1);
}

const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json`);
const targets = await resp.json();
const target = targets.find(t => t.id.startsWith(targetId) || t.id === targetId);
if (!target) { console.error('Target not found'); process.exit(1); }

const wsUrl = target.webSocketDebuggerUrl;
const ws = new WebSocket(wsUrl);
let msgId = 1;
const pendingCallbacks = new Map();

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { ws.close(); reject(new Error('WS timeout')); }, 5000);
  ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
  ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pendingCallbacks.has(msg.id)) {
    pendingCallbacks.get(msg.id)(msg);
    pendingCallbacks.delete(msg.id);
  }
});

function sendCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    pendingCallbacks.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pendingCallbacks.has(id)) {
        pendingCallbacks.delete(id);
        reject(new Error('timeout'));
      }
    }, 10000);
  });
}

// Set device metrics override for larger viewport
await sendCommand('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false
});

console.error(`Set viewport to ${width}x${height}`);

// Reload the page
await sendCommand('Page.reload', {});
await new Promise(r => setTimeout(r, 5000));

// Extract content
const result = await sendCommand('Runtime.evaluate', {
  expression: 'document.body.innerText',
  returnByValue: true
});

console.log('--- Page Content ---');
console.log(result.result?.result?.value || 'No content');

// Also get all links
const linksResult = await sendCommand('Runtime.evaluate', {
  expression: `
    var links = document.querySelectorAll('a[href]');
    var result = [];
    for (var i = 0; i < links.length; i++) {
      result.push(links[i].textContent.trim() + ' -> ' + links[i].href);
    }
    result.join('\\n');
  `,
  returnByValue: true
});

console.log('\n--- Links ---');
console.log(linksResult.result?.result?.value || 'No links');

ws.close();
process.exit(0);
