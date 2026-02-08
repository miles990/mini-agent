#!/usr/bin/env node
/**
 * Inspect Gmail DOM to find the right selectors for automation
 */

const CDP_HOST = process.env.CDP_HOST || 'localhost';
const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;

async function listTargets() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(3000) });
  return res.json();
}

function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

function cdpCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e8);
    const timeout = setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
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

const targets = await listTargets();
const gmail = targets.find(t => t.type === 'page' && t.url.includes('mail.google.com'));
if (!gmail) { console.error('Gmail tab not found'); process.exit(1); }

const ws = await connectWs(gmail.webSocketDebuggerUrl);
await cdpCommand(ws, 'Runtime.enable');

const action = process.argv[2] || 'inspect';

if (action === 'inspect') {
  const r = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const checkboxes = document.querySelectorAll('[role="checkbox"]');
        const checkboxInfo = Array.from(checkboxes).slice(0, 10).map(c => c.getAttribute('aria-label') || c.className.slice(0, 30));

        const buttons = document.querySelectorAll('[role="button"]');
        const buttonInfo = Array.from(buttons).slice(0, 20).map(b => (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 50));

        const toolbars = document.querySelectorAll('[role="toolbar"]');
        const toolbarChildren = Array.from(toolbars).map(t => t.children.length);

        // Look for the select-all area
        const selectAllArea = document.querySelector('.Dj');
        const selectAreaText = selectAllArea ? selectAllArea.textContent.trim().slice(0, 100) : 'not found';

        // Look for the main checkbox toggle
        const mainCheckbox = document.querySelector('[gh="tl"] [role="checkbox"]');
        const mainCheckboxInfo = mainCheckbox ? mainCheckbox.getAttribute('aria-label') : 'not found';

        return JSON.stringify({
          title: document.title,
          hash: window.location.hash,
          checkboxes: checkboxInfo,
          buttons: buttonInfo,
          toolbarChildren,
          selectAreaText,
          mainCheckbox: mainCheckboxInfo,
        }, null, 2);
      })()
    `,
    returnByValue: true,
  });
  console.log(r.result?.value);
}

if (action === 'select-all') {
  // Click the main select-all checkbox
  const r = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        // The main select-all checkbox in Gmail toolbar
        const cb = document.querySelector('[gh="tl"] [role="checkbox"]')
          || document.querySelector('.T-Jo-auh');
        if (cb) {
          cb.click();
          return 'Clicked: ' + (cb.getAttribute('aria-label') || cb.className);
        }
        return 'Not found';
      })()
    `,
    returnByValue: true,
  });
  console.log('select-all:', r.result?.value);
}

if (action === 'select-all-conversations') {
  // After clicking select-all, Gmail shows "Select all conversations that match this search"
  // We need to wait and click that
  const r = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        // Look for the "Select all conversations" banner
        const banners = document.querySelectorAll('.ya span, .T-ays-a1d, [role="link"]');
        const texts = Array.from(banners).map(b => b.textContent.trim()).filter(t => t.length > 0 && t.length < 100);

        // Find banner with "選取所有" or "Select all"
        const selectAllLink = Array.from(document.querySelectorAll('span[role="link"], span.T-ays-a1d'))
          .find(s => s.textContent.includes('選取') || s.textContent.includes('Select all'));

        if (selectAllLink) {
          selectAllLink.click();
          return 'Clicked select-all-conversations: ' + selectAllLink.textContent.trim();
        }

        return 'Banner texts: ' + JSON.stringify(texts.slice(0, 10));
      })()
    `,
    returnByValue: true,
  });
  console.log('select-all-conversations:', r.result?.value);
}

if (action === 'delete') {
  const r = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const del = document.querySelector('[aria-label="刪除"]')
          || document.querySelector('[data-tooltip="刪除"]')
          || document.querySelector('[aria-label="Delete"]');
        if (del) {
          del.click();
          return 'Clicked delete';
        }
        return 'Delete button not found';
      })()
    `,
    returnByValue: true,
  });
  console.log('delete:', r.result?.value);
}

if (action === 'archive') {
  const r = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const btn = document.querySelector('[aria-label="封存"]')
          || document.querySelector('[aria-label="Archive"]');
        if (btn) {
          btn.click();
          return 'Clicked archive';
        }
        return 'Archive button not found';
      })()
    `,
    returnByValue: true,
  });
  console.log('archive:', r.result?.value);
}

if (action === 'confirm') {
  const r = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const ok = document.querySelector('[name="ok"]')
          || document.querySelector('button.J-at1-auR');
        if (ok) {
          ok.click();
          return 'Clicked OK';
        }
        // Look for any confirmation dialog
        const dialogs = document.querySelectorAll('[role="alertdialog"], [role="dialog"]');
        if (dialogs.length) {
          const btns = dialogs[0].querySelectorAll('button');
          const okBtn = Array.from(btns).find(b => b.textContent.includes('確定') || b.textContent.includes('OK'));
          if (okBtn) { okBtn.click(); return 'Clicked dialog OK'; }
          return 'Dialog found but no OK button. Buttons: ' + Array.from(btns).map(b => b.textContent.trim()).join(', ');
        }
        return 'No confirmation dialog found';
      })()
    `,
    returnByValue: true,
  });
  console.log('confirm:', r.result?.value);
}

if (action === 'navigate') {
  const hash = process.argv[3] || '#inbox';
  const r = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        window.location.hash = '${hash}';
        return 'Navigated to ${hash}';
      })()
    `,
    returnByValue: true,
  });
  console.log(r.result?.value);
}

if (action === 'search') {
  const query = process.argv.slice(3).join(' ');
  const hash = '#search/' + encodeURIComponent(query);
  const r = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        window.location.hash = '${hash}';
        return 'Searching: ${query}';
      })()
    `,
    returnByValue: true,
  });
  console.log(r.result?.value);
}

if (action === 'count') {
  await new Promise(r => setTimeout(r, 2000));
  const r = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const rows = document.querySelectorAll('tr.zA');
        const countText = document.querySelector('.Dj') ? document.querySelector('.Dj').textContent.trim() : '';
        return 'Rows visible: ' + rows.length + ', Status: ' + countText + ', Title: ' + document.title;
      })()
    `,
    returnByValue: true,
  });
  console.log(r.result?.value);
}

ws.close();
