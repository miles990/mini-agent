#!/usr/bin/env node
/**
 * Chrome DevTools Protocol (CDP) Browser Tool — Zero Dependencies
 *
 * Complete browser automation with semantic understanding (a11y tree),
 * self-healing element resolution, and action verification.
 * Auto-manages Chrome lifecycle (headless by default, visible for login).
 *
 * Usage:
 *   node cdp-fetch.mjs status                           # Chrome status + open tabs
 *   node cdp-fetch.mjs fetch <url> [--full|--offset N]  # Fetch page content
 *   node cdp-fetch.mjs screenshot <url> [output.png]    # Screenshot a page
 *   node cdp-fetch.mjs open <url>                       # Open visible tab
 *   node cdp-fetch.mjs extract [tabId]                  # Extract content from tab
 *   node cdp-fetch.mjs close <tabId>                    # Close a tab
 *   node cdp-fetch.mjs login <url>                      # Switch to visible for login
 *   node cdp-fetch.mjs headless                         # Switch back to headless
 *   node cdp-fetch.mjs eval <tabId> <js>                # Run JavaScript in tab
 *   node cdp-fetch.mjs click <tabId> <selector>         # Click (self-healing + verify)
 *   node cdp-fetch.mjs type <tabId> <selector> <text>   # Type (self-healing + verify)
 *   node cdp-fetch.mjs scroll <tabId> [down|up|N] [--until "text"]  # Smart scroll
 *   node cdp-fetch.mjs inspect <tabId>                  # Semantic page analysis (a11y tree)
 *   node cdp-fetch.mjs interact fill-form <tabId> <json>   # Auto-fill form
 *   node cdp-fetch.mjs interact handle-dialog <tabId>      # Handle JS dialog
 *   node cdp-fetch.mjs interact upload <tabId> <sel> <file> # Upload file
 *   node cdp-fetch.mjs interact download <url> [dir]        # Download via CDP
 *   node cdp-fetch.mjs watch <tabId> [--interval 30]    # Monitor page changes
 *   node cdp-fetch.mjs network <tabId>                  # Intercept XHR/Fetch
 */

import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
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
    // Auto-extract domain for site memory
    if (detail.url && !detail.domain) {
      try { detail.domain = new URL(detail.url).hostname; } catch {}
    }
    const entry = JSON.stringify({ ts: new Date().toISOString(), op, ...detail });
    appendFileSync(CDP_LOG_FILE, entry + '\n');
  } catch { /* logging should never break operations */ }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── PageState (In-Memory Page Model) ───────────────────────────────────────
// Shadow DOM — in-memory page state cache, avoids unnecessary CDP round-trips.
// Write operations invalidate, read operations use cache.

const pageStateCache = new Map(); // tabId → PageState

class PageState {
  constructor(tabId) {
    this.tabId = tabId;
    this.axNodes = null;       // a11y tree nodes
    this.meta = null;          // { url, title, bodyLen }
    this.interactable = null;  // parsed interactable elements
    this.pageType = null;      // login/form/article/dashboard/search/error/unknown
    this.pageMode = null;      // static/spa/streaming
    this.ts = 0;               // last refresh time
    this.valid = false;        // invalidation flag
  }

  isStale() {
    return !this.valid || (Date.now() - this.ts > 30_000); // 30s max age
  }

  invalidate() { this.valid = false; }

  async ensureFresh(ws) {
    if (!this.isStale()) return;

    const [axResult, metaResult] = await Promise.all([
      cdpCommand(ws, 'Accessibility.getFullAXTree', {}),
      cdpCommand(ws, 'Runtime.evaluate', {
        expression: `JSON.stringify({url:location.href,title:document.title,bodyLen:document.body?.innerHTML.length||0})`,
        returnByValue: true,
      }),
    ]);

    this.axNodes = axResult.nodes || [];
    this.meta = JSON.parse(metaResult.result?.value || '{}');
    this.interactable = extractInteractable(this.axNodes);
    const classification = classifyPage(this.axNodes, this.meta);
    this.pageType = classification.type;
    this.pageMode = classification.mode;
    this.ts = Date.now();
    this.valid = true;
  }

  // ── Pure memory operations (0ms, zero CDP calls) ──

  findByRole(role, nameHint) {
    return this.axNodes?.find(n =>
      n.role?.value === role &&
      n.name?.value?.toLowerCase().includes(nameHint.toLowerCase())
    );
  }

