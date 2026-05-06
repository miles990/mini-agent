#!/usr/bin/env tsx
import {
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import {
  appendKGPromotionRecord,
  buildKGPromotionCandidates,
  candidateToKGTriple,
  getKGPromotionLedgerPath,
  type KGPromotionRecord,
  type KGPromotionTriple,
} from '../src/kg-promotion.js';
import { buildMemoryRepoHealthReport } from '../src/memory-repo-policy.js';

const repoRoot = process.cwd();
const memoryDir = path.resolve(
  readArg('--memory-dir')
    ?? process.env.MINI_AGENT_MEMORY_DIR
    ?? path.join(path.dirname(repoRoot), 'mini-agent-memory', 'memory'),
);
const kgUrl = String(readArg('--kg-url') ?? process.env.KG_SERVICE_URL ?? 'http://localhost:3300').replace(/\/$/, '');
const namespace = String(readArg('--namespace') ?? 'kuro');
const sourceAgent = String(readArg('--source-agent') ?? 'kuro');
const limit = Math.max(1, Math.min(Number(readArg('--limit') ?? 20) || 20, 100));
const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dry');
const recordDryRun = process.argv.includes('--record-dry-run');

if (!existsSync(memoryDir)) fail(`memory dir does not exist: ${memoryDir}`);

const report = buildMemoryRepoHealthReport(memoryDir, collectFiles(memoryDir));
const candidates = buildKGPromotionCandidates(memoryDir, report.kgCandidates, limit);
const triples = candidates.map(candidate => candidateToKGTriple(candidate, { namespace, sourceAgent }));

if (dryRun) {
  if (recordDryRun) {
    for (const candidate of candidates) {
      appendKGPromotionRecord(memoryDir, recordFor('dry-run', candidate, kgUrl, namespace, sourceAgent));
    }
  }
  writeSummary({ dryRun: true, candidates: candidates.length, promoted: 0, failed: 0, triples });
  process.exit(0);
}

let promoted = 0;
let failed = 0;

if (triples.length > 0) {
  try {
    const result = await pushTriples(kgUrl, triples);
    promoted = result.created;
    failed = result.failed;
    for (let i = 0; i < candidates.length; i++) {
      appendKGPromotionRecord(
        memoryDir,
        recordFor(i < promoted ? 'promoted' : 'failed', candidates[i], kgUrl, namespace, sourceAgent, i < promoted ? undefined : 'KG service did not accept this triple'),
      );
    }
  } catch (err) {
    failed = candidates.length;
    const message = err instanceof Error ? err.message : String(err);
    for (const candidate of candidates) {
      appendKGPromotionRecord(memoryDir, recordFor('failed', candidate, kgUrl, namespace, sourceAgent, message));
    }
  }
}

writeSummary({ dryRun: false, candidates: candidates.length, promoted, failed, triples });

function recordFor(
  status: KGPromotionRecord['status'],
  candidate: (typeof candidates)[number],
  targetKgUrl: string,
  targetNamespace: string,
  targetSourceAgent: string,
  error?: string,
): KGPromotionRecord {
  return {
    ts: new Date().toISOString(),
    status,
    relPath: candidate.relPath,
    title: candidate.title,
    sha1: candidate.sha1,
    confidence: candidate.confidence,
    scope: candidate.scope,
    kgUrl: targetKgUrl,
    namespace: targetNamespace,
    sourceAgent: targetSourceAgent,
    tripleSubject: candidate.title,
    ...(error ? { error: error.slice(0, 500) } : {}),
  };
}

async function pushTriples(targetKgUrl: string, batch: KGPromotionTriple[]): Promise<{ created: number; failed: number }> {
  const resp = await fetch(`${targetKgUrl}/api/write/triples`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ triples: batch }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`KG service returned ${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json() as { summary?: { created?: number; failed?: number } };
  return {
    created: data.summary?.created ?? batch.length,
    failed: data.summary?.failed ?? 0,
  };
}

function writeSummary(data: {
  dryRun: boolean;
  candidates: number;
  promoted: number;
  failed: number;
  triples: KGPromotionTriple[];
}): void {
  process.stdout.write(JSON.stringify({
    memoryDir,
    ledgerPath: getKGPromotionLedgerPath(memoryDir),
    kgUrl,
    namespace,
    sourceAgent,
    dryRun: data.dryRun,
    candidates: data.candidates,
    promoted: data.promoted,
    failed: data.failed,
    sample: data.triples.slice(0, 5).map(triple => ({
      subject: triple.subject,
      source_file: triple.properties.source_file,
      confidence: triple.confidence,
      scope: triple.properties.scope,
    })),
  }, null, 2) + '\n');
}

function collectFiles(root: string): Array<{ relPath: string; bytes: number }> {
  const out: Array<{ relPath: string; bytes: number }> = [];
  walk(root, '');
  return out;

  function walk(absDir: string, relDir: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        out.push({ relPath: rel, bytes: statSync(abs).size });
      }
    }
  }
}

function readArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function fail(message: string): never {
  process.stderr.write(`[kg-promote-memory] ${message}\n`);
  process.exit(1);
}
