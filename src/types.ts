/**
 * Mini-Agent Types
 * 多實例 AI Agent 系統的類型定義
 */

/**
 * 實例角色
 */
export type InstanceRole = 'master' | 'worker' | 'standalone';

/**
 * 角色定義
 */
export interface Persona {
  description?: string;
  systemPrompt?: string;
  skills?: string[];
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
  proactive?: { enabled: boolean; schedule?: string };
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
  tagsProcessed?: string[];
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
  enabled?: boolean;    // 是否啟用（預設 true）
  output_cap?: number;  // 每 plugin 輸出上限 chars（預設 PLUGIN_OUTPUT_CAP）
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
  /** Lifecycle hooks — configurable event-driven automation */
  hooks?: Array<{
    name: string;
    event: string;             // CycleStart, CycleEnd, PreLLMCall, etc.
    type?: 'shell' | 'http';
    target: string;            // script path or URL
    async?: boolean;
    timeout?: number;
    condition?: Record<string, string>;
    env?: Record<string, string>;
    enabled?: boolean;
  }>;
  /** Rules directories — path-based contextual rules */
  rules?: string[];
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

// =============================================================================
// Perception Analysis Types
// =============================================================================

export interface PerceptionInsight {
  name: string;
  insight: string;        // 1-2 句結構化洞察
  analyzed: boolean;      // true=Haiku 分析, false=raw fallback
  analysisMs: number;
  tokens?: { input: number; output: number };
}

export interface SituationReport {
  report: string;         // 格式化的 situation report
  insights: PerceptionInsight[];
  totalMs: number;
  totalTokens: { input: number; output: number };
}

// =============================================================================
// Dispatcher / Lane Types
// =============================================================================

/** 訊息來源 */
export type DispatchSource = 'telegram' | 'api' | 'cli' | 'cron' | 'loop';

/** 統一的 dispatch 請求 */
export interface DispatchRequest {
  message: string;
  source: DispatchSource;
  contextMode?: 'full' | 'focused' | 'minimal';
}

/** Thread 操作類型 */
export interface ThreadAction {
  op: 'start' | 'progress' | 'complete' | 'pause';
  id: string;
  title?: string;   // only for 'start'
  note: string;
}

/** Creative Impulse — 學習中冒出的創作衝動 */
export interface CreativeImpulse {
  id: string;
  what: string;           // 想寫/做什麼
  driver: string;         // 為什麼想做
  materials: string[];    // 已有素材
  channel: string;        // journal | inner-voice | gallery | devto | chat
  createdAt: string;      // ISO timestamp
  expressedAt?: string;   // 被表達的時間
}

/** Delegation task types */
export type DelegationTaskType = 'code' | 'learn' | 'research' | 'create' | 'review' | 'shell' | 'browse' | 'akari' | 'plan' | 'debug' | 'graphify';

/** LLM Provider (single source of truth) */
export type Provider = 'claude' | 'codex' | 'local';

/** Delegation 請求（從 <kuro:delegate> tag 解析） */
export interface DelegateRequest {
  prompt: string;
  workdir: string;
  type?: DelegationTaskType;
  provider?: Provider;
  maxTurns?: number;
  verify?: string[];
  /** Convergence condition — observable end state. Required by dispatcher gate. */
  acceptance?: string;
}

/** 解析後的 Agent 標籤 */
export interface ParsedTags {
  remembers: Array<{ content: string; topic?: string; ref?: string }>;
  tasks: Array<{ content: string; schedule?: string }>;
  taskQueueActions: Array<{
    op: 'create' | 'update' | 'delete';
    id?: string;
    type?: 'task' | 'goal';
    status?: 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'hold';
    origin?: string;
    priority?: number;
    verify?: Array<{ name: string; status: 'pass' | 'fail' | 'unknown'; detail?: string }>;
    title?: string;
  }>;
  archive?: { url: string; title: string; content: string; mode?: 'full' | 'excerpt' | 'metadata-only' };
  impulses: Array<{ what: string; driver: string; materials: string[]; channel: string }>;
  threads: ThreadAction[];
  chats: Array<{ text: string; reply: boolean }>;
  asks: string[];
  shows: Array<{ url: string; desc: string }>;
  summaries: string[];
  dones: string[];
  progresses: Array<{ task: string; content: string }>;
  delegates: DelegateRequest[];
  plans: Array<{ goal: string; acceptance?: string }>;
  fetches: Array<{ url: string; label?: string }>;
  schedule?: { next: string; reason: string };
  inner?: string;
  goal?: { description: string; origin?: string };
  goalQueue?: { description: string; origin?: string; priority?: number };
  goalAdvance?: string;
  goalProgress?: string;
  goalDone?: string;
  goalAbandon?: string;
  understands: Array<{ content: string; refs: string[]; tags?: string[] }>;
  directionChanges: Array<{ content: string; refs: string[]; tags?: string[] }>;
  agoraPosts: Array<{ discussion: string; text: string; replyTo?: string; type?: string }>;
  supersedes: Array<{ target: string; reason: string; content: string; topic?: string; concepts?: string[] }>;
  validates: Array<{ target: string }>;
  excludes: Array<{ target: string; reason: string }>;
  cleanContent: string;
}

// =============================================================================
// Memory Layer v3 — Entry schema (see memory/proposals/2026-04-14-memory-layer-v3.md)
// =============================================================================

export type EntryType = 'fact' | 'decision' | 'pattern' | 'reference';

export interface Entry {
  id: string;                    // entry-{16 hex chars}
  source: string;                // e.g. "topics/mushi.md" or "MEMORY.md" or "conversation:cycle-401"
  content_hash: string;          // "sha256:..." — dedup key
  content: string;               // semantic atom content
  concepts: string[];            // extracted concept tags
  type: EntryType;
  created_at: string;            // ISO timestamp
  last_validated_at: string;     // ISO timestamp (for decay; NOT access)
  confidence: number;            // 0-1, decays over time
  supersedes: string[];          // ids this entry replaces (immutable after write)
  superseded_by: string | null;  // derived back-ref (computed at read, persisted as null at write)
  stale_reason: string | null;   // required when supersedes.length > 0
  attribution: string;           // "kuro" | "worker:memory-compiler@v1" | ...
}

export interface EntryExclusion {
  target: string;
  reason: string;
  attribution: string;
  ts: string;
}

/** Unified Inbox 項目 */
export interface InboxItem {
  id: string;
  source: 'telegram' | 'room' | 'claude-code' | 'github' | 'handoff';
  from: string;
  priority: 0 | 1 | 2 | 3 | 4;
  content: string;
  ts: string;
  status: 'pending' | 'seen' | 'replied';
  meta?: Record<string, string>;
}

/** Library catalog entry */
export interface CatalogEntry {
  id: string;
  url: string;
  title: string;
  author?: string;
  date?: string;
  type?: string;
  accessed: string;
  contentFile: string;
  tags: string[];
  charCount: number;
  contentHash: string;
  archiveMode: 'full' | 'excerpt' | 'metadata-only';
}

/** 對話脈絡追蹤項目 */
export interface ConversationThread {
  id: string;
  type: 'promise' | 'question' | 'share' | 'correction';
  content: string;
  createdAt: string;
  resolvedAt?: string;
  source: string;
  roomMsgId?: string;  // link to room message ID
}

/** Chat Room 訊息（帶樹狀 threading） */
export interface RoomMessage {
  id: string;        // format: YYYY-MM-DD-NNN (sortable, human-readable)
  from: string;
  text: string;
  ts: string;
  mentions: string[];
  replyTo?: string;  // 純 threading：指向另一個 message ID，或 absent
}

/** 通知分級 — Calm Technology 三層模型 */
export type NotificationTier = 'signal' | 'summary' | 'heartbeat';

// =============================================================================
// Cognitive Mesh Types (Phase 1: Cross-Process Foundation)
// =============================================================================

/** IPC event envelope — written as JSON files for cross-process communication */
export interface IPCEvent {
  type: string;           // AgentEventType or custom mesh events
  data: Record<string, unknown>;
  from: string;           // source instance ID
  ts: number;             // Date.now()
}

/** Instance heartbeat — written every 30s to advertise liveness */
export interface InstanceHeartbeat {
  instanceId: string;
  pid: number;
  port: number;
  role: InstanceRole;
  perspective?: string;
  status: 'idle' | 'busy' | 'starting' | 'stopping';
  cycleCount: number;
  ts: number;             // Date.now()
}

// =============================================================================
// Cognitive Mesh Types (Phase 3b: Perspective System)
// =============================================================================

/** Perspective configuration — defines what a Specialist instance loads */
export interface PerspectiveConfig {
  perception: 'all' | string[];   // which perception plugins to load
  skills: 'all' | string[];       // which skills to load
  canWriteMemory: boolean;         // can write to memory/ directly
  canSendTelegram: boolean;        // can send Telegram notifications
  maxConcurrent: number;           // max instances with this perspective
}

/** Mesh task output — written by Specialists, read by Primary */
export interface MeshTaskOutput {
  taskId: string;
  instanceId: string;
  perspective: string;
  status: 'completed' | 'failed';
  result: string;
  startedAt: string;
  completedAt: string;
}
