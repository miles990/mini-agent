#!/usr/bin/env node
/**
 * X (Twitter) Login via Google OAuth + Tweet Posting via CDP
 * Uses the same CDP patterns as cdp-fetch.mjs but does NOT modify it.
 *
 * Usage:
 *   node scripts/x-login-tweet.mjs login     # Login to X via Google OAuth
 *   node scripts/x-login-tweet.mjs tweet      # Post tweet after login
 *   node scripts/x-login-tweet.mjs status     # Check if logged in
 */

import { writeFileSync } from 'node:fs';

const CDP_HOST = process.env.CDP_HOST || 'localhost';
const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_BASE = `http://${CDP_HOST}:${CDP_PORT}`;
const TIMEOUT = 30000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const TWEET_TEXT = `Same AI tool. One person feels "hollowed out." Another catches fire at 2am.

Not skill. Not personality. Interface mode.

4 modes. 10 real cases.

https://dev.to/kuro_agent/interface-is-cognition-why-the-same-ai-tool-creates-and-destroys-bna`;

// ─── CDP Helpers ────────────────────────────────────────────────────────────

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
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`Waiting for ${eventName} timeout`));
    }, timeoutMs);
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
    const timeout = setTimeout(() => { ws.close(); reject(new Error('WebSocket connect timeout')); }, 10000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(ws); });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
  });
}

async function listTargets() {
  const res = await fetch(`${CDP_BASE}/json`, { signal: AbortSignal.timeout(5000) });
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
  await cdpCommand(ws, 'Page.enable');
  return { ws, target };
}

async function screenshot(ws, filename) {
  const result = await cdpCommand(ws, 'Page.captureScreenshot', {
    format: 'png', quality: 90,
  });
  const outFile = filename || '/tmp/x-cdp-screenshot.png';
  writeFileSync(outFile, Buffer.from(result.data, 'base64'));
  console.log(`Screenshot saved: ${outFile}`);
  return outFile;
}

