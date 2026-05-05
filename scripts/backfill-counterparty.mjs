#!/usr/bin/env node
// Backfill counterparty for legacy pending commitments.
// Phase E: gives Phase A-D pipeline (2cc0b3ce → 75ba0ed4 → b5cadae4) live data
// to actually branch on. Without this, expireOverdueCommitments never produces
// `abandoned` because no entry carries counterparty.
//
// Heuristic (text-based):
//   - mentions Alex / @kuro / chat / reply / 回覆 / GitHub issue / op7418 → agent:alex
//   - mentions akari / claude-code → agent:<that>
//   - else → self
//
// Latest-by-id wins on read, so we just append rewritten entries (no rewrite
// of historical lines, no risk of losing append-only audit).

import { readFileSync, appendFileSync } from 'node:fs';

const path = 'memory/state/commitments.jsonl';
const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);

// Latest-by-id snapshot
const latest = new Map();
for (const ln of lines) {
  try {
    const e = JSON.parse(ln);
    if (e.id) latest.set(e.id, e);
  } catch {}
}

function inferCounterparty(text) {
  const t = (text || '').toLowerCase();
  if (/akari/.test(t)) return { kind: 'agent', agent_id: 'akari' };
  if (/claude[-_ ]code/.test(t)) return { kind: 'agent', agent_id: 'claude-code' };
  if (/op7418/.test(t)) return { kind: 'agent', agent_id: 'op7418' };
  if (/alex|@kuro|chat|reply|回覆|github issue|gh issue|hn cron|cron/.test(t)) {
    return { kind: 'agent', agent_id: 'alex' };
  }
  return { kind: 'self' };
}

let appended = 0;
const ts = new Date().toISOString();
const newLines = [];
for (const e of latest.values()) {
  if (e.status !== 'pending') continue;
  if (e.counterparty) continue; // already migrated
  const cp = inferCounterparty(`${e.prediction || ''} ${e.falsifier || ''}`);
  // writer guard: ack_at requires counterparty, so we leave ack_at undefined
  const updated = { ...e, counterparty: cp, _migrated_at: ts };
  newLines.push(JSON.stringify(updated));
  appended++;
}

if (newLines.length > 0) {
  appendFileSync(path, newLines.join('\n') + '\n');
}

console.log(JSON.stringify({
  scanned: latest.size,
  pending_without_counterparty: appended,
  appended,
  by_kind: newLines.reduce((acc, ln) => {
    const cp = JSON.parse(ln).counterparty;
    const k = cp.kind === 'agent' ? `agent:${cp.agent_id}` : cp.kind;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {}),
}, null, 2));
