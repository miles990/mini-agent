/**
 * Perspective System — Cognitive Mesh Phase 3b
 *
 * Same identity (SOUL.md), different attention focus.
 * Each Perspective defines which perceptions and skills to load,
 * reducing context size for Specialist instances.
 *
 * Primary: full context (~50K chars)
 * chat:    base + 3 perceptions + 2 skills (~15K chars, 30%)
 * research: base + 4 perceptions + 2 skills (~20K chars, 40%)
 * code:    base + 4 perceptions + 2 skills (~18K chars, 36%)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PerspectiveConfig, MeshTaskOutput, ComposeAgentV2 } from './types.js';
import type { PerspectiveType } from './task-router.js';
import { getDataDir } from './instance.js';
import { slog } from './utils.js';

// =============================================================================
// Default Perspectives
// =============================================================================

const DEFAULT_PERSPECTIVES: Record<PerspectiveType, PerspectiveConfig> = {
  primary: {
    perception: 'all',
    skills: 'all',
    canWriteMemory: true,
    canSendTelegram: true,
    maxConcurrent: 1,
  },
  chat: {
    perception: ['telegram-inbox', 'chat-room-inbox', 'focus-context'],
    skills: ['web-research', 'discussion-participation'],
    canWriteMemory: false,
    canSendTelegram: true,
    maxConcurrent: 1,
  },
  research: {
    perception: ['web', 'chrome', 'x-feed', 'environment-sense'],
    skills: ['web-research', 'web-learning'],
    canWriteMemory: false,
    canSendTelegram: false,
    maxConcurrent: 2,
  },
  code: {
    perception: ['workspace', 'state-changes', 'github-issues', 'github-prs'],
    skills: ['debug-helper', 'github-ops'],
    canWriteMemory: false,
    canSendTelegram: false,
    maxConcurrent: 2,
  },
};

// Active perspective for this instance
let currentPerspective: PerspectiveType = 'primary';
let perspectiveConfig: PerspectiveConfig = DEFAULT_PERSPECTIVES.primary;

// =============================================================================
// Perspective Management
// =============================================================================

/**
 * Set the perspective for this instance.
 */
export function setPerspective(perspective: PerspectiveType, config?: PerspectiveConfig): void {
  currentPerspective = perspective;
  perspectiveConfig = config ?? DEFAULT_PERSPECTIVES[perspective] ?? DEFAULT_PERSPECTIVES.primary;
}

/**
 * Get current perspective.
 */
export function getCurrentPerspective(): PerspectiveType {
  return currentPerspective;
}

/**
 * Get current perspective config.
 */
export function getPerspectiveConfig(): PerspectiveConfig {
  return perspectiveConfig;
}

/**
 * Check if a perception plugin should be loaded for current perspective.
 */
export function shouldLoadPerception(pluginName: string): boolean {
  if (perspectiveConfig.perception === 'all') return true;
  return perspectiveConfig.perception.includes(pluginName);
}

/**
 * Check if a skill should be loaded for current perspective.
 */
export function shouldLoadSkill(skillName: string): boolean {
  if (perspectiveConfig.skills === 'all') return true;
  return perspectiveConfig.skills.includes(skillName);
}

/**
 * Get default perspective config by type.
 */
export function getDefaultPerspective(type: PerspectiveType): PerspectiveConfig {
  return DEFAULT_PERSPECTIVES[type] ?? DEFAULT_PERSPECTIVES.primary;
}

// =============================================================================
// Compose v2 Integration
// =============================================================================

/**
 * Load perspectives from compose v2 agent config.
 * Falls back to defaults if no perspectives defined (v1 compat).
 */
export function loadPerspectives(agent: ComposeAgentV2): Record<string, PerspectiveConfig> {
  if (agent.perspectives) {
    return agent.perspectives;
  }
  // v1 compatibility: no perspectives = pure primary
  return { primary: DEFAULT_PERSPECTIVES.primary };
}

// =============================================================================
// Mesh Output (Result Flow-back)
// =============================================================================

const MESH_OUTPUT_DIR = 'mesh-output';

/**
 * Get the mesh output directory path.
 */
function getMeshOutputDir(): string {
  const dir = path.join(getDataDir(), MESH_OUTPUT_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Write task output (called by Specialist instances).
 */
export function writeMeshOutput(output: MeshTaskOutput): void {
  const dir = getMeshOutputDir();
  const filename = `${output.taskId}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(output, null, 2));
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
