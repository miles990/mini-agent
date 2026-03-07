#!/usr/bin/env node
/**
 * Nutrient Router CLI — Bridge between web-fetch.sh (bash) and nutrient-router.ts
 *
 * Usage:
 *   node scripts/nutrient-cli.mjs log-fetch <domain> <url> <method> <contentLen> <extractedLen> <success>
 *   node scripts/nutrient-cli.mjs route <domain>          → { action, score, reason }
 *   node scripts/nutrient-cli.mjs scores                  → export all scores to JSON
 *   node scripts/nutrient-cli.mjs stats                   → nutrient stats summary
 */

import fs from 'node:fs';
import path from 'node:path';

const INSTANCE_DIR = process.env.MINI_AGENT_INSTANCE_DIR
  || path.join(process.env.HOME || '/tmp', '.mini-agent', 'instances', 'default');
const NUTRIENT_DIR = path.join(INSTANCE_DIR, 'nutrient');
const LOG_PATH = path.join(NUTRIENT_DIR, 'web-nutrient.jsonl');
const SCORES_PATH = path.join(NUTRIENT_DIR, 'web-nutrient-scores.json');

// Constants
const MIN_FETCHES = 3;
const REINFORCE_THRESHOLD = 40;
const PRUNE_THRESHOLD = 15;
const DECAY_DAYS = 14;

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(NUTRIENT_DIR)) fs.mkdirSync(NUTRIENT_DIR, { recursive: true });
}

function appendLog(event) {
  ensureDir();
  fs.appendFileSync(LOG_PATH, JSON.stringify(event) + '\n', 'utf-8');
}

function loadEvents() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs.readFileSync(LOG_PATH, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function computeScores() {
  const events = loadEvents();
  const now = Date.now();
  const decayMs = DECAY_DAYS * 24 * 60 * 60 * 1000;

  const domains = new Map();

  for (const event of events) {
    const domain = event.domain;
    if (!domains.has(domain)) {
      domains.set(domain, {
        fetches: 0, successFetches: 0, citations: 0,
        lastFetch: '', lastCite: null,
        wFetches: 0, wCitations: 0,
      });
    }
    const d = domains.get(domain);
    const age = now - new Date(event.ts).getTime();
    const weight = Math.max(0.1, 1 - (age / decayMs));

    if (event.event === 'fetch') {
      d.fetches++;
      d.wFetches += weight;
      if (event.success) d.successFetches++;
      if (!d.lastFetch || event.ts > d.lastFetch) d.lastFetch = event.ts;
    } else if (event.event === 'cite') {
      d.citations++;
      d.wCitations += weight;
      if (!d.lastCite || event.ts > d.lastCite) d.lastCite = event.ts;
    }
  }

  const scores = {};
  for (const [domain, d] of domains) {
    const fetchSuccessRate = d.fetches > 0 ? d.successFetches / d.fetches : 0;
    const nutrientYield = d.successFetches > 0 ? d.citations / d.successFetches : 0;
    const wYield = d.wFetches > 0 ? d.wCitations / d.wFetches : 0;
    const recencyBonus = d.lastCite
      ? (now - new Date(d.lastCite).getTime() < 3 * 24 * 60 * 60 * 1000 ? 1 : 0.3)
      : 0;

    let score = Math.round((wYield * 60) + (fetchSuccessRate * 25) + (recencyBonus * 15));
    score = Math.min(100, Math.max(0, score));

    let tier;
    if (d.fetches < MIN_FETCHES) {
      tier = 'explore';
    } else if (score >= REINFORCE_THRESHOLD) {
      tier = 'reinforce';
    } else if (score < PRUNE_THRESHOLD) {
      tier = 'prune';
    } else {
      tier = 'explore';
    }

    let action;
    if (tier === 'reinforce') action = 'fetch';
    else if (tier === 'prune') action = 'skip';
    else action = 'explore';

    scores[domain] = { score, tier, action, fetches: d.fetches, citations: d.citations, nutrientYield: Math.round(nutrientYield * 100) };
  }
  return scores;
}

// ─── Commands ───────────────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'log-fetch': {
    const [domain, url, method, contentLen, extractedLen, success] = args;
    appendLog({
      ts: new Date().toISOString(),
      event: 'fetch',
      domain,
      url,
      method: method || 'unknown',
      contentLen: parseInt(contentLen) || 0,
      extractedLen: parseInt(extractedLen) || 0,
      success: success !== 'false' && success !== '0',
    });
    break;
  }

  case 'route': {
    const domain = args[0];
    if (!domain) { console.log(JSON.stringify({ action: 'fetch', score: 50, reason: 'no domain' })); break; }
    const scores = computeScores();
    const s = scores[domain];
    if (!s) {
      console.log(JSON.stringify({ action: 'explore', score: 50, reason: 'unknown domain' }));
    } else {
      console.log(JSON.stringify({ action: s.action, score: s.score, reason: `${s.tier}: ${s.fetches} fetches, ${s.citations} cites, yield ${s.nutrientYield}%` }));
    }
    break;
  }

  case 'scores': {
    const scores = computeScores();
    ensureDir();
    fs.writeFileSync(SCORES_PATH, JSON.stringify(scores, null, 2), 'utf-8');
    console.log(JSON.stringify(scores, null, 2));
    break;
  }

  case 'stats': {
    const scores = computeScores();
    const entries = Object.values(scores);
    const reinforced = entries.filter(e => e.tier === 'reinforce');
    const pruned = entries.filter(e => e.tier === 'prune');
    const exploring = entries.filter(e => e.tier === 'explore');
    console.log(`Domains: ${entries.length} (reinforce: ${reinforced.length}, explore: ${exploring.length}, prune: ${pruned.length})`);
    if (reinforced.length > 0) {
      console.log('Top:');
      reinforced.sort((a, b) => b.score - a.score).slice(0, 5).forEach(e =>
        console.log(`  ${e.score} ${Object.keys(scores).find(k => scores[k] === e)} (yield ${e.nutrientYield}%)`));
    }
    if (pruned.length > 0) {
      console.log('Pruned:');
      pruned.slice(0, 5).forEach(e =>
        console.log(`  ${e.score} ${Object.keys(scores).find(k => scores[k] === e)} (${e.fetches} fetches, ${e.citations} cites)`));
    }
    break;
  }

  default:
    console.error('Usage: nutrient-cli.mjs <log-fetch|route|scores|stats> [args]');
    process.exit(1);
}
