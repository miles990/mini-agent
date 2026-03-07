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
