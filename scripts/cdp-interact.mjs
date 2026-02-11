#!/usr/bin/env node
/**
 * CDP Interact — Browser Interaction via Chrome DevTools Protocol
 *
 * Zero dependencies. Extends cdp-fetch.mjs with UI interaction capabilities.
 * Requires Chrome running with --remote-debugging-port=9222
 *
 * Commands:
 *   click <tabId> <selector>           Click an element by CSS selector
 *   click-text <tabId> <text>          Click element containing text
 *   type <tabId> <selector> <text>     Type text into an input field
 *   select <tabId> <selector> <value>  Select dropdown option by value
 *   scroll <tabId> [pixels]            Scroll down (default 500px)
 *   eval <tabId> <expression>          Evaluate JS expression in page
 *   screenshot <tabId> [path]          Screenshot specific tab
 *   wait <tabId> <selector> [timeout]  Wait for element to appear
 *   list-inputs <tabId>                List all form inputs on page
 *   fill-form <tabId> <json>           Fill multiple form fields at once
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CDP_HOST = process.env.CDP_HOST || 'localhost';
const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;
const TIMEOUT = parseInt(process.env.CDP_TIMEOUT || '15000');

// ─── Logging ──────────────────────────────────────────────────────────────────

const CDP_LOG_DIR = join(homedir(), '.mini-agent');
const CDP_LOG_FILE = join(CDP_LOG_DIR, 'cdp.jsonl');

function logOp(op, detail = {}) {
  try {
    mkdirSync(CDP_LOG_DIR, { recursive: true });
    const entry = JSON.stringify({ ts: new Date().toISOString(), op: `interact.${op}`, ...detail });
    appendFileSync(CDP_LOG_FILE, entry + '\n');
  } catch { /* logging never breaks operations */ }
}

// ─── CDP Helpers ──────────────────────────────────────────────────────────────

async function listTargets() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  return res.json();
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('WebSocket connect timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

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

async function findTarget(tabId) {
  const targets = await listTargets();
  const target = targets.find(t => t.id === tabId || t.id.startsWith(tabId));
  if (!target) {
    console.error(`Tab not found: ${tabId}`);
    console.log('Available tabs:');
    targets.filter(t => t.type === 'page').forEach(t => {
      console.log(`  [${t.id.slice(0, 8)}] ${(t.title || 'Untitled').slice(0, 50)}`);
      console.log(`           ${(t.url || '').slice(0, 80)}`);
    });
    process.exit(1);
  }
  if (!target.webSocketDebuggerUrl) {
    console.error('No WebSocket URL for this tab');
    process.exit(1);
  }
  return target;
}

async function connectToTab(tabId) {
  const target = await findTarget(tabId);
  const ws = await connectWs(target.webSocketDebuggerUrl);
  await cdpCommand(ws, 'Runtime.enable');
  return { ws, target };
}

// ─── Interaction Helpers ──────────────────────────────────────────────────────

/**
 * Dispatch real mouse/keyboard events via CDP Input domain.
 * This works with React/SPA because it simulates real browser events.
 */
async function getElementCenter(ws, selector) {
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return JSON.stringify({ error: 'Element not found: ${selector.replace(/'/g, "\\'")}' });
        const rect = el.getBoundingClientRect();
        return JSON.stringify({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          tag: el.tagName,
          visible: rect.width > 0 && rect.height > 0,
        });
      })()
    `,
    returnByValue: true,
  });
  const data = JSON.parse(result.result?.value || '{"error":"eval failed"}');
  if (data.error) throw new Error(data.error);
  if (!data.visible) throw new Error(`Element exists but not visible: ${selector}`);
  return data;
}

async function getElementCenterByText(ws, text) {
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const escaped = ${JSON.stringify(text)};
        // Try buttons, links, labels, spans — broad search, prefer exact match + smallest element
        const candidates = document.querySelectorAll('button, a, label, span, input[type="submit"], [role="button"]');
        let exactMatch = null;
        let partialMatch = null;

        for (const el of candidates) {
          const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          const area = rect.width * rect.height;
          if (t === escaped) {
            // Exact match — prefer smallest (most specific) element
            if (!exactMatch || area < exactMatch.area) {
              exactMatch = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName, text: t.slice(0, 80), area };
            }
          } else if (t.includes(escaped) && !exactMatch) {
            if (!partialMatch || area < partialMatch.area) {
              partialMatch = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName, text: t.slice(0, 80), area };
            }
          }
        }

        const match = exactMatch || partialMatch;
        if (match) {
          delete match.area;
          return JSON.stringify(match);
        }
        return JSON.stringify({ error: 'No visible element with text: ' + escaped });
      })()
    `,
    returnByValue: true,
  });
  const data = JSON.parse(result.result?.value || '{"error":"eval failed"}');
  if (data.error) throw new Error(data.error);
  return data;
}

