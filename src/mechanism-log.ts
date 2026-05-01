/**
 * Mechanism Log — audit trail for attention/output mechanisms.
 * Append-only JSONL, auto-rotates at 7 days.
 */

import fs from 'node:fs';
import path from 'node:path';

const LOG_FILE = 'mechanism-log.jsonl';
const ROTATE_DAYS = 7;

interface LogEntry {
  ts: string;
  mechanism: 'output-gate' | 'attention-balance' | 'goal-advancer' | 'scheduler';
  action: string;
  reason: string;
  data?: Record<string, unknown>;
}

function getLogPath(memoryDir: string): string {
  const stateDir = path.join(memoryDir, 'state');
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, LOG_FILE);
}

export function logMechanism(memoryDir: string, entry: Omit<LogEntry, 'ts'>): void {
  try {
    const logPath = getLogPath(memoryDir);
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(logPath, line);
  } catch { /* non-critical */ }
}

export function rotateMechanismLog(memoryDir: string): void {
  try {
    const logPath = getLogPath(memoryDir);
    if (!fs.existsSync(logPath)) return;
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    if (lines.length < 500) return;
    const cutoff = Date.now() - ROTATE_DAYS * 86_400_000;
    const kept = lines.filter(l => {
      try { return new Date(JSON.parse(l).ts).getTime() > cutoff; } catch { return true; }
    });
    fs.writeFileSync(logPath, kept.join('\n') + '\n');
  } catch { /* non-critical */ }
}
