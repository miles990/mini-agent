/**
 * Perspective — Cognitive Mesh context building + result flow-back
 *
 * buildContextForPerspective(): builds trimmed context for Specialist instances.
 * Specialists get ~5-10K context instead of Primary's ~50K.
 *
 * consumeMeshOutputs(): Primary reads task results from Specialists.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MeshTaskOutput, PerspectiveConfig } from './types.js';
import type { PerspectiveType } from './task-router.js';
import { getDataDir } from './instance.js';
import { slog } from './utils.js';
import { perceptionStreams } from './perception-stream.js';
import { formatPerceptionResults } from './perception.js';
import { getWorkspaceSnapshot, formatWorkspaceContext } from './workspace.js';

// =============================================================================
// Default Perspective Configs
// =============================================================================

const DEFAULT_PERSPECTIVES: Record<PerspectiveType, PerspectiveConfig> = {
  primary: {
    perception: 'all',
    skills: 'all',
    canWriteMemory: true,
    canSendTelegram: true,
    maxConcurrent: 1,
  },
  research: {
    perception: ['web', 'chrome', 'state-changes', 'environment-sense'],
    skills: [],
    canWriteMemory: false,
    canSendTelegram: false,
    maxConcurrent: 3,
  },
  code: {
    perception: ['tasks', 'state-changes', 'git-detail', 'github-issues', 'github-prs'],
    skills: [],
    canWriteMemory: false,
    canSendTelegram: false,
    maxConcurrent: 2,
  },
  chat: {
    perception: ['telegram-inbox', 'chat-room-inbox', 'state-changes', 'claude-code-inbox'],
    skills: [],
    canWriteMemory: false,
    canSendTelegram: false,
    maxConcurrent: 1,
  },
};

/**
 * Get perspective config, with optional compose overrides.
 */
export function getPerspectiveConfig(perspective: PerspectiveType): PerspectiveConfig {
  return DEFAULT_PERSPECTIVES[perspective] ?? DEFAULT_PERSPECTIVES.research;
}

// =============================================================================
// Build Context for Perspective (Specialist instances)
// =============================================================================

/**
 * Build a trimmed context for a Specialist instance.
 * ~5-10K chars instead of Primary's ~50K.
 *
 * Includes: environment, task, filtered perceptions, minimal workspace.
 * Excludes: SOUL, full conversations, achievements, pulse, commitments,
 *           HEARTBEAT, NEXT, threads, topic memory.
 */
export function buildContextForPerspective(
  perspective: PerspectiveType,
  taskPrompt: string,
): string {
  const config = getPerspectiveConfig(perspective);
  const sections: string[] = [];

  // ── Environment ──
  const now = new Date();
  const timeStr = now.toLocaleString('zh-TW', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hour12: false,
  });
  sections.push(
    `<environment>\nTime: ${timeStr}\nRole: specialist-${perspective}\nInstance: ${process.env.MINI_AGENT_INSTANCE || 'unknown'}\n</environment>`,
  );

  // ── Task ──
  sections.push(`<task>\n${taskPrompt}\n</task>`);

  // ── Constraints ──
  const constraints: string[] = [];
  if (!config.canWriteMemory) constraints.push('- Do NOT write to memory/ directory');
  if (!config.canSendTelegram) constraints.push('- Do NOT send Telegram notifications');
  constraints.push('- Do NOT read SOUL.md (identity belongs to Primary)');
  constraints.push('- Write results to mesh-output/ when done');
  sections.push(`<constraints>\n${constraints.join('\n')}\n</constraints>`);

  // ── Filtered Perceptions (from stream cache) ──
  if (perceptionStreams.isActive()) {
    const allCached = perceptionStreams.getCachedResults();
    const filtered = config.perception === 'all'
      ? allCached
      : allCached.filter(r => (config.perception as string[]).includes(r.name));

    if (filtered.length > 0) {
      const perceptionCtx = formatPerceptionResults(filtered);
      if (perceptionCtx) sections.push(perceptionCtx);
    }
  }

  // ── Minimal Workspace (always useful) ──
  const workspace = getWorkspaceSnapshot();
  const wsCtx = formatWorkspaceContext(workspace);
  if (wsCtx) sections.push(`<workspace>\n${wsCtx}\n</workspace>`);

  return sections.join('\n\n');
}

// =============================================================================
// Mesh Output (Result Flow-back)
// =============================================================================

const MESH_OUTPUT_DIR = 'mesh-output';

function getMeshOutputDir(): string {
  const dir = path.join(getDataDir(), MESH_OUTPUT_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Read and consume all pending mesh outputs (called by Primary).
 * Returns outputs and deletes the files.
 */
export function consumeMeshOutputs(): MeshTaskOutput[] {
  const dir = getMeshOutputDir();
  const outputs: MeshTaskOutput[] = [];

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const output: MeshTaskOutput = JSON.parse(raw);
        outputs.push(output);
        // Consume: delete after reading
        fs.unlinkSync(filePath);
      } catch {
        // Malformed — delete and skip
        try { fs.unlinkSync(filePath); } catch { /* ok */ }
      }
    }
  } catch { /* dir doesn't exist yet */ }

  if (outputs.length > 0) {
    slog('MESH', `Consumed ${outputs.length} mesh output(s)`);
  }

  return outputs;
}

/**
 * Build a mesh-completed section for Primary's context.
 * Similar to <background-completed> but for mesh Specialists.
 */
export function buildMeshCompletedSection(maxChars: number = 2000): string {
  const outputs = consumeMeshOutputs();
  if (outputs.length === 0) return '';

  const lines: string[] = ['<mesh-completed>'];
  let totalChars = 0;

  for (const out of outputs) {
    const line = `[${out.perspective}] ${out.status}: ${out.result}`;
    if (totalChars + line.length > maxChars) {
      lines.push(`... and ${outputs.length - lines.length + 1} more`);
      break;
    }
    lines.push(line);
    totalChars += line.length;
  }

  lines.push('</mesh-completed>');
  return lines.join('\n');
}

/**
 * Clean up old mesh outputs (> 24h). Called periodically.
 */
export function cleanupMeshOutputs(): void {
  const dir = getMeshOutputDir();
  const now = Date.now();
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          fs.unlinkSync(filePath);
        }
      } catch { /* skip */ }
    }
  } catch { /* ok */ }
}
