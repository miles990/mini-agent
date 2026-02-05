/**
 * Mini-Agent Logging System
 *
 * 完整的日誌系統，記錄所有 Claude Code 操作和回應
 *
 * 日誌結構：
 * ~/.mini-agent/instances/{id}/logs/
 * ├── claude/       Claude Code 操作日誌
 * ├── api/          API 請求日誌
 * ├── proactive/    Proactive 系統日誌
 * └── error/        錯誤日誌
 */

import fs from 'node:fs/promises';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';

// =============================================================================
// Types
// =============================================================================

/**
 * 日誌類型
 */
export type LogType = 'claude-call' | 'api-request' | 'proactive' | 'error';

/**
 * Claude 輸入
 */
export interface ClaudeInput {
  userMessage: string;
  systemPrompt: string;
  context: string;
  fullPrompt?: string;
}

/**
 * Claude 輸出
 */
export interface ClaudeOutput {
  content: string;
  shouldRemember?: string;
  taskAdded?: string;
}

/**
 * API 請求
 */
export interface ApiRequest {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

/**
 * API 回應
 */
export interface ApiResponse {
  status: number;
  body?: unknown;
}

/**
 * 日誌元數據
 */
export interface LogMetadata {
  duration?: number;
  success: boolean;
  error?: string;
}

/**
 * 日誌項目
 */
export interface LogEntry {
  timestamp: string;
  type: LogType;
  instanceId: string;
  requestId: string;
  data: Record<string, unknown>;
  metadata: LogMetadata;
}

/**
 * Claude 日誌項目
 */
export interface ClaudeLogEntry extends LogEntry {
  type: 'claude-call';
  data: {
    input: ClaudeInput;
    output: ClaudeOutput;
  };
}

/**
 * API 日誌項目
 */
export interface ApiLogEntry extends LogEntry {
  type: 'api-request';
  data: {
    request: ApiRequest;
    response: ApiResponse;
  };
}

/**
 * Proactive 日誌項目
 */
export interface ProactiveLogEntry extends LogEntry {
  type: 'proactive';
  data: {
    action: string;
    trigger?: string;
    result?: string;
  };
}

/**
 * 錯誤日誌項目
 */
export interface ErrorLogEntry extends LogEntry {
  type: 'error';
  data: {
    error: string;
    stack?: string;
    context?: string;
  };
}

/**
 * 查詢選項
 */
export interface LogQueryOptions {
  type?: LogType;
  date?: string;  // YYYY-MM-DD
  limit?: number;
  offset?: number;
}

// =============================================================================
// Logger Class
// =============================================================================

/**
 * 實例日誌系統
 */
export class Logger {
  private instanceId: string;
  private logsDir: string;

  constructor(instanceId?: string) {
    this.instanceId = instanceId ?? getCurrentInstanceId();
    this.logsDir = path.join(getInstanceDir(this.instanceId), 'logs');
    this.ensureLogDirs();
  }

  /**
   * 確保日誌目錄存在
   */
  private ensureLogDirs(): void {
    const dirs = ['claude', 'api', 'proactive', 'error'];
    for (const dir of dirs) {
      const dirPath = path.join(this.logsDir, dir);
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }
    }
  }

  /**
   * 將 LogType 轉換為目錄名稱
   */
  private typeToDir(type: LogType): string {
    const mapping: Record<LogType, string> = {
      'claude-call': 'claude',
      'api-request': 'api',
      'proactive': 'proactive',
      'error': 'error',
    };
    return mapping[type];
  }

  /**
   * 取得今日日期字串
   */
  private getToday(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * 取得日誌檔案路徑
   */
  private getLogFilePath(type: LogType, date?: string): string {
    const dateStr = date ?? this.getToday();
    const dir = this.typeToDir(type);
    return path.join(this.logsDir, dir, `${dateStr}.jsonl`);
  }

  /**
   * 寫入日誌
   */
  private writeLog(entry: LogEntry): void {
    const filePath = this.getLogFilePath(entry.type);
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(filePath, line, 'utf-8');
  }

  /**
   * 生成請求 ID
   */
  generateRequestId(): string {
    return randomUUID();
  }

  // ---------------------------------------------------------------------------
  // Public Logging Methods
  // ---------------------------------------------------------------------------

  /**
   * 記錄 Claude 操作
   */
  logClaudeCall(
    input: ClaudeInput,
    output: ClaudeOutput,
    metadata: LogMetadata,
    requestId?: string
  ): string {
    const id = requestId ?? this.generateRequestId();
    const entry: ClaudeLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'claude-call',
      instanceId: this.instanceId,
      requestId: id,
      data: { input, output },
      metadata,
    };
    this.writeLog(entry);
    return id;
  }