async function getPageInfo(ws) {
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({ url: location.href, title: document.title, bodyLen: document.body?.innerHTML?.length || 0 })`,
    returnByValue: true,
  });
  return JSON.parse(result.result?.value || '{}');
}

async function getPageText(ws) {
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: 'document.body.innerText',
    returnByValue: true,
  });
  return result.result?.value || '';
}

async function waitForNavigation(ws, timeoutMs = 15000) {
  try {
    await waitForEvent(ws, 'Page.loadEventFired', timeoutMs);
    await sleep(2000);
  } catch {
    // timeout is ok, page might have loaded via SPA
    await sleep(2000);
  }
}

async function getA11yTree(ws) {
  const result = await cdpCommand(ws, 'Accessibility.getFullAXTree', {});
  return result.nodes || [];
}

async function findAndClick(ws, nameHint, roleFilter = null) {
  const nodes = await getA11yTree(ws);
  const interactableRoles = roleFilter
    ? [roleFilter]
    : ['button', 'link', 'textbox', 'combobox', 'checkbox', 'menuitem', 'tab', 'radio'];
  const hint = nameHint.toLowerCase();

  const match = nodes.find(n =>
    interactableRoles.includes(n.role?.value) &&
    n.name?.value?.toLowerCase().includes(hint)
  );

  if (!match) {
    console.log(`  NOT FOUND (a11y): "${nameHint}" (roles: ${interactableRoles.join(',')})`);
    return false;
  }

  console.log(`  Found: [${match.role.value}] "${match.name.value.slice(0, 80)}"`);

  if (match.backendDOMNodeId) {
    try {
      const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: match.backendDOMNodeId });
      if (resolved.object?.objectId) {
        await cdpCommand(ws, 'Runtime.callFunctionOn', {
          objectId: resolved.object.objectId,
          functionDeclaration: 'function() { this.scrollIntoView({block:"center"}); this.click(); }',
        });
        console.log(`  Clicked: "${match.name.value.slice(0, 60)}"`);
        return true;
      }
    } catch (err) {
      console.log(`  DOM resolve failed: ${err.message}`);
    }
  }
  return false;
}

async function findAndClickByJS(ws, jsExpression, description) {
  const result = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: jsExpression,
    returnByValue: true,
    awaitPromise: true,
  });
  const val = result.result?.value;
  if (val) {
    console.log(`  Clicked (JS): ${description}`);
    return true;
  } else {
    console.log(`  NOT FOUND (JS): ${description}`);
    return false;
  }
}

async function typeText(ws, text) {
  for (const char of text) {
    await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', text: char });
    await cdpCommand(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', text: char });
  }
}

async function pressKey(ws, key, code) {
  await cdpCommand(ws, 'Input.dispatchKeyEvent', {
    type: 'keyDown', key, code,
    windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : 0,
  });
  await cdpCommand(ws, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key, code,
    windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Tab' ? 9 : 0,
  });
}

// ─── Login Flow ─────────────────────────────────────────────────────────────

async function doLogin() {
  console.log('=== X Login via Google OAuth ===\n');

  // Step 1: Navigate to X login page
  console.log('Step 1: Opening X login page...');
  const target = await createTarget('https://x.com/i/flow/login');
  const { ws } = await connectToTarget(target.id);

  await waitForNavigation(ws);
  await sleep(3000);

  let info = await getPageInfo(ws);
  console.log(`  Page: ${info.title} (${info.url})`);
  await screenshot(ws, '/tmp/x-login-1.png');

  // Step 2: Look for Google sign-in button
  console.log('\nStep 2: Looking for Google sign-in option...');

  // X login page might show "Sign in with Google" or similar
  // First let's see the a11y tree
  let nodes = await getA11yTree(ws);
  const interactable = nodes
    .filter(n => ['button', 'link'].includes(n.role?.value) && n.name?.value)
    .map(n => `  [${n.role.value}] ${n.name.value.slice(0, 100)}`)
    .slice(0, 30);
  console.log('  Interactable elements:');
  interactable.forEach(l => console.log(l));

  // Try clicking "Sign in with Google" or "Google" button
  let clicked = await findAndClick(ws, 'Google');
  if (!clicked) {
    // Try alternative: might be "使用 Google 帳戶登入" in Chinese
    clicked = await findAndClick(ws, 'google');
  }
  if (!clicked) {
    // Try by JS - look for the Google OAuth iframe or button
    clicked = await findAndClickByJS(ws, `
      (() => {
        // Look for Google sign-in button (could be an iframe)
        const googleBtns = document.querySelectorAll('[data-provider="google"], [aria-label*="Google"], button');
        for (const btn of googleBtns) {
          if (btn.textContent.toLowerCase().includes('google') || btn.getAttribute('aria-label')?.toLowerCase().includes('google')) {
            btn.click();
            return true;
          }
        }
        // Look for Google One Tap iframe
        const iframes = document.querySelectorAll('iframe[src*="google"]');
        if (iframes.length > 0) return 'google_iframe_found';
        return false;
      })()
    `, 'Google sign-in button');
  }

  if (!clicked) {
    console.log('\n  Google sign-in button not found directly.');
    console.log('  Let me check the full page text...');
    const text = await getPageText(ws);
    console.log(`  Page text (first 1000 chars): ${text.slice(0, 1000)}`);
    await screenshot(ws, '/tmp/x-login-2.png');
  }

  await sleep(3000);
  info = await getPageInfo(ws);
  console.log(`\n  After click - Page: ${info.title} (${info.url})`);
  await screenshot(ws, '/tmp/x-login-3.png');

  // Step 3: Handle Google OAuth
  if (info.url.includes('accounts.google.com')) {
    console.log('\nStep 3: On Google OAuth page...');
    await handleGoogleOAuth(ws);
  } else {
    // Check if we're still on X - might need to wait for popup or redirect
    console.log('\nStep 3: Checking if Google OAuth opened...');

    // Check all tabs for Google auth
    const targets = await listTargets();
    const googleTab = targets.find(t => t.url.includes('accounts.google.com'));
    if (googleTab) {
      console.log(`  Found Google auth tab: ${googleTab.id}`);
      const { ws: gws } = await connectToTarget(googleTab.id);
      await handleGoogleOAuth(gws);
      if (gws?.readyState === WebSocket.OPEN) gws.close();
    } else {
      console.log('  No Google OAuth redirect detected.');
      console.log('  Listing available tabs:');
      for (const t of targets.filter(t => t.type === 'page')) {
        console.log(`    [${t.id.slice(0,8)}] ${t.title?.slice(0,60)} - ${t.url?.slice(0,80)}`);
      }

      // Maybe we need to look at the page more carefully
      nodes = await getA11yTree(ws);
      const allElements = nodes
        .filter(n => n.name?.value)
        .map(n => `  [${n.role?.value}] ${n.name.value.slice(0, 120)}`)
        .slice(0, 50);
      console.log('\n  All named elements:');
      allElements.forEach(l => console.log(l));
    }
  }

  // Step 4: Wait for X login to complete
  console.log('\nStep 4: Checking login status...');
  await sleep(5000);
  info = await getPageInfo(ws);
  console.log(`  Page: ${info.title} (${info.url})`);
  await screenshot(ws, '/tmp/x-login-final.png');

  // Verify login
  const text = await getPageText(ws);
  const isLoggedIn = info.url.includes('x.com/home') ||
                     text.includes('What is happening') ||
                     text.includes('What\'s happening') ||
                     text.includes('發佈') ||
                     text.includes('Post');

  if (isLoggedIn) {
    console.log('\n  LOGIN SUCCESSFUL!');
  } else {
    console.log(`\n  Login status unclear. URL: ${info.url}`);
    console.log(`  Page text (first 500): ${text.slice(0, 500)}`);
  }

  if (ws?.readyState === WebSocket.OPEN) ws.close();
  return target.id;
}

async function handleGoogleOAuth(ws) {
  await sleep(2000);
  let info = await getPageInfo(ws);
  console.log(`  Google page: ${info.title} (${info.url})`);
  await screenshot(ws, '/tmp/x-google-1.png');

  // Check page text
  const text = await getPageText(ws);
  console.log(`  Page text (first 800): ${text.slice(0, 800)}`);

  // List interactable elements
  let nodes = await getA11yTree(ws);
  const interactable = nodes
    .filter(n => ['button', 'link', 'textbox'].includes(n.role?.value) && n.name?.value)
    .map(n => `  [${n.role.value}] ${n.name.value.slice(0, 100)}`)
    .slice(0, 30);
  console.log('  Interactable:');
  interactable.forEach(l => console.log(l));

  // If there's an email field, type the email
  const emailField = nodes.find(n =>
    n.role?.value === 'textbox' &&
    (n.name?.value?.toLowerCase().includes('email') || n.name?.value?.toLowerCase().includes('電子郵件'))
  );

  if (emailField) {
    console.log('  Found email field, typing email...');
    if (emailField.backendDOMNodeId) {
      const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: emailField.backendDOMNodeId });
      if (resolved.object?.objectId) {
        await cdpCommand(ws, 'Runtime.callFunctionOn', {
          objectId: resolved.object.objectId,
          functionDeclaration: 'function() { this.focus(); this.value = ""; }',
        });
        await typeText(ws, 'kuro.ai.agent@gmail.com');
        await sleep(500);
        // Click Next
        await findAndClick(ws, 'Next') || await findAndClick(ws, '下一步') || await findAndClick(ws, '繼續');
        await sleep(3000);
      }
    }
  }

  // Check if we're on account chooser - look for the account email
  const accountBtn = nodes.find(n =>
    n.name?.value?.toLowerCase().includes('kuro.ai.agent') ||
    n.name?.value?.toLowerCase().includes('kuro')
  );

  if (accountBtn) {
    console.log(`  Found account: "${accountBtn.name.value}"`);
    if (accountBtn.backendDOMNodeId) {
      const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: accountBtn.backendDOMNodeId });
      if (resolved.object?.objectId) {
        await cdpCommand(ws, 'Runtime.callFunctionOn', {
          objectId: resolved.object.objectId,
          functionDeclaration: 'function() { this.click(); }',
        });
        console.log('  Clicked account.');
        await sleep(5000);
      }
    }
  }

  // After selecting account, might need to click "Continue" or "Allow"
  info = await getPageInfo(ws);
  console.log(`  After account selection: ${info.url}`);
  await screenshot(ws, '/tmp/x-google-2.png');

  // Check for "Continue" or "Allow" buttons
  nodes = await getA11yTree(ws);
  const continueBtn = nodes.find(n =>
    n.role?.value === 'button' &&
    (n.name?.value?.toLowerCase().includes('continue') ||
     n.name?.value?.toLowerCase().includes('allow') ||
     n.name?.value?.toLowerCase().includes('繼續') ||
     n.name?.value?.toLowerCase().includes('允許'))
  );

  if (continueBtn) {
    console.log(`  Found continue/allow button: "${continueBtn.name.value}"`);
    if (continueBtn.backendDOMNodeId) {
      const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: continueBtn.backendDOMNodeId });
      if (resolved.object?.objectId) {
        await cdpCommand(ws, 'Runtime.callFunctionOn', {
          objectId: resolved.object.objectId,
          functionDeclaration: 'function() { this.click(); }',
        });
        console.log('  Clicked continue/allow.');
        await sleep(5000);
      }
    }
  }
}

// ─── Tweet Flow ─────────────────────────────────────────────────────────────

async function doTweet() {
  console.log('=== Posting Tweet ===\n');

  // Navigate to X home
  console.log('Step 1: Opening X home...');
  const target = await createTarget('https://x.com/home');
  const { ws } = await connectToTarget(target.id);

  await waitForNavigation(ws);
  await sleep(3000);

  let info = await getPageInfo(ws);
  console.log(`  Page: ${info.title} (${info.url})`);
  await screenshot(ws, '/tmp/x-tweet-1.png');

  // Check if logged in
  const text = await getPageText(ws);
  if (info.url.includes('/login') || info.url.includes('/i/flow/login')) {
    console.log('  NOT LOGGED IN - run login first!');
    if (ws?.readyState === WebSocket.OPEN) ws.close();
    return;
  }

  console.log('\nStep 2: Finding tweet compose area...');

  // Look for the compose text area
  let nodes = await getA11yTree(ws);
  const interactable = nodes
    .filter(n => ['button', 'link', 'textbox'].includes(n.role?.value) && n.name?.value)
    .map(n => `  [${n.role.value}] ${n.name.value.slice(0, 100)}`)
    .slice(0, 30);
  console.log('  Interactable elements:');
  interactable.forEach(l => console.log(l));

  // The compose area on X is a contenteditable div with role="textbox"
  // It might be labeled "Post text" or "What is happening?!" or similar
  let composeFound = false;

  // Try clicking the compose area
  const composeBox = nodes.find(n =>
    n.role?.value === 'textbox' &&
    (n.name?.value?.toLowerCase().includes('post') ||
     n.name?.value?.toLowerCase().includes('happening') ||
     n.name?.value?.toLowerCase().includes('發佈') ||
     n.name?.value?.toLowerCase().includes('有什麼'))
  );

  if (composeBox) {
    console.log(`  Found compose box: "${composeBox.name.value}"`);
    if (composeBox.backendDOMNodeId) {
      const resolved = await cdpCommand(ws, 'DOM.resolveNode', { backendNodeId: composeBox.backendDOMNodeId });
      if (resolved.object?.objectId) {
        await cdpCommand(ws, 'Runtime.callFunctionOn', {
          objectId: resolved.object.objectId,
          functionDeclaration: 'function() { this.scrollIntoView({block:"center"}); this.focus(); this.click(); }',
        });
        composeFound = true;
      }
    }
  }

  if (!composeFound) {
    // Try JS-based approach
    console.log('  Trying JS approach to find compose...');
    const jsResult = await cdpCommand(ws, 'Runtime.evaluate', {
      expression: `
        (() => {
          // The X compose box is a div with contenteditable="true" and data-testid="tweetTextarea_0"
          const el = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                     document.querySelector('[contenteditable="true"][role="textbox"]') ||
                     document.querySelector('.DraftEditor-root [contenteditable="true"]') ||
                     document.querySelector('[data-contents="true"]');
          if (el) { el.focus(); el.click(); return 'found'; }
          return null;
        })()
      `,
      returnByValue: true,
    });
    if (jsResult.result?.value) {
      composeFound = true;
      console.log('  Found compose box via JS');
    }
  }

  if (!composeFound) {
    console.log('  Could not find compose box. Checking page...');
    console.log(`  Page text (first 500): ${text.slice(0, 500)}`);
    await screenshot(ws, '/tmp/x-tweet-2.png');
    if (ws?.readyState === WebSocket.OPEN) ws.close();
    return;
  }

  console.log('\nStep 3: Typing tweet...');
  await sleep(1000);

  // Use clipboard approach for multi-line text (more reliable than typeText for newlines)
  // First, set the content via execCommand/insertText
  const tweetEscaped = TWEET_TEXT.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                   document.querySelector('[contenteditable="true"][role="textbox"]') ||
                   document.querySelector('[data-contents="true"]');
        if (!el) return false;
        el.focus();
        // Use insertText for contenteditable
        document.execCommand('insertText', false, ${JSON.stringify(TWEET_TEXT)});
        // Dispatch input event to trigger React state update
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `,
    returnByValue: true,
  });

  await sleep(2000);
  await screenshot(ws, '/tmp/x-tweet-3.png');

  // Verify the text was entered
  const verifyResult = await cdpCommand(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                   document.querySelector('[contenteditable="true"][role="textbox"]');
        return el ? el.textContent : 'NOT_FOUND';
      })()
    `,
    returnByValue: true,
  });
  console.log(`  Composed text: ${(verifyResult.result?.value || '').slice(0, 100)}...`);

  console.log('\nStep 4: Clicking Post button...');

  // Find and click the Post/Tweet button
  // It's typically data-testid="tweetButtonInline" or data-testid="tweetButton"
  let posted = await findAndClickByJS(ws, `
    (() => {
      const btn = document.querySelector('[data-testid="tweetButtonInline"]') ||
                  document.querySelector('[data-testid="tweetButton"]');
      if (btn && !btn.disabled) { btn.click(); return true; }
      return false;
    })()
  `, 'Post button');

  if (!posted) {
    // Try a11y approach
    posted = await findAndClick(ws, 'Post') ||
             await findAndClick(ws, '發佈') ||
             await findAndClick(ws, 'Tweet');
  }

  if (posted) {
    await sleep(3000);
    info = await getPageInfo(ws);
    console.log(`\n  After posting - Page: ${info.title} (${info.url})`);
    await screenshot(ws, '/tmp/x-tweet-final.png');
    console.log('\n  TWEET POSTED!');
  } else {
    console.log('\n  Could not find Post button.');
    await screenshot(ws, '/tmp/x-tweet-error.png');
  }

  if (ws?.readyState === WebSocket.OPEN) ws.close();
  return target.id;
}

// ─── Status Check ───────────────────────────────────────────────────────────

async function checkStatus() {
  console.log('=== X Login Status Check ===\n');
  const target = await createTarget('https://x.com/home');
  const { ws } = await connectToTarget(target.id);

  await waitForNavigation(ws);
  await sleep(3000);

  const info = await getPageInfo(ws);
  console.log(`Page: ${info.title}`);
  console.log(`URL: ${info.url}`);

  const text = await getPageText(ws);
  const isLoggedIn = !info.url.includes('/login') && !info.url.includes('/i/flow/login');
  console.log(`Logged in: ${isLoggedIn}`);
  console.log(`Page text (first 300): ${text.slice(0, 300)}`);

  await screenshot(ws, '/tmp/x-status.png');

  if (ws?.readyState === WebSocket.OPEN) ws.close();
  await closeTarget(target.id);
  return isLoggedIn;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'login';

try {
  switch (cmd) {
    case 'login':
      await doLogin();
      break;
    case 'tweet':
      await doTweet();
      break;
    case 'status':
      await checkStatus();
      break;
    default:
      console.log('Usage: node scripts/x-login-tweet.mjs [login|tweet|status]');
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  console.error(err.stack);
}

process.exit(0);