async function dispatchClick(ws, x, y) {
  // Move mouse → press → release (real event sequence)
  await cdpCommand(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y,
  });
  await cdpCommand(ws, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'left', clickCount: 1,
  });
  await cdpCommand(ws, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
  });
}

async function dispatchType(ws, text) {
  // Type character by character for React compatibility
  for (const char of text) {
    await cdpCommand(ws, 'Input.dispatchKeyEvent', {
      type: 'keyDown', text: char,
    });
    await cdpCommand(ws, 'Input.dispatchKeyEvent', {
      type: 'keyUp', text: char,
    });
    // Small delay between chars for SPA state updates
    await new Promise(r => setTimeout(r, 20));
  }
}

async function setInputValue(ws, selector, value) {
  // For React inputs: use native setter to bypass React's synthetic event system,
  // then dispatch input + change events
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return JSON.stringify({ error: 'Element not found' });

        // Focus the element
        el.focus();

        // Use native setter (works with React controlled inputs)
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set;

        if (nativeSetter) {
          nativeSetter.call(el, ${JSON.stringify(value)});
        } else {
          el.value = ${JSON.stringify(value)};
        }

        // Dispatch events React listens to
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        return JSON.stringify({ ok: true, value: el.value.slice(0, 100) });
      })()
    `,
    returnByValue: true,
  });
  const data = JSON.parse(result.result?.value || '{"error":"eval failed"}');
  if (data.error) throw new Error(data.error);
  return data;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdClick(tabId, selector) {
  const { ws } = await connectToTab(tabId);
  try {
    logOp('click', { tabId, selector });
    const pos = await getElementCenter(ws, selector);
    await dispatchClick(ws, pos.x, pos.y);
    console.log(`Clicked: <${pos.tag}> at (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
  } finally { ws.close(); }
}

async function cmdClickText(tabId, text) {
  const { ws } = await connectToTab(tabId);
  try {
    logOp('click-text', { tabId, text });
    const pos = await getElementCenterByText(ws, text);
    await dispatchClick(ws, pos.x, pos.y);
    console.log(`Clicked: <${pos.tag}> "${pos.text}" at (${Math.round(pos.x)}, ${Math.round(pos.y)})`);
  } finally { ws.close(); }
}

async function cmdType(tabId, selector, text) {
  const { ws } = await connectToTab(tabId);
  try {
    logOp('type', { tabId, selector, length: text.length });

    // First try native setter approach (most reliable for React)
    const result = await setInputValue(ws, selector, text);
    console.log(`Typed ${text.length} chars into ${selector}`);
    console.log(`Value now: ${result.value}`);
  } finally { ws.close(); }
}

