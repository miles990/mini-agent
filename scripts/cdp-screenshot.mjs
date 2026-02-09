#!/usr/bin/env node
/**
 * CDP Screenshot — Capture screenshot from Chrome and save to file
 *
 * Uses Node.js native WebSocket (Node 20+) + fetch, zero dependencies.
 * Requires Chrome running with --remote-debugging-port=9222
 *
 * Usage:
 *   node scripts/cdp-screenshot.mjs [output-path]
 *   # Default output: /tmp/screenshot.png
 */

import fs from 'node:fs';

const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_BASE = `http://localhost:${CDP_PORT}`;
const outPath = process.argv[2] || '/tmp/screenshot.png';

// ── Find a page target ──

let tabs;
try {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  tabs = await res.json();
} catch {
  console.error('Chrome CDP not available');
  process.exit(1);
}

const page = tabs.find(t => t.type === 'page');
if (!page) {
  console.error('No page found');
  process.exit(1);
}

if (!page.webSocketDebuggerUrl) {
  console.error('No WebSocket URL for page');
  process.exit(1);
}

// ── Connect WebSocket ──

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { ws.close(); reject(new Error('WS connect timeout')); }, 5000);
  ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
  ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
});

// ── CDP command helper ──

let msgId = 1;
function cdpCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 5000);

    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// ── Capture screenshot ──

try {
  const { data } = await cdpCommand('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log(`Screenshot saved: ${outPath}`);
} catch (err) {
  console.error(`Screenshot failed: ${err.message}`);
  process.exit(1);
} finally {
  ws.close();
}
