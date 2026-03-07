/**
 * Mesh Output — Cognitive Mesh result flow-back
 *
 * Primary instance consumes task outputs from Specialist instances.
 * Specialists write JSON files to mesh-output/, Primary reads and deletes them.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { MeshTaskOutput } from './types.js';
import { getDataDir } from './instance.js';
import { slog } from './utils.js';

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
