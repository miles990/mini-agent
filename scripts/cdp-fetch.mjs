#!/usr/bin/env node
/**
 * Chrome DevTools Protocol (CDP) Fetch — Zero Dependencies
 *
 * Uses Node.js native WebSocket + fetch to control Chrome browser.
 * Requires Chrome running with --remote-debugging-port=9222
 *
 * Usage:
 *   node scripts/cdp-fetch.mjs status                    # Check CDP availability
 *   node scripts/cdp-fetch.mjs fetch <url>               # Fetch page content
 *   node scripts/cdp-fetch.mjs open <url>                # Open visible tab (for login)
 *   node scripts/cdp-fetch.mjs extract [tabId]           # Extract content from existing tab
 *   node scripts/cdp-fetch.mjs close <tabId>             # Close a tab
 */

const CDP_HOST = process.env.CDP_HOST || 'localhost';
const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;
const TIMEOUT = parseInt(process.env.CDP_TIMEOUT || '15000');
const MAX_CONTENT = parseInt(process.env.CDP_MAX_CONTENT || '8000');

// ─── CDP HTTP API helpers ─────────────────────────────────────────────────────

async function cdpAvailable() {
  try {
    const res = await fetch(`${CDP_BASE}/json/version`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function listTargets() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  return res.json();
}

async function createTarget(url) {
  const res = await fetch(`${CDP_BASE}/json/new?${url}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5000),
  });
  return res.json();
}

async function closeTarget(targetId) {
  await fetch(`${CDP_BASE}/json/close/${targetId}`, { signal: AbortSignal.timeout(3000) });
}

async function activateTarget(targetId) {
  await fetch(`${CDP_BASE}/json/activate/${targetId}`, { signal: AbortSignal.timeout(3000) });
}

// ─── CDP WebSocket commands ───────────────────────────────────────────────────

function cdpCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e8);
    const timeout = setTimeout(() => reject(new Error(`CDP command timeout: ${method}`)), TIMEOUT);

    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`));
        else resolve(msg.result);
      }
    };

    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function waitForEvent(ws, eventName, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Waiting for ${eventName} timeout`)), timeoutMs);

    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === eventName) {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        resolve(msg.params);
      }
    };

    ws.addEventListener('message', handler);
  });
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('WebSocket connect timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

// ─── Page content extraction ──────────────────────────────────────────────────

async function extractPageContent(ws) {
  // Get page title
  const titleResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: 'document.title',
    returnByValue: true,
  });
  const title = titleResult.result?.value || '';

  // Get page URL
  const urlResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true,
  });
  const pageUrl = urlResult.result?.value || '';

  // Extract readable text content
  const textResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        // Remove scripts, styles, nav, footer
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script, style, nav, footer, header, aside, [role="navigation"], [role="banner"]')
          .forEach(el => el.remove());
        return clone.innerText.replace(/\\n{3,}/g, '\\n\\n').trim();
      })()
    `,
    returnByValue: true,
  });
  const text = textResult.result?.value || '';

  // Extract all links
  const linksResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      JSON.stringify(
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({ text: a.innerText.trim().slice(0, 80), href: a.href }))
          .filter(l => l.href.startsWith('http') && l.text)
          .slice(0, 30)
      )
    `,
    returnByValue: true,
  });
  let links = [];
  try { links = JSON.parse(linksResult.result?.value || '[]'); } catch {}

  return { title, url: pageUrl, text, links };
}

function detectAuthPage(content) {
  const indicators = [
    'sign in', 'log in', 'login', 'sign up', '登入', '登錄',
    'password', 'captcha', 'verify', '驗證', 'authenticate',
    'access denied', '403', 'forbidden', 'unauthorized',
  ];
  const lower = (content.title + ' ' + content.text.slice(0, 500)).toLowerCase();
  return indicators.some(i => lower.includes(i));
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdStatus() {
  if (!await cdpAvailable()) {
    console.log('Chrome CDP: NOT AVAILABLE');
    console.log('');
    console.log('To enable, start Chrome with:');
    console.log('  open -a "Google Chrome" --args --remote-debugging-port=9222');
    console.log('');
    console.log('Or add to Chrome shortcut/alias.');
    process.exit(1);
  }

  const targets = await listTargets();
  const pages = targets.filter(t => t.type === 'page');

  console.log(`Chrome CDP: AVAILABLE (${CDP_BASE})`);
  console.log(`Open tabs: ${pages.length}`);
  console.log('');

  for (const page of pages.slice(0, 10)) {
    const title = (page.title || 'Untitled').slice(0, 60);
    const url = (page.url || '').slice(0, 80);
    console.log(`  [${page.id.slice(0, 8)}] ${title}`);
    console.log(`           ${url}`);
  }

  if (pages.length > 10) {
    console.log(`  ... and ${pages.length - 10} more`);
  }
}

async function cmdFetch(url) {
  if (!await cdpAvailable()) {
    console.error('Chrome CDP not available. Start Chrome with --remote-debugging-port=9222');
    process.exit(1);
  }

  // Create a new tab (background)
  const target = await createTarget(url);
  const wsUrl = target.webSocketDebuggerUrl;

  if (!wsUrl) {
    console.error('Failed to get WebSocket URL for new tab');
    process.exit(1);
  }

  let ws;
  try {
    ws = await connectWs(wsUrl);

    // Enable Page events and navigate
    await cdpCommand(ws, 'Page.enable');
    await cdpCommand(ws, 'Runtime.enable');

    // Navigate and wait for load
    const loadPromise = waitForEvent(ws, 'Page.loadEventFired', TIMEOUT);
    await cdpCommand(ws, 'Page.navigate', { url });
    await loadPromise;

    // Small delay for dynamic content
    await new Promise(r => setTimeout(r, 1500));

    // Extract content
    const content = await extractPageContent(ws);

    // Check if it's an auth page
    if (detectAuthPage(content)) {
      console.log(`AUTH_REQUIRED: ${url}`);
      console.log(`Title: ${content.title}`);
      console.log('');
      console.log('This page requires login/verification.');
      console.log(`Use: node scripts/cdp-fetch.mjs open "${url}" to open it visibly.`);

      // Close the background tab
      await closeTarget(target.id);
    } else {
      // Output content
      console.log(`Title: ${content.title}`);
      console.log(`URL: ${content.url}`);
      console.log('');

      if (content.text) {
        console.log('--- Content ---');
        console.log(content.text.slice(0, MAX_CONTENT));
      }

      if (content.links.length > 0) {
        console.log('');
        console.log('--- Links ---');
        for (const link of content.links) {
          console.log(`  ${link.text}: ${link.href}`);
        }
      }

      // Close the tab after extraction
      await closeTarget(target.id);
    }
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdOpen(url) {
  if (!await cdpAvailable()) {
    console.error('Chrome CDP not available. Start Chrome with --remote-debugging-port=9222');
    process.exit(1);
  }

  // Create and activate a visible tab
  const target = await createTarget(url);
  await activateTarget(target.id);

  console.log(`Opened: ${url}`);
  console.log(`Tab ID: ${target.id}`);
  console.log('');
  console.log('Page is now visible in Chrome.');
  console.log('After logging in, use:');
  console.log(`  node scripts/cdp-fetch.mjs extract ${target.id}`);
}

async function cmdExtract(tabId) {
  if (!await cdpAvailable()) {
    console.error('Chrome CDP not available');
    process.exit(1);
  }

  // Find the target
  const targets = await listTargets();
  const target = targets.find(t =>
    t.id === tabId || t.id.startsWith(tabId)
  );

  if (!target) {
    console.error(`Tab not found: ${tabId}`);
    console.log('Available tabs:');
    targets.filter(t => t.type === 'page').forEach(t => {
      console.log(`  [${t.id.slice(0, 8)}] ${t.title?.slice(0, 50) || t.url}`);
    });
    process.exit(1);
  }

  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) {
    console.error('Cannot connect to this tab (no WebSocket URL)');
    process.exit(1);
  }

  let ws;
  try {
    ws = await connectWs(wsUrl);
    await cdpCommand(ws, 'Runtime.enable');

    const content = await extractPageContent(ws);

    console.log(`Title: ${content.title}`);
    console.log(`URL: ${content.url}`);
    console.log('');

    if (content.text) {
      console.log('--- Content ---');
      console.log(content.text.slice(0, MAX_CONTENT));
    }

    if (content.links.length > 0) {
      console.log('');
      console.log('--- Links ---');
      for (const link of content.links) {
        console.log(`  ${link.text}: ${link.href}`);
      }
    }
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdClose(tabId) {
  const targets = await listTargets();
  const target = targets.find(t => t.id === tabId || t.id.startsWith(tabId));
  if (target) {
    await closeTarget(target.id);
    console.log(`Closed tab: ${target.title || target.id}`);
  } else {
    console.error(`Tab not found: ${tabId}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'status':
      await cmdStatus();
      break;
    case 'fetch':
      if (!args[0]) { console.error('Usage: cdp-fetch.mjs fetch <url>'); process.exit(1); }
      await cmdFetch(args[0]);
      break;
    case 'open':
      if (!args[0]) { console.error('Usage: cdp-fetch.mjs open <url>'); process.exit(1); }
      await cmdOpen(args[0]);
      break;
    case 'extract':
      if (!args[0]) { console.error('Usage: cdp-fetch.mjs extract <tabId>'); process.exit(1); }
      await cmdExtract(args[0]);
      break;
    case 'close':
      if (!args[0]) { console.error('Usage: cdp-fetch.mjs close <tabId>'); process.exit(1); }
      await cmdClose(args[0]);
      break;
    default:
      console.log('cdp-fetch — Chrome DevTools Protocol content fetcher');
      console.log('');
      console.log('Commands:');
      console.log('  status              Check Chrome CDP availability');
      console.log('  fetch <url>         Fetch page content (background tab)');
      console.log('  open <url>          Open visible tab (for login/verification)');
      console.log('  extract <tabId>     Extract content from existing tab');
      console.log('  close <tabId>       Close a tab');
      console.log('');
      console.log('Environment:');
      console.log('  CDP_PORT=9222       Chrome debugging port');
      console.log('  CDP_TIMEOUT=15000   Command timeout (ms)');
      console.log('  CDP_MAX_CONTENT=8000  Max content chars');
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
