/**
 * Mini-Agent - Main Entry Point
 *
 * A minimal Personal AI Agent with:
 * - Memory (file-based, instance-isolated)
 * - Proactivity (cron-based heartbeat)
 * - Multi-instance support
 */

// Types
export type {
  InstanceRole,
  InstanceConfig,
  InstanceStatus,
  GlobalConfig,
  GlobalDefaults,
  CreateInstanceOptions,
  Persona,
  MemoryConfig,
  Task,
  MemoryEntry,
  MemorySearchResult,
  ApiResponse,
  ChatRequest,
  ChatResponse,
  AgentResponse,
} from './types.js';

// Agent
export { callClaude, type Message } from './agent.js';

// Dispatcher
export { parseTags, postProcess, getSystemPrompt } from './dispatcher.js';

// Memory (instance-aware)
export {
  InstanceMemory,
  createMemory,
  getMemory,
  readMemory,
  appendMemory,
  appendTopicMemory,
  readDailyNotes,
  appendDailyNote,
  searchMemory,
  readHeartbeat,
  updateHeartbeat,
  addTask,
  buildContext,
} from './memory.js';

// Cron
export {
  startCronTasks,
  stopCronTasks,
  getActiveCronTasks,
  getCronTaskCount,
  addCronTask,
  removeCronTask,
  reloadCronTasks,
} from './cron.js';

// Watcher
export {
  startComposeWatcher,
  stopComposeWatcher,
  getWatcherStatus,
} from './watcher.js';

// Instance Management
export {
  InstanceManager,
  getInstanceManager,
  getDataDir,
  getInstanceDir,
  initDataDir,
  loadGlobalConfig,
  saveGlobalConfig,
  getGlobalDefaults,
  updateGlobalDefaults,
  loadInstanceConfig,
  saveInstanceConfig,
  updateInstanceConfig,
  resetInstanceConfig,
  createInstance,
  listInstances,
  deleteInstance,
  getCurrentInstanceId,
  getOrCreateDefaultInstance,
  validateInstanceId,
  startHeartbeat,
  updateInstanceHeartbeat,
  stopHeartbeat,
  getNeighborHeartbeats,
  isInstanceAlive,
} from './instance.js';

// IPC Bus
export { initIPCBus, emitIPC, stopIPCBus } from './ipc-bus.js';

// Memory Cache (CQRS Read Layer)
export { cachedReadFile, invalidateCache, getCacheStats, stopMemoryCache } from './memory-cache.js';

// Task Router (Cognitive Mesh Phase 3)
export { routeTask, getClusterState, mushiRoute } from './task-router.js';
export type { RouteDecision, PerspectiveType, ClusterState } from './task-router.js';

// Scaling Controller (Cognitive Mesh Phase 3)
export { evaluateScaling, getScalingStatus, setScalingConfig } from './scaling.js';

// Consensus (Cognitive Mesh Phase 4)
export {
  logDecision, getRecentDecisions, hasRecentDecision,
  claimExclusive, releaseClaim, isOperationClaimed,
  canPerformDomain, getPartitionRules, getActiveClaims,
  cleanupConsensusState,
} from './consensus.js';
export type { DecisionEntry, ExclusiveOperation } from './consensus.js';

// Shared Knowledge Bus
export {
  initSharedKnowledge, observe as kbObserve, query as kbQuery,
  stats as kbStats, patterns as kbPatterns,
  getKnowledgeSummary, getKBStatus,
} from './shared-knowledge.js';
export type { KBEvent, KBFilter, KBStats, KBPattern, KBSource, KBEventType } from './shared-knowledge.js';

// Config
export {
  getConfig,
  updateConfig,
  resetConfig,
  getConfigValue,
  setConfigValue,
  getInstanceFullConfig,
  DEFAULT_CONFIG,
  type Config,
} from './config.js';

// API
export { createApi } from './api.js';

// =============================================================================
// Hermes-Inspired Systems (v2)
// =============================================================================

// Tool Registry — Standardized tool definitions with JSON Schema
export {
  toolRegistry,
  registerBuiltinTools,
  registerShellTool,
  formatToolSchemasForPrompt,
  type ToolDefinition,
  type ToolResult,
  type ToolSchema,
  type BlastRadius,
} from './tool-registry.js';

// Lifecycle Hooks — Configurable event-driven automation
export {
  hookManager,
  parseHooksFromConfig,
  createHookContext,
  type HookDefinition,
  type HookEvent,
  type HookResult,
  type HookContext,
} from './lifecycle-hooks.js';

// Active Context — Persistent decision injection layer
export {
  activeContext,
  analyzeContextBudget,
  applyProgressiveCompression,
  extractDecisions,
  type ActiveDecision,
  type ContextBudgetState,
} from './active-context.js';

// Skill System v2 — On-demand loading with YAML frontmatter
export {
  skillIndex,
  parseFrontmatter,
  formatSkillsForPrompt,
  type SkillFrontmatter,
  type SkillIndex,
  type SkillLoaded,
  type SkillMatchContext,
} from './skill-system.js';

// Agent Isolation — Fresh context + file-based handoff
export {
  getHandoffDir,
  writeTaskSpec,
  readTaskSpec,
  writeTaskResult,
  readTaskResult,
  buildIsolatedContext,
  formatIsolatedPrompt,
  logAgentLifecycle,
  getRecentLifecycleEvents,
  getLifecycleSummary,
  cleanupHandoff,
  type IsolatedTaskSpec,
  type IsolatedTaskResult,
  type IsolatedContext,
  type AgentLifecycleEvent,
} from './agent-isolation.js';

// Rules Engine — Path-based contextual rules
export {
  rulesEngine,
  getDefaultRulesDirs,
  type Rule,
  type RuleMatch,
  type RuleMatchContext,
} from './rules-engine.js';

// Structured Event Logging — JSONL with correlation IDs
export {
  structuredLog,
  wireStructuredLogging,
  type StructuredEvent,
  type LogQuery,
} from './structured-log.js';

// Blast Radius Classification — Action safety gate
export {
  classifyAction,
  shouldAllow,
  classifyBatch,
  maxBlastRadius,
  type ActionClassification,
} from './blast-radius.js';
