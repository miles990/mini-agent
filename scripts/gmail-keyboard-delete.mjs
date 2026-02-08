#!/usr/bin/env node
/**
 * Gmail Batch Delete using keyboard shortcuts via CDP
 *
 * Uses Gmail keyboard shortcuts (* a = select all, # = delete)
 * This is more reliable than clicking DOM elements.
 *
 * Usage:
 *   node scripts/gmail-keyboard-delete.mjs "from:tumblr.com"
 */

const CDP_BASE = `http://localhost:${process.env.CDP_PORT || '9222'}`;

async function getGmailWs() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  const targets = await res.json();
  const gmail = targets.find(t => t.type === 'page' && t.url.includes('mail.google.com'));
  if (!gmail) throw new Error('Gmail tab not found');
  const ws = new WebSocket(gmail.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('error')); });
  });

  let _id = 0;
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++_id;
    const t = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === id) {
        clearTimeout(t);
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  return { ws, cdp, close: () => ws.close() };
}

async function pressKey(cdp, key, keyCode, modifiers = 0) {
  // Dispatch keydown + char + keyup
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'char',
    text: key,
    key,
    code: `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    modifiers,
  });
}

async function pressSpecialKey(cdp, key, keyCode) {
  await cdp('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function evaluate(cdp, js) {
  const r = await cdp('Runtime.evaluate', {
    expression: js,
    returnByValue: true,
    awaitPromise: true,
  });
  return r.result?.value;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const query = process.argv.slice(2).join(' ');
const mode = process.env.MODE || 'delete'; // delete or archive

if (!query) {
  console.error('Usage: gmail-keyboard-delete.mjs <search-query>');
  process.exit(1);
}

console.log(`=== Gmail Keyboard ${mode.toUpperCase()} ===`);
console.log(`Query: ${query}`);
console.log('');

const { cdp, close } = await getGmailWs();
await cdp('Runtime.enable');

try {
  // Step 1: Navigate to search
  const hash = '#search/' + encodeURIComponent(query);
  console.log('Step 1: Navigating to search...');
  await evaluate(cdp, `window.location.hash = '${hash}'; 'ok'`);
  await sleep(3000);

  const title = await evaluate(cdp, 'document.title');
  console.log(`  Title: ${title}`);

  // Make sure focus is on the email list, not search bar
  // Click on the body first
  await evaluate(cdp, `
    (async () => {
      // Click on the message list area to ensure focus
      const list = document.querySelector('[role="main"]');
      if (list) list.click();
      await new Promise(r => setTimeout(r, 300));
      // Blur any focused input
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
      }
      return 'focused';
    })()
  `);
  await sleep(500);

  // Step 2: Use keyboard shortcut to select all: * then a
  console.log('Step 2: Pressing * a (select all)...');

  // Press * (Shift + 8)
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: '*',
    code: 'Digit8',
    text: '*',
    windowsVirtualKeyCode: 56,
    nativeVirtualKeyCode: 56,
    modifiers: 8, // Shift
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'char',
    text: '*',
    key: '*',
    code: 'Digit8',
    windowsVirtualKeyCode: 56,
    nativeVirtualKeyCode: 56,
    modifiers: 8,
  });
  await cdp('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: '*',
    code: 'Digit8',
    windowsVirtualKeyCode: 56,
    nativeVirtualKeyCode: 56,
    modifiers: 8,
  });

  await sleep(300);

  // Press 'a' (select all shortcut in * menu)
  await pressKey(cdp, 'a', 65);
  await sleep(1500);

  // Check what happened
  const selectState = await evaluate(cdp, `
    (() => {
      const divs = document.querySelectorAll('div');
      const selected = Array.from(divs).filter(d => {
        const t = d.textContent.trim();
        return (t.includes('已選取') || t.includes('selected')) && t.length < 100;
      }).map(d => d.textContent.trim());

      const checkboxes = document.querySelectorAll('[role="checkbox"]');
      const checked = Array.from(checkboxes).filter(c => c.getAttribute('aria-checked') === 'true').length;

      return JSON.stringify({ selected, checked, total: checkboxes.length });
    })()
  `);
  console.log(`  State: ${selectState}`);

  // Step 3: Look for and click "Select all conversations that match this search"
  console.log('Step 3: Looking for select-all-conversations...');
  const bannerResult = await evaluate(cdp, `
    (async () => {
      const allElements = document.querySelectorAll('span, a, div');
      for (const el of allElements) {
        const text = el.textContent.trim();
        if ((text.includes('選取與這項搜尋') || text.includes('Select all conversations that match'))
            && text.length < 200 && !text.includes('已選取')) {
          el.click();
          await new Promise(r => setTimeout(r, 800));
          return 'CLICKED: ' + text.slice(0, 100);
        }
      }

      // Dump all visible short texts with "選" character
      const texts = [];
      for (const el of allElements) {
        const t = el.textContent.trim();
        if (t.includes('選') && t.length > 3 && t.length < 150) {
          if (!texts.includes(t.slice(0, 80))) texts.push(t.slice(0, 80));
        }
      }
      return 'NOT FOUND. Texts with 選: ' + JSON.stringify(texts.slice(0, 10));
    })()
  `);
  console.log(`  ${bannerResult}`);

  // Step 4: Press # to delete (or 'e' to archive)
  const actionKey = mode === 'delete' ? '#' : 'e';
  console.log(`Step 4: Pressing ${actionKey} (${mode})...`);

  if (actionKey === '#') {
    // # is Shift + 3
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: '#',
      code: 'Digit3',
      text: '#',
      windowsVirtualKeyCode: 51,
      nativeVirtualKeyCode: 51,
      modifiers: 8, // Shift
    });
    await cdp('Input.dispatchKeyEvent', {
      type: 'char',
      text: '#',
      key: '#',
      code: 'Digit3',
      windowsVirtualKeyCode: 51,
      nativeVirtualKeyCode: 51,
      modifiers: 8,
    });
    await cdp('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: '#',
      code: 'Digit3',
      windowsVirtualKeyCode: 51,
      nativeVirtualKeyCode: 51,
      modifiers: 8,
    });
  } else {
    await pressKey(cdp, 'e', 69);
  }

  await sleep(2000);

  // Step 5: Check for confirmation dialog
  console.log('Step 5: Checking for confirmation...');
  const confirmResult = await evaluate(cdp, `
    (async () => {
      const ok = document.querySelector('[name="ok"]');
      if (ok) { ok.click(); return 'confirmed'; }

      const dialogs = document.querySelectorAll('[role="alertdialog"], [role="dialog"]');
      for (const d of dialogs) {
        const btns = d.querySelectorAll('button');
        for (const b of btns) {
          const t = b.textContent.trim();
          if (t === '確定' || t === 'OK') { b.click(); return 'dialog confirmed: ' + t; }
        }
        return 'dialog found, buttons: ' + Array.from(btns).map(b => b.textContent.trim()).join(', ');
      }
      return 'no dialog';
    })()
  `);
  console.log(`  ${confirmResult}`);

  await sleep(2000);

  // Final: check
  const finalTitle = await evaluate(cdp, 'document.title');
  console.log('');
  console.log(`Done! Title: ${finalTitle}`);

} finally {
  close();
}
