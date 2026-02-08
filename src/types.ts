/**
 * Mini-Agent Types
 * 多實例 AI Agent 系統的類型定義
 */

/**
 * 實例角色
 */
export type InstanceRole = 'master' | 'worker' | 'standalone';

/**
 * Proactive 觸發器類型
 */
export interface ProactiveTrigger {
  type: 'cron' | 'event' | 'webhook';
  schedule?: string;
  event?: string;
  action: string;
}

/**
 * 角色定義
 */
export interface Persona {
  description?: string;
  systemPrompt?: string;
  skills?: string[];
}

/**
 * Proactive 配置
 */
export interface ProactiveConfig {
  enabled: boolean;
  schedule?: string;
  triggers?: ProactiveTrigger[];
}

/**
 * 對話項目
 */
export interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * 記憶配置
 */
export interface MemoryConfig {
  maxSize?: string;
  syncToGlobal?: boolean;
  hot?: number;    // Context 中的對話數量 (default: 20)
  warm?: number;   // 每日保留的對話數量 (default: 100)
}

/**
 * 實例配置
 */
export interface InstanceConfig {
  id: string;
  name?: string;
  role: InstanceRole;
  port: number;
  persona?: Persona;
  proactive?: ProactiveConfig;
  memory?: MemoryConfig;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 全域配置預設值
 */
export interface GlobalDefaults {
  port: number;
  proactiveSchedule: string;
  claudeTimeout: number;
  maxSearchResults: number;
}

/**
 * 全域配置
 */
export interface GlobalConfig {
  defaults: GlobalDefaults;
  instances: Array<{ id: string; role: InstanceRole }>;
}

/**
 * 實例狀態
 */
export interface InstanceStatus {
  id: string;
  name?: string;
  role: InstanceRole;
  port: number;
  running: boolean;
  pid?: number;
  uptime?: number;
}

/**
 * 創建實例的參數
 */
export interface CreateInstanceOptions {
  name?: string;
  role?: InstanceRole;
  port?: number;
  persona?: string;
}

/**
 * 任務定義
 */
export interface Task {
  task: string;
  schedule?: string;
  completed: boolean;
  createdAt?: string;
}

/**
 * 記憶搜尋結果
 */
export interface MemorySearchResult {
  content: string;
  section?: string;
  score?: number;
  createdAt?: string;
}

/**
 * 記憶項目
 */
export interface MemoryEntry {
  content: string;
  source: string;
  date: string;
}

/**
 * API 回應類型
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Chat 請求
 */
export interface ChatRequest {
  message: string;
  context?: string;
}

/**
 * Chat 回應
 */
export interface ChatResponse {
  content: string;
  tokens?: {
    input: number;
    output: number;
  };
}

/**
 * Agent 回應
 */
export interface AgentResponse {
  content: string;
  shouldRemember?: string;
  taskAdded?: string;
}

// =============================================================================
// Compose Types
// =============================================================================

/**
 * Cron 任務定義
 */
export interface CronTask {
  schedule: string;
  task: string;
  enabled?: boolean;
}

/**
 * Compose 檔案中的 Agent 定義
 */
/**
 * 自訂感知插件（Shell Script）
 */
export interface ComposePerception {
  name: string;
  script: string;       // 腳本路徑（相對或絕對）
  interval?: string;    // 執行間隔（預留）
  timeout?: number;     // 超時毫秒（預設 5000）
}

export interface ComposeAgent {
  name?: string;
  port?: number;
  role?: InstanceRole;
  persona?: string;
  paths?: {
    memory?: string;
    logs?: string;
  };
  proactive?: {
    schedule?: string;
  };
  cron?: CronTask[];
  loop?: {
    enabled?: boolean;
    interval?: string;  // "5m", "30s", "1h"
    activeHours?: {
      start?: number;   // 0-23, default 8
      end?: number;     // 0-23, default 23
    };
  };
  perception?: {
    builtin?: string[];           // 啟用的內建感知（預設全部）
    custom?: ComposePerception[]; // 自訂 Shell Script 感知
  };
  skills?: string[];              // Markdown skill 檔案路徑
  depends_on?: string[];
}

/**
 * Compose 檔案格式
 */
export interface ComposeFile {
  version?: string;
  agents: Record<string, ComposeAgent>;
  paths?: {
    memory?: string;
    logs?: string;
  };
  memory?: {
    shared?: {
      path?: string;
      sync?: boolean;
    };
  };
}
