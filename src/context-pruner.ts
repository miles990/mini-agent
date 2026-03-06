/**
 * Context Pruner — Haiku-driven topic memory pruning
 *
 * Daily job: reads topic files, sends to Haiku for analysis,
 * saves pruning proposals as markdown diff for Kuro review.
 *
 * ACE Anti-Collapse Guardrail: cross-domain insights (analogies,
 * isomorphisms, cross-field connections) are NEVER auto-deleted.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { readState, writeState } from './feedback-loops.js';

// =============================================================================
// Types
// =============================================================================

interface PrunerState {
  lastRun: string;
  lastTopic: string;
  proposalsPending: number;
}

export interface PruningProposal {
  deletions: Array<{ line: string; reason: string }>;
  keeps: Array<{ line: string }>;
}

// =============================================================================
// Constants
// =============================================================================

const STATE_FILE = 'context-pruner.json';
const PROPOSALS_DIR = 'pruning-proposals';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 30_000;

/**
 * ACE Anti-Collapse: patterns indicating cross-domain insights.
 * Entries matching these are NEVER proposed for deletion, regardless
 * of what Haiku suggests. This prevents knowledge collapse where
 * valuable cross-field connections get pruned as "irrelevant".
 */
const CROSS_DOMAIN_PATTERNS = [
  /cross.domain/i,
  /isomorphi/i,
  /analog(?:y|ous)/i,
  /maps?\s+to\b/i,
  /similar\s+to\b.*(?:in|from)\b/i,
  /reminds?\s+(?:me\s+)?of\b/i,
  /same\s+(?:pattern|structure|principle)/i,
  /connects?\s+(?:to|with)\b/i,
  /parallels?\s+(?:between|with)/i,
];

function isCrossDomainInsight(line: string): boolean {
  return CROSS_DOMAIN_PATTERNS.some(p => p.test(line));
}

// =============================================================================
// Prompt & Parse
// =============================================================================

export function generatePruningPrompt(topicName: string, content: string): string {
  return `You are analyzing a topic memory file for an AI agent. Your job is to identify entries that should be DELETED because they are:
1. Duplicates (same information stated differently)
2. Outdated facts (superseded by newer entries)
3. Ephemeral data (specific values/metrics that aren't reusable knowledge)

IMPORTANT — You must ALWAYS KEEP and never delete:
- Cross-domain insights (connections between different fields, e.g. "X maps to Y", "X is isomorphic to Y")
- Opinions and perspectives (subjective judgments)
- Reusable patterns (applicable to future decisions)
- Unique knowledge not duplicated elsewhere

For each entry, respond with either:
DELETE: [the full entry line]
REASON: [why it should be deleted]

or:
KEEP: [the full entry line]

Topic: "${topicName}"
Content:
${content}`;
}

export function parsePruningProposal(response: string): PruningProposal {
  const deletions: Array<{ line: string; reason: string }> = [];
  const keeps: Array<{ line: string }> = [];

  const lines = response.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('DELETE:')) {
      const entryLine = line.replace(/^DELETE:\s*/, '').trim();
      const nextLine = lines[i + 1]?.trim() ?? '';
      const reason = nextLine.startsWith('REASON:')
        ? nextLine.replace(/^REASON:\s*/, '').trim()
        : 'No reason given';

      if (entryLine) {
        // ACE guardrail: reject deletion of cross-domain insights
        if (isCrossDomainInsight(entryLine)) {
          keeps.push({ line: entryLine });
        } else {
          deletions.push({ line: entryLine, reason });
        }
      }
    } else if (line.startsWith('KEEP:')) {
      const entryLine = line.replace(/^KEEP:\s*/, '').trim();
      if (entryLine) {
        keeps.push({ line: entryLine });
      }
    }
  }

  return { deletions, keeps };
}

// =============================================================================
// Haiku Subprocess
// =============================================================================

