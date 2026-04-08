/**
 * URL Case Preservation Gate — Crystallization of verification discipline #1.
 *
 * Problem: GitHub URLs are case-sensitive (`JuliusBrussee` ≠ `juliusbrussee`).
 * When I copy a URL from Alex's inbox into a delegate prompt, I must preserve
 * the owner/repo casing verbatim. Rewriting even one letter's case turns every
 * API fetch into a 404, which I then (wrongly) interpret as "entity does not
 * exist" — a failure mode that has already happened twice:
 *   - Cycle #37 (2026-04-08): `julius-brussee` lowercased → 404 → fabricated
 *     a bogus replacement repo.
 *   - Cycle #46 (same day): rebroadcast of the same error.
 *
 * The markdown rule in the system prompt (verification discipline #1) did not
 * prevent either failure. Per Crystallization Protocol: two occurrences of a
 * mechanical pattern = code gate, not another memory file.
 *
 * Gate behavior: For each outbound delegate prompt, extract GitHub URLs, look
 * them up in the recent Alex-authored inbox (last 24h), and if the normalized
 * path matches but the case differs → rewrite in-place to the inbox-verbatim
 * form and emit a warning. Rewrite rather than reject so discovery-mode
 * delegates (where Alex never provided the URL) pass through untouched.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';

// =============================================================================
// URL extraction
// =============================================================================

// Matches GitHub URLs in three common case-sensitive forms:
//   https://github.com/<owner>/<repo>[/...]
//   https://api.github.com/repos/<owner>/<repo>[/...]
//   https://raw.githubusercontent.com/<owner>/<repo>/...
// Owner + repo are captured as separate groups to allow case-normalization on
// the path segments that matter (the first two) without touching branch/file
// segments that may legitimately differ in case.
const GITHUB_URL_PATTERN =
  /https?:\/\/(?:www\.)?(?:github\.com|api\.github\.com\/repos|raw\.githubusercontent\.com)\/([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)(?=[/\s)\]}"'`,;:?#]|$)/g;

export interface GitHubRef {
  /** The full matched URL prefix through owner/repo (no trailing path). */
  urlPrefix: string;
  /** Character offset of the match in the source text. */
  index: number;
  /** Original owner segment as it appeared. */
  owner: string;
  /** Original repo segment as it appeared. */
  repo: string;
  /** Lowercase "owner/repo" key used for case-insensitive lookup. */
  key: string;
}

export function extractGitHubRefs(text: string): GitHubRef[] {
  if (!text) return [];
  const refs: GitHubRef[] = [];
  // Reset regex state (global flag makes lastIndex stateful across calls).
  GITHUB_URL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = GITHUB_URL_PATTERN.exec(text)) !== null) {
    const [full, owner, repo] = m;
    refs.push({
      urlPrefix: full,
      index: m.index,
      owner,
      repo,
      key: `${owner.toLowerCase()}/${repo.toLowerCase()}`,
    });
  }
  return refs;
}

// =============================================================================
// Verbatim map — build from recent inbox
// =============================================================================

export interface VerbatimUrlRecord {
  /** Canonical form as Alex wrote it (first occurrence wins for stable behavior). */
  canonical: GitHubRef;
  /** Chat-room message id where this URL was first seen. */
  msgId: string;
  /** Author of the message (should be non-kuro). */
  from: string;
}

/**
 * Map keyed by lowercase "owner/repo" → verbatim ref as written by Alex.
 * Only the first occurrence wins so re-quoted (possibly mangled) versions
 * cannot overwrite the authoritative original.
 */
export type VerbatimUrlMap = Map<string, VerbatimUrlRecord>;

