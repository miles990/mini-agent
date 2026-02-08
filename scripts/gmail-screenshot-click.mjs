#!/usr/bin/env node
/**
 * Gmail Screenshot + Smart Click via CDP
 *
 * Takes a screenshot to understand layout, then uses
 * Input.dispatchMouseEvent for precise clicking.
 */

const CDP_BASE = `http://localhost:${process.env.CDP_PORT || '9222'}`;
const fs = await import('fs');

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
  await cdp('Page.enable');

  const evaluate = async (js) => {
    const r = await cdp('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  const clickAt = async (x, y) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 50));
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  const screenshot = async (path) => {
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
    console.log(`Screenshot saved: ${path}`);
  };

  return { ws, cdp, evaluate, clickAt, screenshot, close: () => ws.close() };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Main ─────────────────────────────────────────────────────────────────────

const action = process.argv[2] || 'screenshot';
const { cdp, evaluate, clickAt, screenshot, close } = await setup();

try {
  if (action === 'screenshot') {
    await screenshot('/tmp/gmail-current.png');
  }

  if (action === 'batch-delete') {
    const query = process.argv.slice(3).join(' ') || 'from:tumblr.com';
    console.log(`=== Batch Delete: ${query} ===\n`);

    // Navigate to search
    await evaluate(`window.location.hash = '#search/${encodeURIComponent(query)}'; 'ok'`);
    await sleep(4000);
    console.log('Page:', await evaluate('document.title'));

    // Take screenshot to see current state
    await screenshot('/tmp/gmail-search.png');

    // Get all interactive elements with their positions
    const elements = await evaluate(`
      (() => {
        const results = [];
        // Get all checkboxes
        const cbs = document.querySelectorAll('[role="checkbox"]');
        cbs.forEach((cb, i) => {
          const rect = cb.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            results.push({ type: 'checkbox', i, x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), label: (cb.getAttribute('aria-label') || cb.className).slice(0, 30) });
          }
        });

        // Get toolbar buttons
        const buttons = document.querySelectorAll('[role="button"]');
        buttons.forEach((btn, i) => {
          const label = btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || '';
          if (['選取', '刪除', '封存', '回報為垃圾郵件', '標示為已讀取', 'Select', 'Delete', 'Archive'].some(l => label.includes(l))) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({ type: 'button', i, x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), label: label.slice(0, 30) });
            }
          }
        });

        return JSON.stringify(results.slice(0, 20));
      })()
    `);
    console.log('Interactive elements:', elements);

    const elems = JSON.parse(elements);
    const checkbox = elems.find(e => e.type === 'checkbox' && e.i === 0);
    const deleteBtn = elems.find(e => e.label.includes('刪除') || e.label.includes('Delete'));

    if (!checkbox) {
      console.log('ERROR: No checkbox found');
    } else {
      console.log(`\nClicking checkbox at (${checkbox.x}, ${checkbox.y})...`);
      await clickAt(checkbox.x, checkbox.y);
      await sleep(2000);

      // Screenshot after select
      await screenshot('/tmp/gmail-selected.png');

      // Check if banner appeared
      const bannerInfo = await evaluate(`
        (() => {
          const spans = document.querySelectorAll('span, a');
          for (const s of spans) {
            const t = s.textContent.trim();
            if ((t.includes('選取與這項搜尋') || t.includes('Select all conversations that match')) && t.length < 200) {
              const rect = s.getBoundingClientRect();
              return JSON.stringify({ x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2), text: t.slice(0, 80) });
            }
          }
          // Also check for any selection info
          const selInfo = [];
          for (const s of spans) {
            const t = s.textContent.trim();
            if (t.includes('已選取') && t.length < 80) selInfo.push(t);
          }
          return JSON.stringify({ notFound: true, selectionInfo: selInfo });
        })()
      `);
      console.log('Banner:', bannerInfo);

      const banner = JSON.parse(bannerInfo);
      if (!banner.notFound) {
        console.log(`Clicking "Select all" at (${banner.x}, ${banner.y})...`);
        await clickAt(banner.x, banner.y);
        await sleep(1500);
      }

      // Now find and click delete
      // Re-find delete button (position may have changed)
      const delInfo = await evaluate(`
        (() => {
          const buttons = document.querySelectorAll('[role="button"]');
          for (const btn of buttons) {
            const label = btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || '';
            if (label === '刪除' || label === 'Delete') {
              const rect = btn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                return JSON.stringify({ x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) });
              }
            }
          }
          return null;
        })()
      `);

      if (delInfo) {
        const del = JSON.parse(delInfo);
        console.log(`Clicking delete at (${del.x}, ${del.y})...`);
        await clickAt(del.x, del.y);
        await sleep(3000);

        // Check for confirmation
        const confirmInfo = await evaluate(`
          (() => {
            const ok = document.querySelector('[name="ok"]');
            if (ok) {
              const rect = ok.getBoundingClientRect();
              return JSON.stringify({ x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) });
            }
            return null;
          })()
        `);

        if (confirmInfo) {
          const pos = JSON.parse(confirmInfo);
          console.log(`Confirming at (${pos.x}, ${pos.y})...`);
          await clickAt(pos.x, pos.y);
          await sleep(2000);
        }

        await screenshot('/tmp/gmail-after-delete.png');
      } else {
        console.log('Delete button not found after selection');
      }
    }

    // Navigate to trash to verify
    await evaluate("window.location.hash = '#trash'; 'ok'");
    await sleep(3000);
    const trashCount = await evaluate(`
      (() => {
        const rows = document.querySelectorAll('tr.zA');
        return 'Trash: ' + rows.length + ' rows';
      })()
    `);
    console.log('\n' + trashCount);
    await screenshot('/tmp/gmail-trash.png');
  }

} finally {
  close();
}
