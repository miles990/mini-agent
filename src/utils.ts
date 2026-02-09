/**
 * Shared Utilities
 *
 * 統一工具函數，避免循環依賴。所有檔案統一從這裡 import。
 *
 * - slog: Timestamped console log for server.log observability
 * - diagLog: 統一診斷記錄（slog + error JSONL）
 * - safeExec / safeExecAsync: 統一 try/catch wrapper
 */

import { getLogger } from './logging.js';

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
// diagLog — 統一診斷記錄
// =============================================================================

/**
 * 從 error 提取有用資訊
 */
function extractErrorInfo(error: unknown): { message: string; code?: string; stack?: string } {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { message: error.message, code, stack: error.stack };
  }
  return { message: String(error) };
}

/**
 * 統一診斷記錄：slog [DIAG] + error JSONL 持久記錄
 *
 * @param context - 呼叫位置描述（e.g. 'instance.loadConfig', 'memory.search'）
 * @param error - 錯誤物件或任意值
 * @param snapshot - 現場 key-value（e.g. { file: configPath, instanceId }）
 */
export function diagLog(context: string, error: unknown, snapshot?: Record<string, string>): void {
  const info = extractErrorInfo(error);
  const snapshotStr = snapshot
    ? ' | ' + Object.entries(snapshot).map(([k, v]) => `${k}=${v}`).join(' ')
    : '';

  // 1. slog — server.log 即時可見
  slog('DIAG', `[${context}] ${info.message}${info.code ? ` (${info.code})` : ''}${snapshotStr}`);

  // 2. error JSONL — 持久記錄（帶 context + snapshot）
  try {
    const logger = getLogger();
    logger.logDiag(context, error, snapshot);
  } catch {
    // Logger 尚未初始化時（啟動階段），至少 slog 已經記錄了
  }
}

// =============================================================================
// safeExec / safeExecAsync — 統一 try/catch wrapper
// =============================================================================

/**
 * 同步安全執行：自動 diagLog 錯誤
 *
 * @param fn - 要執行的同步函數
 * @param context - 診斷 context 名稱
 * @param fallback - 錯誤時的 fallback 值
 * @param snapshot - 現場 key-value
 */
export function safeExec<T>(
  fn: () => T,
  context: string,
  fallback: T,
  snapshot?: Record<string, string>,
): T {
  try {
    return fn();
  } catch (error) {
    diagLog(context, error, snapshot);
    return fallback;
  }
}

/**
 * 非同步安全執行：自動 diagLog 錯誤
 *
 * @param fn - 要執行的非同步函數
 * @param context - 診斷 context 名稱
 * @param fallback - 錯誤時的 fallback 值
 * @param snapshot - 現場 key-value
 */
export async function safeExecAsync<T>(
  fn: () => Promise<T>,
  context: string,
  fallback: T,
  snapshot?: Record<string, string>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    diagLog(context, error, snapshot);
    return fallback;
  }
}
