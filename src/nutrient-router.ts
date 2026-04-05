/**
 * Nutrient Router — Slime Mold (Physarum) Model for Web Perception
 *
 * Tracks per-domain nutrient yield (was fetched content actually consumed?)
 * and provides routing scores to guide fetch priority.
 *
 * Chemical gradient: fetch → cite feedback loop
 * Tube reinforcement: high-yield domains get priority
 * Exploratory tentacles: unknown domains get 20% exploration budget
 * Pruning: consistently low-yield domains get deprioritized
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

interface FetchEvent {
  ts: string;
  event: 'fetch';
  domain: string;
  url: string;
  method: string;
  contentLen: number;
  extractedLen: number;
  success: boolean;
}

interface CiteEvent {
  ts: string;
  event: 'cite';
  domain: string;
  source: 'remember' | 'action' | 'chat' | 'archive' | 'delegate';
}

type NutrientEvent = FetchEvent | CiteEvent;

interface DomainScore {
  domain: string;
  totalFetches: number;
  successfulFetches: number;
  citations: number;
  nutrientYield: number;     // citations / successfulFetches (0-1)
  fetchSuccessRate: number;  // successfulFetches / totalFetches (0-1)
  lastFetch: string;
  lastCite: string | null;
  score: number;             // composite routing score (0-100)
  tier: 'reinforce' | 'explore' | 'prune';
}

interface RouteDecision {
  domain: string;
  action: 'fetch' | 'skip' | 'explore';
  score: number;
  reason: string;
}

// =============================================================================
// Constants
// =============================================================================

const NUTRIENT_LOG = 'web-nutrient.jsonl';
const SCORES_CACHE = 'web-nutrient-scores.json';
const NUTRIENT_DIR_NAME = 'nutrient';

// Scoring thresholds
const REINFORCE_THRESHOLD = 40;   // score >= 40 → reinforce (fetch eagerly)
const PRUNE_THRESHOLD = 15;       // score < 15 → prune (skip unless exploring)
const MIN_FETCHES_FOR_SCORING = 3; // need at least 3 fetches to judge
const DECAY_DAYS = 14;            // events older than 14 days decay in weight
// Exploration is self-limiting: unknown domains → explore → after MIN_FETCHES_FOR_SCORING fetches → auto-score → reinforce/prune

// =============================================================================
// Path Resolution
// =============================================================================

function getNutrientDir(): string {
  const base = process.env.MINI_AGENT_INSTANCE_DIR
    || path.join(process.env.HOME || '/tmp', '.mini-agent', 'instances', 'default');
  const dir = path.join(base, NUTRIENT_DIR_NAME);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getLogPath(): string {
  return path.join(getNutrientDir(), NUTRIENT_LOG);
}

function getScoresCachePath(): string {
  return path.join(getNutrientDir(), SCORES_CACHE);
}

// =============================================================================
// Logging — fire-and-forget
// =============================================================================

export function logFetch(domain: string, url: string, method: string, contentLen: number, extractedLen: number, success: boolean): void {
  try {
    const event: FetchEvent = {
      ts: new Date().toISOString(),
      event: 'fetch',
      domain,
      url,
      method,
      contentLen,
      extractedLen,
      success,
    };
    fs.appendFileSync(getLogPath(), JSON.stringify(event) + '\n', 'utf-8');
  } catch {
    // fire-and-forget
  }
}

export function logCite(domain: string, source: CiteEvent['source']): void {
  try {
    const event: CiteEvent = {
      ts: new Date().toISOString(),
      event: 'cite',
      domain,
      source,
    };
    fs.appendFileSync(getLogPath(), JSON.stringify(event) + '\n', 'utf-8');
  } catch {
    // fire-and-forget
  }
}

// =============================================================================
// Scoring — compute per-domain nutrient yield
// =============================================================================

function loadEvents(): NutrientEvent[] {
  try {
    const logPath = getLogPath();
    if (!fs.existsSync(logPath)) return [];
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
    return lines.map(line => {
      try { return JSON.parse(line) as NutrientEvent; }
      catch { return null; }
    }).filter((e): e is NutrientEvent => e !== null);
  } catch {
    return [];
  }
}

function computeScores(): Map<string, DomainScore> {
  const events = loadEvents();
  const now = Date.now();
  const decayMs = DECAY_DAYS * 24 * 60 * 60 * 1000;

  // Aggregate per domain
  const domains = new Map<string, {
    fetches: number;
    successFetches: number;
    citations: number;
    lastFetch: string;
    lastCite: string | null;
    // Time-weighted counts
    wFetches: number;
    wCitations: number;
  }>();

  for (const event of events) {
    const domain = event.domain;
    if (!domains.has(domain)) {
      domains.set(domain, {
        fetches: 0, successFetches: 0, citations: 0,
        lastFetch: '', lastCite: null,
        wFetches: 0, wCitations: 0,
      });
    }
    const d = domains.get(domain)!;

    // Time decay weight: recent events count more
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

  // Compute scores
  const scores = new Map<string, DomainScore>();

  for (const [domain, d] of domains) {
    const fetchSuccessRate = d.fetches > 0 ? d.successFetches / d.fetches : 0;
    const nutrientYield = d.successFetches > 0 ? d.citations / d.successFetches : 0;

    // Composite score (0-100):
    // - 60% nutrient yield (time-weighted)
    // - 25% fetch success rate
    // - 15% recency bonus (cited in last 3 days)
    const wYield = d.wFetches > 0 ? d.wCitations / d.wFetches : 0;
    const recencyBonus = d.lastCite
      ? (now - new Date(d.lastCite).getTime() < 3 * 24 * 60 * 60 * 1000 ? 1 : 0.3)
      : 0;

    let score = Math.round(
      (wYield * 60) +
      (fetchSuccessRate * 25) +
      (recencyBonus * 15)
    );

    // Cap at 100
    score = Math.min(100, Math.max(0, score));

    // Determine tier
    let tier: DomainScore['tier'];
    if (d.fetches < MIN_FETCHES_FOR_SCORING) {
      tier = 'explore';  // Not enough data — keep exploring
    } else if (score >= REINFORCE_THRESHOLD) {
      tier = 'reinforce';
    } else if (score < PRUNE_THRESHOLD) {
      tier = 'prune';
    } else {
      tier = 'explore';  // Middle ground — keep observing
    }

    scores.set(domain, {
      domain,
      totalFetches: d.fetches,
      successfulFetches: d.successFetches,
      citations: d.citations,
      nutrientYield,
      fetchSuccessRate,
      lastFetch: d.lastFetch,
      lastCite: d.lastCite,
      score,
      tier,
    });
  }

  return scores;
}

// =============================================================================
// Routing — decide whether to fetch a domain
// =============================================================================

export function getRouteDecision(domain: string): RouteDecision {
  try {
    const scores = computeScores();
    const domainScore = scores.get(domain);

    if (!domainScore) {
      // Unknown domain — explore
      return {
        domain,
        action: 'explore',
        score: 50,  // neutral
        reason: 'unknown domain — exploratory fetch',
      };
    }

    if (domainScore.tier === 'reinforce') {
      return {
        domain,
        action: 'fetch',
        score: domainScore.score,
        reason: `high nutrient yield (${(domainScore.nutrientYield * 100).toFixed(0)}%, ${domainScore.citations} citations)`,
      };
    }

    if (domainScore.tier === 'prune') {
      return {
        domain,
        action: 'skip',
        score: domainScore.score,
        reason: `low nutrient yield (${domainScore.totalFetches} fetches, ${domainScore.citations} citations)`,
      };
    }

    // Explore tier
    return {
      domain,
      action: 'explore',
      score: domainScore.score,
      reason: `observing (${domainScore.totalFetches} fetches, score ${domainScore.score})`,
    };
  } catch {
    // On error, default to fetch (fail-open)
    return { domain, action: 'fetch', score: 50, reason: 'scoring unavailable' };
  }
}

// =============================================================================
// Bulk scoring — export for web-fetch.sh to consume
// =============================================================================

export function exportScores(): void {
  try {
    const scores = computeScores();
    const output: Record<string, { score: number; tier: string; action: string }> = {};

    for (const [domain, s] of scores) {
      const decision = getRouteDecision(domain);
      output[domain] = {
        score: s.score,
        tier: s.tier,
        action: decision.action,
      };
    }

    fs.writeFileSync(getScoresCachePath(), JSON.stringify(output, null, 2), 'utf-8');
  } catch {
    // fire-and-forget
  }
}

// =============================================================================
// Cite Detection — scan response for domain references
// =============================================================================

const URL_REGEX = /https?:\/\/([^/\s)"'<>]+)/g;

export function detectCitations(response: string, contextDomains: string[]): void {
  setImmediate(() => {
    try {
      const citedDomains = new Set<string>();

      // Method 1: URLs in response
      const urlMatches = response.matchAll(URL_REGEX);
      for (const match of urlMatches) {
        const domain = match[1].replace(/^www\./, '');
        citedDomains.add(domain);
      }

      // Method 2: domain names mentioned in REMEMBER/action/chat tags
      const hasRemember = /<kuro:remember[\s>]/i.test(response);
      const hasAction = /<kuro:action[\s>]/i.test(response);
      const hasChat = /<kuro:chat[\s>]/i.test(response);
      const hasArchive = /<kuro:archive[\s>]/i.test(response);

      // Check which context domains are referenced in the response
      for (const domain of contextDomains) {
        if (response.toLowerCase().includes(domain.toLowerCase())) {
          citedDomains.add(domain);
        }
      }

      // Log citations
      for (const domain of citedDomains) {
        // Only log if this domain was in the perception context
        if (contextDomains.includes(domain)) {
          const source = hasArchive ? 'archive'
            : hasRemember ? 'remember'
            : hasAction ? 'action'
            : hasChat ? 'chat'
            : 'action';
          logCite(domain, source);
        }
      }

      // Re-export scores after citations
      if (citedDomains.size > 0) {
        exportScores();
      }
    } catch {
      // fire-and-forget
    }
  });
}

