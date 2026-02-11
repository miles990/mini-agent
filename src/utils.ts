/**
 * Shared Utilities — Minimal Core Enhanced
 *
 * slog + diagLog + behaviorLog + structuredLog + activitySummary
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// =============================================================================
// slog — Server Log Helper
// =============================================================================

let slogPrefix = '';

export function setSlogPrefix(instanceId: string, name?: string): void {
  const short = instanceId.slice(0, 8);
  slogPrefix = name ? `${short}|${name}` : short;
}

/** Timestamped console log for server.log observability */
export function slog(tag: string, msg: string): void {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const clean = msg.replace(/\r?\n/g, '\\n');
  const prefix = slogPrefix ? ` ${slogPrefix} |` : '';
  console.log(`${ts}${prefix} [${tag}] ${clean}`);
}

// =============================================================================
// diagLog — Diagnostic logging (console + JSONL)
// =============================================================================

function extractErrorInfo(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { message: error.message, code };
  }
  return { message: String(error) };
}

export function diagLog(context: string, error: unknown, snapshot?: Record<string, string>): void {
  const info = extractErrorInfo(error);
  const snapshotStr = snapshot
    ? ' | ' + Object.entries(snapshot).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';

  slog('DIAG', `[${context}] ${info.message}${info.code ? ` (${info.code})` : ''}${snapshotStr}`);

  // Also write to diag.jsonl for Error Review
  if (behaviorLogDir) {
    const entry = {
      ts: new Date().toISOString(),
      context,
      message: info.message,
      code: info.code,
      ...(snapshot ?? {}),
    };
    try {
      appendFileSync(join(behaviorLogDir, 'diag.jsonl'), JSON.stringify(entry) + '\n');
    } catch { /* non-critical */ }
  }
}

// =============================================================================
// behaviorLog — Append-only JSONL behavior record
// =============================================================================

let behaviorLogDir: string | null = null;

export function setBehaviorLogDir(dir: string): void {
  behaviorLogDir = dir;
  try { mkdirSync(dir, { recursive: true }); } catch { /* ok */ }
}

export function behaviorLog(action: string, detail: string): void {
  if (!behaviorLogDir) return;
  const entry = {
    ts: new Date().toISOString(),
    action,
    detail: detail.slice(0, 500),
  };
  try {
    appendFileSync(join(behaviorLogDir, 'behavior.jsonl'), JSON.stringify(entry) + '\n');
  } catch { /* non-critical */ }
}

export function structuredLog(type: string, data: Record<string, unknown>): void {
  if (!behaviorLogDir) return;
  const entry = { ts: new Date().toISOString(), type, ...data };
  try {
    appendFileSync(join(behaviorLogDir, `${type}.jsonl`), JSON.stringify(entry) + '\n');
  } catch { /* non-critical */ }
}

// =============================================================================
// Activity Summary — Recent behavior for OODA context
// =============================================================================

function tailJsonl(filePath: string, limit: number): Array<Record<string, unknown>> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

/** Get recent activity summary for OODA context injection */
export function getRecentActivity(limit = 15): string {
  if (!behaviorLogDir) return '';

  const behaviors = tailJsonl(join(behaviorLogDir, 'behavior.jsonl'), limit);
  const errors = tailJsonl(join(behaviorLogDir, 'diag.jsonl'), 5);

  const lines: string[] = [];

  for (const b of behaviors) {
    const time = (b.ts as string)?.split('T')[1]?.slice(0, 8) ?? '';
    lines.push(`[${time}] ${b.action}: ${(b.detail as string)?.slice(0, 120) ?? ''}`);
  }

  if (errors.length > 0) {
    lines.push('--- recent errors ---');
    for (const e of errors) {
      const time = (e.ts as string)?.split('T')[1]?.slice(0, 8) ?? '';
      lines.push(`[${time}] ${e.context}: ${(e.message as string)?.slice(0, 120) ?? ''}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '';
}