  /**
   * 記錄 API 請求
   */
  logApiRequest(
    request: ApiRequest,
    response: ApiResponse,
    metadata: LogMetadata,
    requestId?: string
  ): string {
    const id = requestId ?? this.generateRequestId();
    const entry: ApiLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'api-request',
      instanceId: this.instanceId,
      requestId: id,
      data: { request, response },
      metadata,
    };
    this.writeLog(entry);
    return id;
  }

  /**
   * 記錄 Proactive 動作
   */
  logProactive(
    action: string,
    result?: string,
    trigger?: string,
    metadata?: Partial<LogMetadata>
  ): string {
    const id = this.generateRequestId();
    const entry: ProactiveLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'proactive',
      instanceId: this.instanceId,
      requestId: id,
      data: { action, result, trigger },
      metadata: { success: true, ...metadata },
    };
    this.writeLog(entry);
    return id;
  }

  /**
   * 記錄錯誤
   */
  logError(
    error: Error | string,
    context?: string,
    metadata?: Partial<LogMetadata>
  ): string {
    const id = this.generateRequestId();
    const errorStr = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;
    const entry: ErrorLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'error',
      instanceId: this.instanceId,
      requestId: id,
      data: { error: errorStr, stack, context },
      metadata: { success: false, error: errorStr, ...metadata },
    };
    this.writeLog(entry);
    return id;
  }

  // ---------------------------------------------------------------------------
  // Query Methods
  // ---------------------------------------------------------------------------

  /**
   * 讀取日誌檔案
   */
  private readLogFile(type: LogType, date: string): LogEntry[] {
    const filePath = this.getLogFilePath(type, date);
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.map((line) => JSON.parse(line) as LogEntry);
    } catch {
      return [];
    }
  }

  /**
   * 查詢日誌
   */
  query(options: LogQueryOptions = {}): LogEntry[] {
    const { type, date, limit = 100, offset = 0 } = options;
    const dateStr = date ?? this.getToday();

    let entries: LogEntry[] = [];

    if (type) {
      entries = this.readLogFile(type, dateStr);
    } else {
      // 讀取所有類型
      const types: LogType[] = ['claude-call', 'api-request', 'proactive', 'error'];
      for (const t of types) {
        entries.push(...this.readLogFile(t, dateStr));
      }
      // 按時間排序
      entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    // 反轉順序（最新在前）
    entries.reverse();

    // 分頁
    return entries.slice(offset, offset + limit);
  }

  /**
   * 查詢 Claude 日誌
   */
  queryClaudeLogs(date?: string, limit = 50): ClaudeLogEntry[] {
    return this.query({ type: 'claude-call', date, limit }) as ClaudeLogEntry[];
  }

  /**
   * 查詢錯誤日誌
   */
  queryErrorLogs(date?: string, limit = 50): ErrorLogEntry[] {
    return this.query({ type: 'error', date, limit }) as ErrorLogEntry[];
  }

  /**
   * 查詢 Proactive 日誌
   */
  queryProactiveLogs(date?: string, limit = 50): ProactiveLogEntry[] {
    return this.query({ type: 'proactive', date, limit }) as ProactiveLogEntry[];
  }

  /**
   * 查詢 API 日誌
   */
  queryApiLogs(date?: string, limit = 50): ApiLogEntry[] {
    return this.query({ type: 'api-request', date, limit }) as ApiLogEntry[];
  }

  /**
   * 取得可用的日誌日期
   */
  async getAvailableDates(type?: LogType): Promise<string[]> {
    const dates = new Set<string>();
    const types: LogType[] = type ? [type] : ['claude-call', 'api-request', 'proactive', 'error'];

    for (const t of types) {
      const dirPath = path.join(this.logsDir, this.typeToDir(t));
      try {
        const files = await fs.readdir(dirPath);
        for (const file of files) {
          if (file.endsWith('.jsonl')) {
            dates.add(file.replace('.jsonl', ''));
          }
        }
      } catch {
        // 目錄不存在
      }
    }

    return Array.from(dates).sort().reverse();
  }

  /**
   * 取得日誌統計
   */
  async getStats(date?: string): Promise<{
    date: string;
    claude: number;
    api: number;
    proactive: number;
    error: number;
    total: number;
  }> {
    const dateStr = date ?? this.getToday();
    const claude = this.readLogFile('claude-call', dateStr).length;
    const api = this.readLogFile('api-request', dateStr).length;
    const proactive = this.readLogFile('proactive', dateStr).length;
    const error = this.readLogFile('error', dateStr).length;

    return {
      date: dateStr,
      claude,
      api,
      proactive,
      error,
      total: claude + api + proactive + error,
    };
  }
}

// =============================================================================
// Factory & Singleton
// =============================================================================

const loggerInstances = new Map<string, Logger>();

/**
 * 創建或取得實例的日誌系統
 */
export function createLogger(instanceId?: string): Logger {
  const id = instanceId ?? getCurrentInstanceId();

  if (!loggerInstances.has(id)) {
    loggerInstances.set(id, new Logger(id));
  }

  return loggerInstances.get(id)!;
}

/**
 * 取得當前實例的日誌系統
 */
export function getLogger(): Logger {
  return createLogger();
}
