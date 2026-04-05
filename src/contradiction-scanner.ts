/**
 * Contradiction Scanner — 週期性掃描 source_* 記憶檔案的矛盾
 *
 * 工作流程：
 * 1. 讀取所有 source_* 記憶檔案，提取 name + description frontmatter
 * 2. 依主題群組分類（ISC、multi-agent、constraint、LLM behavior 等）
 * 3. 以 Claude Haiku CLI subprocess 識別真正矛盾（非互補觀點）
 * 4. 把結果寫入 memory/contradiction-report.md
 *
 * 設計原則：
 * - Fire-and-forget（不阻塞主迴圈）
 * - Idempotent（重複執行安全）
 * - 只用 Claude CLI subprocess，不走 Anthropic SDK
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { slog } from './utils.js';

// =============================================================================
// Constants
// =============================================================================

const MEMORY_DIR = path.join(
  process.env.HOME ?? '/tmp',
  '.claude/projects/-Users-user--mini-agent-subprocess/memory',
);
const REPORT_PATH = path.join(process.cwd(), 'memory', 'contradiction-report.md');
const SUBPROCESS_CWD = path.join(process.env.HOME ?? '/tmp', '.mini-agent-subprocess');
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SCAN_TIMEOUT_MS = 120_000; // 2 minutes — Haiku is fast

// =============================================================================
// Types
// =============================================================================

interface SourceFile {
  filename: string;
  name: string;
  description: string;
  rawContent: string;
}

interface ThemeCluster {
  theme: string;
  files: SourceFile[];
}

// =============================================================================
// Step 1 — Read all source_* files and extract frontmatter metadata
// =============================================================================

function readSourceFiles(): SourceFile[] {
  if (!fs.existsSync(MEMORY_DIR)) {
    slog('CONTRADICTION-SCANNER', `memory dir not found: ${MEMORY_DIR}`);
    return [];
  }

  const entries = fs.readdirSync(MEMORY_DIR).filter(f => f.startsWith('source_') && f.endsWith('.md'));
  const results: SourceFile[] = [];

  for (const filename of entries) {
    try {
      const raw = fs.readFileSync(path.join(MEMORY_DIR, filename), 'utf-8');
      const nameMatch = raw.match(/^name:\s*(.+)$/m);
      const descMatch = raw.match(/^description:\s*(.+)$/m);
      results.push({
        filename,
        name: nameMatch?.[1]?.trim() ?? filename.replace(/\.md$/, ''),
        description: descMatch?.[1]?.trim() ?? '(no description)',
        rawContent: raw,
      });
    } catch {
      // Skip unreadable files — non-critical
    }
  }

  slog('CONTRADICTION-SCANNER', `read ${results.length} source files`);
  return results;
}

// =============================================================================
// Step 2 — Group into theme clusters via keyword matching
// =============================================================================

const THEME_KEYWORDS: Record<string, string[]> = {
  'multi-agent coordination': ['multi-agent', 'multi_agent', 'coordination', 'team', 'fleet', 'swarm', 'emergent'],
  'constraint theory (ISC)': ['constraint', 'isc', 'protective', 'convergence condition', 'prescription'],
  'LLM behavior & alignment': ['alignment', 'llm', 'sycophancy', 'hallucination', 'cognitive', 'rlhf', 'training'],
  'interface & cognition': ['interface', 'cognition', 'affordance', 'grounding', 'boundary'],
  'agent memory & architecture': ['memory', 'architecture', 'context', 'retrieval', 'storage'],
  'AI productivity & tooling': ['productivity', 'tool', 'developer', 'coding', 'vibe', 'craft'],
};

function groupIntoClusters(files: SourceFile[]): ThemeCluster[] {
  const clusterMap = new Map<string, SourceFile[]>(
    Object.keys(THEME_KEYWORDS).map(t => [t, []]),
  );
  const uncategorized: SourceFile[] = [];

  for (const file of files) {
    const combined = (file.description + ' ' + file.name).toLowerCase();
    let placed = false;

    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      if (keywords.some(kw => combined.includes(kw))) {
        clusterMap.get(theme)!.push(file);
        placed = true;
        break; // First-match wins — keep clusters non-overlapping for cleaner prompts
      }
    }

    if (!placed) {
      uncategorized.push(file);
    }
  }

  // Only return clusters with 2+ files (need pairs to contradict)
  const clusters: ThemeCluster[] = [];
  for (const [theme, clusterFiles] of clusterMap) {
    if (clusterFiles.length >= 2) {
      clusters.push({ theme, files: clusterFiles });
    }
  }
  if (uncategorized.length >= 2) {
    clusters.push({ theme: 'other', files: uncategorized });
  }

  slog('CONTRADICTION-SCANNER', `grouped into ${clusters.length} theme clusters`);
  return clusters;
}

// =============================================================================
// Step 3 — Build prompt from clusters (claim list, not full content)
// =============================================================================

function buildScanPrompt(clusters: ThemeCluster[]): string {
  const sections: string[] = [];

  sections.push(`You are scanning a research memory archive for genuine contradictions.

IMPORTANT DISTINCTIONS:
- Contradiction: two claims that cannot both be true (e.g., "more agents = better performance" vs "multi-agent teams underperform best member")
- Complementary: two claims that are compatible or address different aspects (not a contradiction)
- Context-dependent: claims true in different conditions (note the conditions, not a flat contradiction)

For each GENUINE contradiction found, output:
  CONTRADICTION: <File A> vs <File B>
  Claim A: <one sentence>
  Claim B: <one sentence>
  Tension: <one sentence explaining why they conflict>

If no genuine contradictions exist in a cluster, output: CLUSTER <theme>: no contradictions found

---
`);

  for (const cluster of clusters) {
    sections.push(`## Cluster: ${cluster.theme}\n`);
    for (const file of cluster.files) {
      sections.push(`- [${file.name}] ${file.description}`);
    }
    sections.push('');
  }

  sections.push('Scan all clusters above. Be precise — only flag genuine contradictions, not complementary perspectives.');

  return sections.join('\n');
}

// =============================================================================
// Step 4 — Call Claude Haiku via CLI subprocess
// =============================================================================

function callHaiku(prompt: string): Promise<string | null> {
  if (!existsSync(SUBPROCESS_CWD)) {
    mkdirSync(SUBPROCESS_CWD, { recursive: true });
  }

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'),
  );

  return new Promise<string | null>((resolve) => {
    const args = ['-p', '--model', HAIKU_MODEL, '--output-format', 'text'];

    const child = spawn('claude', args, {
      env,
      cwd: SUBPROCESS_CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let settled = false;

    const settle = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      slog('CONTRADICTION-SCANNER', `Haiku subprocess timed out after ${SCAN_TIMEOUT_MS}ms`);
      settle(null);
    }, SCAN_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) slog('CONTRADICTION-SCANNER', `haiku stderr: ${msg.slice(0, 200)}`);
    });

    child.on('error', (err) => {
      slog('CONTRADICTION-SCANNER', `haiku spawn error: ${err.message}`);
      settle(null);
    });

    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        settle(stdout.trim());
      } else {
        slog('CONTRADICTION-SCANNER', `haiku exited with code=${code}`);
        settle(null);
      }
    });

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

// =============================================================================
// Step 5 — Write report to memory/contradiction-report.md
// =============================================================================

function writeReport(rawOutput: string | null, fileCount: number, clusterCount: number): void {
  const now = new Date().toISOString().slice(0, 16);

  const lines: string[] = [];
  lines.push(`# Contradiction Report`);
  lines.push(``);
  lines.push(`Generated: ${now}  `);
  lines.push(`Scanned: ${fileCount} source files across ${clusterCount} theme clusters`);
  lines.push(``);

  if (!rawOutput) {
    lines.push(`## Status`);
    lines.push(``);
    lines.push(`Scan failed or timed out. Will retry next scheduled run.`);
  } else {
    lines.push(`## Findings`);
    lines.push(``);
    lines.push(rawOutput);
  }

  const reportDir = path.dirname(REPORT_PATH);
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf-8');
  slog('CONTRADICTION-SCANNER', `report written to ${REPORT_PATH}`);
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Scan source_* memory files for contradictions and write a report.
 *
 * Idempotent — safe to call multiple times.
 * Does not throw — all errors are logged and gracefully swallowed.
 */
export async function scanContradictions(): Promise<void> {
  slog('CONTRADICTION-SCANNER', 'starting scan');

  try {
    const files = readSourceFiles();
    if (files.length < 2) {
      slog('CONTRADICTION-SCANNER', 'fewer than 2 source files — skipping scan');
      return;
    }

    const clusters = groupIntoClusters(files);
    if (clusters.length === 0) {
      slog('CONTRADICTION-SCANNER', 'no clusters with 2+ files — skipping scan');
      return;
    }

    const prompt = buildScanPrompt(clusters);
    slog('CONTRADICTION-SCANNER', `prompt length: ${prompt.length} chars, calling Haiku`);

    const output = await callHaiku(prompt);

    writeReport(output, files.length, clusters.length);
    slog('CONTRADICTION-SCANNER', output ? 'scan complete' : 'scan completed with null output');
  } catch (err) {
    slog('CONTRADICTION-SCANNER', `unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    // Non-critical — don't re-throw
  }
}