interface ChatMessage {
  id: string;
  from: string;
  text: string;
  ts: string;
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function buildVerbatimUrlMap(
  memoryDir: string,
  windowMs: number = DEFAULT_WINDOW_MS,
  nowMs: number = Date.now(),
): VerbatimUrlMap {
  const map: VerbatimUrlMap = new Map();
  const convDir = path.join(memoryDir, 'conversations');
  if (!existsSync(convDir)) return map;

  // Walk back up to 2 day-files to cover the window (today + yesterday).
  const cutoff = nowMs - windowMs;
  const days = dayStamps(nowMs, 2);

  for (const day of days) {
    const file = path.join(convDir, `${day}.jsonl`);
    if (!existsSync(file)) continue;
    let raw: string;
    try { raw = readFileSync(file, 'utf-8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let msg: ChatMessage;
      try { msg = JSON.parse(line) as ChatMessage; } catch { continue; }
      if (!msg?.text || !msg.from || !msg.ts) continue;
      // Only trust non-self senders; self-authored URLs could already be
      // mangled by the very failure mode this gate is preventing.
      if (msg.from === 'kuro') continue;
      const tsMs = Date.parse(msg.ts);
      if (!Number.isFinite(tsMs) || tsMs < cutoff) continue;
      for (const ref of extractGitHubRefs(msg.text)) {
        if (!map.has(ref.key)) {
          map.set(ref.key, { canonical: ref, msgId: msg.id, from: msg.from });
        }
      }
    }
  }
  return map;
}

function dayStamps(nowMs: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(nowMs - i * 24 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

// =============================================================================
// Enforcement
// =============================================================================

export interface UrlCaseRewrite {
  from: string;
  to: string;
  sourceMsgId: string;
}

export interface UrlCaseGateResult {
  prompt: string;
  rewrites: UrlCaseRewrite[];
}

/**
 * Scan the prompt for GitHub URLs; for any whose owner/repo case mismatches
 * the verbatim inbox version, rewrite to the verbatim form. Returns the
 * (possibly-rewritten) prompt plus a list of rewrites so callers can log.
 *
 * Non-goals:
 *  - We do NOT reject the delegation. Discovery prompts (URLs Alex never
 *    typed) must pass through unchanged.
 *  - We do NOT touch branch/file path segments past owner/repo; those are
 *    outside the failure mode we're guarding against.
 */
export function enforceUrlCase(
  prompt: string,
  verbatim: VerbatimUrlMap,
): UrlCaseGateResult {
  if (!prompt || verbatim.size === 0) return { prompt, rewrites: [] };
  const refs = extractGitHubRefs(prompt);
  if (refs.length === 0) return { prompt, rewrites: [] };

  const rewrites: UrlCaseRewrite[] = [];
  // Walk refs in reverse so earlier offsets stay valid as we splice.
  let out = prompt;
  const sorted = [...refs].sort((a, b) => b.index - a.index);
  for (const ref of sorted) {
    const record = verbatim.get(ref.key);
    if (!record) continue;
    const canon = record.canonical;
    if (canon.owner === ref.owner && canon.repo === ref.repo) continue;

    const correctedPrefix = canon.urlPrefix.replace(
      `${canon.owner}/${canon.repo}`,
      `${canon.owner}/${canon.repo}`,
    );
    // Replace only the exact owner/repo substring within this match to avoid
    // clobbering unrelated text. Rebuild the prefix using the verbatim owner
    // + verbatim repo while keeping the URL scheme/host from the original
    // match (both are host-case-insensitive so either is fine).
    const rewrittenPrefix = ref.urlPrefix.replace(
      new RegExp(`${escapeRegex(ref.owner)}\\/${escapeRegex(ref.repo)}`),
      `${canon.owner}/${canon.repo}`,
    );
    out = out.slice(0, ref.index) + rewrittenPrefix + out.slice(ref.index + ref.urlPrefix.length);
    rewrites.push({
      from: ref.urlPrefix,
      to: correctedPrefix,
      sourceMsgId: record.msgId,
    });
  }

  return { prompt: out, rewrites };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convenience wrapper: build the verbatim map and apply enforcement in one
 * call, logging any rewrites via slog. Designed to be called from the
 * dispatcher immediately before `spawnDelegation()`.
 */
export function applyUrlCaseGate(
  prompt: string,
  memoryDir: string,
): UrlCaseGateResult {
  let verbatim: VerbatimUrlMap;
  try {
    verbatim = buildVerbatimUrlMap(memoryDir);
  } catch (err) {
    slog('WARN', `url-case-gate: buildVerbatimUrlMap failed (fail-open): ${err instanceof Error ? err.message : err}`);
    return { prompt, rewrites: [] };
  }
  const result = enforceUrlCase(prompt, verbatim);
  for (const r of result.rewrites) {
    slog(
      'URL-CASE-GATE',
      `rewrote "${r.from}" → "${r.to}" (verbatim source: ${r.sourceMsgId})`,
    );
  }
  return result;
}