async function callHaiku(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--model', HAIKU_MODEL, '--output-format', 'text'],
      {
        env: { ...process.env, ANTHROPIC_API_KEY: undefined, CLAUDECODE: undefined },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', (err) => reject(new Error(`spawn error: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Haiku exit ${code}: ${stderr.slice(0, 200)}`));
      }
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Haiku timeout'));
    }, TIMEOUT_MS);
    child.on('close', () => clearTimeout(timer));

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// =============================================================================
// Core Logic
// =============================================================================

/**
 * Run Haiku pruning on a single topic file.
 * Returns proposal or null if no deletions suggested.
 */
export async function pruneTopicFile(
  topicPath: string,
  topicName: string,
): Promise<PruningProposal | null> {
  const content = fs.readFileSync(topicPath, 'utf-8');

  // Skip small files (not worth pruning)
  if (content.length < 500) return null;

  const prompt = generatePruningPrompt(topicName, content);

  try {
    const result = await callHaiku(prompt);
    const proposal = parsePruningProposal(result);
    if (proposal.deletions.length === 0) return null;
    return proposal;
  } catch (error) {
    slog('PRUNER', `Haiku call failed for ${topicName}: ${error}`);
    return null;
  }
}

/**
 * Save a pruning proposal as markdown diff for review.
 */
export function savePruningProposal(
  memoryDir: string,
  topicName: string,
  proposal: PruningProposal,
): string {
  const dir = path.join(memoryDir, PROPOSALS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-prune-${topicName}.md`;
  const filepath = path.join(dir, filename);

  const lines = [
    `# Pruning Proposal: ${topicName}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Proposed Deletions',
    '',
    ...proposal.deletions.map(d =>
      `- \`${d.line.slice(0, 100)}\`\n  Reason: ${d.reason}`
    ),
    '',
    '## Entries to Keep',
    '',
    ...proposal.keeps.map(k => `- ${k.line.slice(0, 100)}`),
    '',
    '---',
    'To apply: Kuro reviews and uses `<kuro:action>` to delete approved lines.',
  ];

  fs.writeFileSync(filepath, lines.join('\n'));
  return filepath;
}

/**
 * Daily pruning job: process one topic file per run (round-robin).
 * Called from loop.ts on daily schedule.
 */
export async function runDailyPruning(memoryDir: string): Promise<void> {
  const state = readState<PrunerState>(STATE_FILE, {
    lastRun: '',
    lastTopic: '',
    proposalsPending: 0,
  });

  // Check if already ran today
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastRun === today) return;

  // List topic files
  const topicsDir = path.join(memoryDir, 'topics');
  if (!fs.existsSync(topicsDir)) return;

  const topics = fs.readdirSync(topicsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));

  if (topics.length === 0) return;

  // Round-robin: pick next topic after lastTopic
  const lastIdx = topics.indexOf(state.lastTopic);
  const nextIdx = (lastIdx + 1) % topics.length;
  const topicName = topics[nextIdx];
  const topicPath = path.join(topicsDir, `${topicName}.md`);

  slog('PRUNER', `Analyzing topic: ${topicName}`);

  const proposal = await pruneTopicFile(topicPath, topicName);

  if (proposal) {
    const filepath = savePruningProposal(memoryDir, topicName, proposal);
    state.proposalsPending++;
    slog('PRUNER', `Proposal saved: ${filepath} (${proposal.deletions.length} deletions)`);
  } else {
    slog('PRUNER', `No pruning needed for ${topicName}`);
  }

  // Weekly cold storage migration (every Sunday)
  if (new Date().getDay() === 0) {
    try {
      const { migrateToColdStorage } = await import('./context-optimizer.js');
      const result = migrateToColdStorage(memoryDir, 30);
      if (result.migrated > 0) {
        slog('PRUNER', `Cold storage: migrated ${result.migrated} entries`);
      }
    } catch { /* ignore */ }
  }

  state.lastRun = today;
  state.lastTopic = topicName;
  writeState(STATE_FILE, state);
}