async function cmdSelect(tabId, selector, value) {
  const { ws } = await connectToTab(tabId);
  try {
    logOp('select', { tabId, selector, value });
    const result = await cdpCommand(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return JSON.stringify({ error: 'Element not found' });
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return JSON.stringify({ ok: true, value: el.value });
        })()
      `,
      returnByValue: true,
    });
    const data = JSON.parse(result.result?.value || '{"error":"eval failed"}');
    if (data.error) throw new Error(data.error);
    console.log(`Selected: ${selector} = ${data.value}`);
  } finally { ws.close(); }
}

async function cmdScroll(tabId, pixels = 500) {
  const { ws } = await connectToTab(tabId);
  try {
    logOp('scroll', { tabId, pixels });
    await cdpCommand(ws, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: pixels,
    });
    console.log(`Scrolled ${pixels}px`);
  } finally { ws.close(); }
}

async function cmdEval(tabId, expression) {
  const { ws } = await connectToTab(tabId);
  try {
    logOp('eval', { tabId, expression: expression.slice(0, 100) });
    const result = await cdpCommand(ws, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      console.error(`Error: ${result.exceptionDetails.text}`);
      process.exit(1);
    }
    const val = result.result?.value;
    console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val));
  } finally { ws.close(); }
}

async function cmdScreenshot(tabId, outPath = '/tmp/cdp-interact-screenshot.png') {
  const { ws } = await connectToTab(tabId);
  try {
    logOp('screenshot', { tabId, outPath });
    await cdpCommand(ws, 'Page.enable');
    const { data } = await cdpCommand(ws, 'Page.captureScreenshot', { format: 'png' });
    writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log(`Screenshot saved: ${outPath}`);
  } finally { ws.close(); }
}

async function cmdWait(tabId, selector, timeoutMs = 10000) {
  const { ws } = await connectToTab(tabId);
  try {
    logOp('wait', { tabId, selector, timeout: timeoutMs });
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await cdpCommand(ws, 'Runtime.evaluate', {
        expression: `!!document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: true,
      });
      if (result.result?.value === true) {
        console.log(`Found: ${selector} (${Date.now() - start}ms)`);
        return;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    console.error(`Timeout: ${selector} not found after ${timeoutMs}ms`);
    process.exit(1);
  } finally { ws.close(); }
}