  findByName(nameHint) {
    const interactableRoles = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'menuitem', 'tab', 'radio'];
    const hint = nameHint.toLowerCase();
    return this.axNodes?.find(n =>
      interactableRoles.includes(n.role?.value) &&
      n.name?.value?.toLowerCase().includes(hint)
    );
  }

  getForms() { return extractForms(this.axNodes); }
  getState() { return detectPageState(this.axNodes, this.meta); }
  getSummary() {
    return {
      url: this.meta?.url, title: this.meta?.title,
      pageType: this.pageType, pageMode: this.pageMode,
      interactable: this.interactable,
      forms: this.getForms(),
      state: this.getState(),
      nodeCount: this.axNodes?.length || 0,
      cacheAge: Date.now() - this.ts,
    };
  }
}

function getPageState(tabId) {
  if (!pageStateCache.has(tabId)) pageStateCache.set(tabId, new PageState(tabId));
  return pageStateCache.get(tabId);
}

function extractInteractable(nodes) {
  const roles = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'menuitem', 'tab', 'radio', 'searchbox', 'slider'];
  const cap = (nodes?.length || 0) > 5000 ? 100 : 50; // dynamic cap: giant pages get 100
  const result = [];
  for (const n of (nodes || [])) {
    if (result.length >= cap) break;
    if (roles.includes(n.role?.value) && n.name?.value) {
      result.push({
        role: n.role.value,
        name: n.name.value.slice(0, 80),
        nodeId: n.nodeId,
        backendDOMNodeId: n.backendDOMNodeId,
        ...(n.value?.value != null ? { value: String(n.value.value).slice(0, 40) } : {}),
      });
    }
  }
  return result;
}

