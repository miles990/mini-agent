#!/usr/bin/env node
// Phase E.2: extend backfill to historical 'expired' entries.
// Phase E (commit f072d03b) only handled status=pending, leaving 1740 legacy
// expired entries with no counterparty — they all inflated PERFORMATIVE
// SKEPTICISM despite ~75% being unacked counterparty asks (decision table row #2).
//
// Heuristic identical to backfill-counterparty.mjs. For each unmigrated expired:
//   counterparty.kind === 'agent' → reclassify to status='abandoned' (no ack)
//   counterparty.kind === 'self'  → keep status='expired', just add cp field

import { readFileSync, appendFileSync } from 'node:fs';

const path = 'memory/state/commitments.jsonl';
const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);

const latest = new Map();
for (const ln of lines) {
  try { const e = JSON.parse(ln); if (e.id) latest.set(e.id, e); } catch {}
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

const ts = new Date().toISOString();
const newLines = [];
const stats = { abandoned: 0, expired_kept: 0, by_kind: {} };

for (const e of latest.values()) {
  if (e.status !== 'expired') continue;
  if (e.counterparty) continue; // already migrated

  const cp = inferCounterparty(`${e.prediction || ''} ${e.falsifier || ''}`);
  const k = cp.kind === 'agent' ? `agent:${cp.agent_id}` : cp.kind;
  stats.by_kind[k] = (stats.by_kind[k] || 0) + 1;

  const updated = { ...e, counterparty: cp, _migrated_at: ts };
  if (cp.kind === 'agent') {
    updated.status = 'abandoned';
    updated.resolution_evidence = `backfilled: counterparty=${cp.agent_id} never acked (Phase E.2)`;
    stats.abandoned++;
  } else {
    stats.expired_kept++;
  }
  newLines.push(JSON.stringify(updated));
}

if (newLines.length > 0) {
  appendFileSync(path, newLines.join('\n') + '\n');
}

console.log(JSON.stringify({
  scanned_expired: stats.abandoned + stats.expired_kept,
  reclassified_to_abandoned: stats.abandoned,
  kept_as_expired_self: stats.expired_kept,
  by_kind: stats.by_kind,
  appended_lines: newLines.length,
}, null, 2));
