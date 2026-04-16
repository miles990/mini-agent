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

// Memory Cache (CQRS Read Layer)
export { cachedReadFile, invalidateCache, getCacheStats, stopMemoryCache } from './memory-cache.js';

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

// Content Scanner — Memory write injection/exfiltration protection
export { scanContent, type TrustLevel, type ScanResult } from './content-scanner.js';
