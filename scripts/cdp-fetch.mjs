#!/usr/bin/env node
/**
 * Chrome DevTools Protocol (CDP) Browser Tool — Zero Dependencies
 *
 * Complete browser automation: fetch, screenshot, interact, login.
 * Auto-manages Chrome lifecycle (headless by default, visible for login).
 *
 * Usage:
 *   node cdp-fetch.mjs status                       # Chrome status + open tabs
 *   node cdp-fetch.mjs fetch <url> [--full|--offset N]  # Fetch page content
 *   node cdp-fetch.mjs screenshot <url> [output.png] # Screenshot a page
 *   node cdp-fetch.mjs open <url>                    # Open visible tab
 *   node cdp-fetch.mjs extract [tabId]               # Extract content from tab
 *   node cdp-fetch.mjs close <tabId>                 # Close a tab
 *   node cdp-fetch.mjs login <url>                   # Switch to visible for login
 *   node cdp-fetch.mjs headless                      # Switch back to headless
 *   node cdp-fetch.mjs eval <tabId> <js>             # Run JavaScript in tab
 *   node cdp-fetch.mjs click <tabId> <selector>      # Click element
 *   node cdp-fetch.mjs type <tabId> <selector> <text> # Type into element
 *   node cdp-fetch.mjs scroll <tabId> [down|up|N]    # Scroll page
 */

import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync, spawn } from 'node:child_process';

const CDP_HOST = process.env.CDP_HOST || 'localhost';
const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;
const TIMEOUT = parseInt(process.env.CDP_TIMEOUT || '15000');
const MAX_CONTENT = parseInt(process.env.CDP_MAX_CONTENT || '8000');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE_DIR = join(homedir(), '.mini-agent', 'chrome-cdp-profile');
const CDP_LOG_DIR = join(homedir(), '.mini-agent');
const CDP_LOG_FILE = join(CDP_LOG_DIR, 'cdp.jsonl');

// ─── Logging ─────────────────────────────────────────────────────────────────

function logCdpOp(op, detail = {}) {
  try {
    mkdirSync(CDP_LOG_DIR, { recursive: true });
    const entry = JSON.stringify({ ts: new Date().toISOString(), op, ...detail });
    appendFileSync(CDP_LOG_FILE, entry + '\n');
  } catch { /* logging should never break operations */ }
}

// ─── Chrome Lifecycle ────────────────────────────────────────────────────────

async function cdpAvailable() {
  try {
    const res = await fetch(`${CDP_BASE}/json/version`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function findChromePid() {
  try {
    const out = execSync(
      `pgrep -f "Google Chrome.*--remote-debugging-port=${CDP_PORT}.*--user-data-dir=.*chrome-cdp-profile"`,
      { encoding: 'utf-8', timeout: 3000 }
    ).trim();
    const pids = out.split('\n').filter(Boolean);
    return pids.length > 0 ? parseInt(pids[0]) : null;
  } catch {
    return null;
  }
}

function killChrome() {
  const pid = findChromePid();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
      // Wait for it to die
      for (let i = 0; i < 20; i++) {
        try { process.kill(pid, 0); } catch { return true; }
        execSync('sleep 0.2');
      }
      process.kill(pid, 'SIGKILL');
    } catch { /* already dead */ }
  }
  return true;
}

function startChrome(headless = true) {
  mkdirSync(PROFILE_DIR, { recursive: true });

  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
  ];

  if (headless) {
    args.push('--headless=new');
  }

  const child = spawn(CHROME_PATH, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  logCdpOp('chrome-start', { headless, pid: child.pid });
  return child.pid;
}

async function ensureChrome() {
  if (await cdpAvailable()) return true;

  // Chrome not running — start headless
  console.error('[auto-starting Chrome headless...]');
  startChrome(true);

  // Wait for CDP to become available
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await cdpAvailable()) return true;
  }

  console.error('Failed to start Chrome. Is Google Chrome installed?');
  process.exit(1);
}

// ─── CDP HTTP API ────────────────────────────────────────────────────────────

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

// ─── CDP WebSocket ───────────────────────────────────────────────────────────

function cdpCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e8);
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), TIMEOUT);

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

