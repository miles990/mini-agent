#!/usr/bin/env node
/**
 * Gmail operations using CDP Input.dispatchMouseEvent for real clicks
 * This simulates actual mouse events at the OS level, which Gmail's
 * Closure Library event handlers will properly detect.
 */

const CDP_BASE = `http://localhost:${process.env.CDP_PORT || '9222'}`;

async function setup() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  const targets = await res.json();
  const gmail = targets.find(t => t.type === 'page' && t.url.includes('mail.google.com'));
  if (!gmail) throw new Error('Gmail tab not found');
  const ws = new WebSocket(gmail.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('err')); });
  });
  let _id = 0;
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++_id;
    const t = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) { clearTimeout(t); ws.removeEventListener('message', handler); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await cdp('Runtime.enable');
  await cdp('DOM.enable');

  const evaluate = async (js) => {
    const r = await cdp('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  // Real click at coordinates
  const clickAt = async (x, y) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  // Get element coordinates by selector
  const getCoords = async (selector) => {
    const coords = await evaluate(`
      (() => {
        const el = document.querySelector('${selector}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, w: rect.width, h: rect.height });
      })()
    `);
    return coords ? JSON.parse(coords) : null;
  };

  // Get element coordinates by searching text
  const getCoordsByText = async (text) => {
    const coords = await evaluate(`
      (() => {
        const elements = document.querySelectorAll('[aria-label], [data-tooltip], button, [role="button"]');
        for (const el of elements) {
          const label = el.getAttribute('aria-label') || el.getAttribute('data-tooltip') || el.textContent.trim();
          if (label && label.includes('${text}')) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, label: label.slice(0, 50) });
            }
          }
        }
        return null;
      })()
    `);
    return coords ? JSON.parse(coords) : null;
  };

  return { ws, cdp, evaluate, clickAt, getCoords, getCoordsByText, close: () => ws.close() };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Main ─────────────────────────────────────────────────────────────────────

const action = process.argv[2] || 'test';
const { cdp, evaluate, clickAt, getCoords, getCoordsByText, close } = await setup();

try {
  if (action === 'test') {
    // Test: find and click the select-all checkbox
    console.log('Current page:', await evaluate('document.title'));
    console.log('Current hash:', await evaluate('window.location.hash'));

    // Find the main select-all checkbox coordinates
    const cbCoords = await evaluate(`
      (() => {
        const cbs = document.querySelectorAll('[role="checkbox"]');
        if (cbs.length === 0) return null;
        const cb = cbs[0];
        const rect = cb.getBoundingClientRect();
        return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, w: rect.width, h: rect.height, label: cb.getAttribute('aria-label') || cb.className.slice(0, 30) });
      })()
    `);
    console.log('Checkbox:', cbCoords);

    // Find delete button coordinates
    const delCoords = await getCoordsByText('刪除');
    console.log('Delete btn:', JSON.stringify(delCoords));

    // Find archive button coordinates
    const archCoords = await getCoordsByText('封存');
    console.log('Archive btn:', JSON.stringify(archCoords));
  }

  if (action === 'delete-all') {
    const query = process.argv.slice(3).join(' ') || 'from:tumblr.com';
    console.log(`=== Real Click Delete: ${query} ===`);

    // Navigate
    const hash = '#search/' + encodeURIComponent(query);
    await evaluate(`window.location.hash = '${hash}'; 'ok'`);
    await sleep(3000);
    console.log('Page:', await evaluate('document.title'));

    // Click on the mail list area to ensure we're focused there (not search bar)
    const mainArea = await evaluate(`
      (() => {
        const main = document.querySelector('[role="main"]');
        if (main) {
          const rect = main.getBoundingClientRect();
          return JSON.stringify({ x: rect.x + 200, y: rect.y + 100 });
        }
        return null;
      })()
    `);
    if (mainArea) {
      const ma = JSON.parse(mainArea);
      await clickAt(ma.x, ma.y);
      await sleep(500);
    }

    // Find and REAL-click the select-all checkbox
    const cbStr = await evaluate(`
      (() => {
        const cbs = document.querySelectorAll('[role="checkbox"]');
        if (cbs.length === 0) return null;
        const cb = cbs[0];
        const rect = cb.getBoundingClientRect();
        return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2 });
      })()
    `);

    if (!cbStr) {
      console.log('ERROR: No checkbox found');
      close();
      process.exit(1);
    }

    const cbPos = JSON.parse(cbStr);
    console.log(`Clicking select-all at (${cbPos.x}, ${cbPos.y})...`);
    await clickAt(cbPos.x, cbPos.y);
    await sleep(1500);

    // Check selection state
    const selectedInfo = await evaluate(`
      (() => {
        const divs = document.querySelectorAll('div, span');
        for (const d of divs) {
          const t = d.textContent.trim();
          if (t.includes('已選取') && t.length < 50) return t;
        }
        return 'no selection text found';
      })()
    `);
    console.log('Selection:', selectedInfo);

    // Look for "Select all conversations" link and click it
    const selectAllLink = await evaluate(`
      (() => {
        const spans = document.querySelectorAll('span');
        for (const s of spans) {
          const t = s.textContent.trim();
          if ((t.includes('選取與這項搜尋') || t.includes('Select all conversations')) && t.length < 200) {
            const rect = s.getBoundingClientRect();
            return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, text: t.slice(0, 80) });
          }
        }
        return null;
      })()
    `);

    if (selectAllLink) {
      const pos = JSON.parse(selectAllLink);
      console.log(`Found "Select all" banner: ${pos.text}`);
      console.log(`Clicking at (${pos.x}, ${pos.y})...`);
      await clickAt(pos.x, pos.y);
      await sleep(1000);
    } else {
      console.log('No "Select all conversations" banner found (will delete page only)');
    }

    // Find and REAL-click the delete button
    const delPos = await getCoordsByText('刪除');
    if (!delPos) {
      console.log('ERROR: Delete button not found');
      close();
      process.exit(1);
    }

    console.log(`Clicking delete at (${delPos.x}, ${delPos.y})...`);
    await clickAt(delPos.x, delPos.y);
    await sleep(2000);

    // Check for confirmation dialog and click OK
    const confirmPos = await evaluate(`
      (() => {
        const ok = document.querySelector('[name="ok"]');
        if (ok) {
          const rect = ok.getBoundingClientRect();
          return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2 });
        }
        const dialogs = document.querySelectorAll('[role="alertdialog"], [role="dialog"]');
        for (const d of dialogs) {
          const btns = d.querySelectorAll('button');
          for (const b of btns) {
            if (b.textContent.includes('確定') || b.textContent.includes('OK')) {
              const rect = b.getBoundingClientRect();
              return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2, text: b.textContent.trim() });
            }
          }
        }
        return null;
      })()
    `);

    if (confirmPos) {
      const pos = JSON.parse(confirmPos);
      console.log(`Confirming at (${pos.x}, ${pos.y})...`);
      await clickAt(pos.x, pos.y);
      await sleep(1000);
    } else {
      console.log('No confirmation needed');
    }

    // Check trash
    await evaluate("window.location.hash = '#trash'; 'ok'");
    await sleep(3000);
    const trashInfo = await evaluate(`
      (() => {
        const rows = document.querySelectorAll('tr.zA');
        const tc = document.querySelector('.TC');
        return 'Trash rows: ' + rows.length + ', empty: ' + (tc ? tc.textContent.trim().slice(0, 50) : 'no');
      })()
    `);
    console.log('Trash check:', trashInfo);

    console.log('\nDone!');
  }

} finally {
  close();
}
