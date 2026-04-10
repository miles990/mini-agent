#!/usr/bin/env node
/**
 * X (Twitter) API v2 — Post tweets via OAuth 1.0a
 * No external dependencies. Uses Node.js built-in crypto.
 *
 * Usage:
 *   node scripts/x-api-tweet.mjs verify              # Verify credentials
 *   node scripts/x-api-tweet.mjs tweet "Hello world"  # Post a tweet
 *   node scripts/x-api-tweet.mjs tweet                # Post default tweet
 */

import { createHmac, randomBytes } from 'node:crypto';

// ─── Config from env ────────────────────────────────────────────────────────

const CONFIG = {
  consumerKey:       process.env.X_CONSUMER_KEY,
  consumerSecret:    process.env.X_CONSUMER_SECRET,
  accessToken:       process.env.X_ACCESS_TOKEN,
  accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET,
};

// ─── OAuth 1.0a Implementation ──────────────────────────────────────────────

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function generateNonce() {
  return randomBytes(16).toString('hex');
}

function generateSignature(method, url, params, consumerSecret, tokenSecret) {
  // Sort params alphabetically and build param string
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');

  // Build signature base string
  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(paramString),
  ].join('&');

  // Build signing key
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;

  // HMAC-SHA1
  return createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildAuthHeader(method, url, extraParams = {}) {
  const oauthParams = {
    oauth_consumer_key: CONFIG.consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: CONFIG.accessToken,
    oauth_version: '1.0',
  };

  // Combine oauth params with any extra params (query params) for signature
  const allParams = { ...oauthParams, ...extraParams };

  const signature = generateSignature(
    method, url, allParams,
    CONFIG.consumerSecret, CONFIG.accessTokenSecret
  );

  oauthParams.oauth_signature = signature;

  // Build Authorization header
  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(', ');

  return `OAuth ${headerParts}`;
}

// ─── API Calls ──────────────────────────────────────────────────────────────

async function verifyCredentials() {
  const url = 'https://api.twitter.com/2/users/me';
  const auth = buildAuthHeader('GET', url);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': auth,
    },
  });

  const body = await res.text();
  console.log(`Status: ${res.status}`);

  if (res.ok) {
    const data = JSON.parse(body);
    console.log(`Username: @${data.data.username}`);
    console.log(`Name: ${data.data.name}`);
    console.log(`ID: ${data.data.id}`);
    return true;
  } else {
    console.log(`Error: ${body}`);
    return false;
  }
}

async function postTweet(text) {
  const url = 'https://api.twitter.com/2/tweets';
  // For POST with JSON body, don't include body params in OAuth signature
  const auth = buildAuthHeader('POST', url);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  const body = await res.text();
  console.log(`Status: ${res.status}`);

  if (res.ok) {
    const data = JSON.parse(body);
    console.log(`Tweet ID: ${data.data.id}`);
    console.log(`URL: https://x.com/Kuro938658/status/${data.data.id}`);
    return data.data;
  } else {
    console.log(`Error: ${body}`);
    return null;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'verify';

// Validate config
const missing = Object.entries(CONFIG).filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(', ')}`);
  console.error('Required: X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET');
  process.exit(1);
}

switch (cmd) {
  case 'verify':
    await verifyCredentials();
    break;
  case 'tweet': {
    const text = process.argv[3] || 'Hello from Kuro API';
    console.log(`Posting: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`);
    await postTweet(text);
    break;
  }
  default:
    console.log('Usage: node scripts/x-api-tweet.mjs [verify|tweet] [text]');
}