async function connectToTarget(targetOrId) {
  let target = targetOrId;
  if (typeof targetOrId === 'string') {
    const targets = await listTargets();
    target = targets.find(t => t.id === targetOrId || t.id.startsWith(targetOrId));
    if (!target) throw new Error(`Tab not found: ${targetOrId}`);
  }
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('No WebSocket URL for this tab');
  const ws = await connectWs(wsUrl);
  await cdpCommand(ws, 'Runtime.enable');
  return { ws, target };
}

// ─── Content Extraction ──────────────────────────────────────────────────────

async function extractPageContent(ws) {
  const titleResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: 'document.title', returnByValue: true,
  });
  const title = titleResult.result?.value || '';

  const urlResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: 'window.location.href', returnByValue: true,
  });
  const pageUrl = urlResult.result?.value || '';

  const textResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script, style, nav, footer, header, aside, [role="navigation"], [role="banner"]')
          .forEach(el => el.remove());
        return clone.innerText.replace(/\\n{3,}/g, '\\n\\n').trim();
      })()
    `,
    returnByValue: true,
  });
  const text = textResult.result?.value || '';

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

function formatContent(content, offset = 0, maxLen = MAX_CONTENT, { compact = false } = {}) {
  let output = `Title: ${content.title}\nURL: ${content.url}\n`;

  if (content.text) {
    const text = content.text;
    const slice = text.slice(offset, offset + maxLen);
    output += '\n--- Content ---\n' + slice;
    if (offset + maxLen < text.length) {
      const remaining = text.length - offset - maxLen;
      output += `\n\n[... truncated, ${remaining} more chars. Use --offset ${offset + maxLen} to continue]`;
    }
  }

  // --compact: skip links section (saves ~2000 chars for perception use)
  if (!compact && offset === 0 && content.links.length > 0) {
    output += '\n\n--- Links ---\n';
    for (const link of content.links) {
      output += `  ${link.text}: ${link.href}\n`;
    }
  }

  return output;
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdStatus() {
  const available = await cdpAvailable();
  if (!available) {
    console.log('Chrome CDP: NOT RUNNING');
    console.log('');
    console.log('Auto-start: any command will start Chrome headless automatically.');
    console.log(`Profile: ${PROFILE_DIR}`);
    return;
  }

  const version = await fetch(`${CDP_BASE}/json/version`, { signal: AbortSignal.timeout(3000) }).then(r => r.json());
  const targets = await listTargets();
  const pages = targets.filter(t => t.type === 'page');
  const isHeadless = (version.Browser || '').toLowerCase().includes('headless');

  console.log(`Chrome CDP: AVAILABLE (${CDP_BASE})`);
  console.log(`Browser: ${version.Browser}`);
  console.log(`Mode: ${isHeadless ? 'headless (background)' : 'visible'}`);
  console.log(`Profile: ${PROFILE_DIR}`);
  console.log(`Open tabs: ${pages.length}`);
  console.log('');

  for (const page of pages.slice(0, 10)) {
    console.log(`  [${page.id.slice(0, 8)}] ${(page.title || 'Untitled').slice(0, 60)}`);
    console.log(`           ${(page.url || '').slice(0, 80)}`);
  }
  if (pages.length > 10) console.log(`  ... and ${pages.length - 10} more`);
}

async function cmdFetch(url, flags = {}) {
  await ensureChrome();
  logCdpOp('fetch', { url });

  const target = await createTarget(url);
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) { console.error('Failed to get WebSocket URL'); process.exit(1); }

  let ws;
  try {
    ws = await connectWs(wsUrl);
    await cdpCommand(ws, 'Page.enable');
    await cdpCommand(ws, 'Runtime.enable');

    const loadPromise = waitForEvent(ws, 'Page.loadEventFired', TIMEOUT);
    await cdpCommand(ws, 'Page.navigate', { url });
    await loadPromise;
    await new Promise(r => setTimeout(r, 1500));

    const content = await extractPageContent(ws);

    if (detectAuthPage(content)) {
      console.log(`AUTH_REQUIRED: ${url}`);
      console.log(`Title: ${content.title}`);
      console.log('');
      console.log('This page requires login.');
      console.log(`Use: node scripts/cdp-fetch.mjs login "${url}"`);
    } else {
      const maxLen = flags.full ? Infinity : MAX_CONTENT;
      const offset = flags.offset || 0;
      console.log(formatContent(content, offset, maxLen, { compact: !!flags.compact }));
    }

    await closeTarget(target.id);
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdScreenshot(url, outputPath) {
  await ensureChrome();
  logCdpOp('screenshot', { url, output: outputPath });

  const target = await createTarget(url);
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) { console.error('Failed to get WebSocket URL'); process.exit(1); }

  let ws;
  try {
    ws = await connectWs(wsUrl);
    await cdpCommand(ws, 'Page.enable');
    await cdpCommand(ws, 'Runtime.enable');

    const loadPromise = waitForEvent(ws, 'Page.loadEventFired', TIMEOUT);
    await cdpCommand(ws, 'Page.navigate', { url });
    await loadPromise;
    await new Promise(r => setTimeout(r, 2000));

    // Set viewport
    await cdpCommand(ws, 'Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 960, deviceScaleFactor: 2, mobile: false,
    });
    await new Promise(r => setTimeout(r, 500));

    const result = await cdpCommand(ws, 'Page.captureScreenshot', {
      format: 'png', quality: 90,
    });

    const outFile = outputPath || '/tmp/cdp-screenshot.png';
    writeFileSync(outFile, Buffer.from(result.data, 'base64'));
    console.log(`Screenshot saved: ${outFile}`);

    await closeTarget(target.id);
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdOpen(url) {
  await ensureChrome();
  logCdpOp('open', { url });

  const target = await createTarget(url);
  await activateTarget(target.id);

  console.log(`Opened: ${url}`);
  console.log(`Tab ID: ${target.id}`);
  console.log('');
  console.log('After done, use:');
  console.log(`  node scripts/cdp-fetch.mjs extract ${target.id}`);
}

async function cmdExtract(tabId) {
  await ensureChrome();
  const { ws, target } = await connectToTarget(tabId);
  logCdpOp('extract', { tabId, url: target.url, title: target.title });

  try {
    const content = await extractPageContent(ws);
    console.log(formatContent(content));
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdClose(tabId) {
  const targets = await listTargets();
  const target = targets.find(t => t.id === tabId || t.id.startsWith(tabId));
  if (target) {
    logCdpOp('close', { tabId, url: target.url, title: target.title });
    await closeTarget(target.id);
    console.log(`Closed tab: ${target.title || target.id}`);
  } else {
    console.error(`Tab not found: ${tabId}`);
  }
}

async function cmdLogin(url) {
  logCdpOp('login', { url });

  // Kill headless, start visible
  if (await cdpAvailable()) {
    console.log('Stopping headless Chrome...');
    killChrome();
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('Starting visible Chrome for login...');
  startChrome(false);

  // Wait for Chrome
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await cdpAvailable()) break;
  }

  if (!await cdpAvailable()) {
    console.error('Failed to start visible Chrome.');
    process.exit(1);
  }

  if (url) {
    const target = await createTarget(url);
    await activateTarget(target.id);
    console.log(`Opened: ${url}`);
    console.log(`Tab ID: ${target.id}`);
  }

  console.log('');
  console.log('Chrome is now visible. Log in as needed.');
  console.log('When done: node scripts/cdp-fetch.mjs headless');
}

async function cmdHeadless() {
  logCdpOp('headless');

  if (await cdpAvailable()) {
    console.log('Stopping visible Chrome...');
    killChrome();
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('Starting headless Chrome...');
  startChrome(true);

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await cdpAvailable()) break;
  }

  if (await cdpAvailable()) {
    console.log('Chrome is now running headless (background).');
  } else {
    console.error('Failed to start headless Chrome.');
    process.exit(1);
  }
}

async function cmdEval(tabId, expression) {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('eval', { tabId, expression: expression.slice(0, 100) });

  try {
    const result = await cdpCommand(ws, 'Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (result.exceptionDetails) {
      console.error('Error:', result.exceptionDetails.text || result.exceptionDetails.exception?.description);
    } else {
      const val = result.result?.value;
      console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
    }
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdClick(tabId, selector) {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('click', { tabId, selector });

  try {
    const result = await cdpCommand(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return 'NOT_FOUND: ' + ${JSON.stringify(selector)};
          el.click();
          return 'Clicked: ' + (el.textContent || '').trim().slice(0, 50);
        })()
      `,
      returnByValue: true,
    });
    console.log(result.result?.value);
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdType(tabId, selector, text) {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('type', { tabId, selector, text: text.slice(0, 30) });

  try {
    // Focus the element
    await cdpCommand(ws, 'Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`,
    });

    // Type character by character via Input.dispatchKeyEvent
    for (const char of text) {
      await cdpCommand(ws, 'Input.dispatchKeyEvent', {
        type: 'keyDown', text: char,
      });
      await cdpCommand(ws, 'Input.dispatchKeyEvent', {
        type: 'keyUp', text: char,
      });
    }
    console.log(`Typed ${text.length} chars into ${selector}`);
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdScroll(tabId, direction = 'down') {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('scroll', { tabId, direction });

  try {
    const pixels = direction === 'up' ? -600 : direction === 'down' ? 600 : parseInt(direction) || 600;
    await cdpCommand(ws, 'Runtime.evaluate', {
      expression: `window.scrollBy(0, ${pixels})`,
    });
    console.log(`Scrolled ${pixels}px`);
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

// Parse flags
const flags = {};
const positional = [];
for (const arg of args) {
  if (arg === '--full') flags.full = true;
  else if (arg === '--compact') flags.compact = true;
  else if (arg.startsWith('--offset')) { /* handled next */ }
  else if (args[args.indexOf(arg) - 1] === '--offset') flags.offset = parseInt(arg);
  else positional.push(arg);
}
// Handle --offset=N format
for (const arg of args) {
  const m = arg.match(/^--offset[= ](\d+)$/);
  if (m) flags.offset = parseInt(m[1]);
}

try {
  switch (cmd) {
    case 'status':
      await cmdStatus();
      break;
    case 'fetch':
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs fetch <url> [--full|--offset N]'); process.exit(1); }
      await cmdFetch(positional[0], flags);
      break;
    case 'screenshot':
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs screenshot <url> [output.png]'); process.exit(1); }
      await cmdScreenshot(positional[0], positional[1]);
      break;
    case 'open':
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs open <url>'); process.exit(1); }
      await cmdOpen(positional[0]);
      break;
    case 'extract':
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs extract <tabId>'); process.exit(1); }
      await cmdExtract(positional[0]);
      break;
    case 'close':
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs close <tabId>'); process.exit(1); }
      await cmdClose(positional[0]);
      break;
    case 'login':
      await cmdLogin(positional[0]);
      break;
    case 'headless':
      await cmdHeadless();
      break;
    case 'eval':
      if (!positional[0] || !positional[1]) { console.error('Usage: cdp-fetch.mjs eval <tabId> <js>'); process.exit(1); }
      await cmdEval(positional[0], positional.slice(1).join(' '));
      break;
    case 'click':
      if (!positional[0] || !positional[1]) { console.error('Usage: cdp-fetch.mjs click <tabId> <selector>'); process.exit(1); }
      await cmdClick(positional[0], positional[1]);
      break;
    case 'type':
      if (positional.length < 3) { console.error('Usage: cdp-fetch.mjs type <tabId> <selector> <text>'); process.exit(1); }
      await cmdType(positional[0], positional[1], positional.slice(2).join(' '));
      break;
    case 'scroll':
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs scroll <tabId> [down|up|N]'); process.exit(1); }
      await cmdScroll(positional[0], positional[1]);
      break;
    default:
      console.log('cdp-fetch — Chrome browser tool (CDP, zero dependencies)');
      console.log('');
      console.log('Content:');
      console.log('  fetch <url> [--full|--offset N]   Fetch page content');
      console.log('  screenshot <url> [output.png]     Screenshot a page');
      console.log('  open <url>                        Open visible tab');
      console.log('  extract <tabId>                   Extract content from tab');
      console.log('  close <tabId>                     Close a tab');
      console.log('');
      console.log('Chrome management:');
      console.log('  status                            Chrome status + open tabs');
      console.log('  login [url]                       Switch to visible for login');
      console.log('  headless                          Switch back to headless');
      console.log('');
      console.log('Interact:');
      console.log('  eval <tabId> <js>                 Run JavaScript in tab');
      console.log('  click <tabId> <selector>          Click element');
      console.log('  type <tabId> <selector> <text>    Type into element');
      console.log('  scroll <tabId> [down|up|N]        Scroll page');
      console.log('');
      console.log('Chrome auto-starts headless on first use. Profile persists logins.');
      console.log(`Profile: ${PROFILE_DIR}`);
      console.log('');
      console.log('Environment:');
      console.log('  CDP_PORT=9222          Chrome debugging port');
      console.log('  CDP_TIMEOUT=15000      Command timeout (ms)');
      console.log('  CDP_MAX_CONTENT=8000   Max content chars');
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