function classifyPage(nodes, meta) {
  const names = (nodes || []).map(n => (n.name?.value || '').toLowerCase()).join(' ');
  const roles = (nodes || []).map(n => n.role?.value || '');
  const url = (meta?.url || '').toLowerCase();
  const bodyLen = meta?.bodyLen || 0;

  // Error pages
  if (url.includes('404') || url.includes('error') || names.includes('page not found') || names.includes('not found'))
    return { type: 'error', mode: 'static' };
  if (bodyLen === 0 && (meta?.title || '').match(/5\d\d|error|timeout/i))
    return { type: 'error', mode: 'static' };

  // Page type
  let type = 'unknown';
  const hasPassword = roles.includes('textbox') && names.match(/password|密碼/);
  const hasLogin = names.match(/log\s?in|sign\s?in|登入|登錄/);
  if (hasPassword || hasLogin) type = 'login';
  else if (roles.filter(r => r === 'textbox' || r === 'combobox').length >= 2) type = 'form';
  else if (roles.filter(r => r === 'searchbox' || (r === 'textbox' && names.includes('search'))).length > 0) type = 'search';
  else if (names.match(/dashboard|儀表板|overview/)) type = 'dashboard';
  else if (bodyLen > 2000 && roles.filter(r => r === 'heading').length >= 2) type = 'article';

  // Page mode: static / spa / streaming
  let mode = 'static';
  if (names.match(/react|next|angular|vue|__next|__nuxt/) || url.match(/#\/|\/app\/|\/dashboard/)) mode = 'spa';

  return { type, mode };
}

function extractForms(nodes) {
  const forms = [];
  const fieldRoles = ['textbox', 'combobox', 'checkbox', 'radio', 'searchbox', 'slider'];
  const fields = (nodes || []).filter(n => fieldRoles.includes(n.role?.value) && n.name?.value);
  if (fields.length === 0) return forms;

  // Group fields as a single form (a11y tree doesn't always have explicit form groups)
  const formFields = fields.map(n => ({
    role: n.role.value,
    name: n.name.value.slice(0, 60),
    nodeId: n.nodeId,
    backendDOMNodeId: n.backendDOMNodeId,
    ...(n.value?.value != null ? { value: String(n.value.value).slice(0, 40) } : {}),
  }));

  // Find nearby submit button
  const submitBtn = (nodes || []).find(n =>
    n.role?.value === 'button' &&
    (n.name?.value || '').toLowerCase().match(/submit|send|login|sign|確認|送出|登入/)
  );

  forms.push({
    fields: formFields,
    ...(submitBtn ? { submitButton: { name: submitBtn.name.value, nodeId: submitBtn.nodeId, backendDOMNodeId: submitBtn.backendDOMNodeId } } : {}),
  });

  return forms;
}

function detectPageState(nodes, meta) {
  const names = (nodes || []).map(n => (n.name?.value || '').toLowerCase()).join(' ');
  const bodyLen = meta?.bodyLen || 0;

  // Readable text estimation (nodes with text role and long names)
  const readableTextLen = (nodes || [])
    .filter(n => n.role?.value === 'StaticText' || n.role?.value === 'paragraph' || n.role?.value === 'heading')
    .reduce((sum, n) => sum + (n.name?.value?.length || 0), 0);

  return {
    loggedIn: !!(names.match(/log\s?out|sign\s?out|登出|profile|avatar|my account/)),
    hasPaywall: !!(names.match(/subscribe|paywall|premium|unlock|付費/)),
    isLoading: !!(names.match(/loading|spinner|載入中/) && bodyLen < 500),
    hasCookieConsent: !!(names.match(/cookie|consent|accept all|accept cookies|同意/)),
    hasMainContent: bodyLen > 500 && readableTextLen > 200,
    readableTextLen,
  };
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
  if (!wsUrl) {
    await closeTarget(target.id).catch(() => {});
    console.error('Failed to get WebSocket URL');
    process.exit(1);
  }

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
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
    await closeTarget(target.id).catch(() => {});
  }
}

async function cmdScreenshot(url, outputPath) {
  await ensureChrome();
  logCdpOp('screenshot', { url, output: outputPath });

  const target = await createTarget(url);
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) {
    await closeTarget(target.id).catch(() => {});
    console.error('Failed to get WebSocket URL');
    process.exit(1);
  }

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
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
    await closeTarget(target.id).catch(() => {});
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
    const before = await snapshotState(ws);
    const resolved = await resolveElement(ws, tabId, selector);

    if (!resolved) {
      console.log(`NOT_FOUND: ${selector}`);
      logCdpOp('click-failed', { tabId, selector, domain: extractDomain(before.url) });
      return;
    }

    // Execute click
    if (resolved.strategy === 'a11y' && resolved.objectId) {
      await clickByObjectId(ws, resolved.objectId);
    } else {
      await clickByStrategy(ws, selector, resolved.strategy);
    }

    // Invalidate PageState + verify
    getPageState(tabId).invalidate();
    const domain = extractDomain(before.url);
    const changes = await verifyAction(ws, before, 'click', domain);
    const healTag = resolved.strategy !== 'original' ? ` (healed: ${resolved.strategy})` : '';
    const verifyTag = changes.length > 0 ? ` ✓ (${changes.join(', ')})` : ' ⚠ no visible change';
    console.log(`Clicked: ${resolved.text}${healTag}${verifyTag}`);
    logCdpOp('click-result', { tabId, selector, strategy: resolved.strategy, verified: changes.length > 0, domain });
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdType(tabId, selector, text) {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('type', { tabId, selector, text: text.slice(0, 30) });

  try {
    const before = await snapshotState(ws);
    const resolved = await resolveElement(ws, tabId, selector);

    if (!resolved) {
      console.log(`NOT_FOUND: ${selector}`);
      logCdpOp('type-failed', { tabId, selector, domain: extractDomain(before.url) });
      return;
    }

    // Focus the element
    if (resolved.strategy === 'a11y' && resolved.objectId) {
      await focusByObjectId(ws, resolved.objectId);
    } else {
      await focusByStrategy(ws, selector, resolved.strategy);
    }

    // Type character by character via Input.dispatchKeyEvent
    for (const char of text) {
      await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char });
      await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', text: char });
    }

    // Invalidate + verify
    getPageState(tabId).invalidate();
    const domain = extractDomain(before.url);
    const changes = await verifyAction(ws, before, 'type', domain);
    const healTag = resolved.strategy !== 'original' ? ` (healed: ${resolved.strategy})` : '';
    console.log(`Typed ${text.length} chars into ${resolved.text}${healTag}`);
    logCdpOp('type-result', { tabId, selector, strategy: resolved.strategy, domain });
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdScroll(tabId, direction = 'down', untilText = null) {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('scroll', { tabId, direction, until: untilText });

  try {
    const pixels = direction === 'up' ? -600 : direction === 'down' ? 600 : parseInt(direction) || 600;

    if (untilText) {
      // Smart scroll: scroll until target text found or content stops changing
      let lastLen = 0;
      let stableCount = 0;
      for (let i = 0; i < 20; i++) {
        await cdpCommand(ws, 'Runtime.evaluate', { expression: `window.scrollBy(0, ${Math.abs(pixels)})` });
        await sleep(500);
        const check = await cdpCommand(ws, 'Runtime.evaluate', {
          expression: `JSON.stringify({ found: document.body.innerText.includes(${JSON.stringify(untilText)}), len: document.body.innerHTML.length })`,
          returnByValue: true,
        });
        const { found, len } = JSON.parse(check.result?.value || '{}');
        if (found) { console.log(`Found "${untilText}" after ${i + 1} scrolls`); return; }
        if (len === lastLen) stableCount++; else { stableCount = 0; lastLen = len; }
        if (stableCount >= 3) { console.log(`Content stopped changing after ${i + 1} scrolls. "${untilText}" not found.`); return; }
      }
      console.log(`Reached max scrolls (20). "${untilText}" not found.`);
    } else {
      await cdpCommand(ws, 'Runtime.evaluate', { expression: `window.scrollBy(0, ${pixels})` });
      console.log(`Scrolled ${pixels}px`);
    }
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

// ─── Snapshot & Verify ──────────────────────────────────────────────────────

function extractDomain(url) {
  if (!url) return undefined;
  try { return new URL(url).hostname; } catch { return undefined; }
}

async function snapshotState(ws) {
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({ url: location.href, title: document.title, bodyLen: document.body?.innerHTML.length || 0 })`,
    returnByValue: true,
  });
  return JSON.parse(result.result?.value || '{}');
}

// SPA-aware verify: wait for DOM to settle, not just a fixed sleep
async function verifyAction(ws, before, action, domain) {
  let after, lastLen = before.bodyLen, stableCount = 0;
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    after = await snapshotState(ws);
    if (after.bodyLen === lastLen) stableCount++;
    else { stableCount = 0; lastLen = after.bodyLen; }
    if (stableCount >= 2 || after.url !== before.url) break;
  }
  after = after || await snapshotState(ws);
  const changes = [];
  if (after.url !== before.url) changes.push(`navigated: ${after.url}`);
  if (after.title !== before.title) changes.push(`title: ${after.title}`);
  if (Math.abs(after.bodyLen - before.bodyLen) > 100) changes.push('dom-changed');
  logCdpOp(changes.length ? 'verify-ok' : 'verify-no-change', { action, changes, domain });
  return changes;
}

// ─── Site Memory (Adaptive Strategy Selection) ──────────────────────────────

function getPreferredStrategies(domain) {
  if (!domain) return ['original', 'a11y', 'aria-label', 'text-match', 'testid'];
  try {
    const data = readFileSync(CDP_LOG_FILE, 'utf-8');
    const lines = data.trim().split('\n').slice(-200); // last 200 entries
    const stats = {}; // strategy → { ok: 0, fail: 0 }
    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        if (d.domain !== domain) continue;
        if (d.op === 'click-result' || d.op === 'type-result') {
          const s = d.strategy || 'original';
          if (!stats[s]) stats[s] = { ok: 0, fail: 0 };
          stats[s].ok++;
        } else if (d.op === 'click-failed' || d.op === 'type-failed') {
          if (!stats['original']) stats['original'] = { ok: 0, fail: 0 };
          stats['original'].fail++;
        }
      } catch { /* skip bad lines */ }
    }
    // Sort by success rate, then by total count
    const sorted = Object.entries(stats)
      .map(([s, c]) => ({ s, rate: c.ok / (c.ok + c.fail + 1), total: c.ok + c.fail }))
      .sort((a, b) => b.rate - a.rate || b.total - a.total)
      .map(x => x.s);
    // Fill in missing strategies
    const allStrategies = ['original', 'a11y', 'aria-label', 'text-match', 'testid'];
    const result = [...sorted, ...allStrategies.filter(s => !sorted.includes(s))];
    return result;
  } catch {
    return ['original', 'a11y', 'aria-label', 'text-match', 'testid'];
  }
}

// ─── Resolve Element (Multi-Strategy Self-Healing) ──────────────────────────

async function resolveElement(ws, tabId, selector) {
  // Strategy 1: Original CSS selector
  const cssResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      return { text: (el.textContent || '').trim().slice(0, 50), tag: el.tagName };
    })()`,
    returnByValue: true,
  });
  if (cssResult.result?.value) {
    return { strategy: 'original', text: cssResult.result.value.text };
  }

  // Strategy 2: a11y name match (0ms memory search)
  const state = getPageState(tabId);
  await state.ensureFresh(ws);
  const axMatch = state.findByName(selector);
  if (axMatch?.backendDOMNodeId) {
    // Resolve a11y node to DOM node for interaction
    try {
      const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: axMatch.backendDOMNodeId });
      if (resolved.object?.objectId) {
        return { strategy: 'a11y', objectId: resolved.object.objectId, text: axMatch.name?.value || selector, axNode: axMatch };
      }
    } catch { /* DOM.resolveNode can fail for detached nodes */ }
  }

  // Strategy 3: CSS fallback (aria-label, text content, data-testid)
  const fallbackResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const sel = ${JSON.stringify(selector)};
      const lower = sel.toLowerCase();
      // Try aria-label
      let el = document.querySelector('[aria-label*="' + sel.replace(/"/g, '\\\\"') + '"]');
      if (el) return { text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 50), tag: el.tagName, method: 'aria-label' };
      // Try text content match
      const all = document.querySelectorAll('button, a, input, [role="button"], [role="link"]');
      for (const e of all) {
        if ((e.textContent || '').toLowerCase().includes(lower) || (e.getAttribute('aria-label') || '').toLowerCase().includes(lower)) {
          return { text: (e.textContent || '').trim().slice(0, 50), tag: e.tagName, method: 'text-match' };
        }
      }
      // Try data-testid
      el = document.querySelector('[data-testid*="' + sel.replace(/"/g, '\\\\"') + '"]');
      if (el) return { text: (el.textContent || '').trim().slice(0, 50), tag: el.tagName, method: 'testid' };
      return null;
    })()`,
    returnByValue: true,
  });
  if (fallbackResult.result?.value) {
    const fb = fallbackResult.result.value;
    return { strategy: fb.method, text: fb.text };
  }

  return null; // Not found by any strategy
}

// Execute click via objectId (for a11y-resolved elements)
async function clickByObjectId(ws, objectId) {
  await cdpCommand(ws, 'Runtime.callFunctionOn', {
    objectId, functionDeclaration: 'function() { this.click(); }',
  });
}

// Execute click via selector or fallback strategy
async function clickByStrategy(ws, selector, strategy) {
  if (strategy === 'a11y') return; // handled by clickByObjectId
  // For original/aria-label/text-match/testid — re-query and click
  const strat = strategy === 'original' ? JSON.stringify(selector) : null;
  const expression = strategy === 'original'
    ? `document.querySelector(${JSON.stringify(selector)})?.click()`
    : `(() => {
        const sel = ${JSON.stringify(selector)};
        const lower = sel.toLowerCase();
        ${strategy === 'aria-label' ? `const el = document.querySelector('[aria-label*="' + sel.replace(/"/g, '\\\\"') + '"]'); if (el) { el.click(); return true; }` : ''}
        ${strategy === 'text-match' ? `const all = document.querySelectorAll('button, a, input, [role="button"], [role="link"]'); for (const e of all) { if ((e.textContent || '').toLowerCase().includes(lower) || (e.getAttribute('aria-label') || '').toLowerCase().includes(lower)) { e.click(); return true; } }` : ''}
        ${strategy === 'testid' ? `const el = document.querySelector('[data-testid*="' + sel.replace(/"/g, '\\\\"') + '"]'); if (el) { el.click(); return true; }` : ''}
        return false;
      })()`;
  await cdpCommand(ws, 'Runtime.evaluate', { expression });
}

// Focus element by strategy (for type command)
async function focusByObjectId(ws, objectId) {
  await cdpCommand(ws, 'Runtime.callFunctionOn', {
    objectId, functionDeclaration: 'function() { this.focus(); }',
  });
}

async function focusByStrategy(ws, selector, strategy) {
  if (strategy === 'a11y') return; // handled by focusByObjectId
  const expression = strategy === 'original'
    ? `document.querySelector(${JSON.stringify(selector)})?.focus()`
    : `(() => {
        const sel = ${JSON.stringify(selector)};
        const lower = sel.toLowerCase();
        ${strategy === 'aria-label' ? `const el = document.querySelector('[aria-label*="' + sel.replace(/"/g, '\\\\"') + '"]'); if (el) el.focus();` : ''}
        ${strategy === 'text-match' ? `const all = document.querySelectorAll('input, textarea, [contenteditable], [role="textbox"]'); for (const e of all) { if ((e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').toLowerCase().includes(lower)) { e.focus(); break; } }` : ''}
        ${strategy === 'testid' ? `const el = document.querySelector('[data-testid*="' + sel.replace(/"/g, '\\\\"') + '"]'); if (el) el.focus();` : ''}
      })()`;
  await cdpCommand(ws, 'Runtime.evaluate', { expression });
}

async function cmdInspect(tabId) {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('inspect', { tabId });

  try {
    const state = getPageState(tabId);
    await state.ensureFresh(ws);
    const summary = state.getSummary();
    console.log(JSON.stringify(summary, null, 2));
    logCdpOp('inspect-result', {
      tabId, url: state.meta?.url, pageType: state.pageType,
      pageMode: state.pageMode,
      interactableCount: state.interactable?.length || 0,
      domain: state.meta?.url ? (() => { try { return new URL(state.meta.url).hostname; } catch { return undefined; } })() : undefined,
    });
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdInteract(subCmd, tabId, argsExtra) {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('interact', { tabId, subCmd });

  try {
    switch (subCmd) {
      case 'fill-form': {
        let formData;
        try { formData = JSON.parse(argsExtra[0]); } catch { console.error('Invalid JSON. Usage: interact fill-form <tabId> \'{"field":"value"}\''); return; }

        const state = getPageState(tabId);
        await state.ensureFresh(ws);
        const forms = state.getForms();
        let filled = 0;

        for (const [fieldName, value] of Object.entries(formData)) {
          // Find matching field in form
          const field = forms[0]?.fields?.find(f => f.name.toLowerCase().includes(fieldName.toLowerCase()));
          if (field?.backendDOMNodeId) {
            try {
              const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: field.backendDOMNodeId });
              if (resolved.object?.objectId) {
                await cdpCommand(ws, 'Runtime.callFunctionOn', {
                  objectId: resolved.object.objectId,
                  functionDeclaration: 'function() { this.focus(); }',
                });
                for (const char of String(value)) {
                  await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char });
                  await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', text: char });
                }
                filled++;
              }
            } catch { /* skip unresolvable fields */ }
          } else {
            // Fallback: try resolveElement
            const resolved = await resolveElement(ws, tabId, fieldName);
            if (resolved) {
              if (resolved.strategy === 'a11y' && resolved.objectId) {
                await focusByObjectId(ws, resolved.objectId);
              } else {
                await focusByStrategy(ws, fieldName, resolved.strategy);
              }
              for (const char of String(value)) {
                await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char });
                await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', text: char });
              }
              filled++;
            }
          }
        }

        state.invalidate();

        // Try to find and click submit button
        if (forms[0]?.submitButton?.backendDOMNodeId) {
          const before = await snapshotState(ws);
          try {
            const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: forms[0].submitButton.backendDOMNodeId });
            if (resolved.object?.objectId) {
              await clickByObjectId(ws, resolved.object.objectId);
              state.invalidate();
              const changes = await verifyAction(ws, before, 'fill-form-submit', extractDomain(before.url));
              const verifyTag = changes.length > 0 ? ` ✓ (${changes.join(', ')})` : '';
              console.log(`Filled ${filled} field(s), submitted${verifyTag}`);
            }
          } catch {
            console.log(`Filled ${filled} field(s), submit button not clickable`);
          }
        } else {
          console.log(`Filled ${filled} field(s), no submit button found`);
        }
        break;
      }
      case 'handle-dialog': {
        const action = argsExtra[0] || 'accept';
        const shouldAccept = action !== 'dismiss';
        await cdpCommand(ws, 'Page.enable', {});
        // Register handler for dialogs
        const dialogPromise = new Promise((resolve) => {
          const handler = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.method === 'Page.javascriptDialogOpening') {
              ws.removeEventListener('message', handler);
              cdpCommand(ws, 'Page.handleJavaScriptDialog', { accept: shouldAccept })
                .then(() => resolve(msg.params))
                .catch(() => resolve(msg.params));
            }
          };
          ws.addEventListener('message', handler);
          // Timeout after 10s
          setTimeout(() => { ws.removeEventListener('message', handler); resolve(null); }, 10_000);
        });
        console.log(`Waiting for dialog (will ${shouldAccept ? 'accept' : 'dismiss'})...`);
        const result = await dialogPromise;
        if (result) {
          console.log(`Dialog handled: "${result.message?.slice(0, 100)}" → ${shouldAccept ? 'accepted' : 'dismissed'}`);
        } else {
          console.log('No dialog appeared within 10s');
        }
        break;
      }
      case 'upload': {
        const inputSelector = argsExtra[0];
        const filePath = argsExtra[1];
        if (!inputSelector || !filePath) { console.error('Usage: interact upload <tabId> <selector> <filepath>'); return; }
        // Find the file input node
        const nodeResult = await cdpCommand(ws, 'Runtime.evaluate', {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(inputSelector)});
            return el ? true : false;
          })()`,
          returnByValue: true,
        });
        if (!nodeResult.result?.value) { console.log(`NOT_FOUND: ${inputSelector}`); return; }
        // Get DOM node ID
        const doc = await cdpCommand(ws, 'DOM.getDocument', {});
        const found = await cdpCommand(ws, 'DOM.querySelector', { nodeId: doc.root.nodeId, selector: inputSelector });
        if (!found.nodeId) { console.log(`Cannot resolve DOM node: ${inputSelector}`); return; }
        await cdpCommand(ws, 'DOM.setFileInputFiles', { files: [filePath], nodeId: found.nodeId });
        console.log(`Uploaded: ${filePath} → ${inputSelector}`);
        getPageState(tabId).invalidate();
        break;
      }
      case 'download': {
        const url = argsExtra[0];
        const outputDir = argsExtra[1] || '/tmp';
        if (!url) { console.error('Usage: interact download <url> [outputDir]'); return; }
        await cdpCommand(ws, 'Browser.setDownloadBehavior', {
          behavior: 'allowAndName', downloadPath: outputDir,
        });
        await cdpCommand(ws, 'Page.navigate', { url });
        console.log(`Download initiated: ${url} → ${outputDir}`);
        break;
      }
      default:
        console.error(`Unknown interact sub-command: ${subCmd}`);
        console.error('Available: fill-form, handle-dialog, upload, download');
    }
  } finally {
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdWatch(tabId, intervalSec = 30) {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('watch', { tabId, interval: intervalSec });

  let lastHash = null;
  let changeCount = 0;

  const tick = async () => {
    try {
      const state = await snapshotState(ws);
      const hash = `${state.bodyLen}|${state.title}`;
      if (lastHash && hash !== lastHash) {
        changeCount++;
        const domain = extractDomain(state.url);
        console.log(`[${new Date().toISOString()}] CHANGED (#${changeCount}): ${state.title} (bodyLen: ${state.bodyLen})`);
        logCdpOp('watch-change', { tabId, url: state.url, domain, changeCount });
        getPageState(tabId).invalidate();
      } else if (!lastHash) {
        console.log(`[${new Date().toISOString()}] Watching: ${state.title} (interval: ${intervalSec}s)`);
      }
      lastHash = hash;
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Watch error: ${err.message}`);
    }
  };

  await tick(); // Initial check
  const timer = setInterval(tick, intervalSec * 1000);

  // Run indefinitely until process is killed
  process.on('SIGINT', () => { clearInterval(timer); if (ws?.readyState === WebSocket.OPEN) ws.close(); process.exit(0); });
  process.on('SIGTERM', () => { clearInterval(timer); if (ws?.readyState === WebSocket.OPEN) ws.close(); process.exit(0); });
  // Keep alive
  await new Promise(() => {});
}

async function cmdNetwork(tabId) {
  await ensureChrome();
  const { ws } = await connectToTarget(tabId);
  logCdpOp('network', { tabId });

  try {
    await cdpCommand(ws, 'Network.enable', {});
    let count = 0;

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.method === 'Network.requestWillBeSent') {
          const p = msg.params;
          if (p.type === 'XHR' || p.type === 'Fetch') {
            count++;
            const entry = {
              ts: new Date().toISOString(),
              method: p.request.method,
              url: p.request.url.slice(0, 200),
              type: p.type,
            };
            console.log(JSON.stringify(entry));
            logCdpOp('network-request', { ...entry, domain: extractDomain(p.request.url) });
          }
        }
      } catch { /* ignore parse errors */ }
    });

    console.error(`Intercepting XHR/Fetch requests on tab ${tabId}... (Ctrl+C to stop)`);

    process.on('SIGINT', () => { console.error(`\nCaptured ${count} request(s).`); if (ws?.readyState === WebSocket.OPEN) ws.close(); process.exit(0); });
    process.on('SIGTERM', () => { if (ws?.readyState === WebSocket.OPEN) ws.close(); process.exit(0); });
    // Keep alive
    await new Promise(() => {});
  } catch (err) {
    console.error(`Network error: ${err.message}`);
    if (ws?.readyState === WebSocket.OPEN) ws.close();
  }
}

async function cmdCleanup() {
  if (!await cdpAvailable()) {
    console.log('Chrome not running. Nothing to clean up.');
    return;
  }
  const targets = await listTargets();
  const pages = targets.filter(t => t.type === 'page');
  const blanks = pages.filter(t => !t.url || t.url === 'about:blank' || t.url === 'chrome://newtab/');

  if (blanks.length === 0) {
    console.log('No blank tabs to clean up.');
    return;
  }

  for (const tab of blanks) {
    await closeTarget(tab.id).catch(() => {});
  }
  console.log(`Closed ${blanks.length} blank tab(s).`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

// Parse flags
const flags = {};
const positional = [];
const flagsWithValue = new Set(['--offset', '--interval', '--until']);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--full') flags.full = true;
  else if (arg === '--compact') flags.compact = true;
  else if (arg === '--json') flags.json = true;
  else if (flagsWithValue.has(arg) && i + 1 < args.length) { flags[arg.slice(2)] = args[++i]; }
  else if (arg.match(/^--(offset|interval|until)=(.+)$/)) { const m = arg.match(/^--(\w+)=(.+)$/); flags[m[1]] = m[2]; }
  else positional.push(arg);
}
if (flags.offset) flags.offset = parseInt(flags.offset);
if (flags.interval) flags.interval = parseInt(flags.interval);

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
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs scroll <tabId> [down|up|N] [--until "text"]'); process.exit(1); }
      await cmdScroll(positional[0], positional[1], flags.until || null);
      break;
    case 'interact':
      if (!positional[0] || !positional[1]) { console.error('Usage: cdp-fetch.mjs interact <sub-cmd> <tabId> [args...]'); process.exit(1); }
      await cmdInteract(positional[0], positional[1], positional.slice(2));
      break;
    case 'watch':
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs watch <tabId> [--interval 30]'); process.exit(1); }
      await cmdWatch(positional[0], flags.interval || 30);
      break;
    case 'network':
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs network <tabId>'); process.exit(1); }
      await cmdNetwork(positional[0]);
      break;
    case 'inspect':
      if (!positional[0]) { console.error('Usage: cdp-fetch.mjs inspect <tabId>'); process.exit(1); }
      await cmdInspect(positional[0]);
      break;
    case 'cleanup':
      await cmdCleanup();
      break;
    default:
      console.log('cdp-fetch — Chrome browser tool with Web Intelligence (CDP, zero dependencies)');
      console.log('');
      console.log('Content:');
      console.log('  fetch <url> [--full|--offset N]       Fetch page content');
      console.log('  screenshot <url> [output.png]         Screenshot a page');
      console.log('  open <url>                            Open visible tab');
      console.log('  extract <tabId>                       Extract content from tab');
      console.log('  close <tabId>                         Close a tab');
      console.log('');
      console.log('Chrome management:');
      console.log('  status                                Chrome status + open tabs');
      console.log('  cleanup                               Close all blank tabs');
      console.log('  login [url]                           Switch to visible for login');
      console.log('  headless                              Switch back to headless');
      console.log('');
      console.log('Interact (self-healing + verify):');
      console.log('  eval <tabId> <js>                     Run JavaScript in tab');
      console.log('  click <tabId> <selector>              Click element (a11y self-heal)');
      console.log('  type <tabId> <selector> <text>        Type into element (a11y self-heal)');
      console.log('  scroll <tabId> [down|up|N] [--until]  Scroll (smart-scroll with target)');
      console.log('');
      console.log('Intelligence:');
      console.log('  inspect <tabId>                       Semantic page analysis (a11y tree)');
      console.log('  interact fill-form <tabId> <json>     Auto-fill form fields');
      console.log('  interact handle-dialog <tabId>        Handle JS dialogs');
      console.log('  interact upload <tabId> <sel> <file>  Upload file');
      console.log('  interact download <url> [outputDir]   Download via CDP');
      console.log('  watch <tabId> [--interval 30]         Monitor page changes');
      console.log('  network <tabId>                       Intercept XHR/Fetch requests');
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
