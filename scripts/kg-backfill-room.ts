#!/usr/bin/env tsx
/**
 * KG Room Backfill — import existing JSONL conversation messages into KG Discussion.
 *
 * Usage:
 *   pnpm tsx scripts/kg-backfill-room.ts [--date 2026-04-21] [--dry-run]
 *
 * Reads memory/conversations/YYYY-MM-DD.jsonl, creates a KG discussion for that day,
 * and adds each message as a position with full text preserved.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const KG_SERVICE = 'http://localhost:3300';
const DRY_RUN = process.argv.includes('--dry-run');
const NAMESPACE = 'kuro';

const dateArg = process.argv.find((_, i, a) => a[i - 1] === '--date');
const targetDate = dateArg || new Date().toISOString().slice(0, 10);

interface RoomMessage {
  id: string;
  from: string;
  text: string;
  ts: string;
  replyTo?: string;
  mentions?: string[];
}

async function ensureDiscussion(date: string): Promise<string | null> {
  const topic = `room-${date}`;

  // Check existing
  const listResp = await fetch(`${KG_SERVICE}/api/discussions?namespace=${NAMESPACE}&status=open`);
  if (listResp.ok) {
    const { discussions } = await listResp.json() as { discussions: Array<{ id: string; topic: string }> };
    const existing = discussions.find(d => d.topic === topic);
    if (existing) return existing.id;
  }

  // Create new
  const resp = await fetch(`${KG_SERVICE}/api/discussion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      description: `Chat Room conversation for ${date} (backfilled)`,
      source_agent: 'claude-code',
      namespace: NAMESPACE,
      participants: ['alex', 'kuro', 'claude-code'],
    }),
  });
  if (!resp.ok) return null;
  const { discussion_id } = await resp.json() as { discussion_id: string };
  return discussion_id;
}

async function main() {
  console.log(`KG Room Backfill — date: ${targetDate}, dry-run: ${DRY_RUN}`);

  // Check KG health
  try {
    const resp = await fetch(`${KG_SERVICE}/health`);
    if (!resp.ok) throw new Error(`${resp.status}`);
    console.log('✓ KG service healthy');
  } catch {
    console.error(`✗ KG service not reachable at ${KG_SERVICE}`);
    process.exit(1);
  }

  // Read JSONL
  const convPath = path.join(ROOT, 'memory', 'conversations', `${targetDate}.jsonl`);
  if (!fs.existsSync(convPath)) {
    console.error(`✗ No conversation file: ${convPath}`);
    process.exit(1);
  }

  const messages: RoomMessage[] = [];
  for (const line of fs.readFileSync(convPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as RoomMessage);
    } catch { /* skip */ }
  }
  console.log(`  ${messages.length} messages found`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would push:');
    for (const m of messages.slice(0, 5)) {
      console.log(`  [${m.id}] ${m.from}: ${m.text.slice(0, 80)}...`);
    }
    if (messages.length > 5) console.log(`  ... and ${messages.length - 5} more`);
    return;
  }

  // Ensure discussion
  const discussionId = await ensureDiscussion(targetDate);
  if (!discussionId) {
    console.error('✗ Failed to create discussion');
    process.exit(1);
  }
  console.log(`  Discussion: ${discussionId}`);

  // Push messages as positions
  let pushed = 0;
  let failed = 0;
  for (const m of messages) {
    try {
      const resp = await fetch(`${KG_SERVICE}/api/discussion/${discussionId}/position`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${m.from}: ${m.text.slice(0, 80)}`,
          content: m.text,
          type: 'observation',
          confidence: 0.9,
          source_agent: m.from,
          relation: 'HAS_POSITION',
          properties: {
            roomMsgId: m.id,
            ...(m.replyTo ? { replyTo: m.replyTo } : {}),
            ts: m.ts,
          },
        }),
      });
      if (resp.ok) pushed++;
      else failed++;
    } catch {
      failed++;
    }
  }

  console.log(`\n✓ Done: ${pushed} pushed, ${failed} failed`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
