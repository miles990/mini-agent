/**
 * Shared Utilities — Minimal Core
 *
 * Stripped down: no logging.js dependency, just slog + diagLog.
 */

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
// diagLog — Minimal diagnostic logging (console only)
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
}