async function cmdListInputs(tabId) {
  const { ws } = await connectToTab(tabId);
  try {
    logOp('list-inputs', { tabId });
    const result = await cdpCommand(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          const inputs = [];

          // Regular inputs
          document.querySelectorAll('input, textarea, select').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return; // skip hidden

            const entry = {
              tag: el.tagName.toLowerCase(),
              type: el.type || '',
              name: el.name || '',
              id: el.id || '',
              placeholder: el.placeholder || '',
              value: (el.value || '').slice(0, 50),
              selector: el.id ? '#' + el.id
                       : el.name ? el.tagName.toLowerCase() + '[name="' + el.name + '"]'
                       : '',
            };

            // For contenteditable
            if (el.getAttribute('contenteditable') === 'true') {
              entry.contenteditable = true;
            }

            inputs.push(entry);
          });

          // Also find contenteditable elements
          document.querySelectorAll('[contenteditable="true"]').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            inputs.push({
              tag: el.tagName.toLowerCase(),
              type: 'contenteditable',
              name: '',
              id: el.id || '',
              placeholder: el.getAttribute('data-placeholder') || '',
              value: (el.innerText || '').slice(0, 50),
              selector: el.id ? '#' + el.id : '',
            });
          });

          // Find buttons
          document.querySelectorAll('button, [role="button"], input[type="submit"]').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            inputs.push({
              tag: el.tagName.toLowerCase(),
              type: 'button',
              name: el.name || '',
              id: el.id || '',
              text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 50),
              selector: el.id ? '#' + el.id : '',
            });
          });

          return JSON.stringify(inputs);
        })()
      `,
      returnByValue: true,
    });

    const inputs = JSON.parse(result.result?.value || '[]');
    if (inputs.length === 0) {
      console.log('No visible form inputs found.');
      return;
    }

    console.log(`Found ${inputs.length} interactive elements:\n`);
    for (const inp of inputs) {
      const sel = inp.selector ? ` → ${inp.selector}` : '';
      if (inp.type === 'button') {
        console.log(`  [BUTTON] "${inp.text}"${sel}`);
      } else {
        const ph = inp.placeholder ? ` (${inp.placeholder})` : '';
        const val = inp.value ? ` = "${inp.value}"` : '';
        console.log(`  [${inp.tag}${inp.type ? ':' + inp.type : ''}] ${inp.name || inp.id || '(unnamed)'}${ph}${val}${sel}`);
      }
    }
  } finally { ws.close(); }
}

async function cmdFillForm(tabId, jsonStr) {
  let fields;
  try {
    fields = JSON.parse(jsonStr);
  } catch {
    console.error('Invalid JSON. Format: {"selector": "value", ...}');
    process.exit(1);
  }

  const { ws } = await connectToTab(tabId);
  try {
    logOp('fill-form', { tabId, fieldCount: Object.keys(fields).length });

    for (const [selector, value] of Object.entries(fields)) {
      try {
        await setInputValue(ws, selector, value);
        console.log(`  ✓ ${selector} = "${String(value).slice(0, 50)}"`);
      } catch (err) {
        console.log(`  ✗ ${selector}: ${err.message}`);
      }
    }
    console.log(`\nFilled ${Object.keys(fields).length} fields.`);
  } finally { ws.close(); }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const [cmd, ...args] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'click':
      if (args.length < 2) { console.error('Usage: cdp-interact.mjs click <tabId> <selector>'); process.exit(1); }
      await cmdClick(args[0], args[1]);
      break;
    case 'click-text':
      if (args.length < 2) { console.error('Usage: cdp-interact.mjs click-text <tabId> <text>'); process.exit(1); }
      await cmdClickText(args[0], args[1]);
      break;
    case 'type':
      if (args.length < 3) { console.error('Usage: cdp-interact.mjs type <tabId> <selector> <text>'); process.exit(1); }
      await cmdType(args[0], args[1], args.slice(2).join(' '));
      break;
    case 'select':
      if (args.length < 3) { console.error('Usage: cdp-interact.mjs select <tabId> <selector> <value>'); process.exit(1); }
      await cmdSelect(args[0], args[1], args[2]);
      break;
    case 'scroll':
      if (args.length < 1) { console.error('Usage: cdp-interact.mjs scroll <tabId> [pixels]'); process.exit(1); }
      await cmdScroll(args[0], parseInt(args[1] || '500'));
      break;
    case 'eval':
      if (args.length < 2) { console.error('Usage: cdp-interact.mjs eval <tabId> <expression>'); process.exit(1); }
      await cmdEval(args[0], args.slice(1).join(' '));
      break;
    case 'screenshot':
      if (args.length < 1) { console.error('Usage: cdp-interact.mjs screenshot <tabId> [path]'); process.exit(1); }
      await cmdScreenshot(args[0], args[1]);
      break;
    case 'wait':
      if (args.length < 2) { console.error('Usage: cdp-interact.mjs wait <tabId> <selector> [timeout]'); process.exit(1); }
      await cmdWait(args[0], args[1], parseInt(args[2] || '10000'));
      break;
    case 'list-inputs':
      if (args.length < 1) { console.error('Usage: cdp-interact.mjs list-inputs <tabId>'); process.exit(1); }
      await cmdListInputs(args[0]);
      break;
    case 'fill-form':
      if (args.length < 2) { console.error('Usage: cdp-interact.mjs fill-form <tabId> \'{"selector":"value"}\''); process.exit(1); }
      await cmdFillForm(args[0], args.slice(1).join(' '));
      break;
    default:
      console.log('cdp-interact — Browser interaction via Chrome DevTools Protocol');
      console.log('');
      console.log('Commands:');
      console.log('  click <tabId> <selector>           Click element by CSS selector');
      console.log('  click-text <tabId> <text>          Click element containing text');
      console.log('  type <tabId> <selector> <text>     Type into input (React-compatible)');
      console.log('  select <tabId> <selector> <value>  Select dropdown option');
      console.log('  scroll <tabId> [pixels]            Scroll down (default 500)');
      console.log('  eval <tabId> <expression>          Evaluate JS in page context');
      console.log('  screenshot <tabId> [path]          Capture tab screenshot');
      console.log('  wait <tabId> <selector> [timeout]  Wait for element (default 10s)');
      console.log('  list-inputs <tabId>                List form inputs and buttons');
      console.log('  fill-form <tabId> <json>           Fill multiple fields at once');
      console.log('');
      console.log('Examples:');
      console.log('  node scripts/cdp-interact.mjs list-inputs B561D2A5');
      console.log('  node scripts/cdp-interact.mjs click B561D2A5 "button.submit"');
      console.log('  node scripts/cdp-interact.mjs click-text B561D2A5 "Create"');
      console.log('  node scripts/cdp-interact.mjs type B561D2A5 "textarea" "Hello world"');
      console.log('  node scripts/cdp-interact.mjs fill-form B561D2A5 \'{"#name":"Kuro","#email":"kuro@ai"}\'');
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
