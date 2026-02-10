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
  ProactiveTrigger,
  Persona,
  ProactiveConfig as ProactiveInstanceConfig,
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
export { processMessage, runHeartbeat, type Message } from './agent.js';

// Dispatcher
export { dispatch, parseTags, getLaneStats, Semaphore, triageMessage } from './dispatcher.js';

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

// Proactive
export {
  startProactive,
  stopProactive,
  triggerHeartbeat,
  type ProactiveConfig,
} from './proactive.js';

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
} from './instance.js';

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
