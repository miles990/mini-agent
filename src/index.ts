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
export type {
  ActorId,
  ActorSelectionTrace,
  ArbitrationDecision,
  ArbitrationMode,
  BrainProvider,
  BrainRequest,
  BrainResult,
  DecisionBudget,
  DecisionCost,
  DecisionStopCondition,
  PeerAgentId,
  ProviderCapabilities,
  ProviderHealth,
  ProviderId,
  WorkIntent,
  WorkItem,
  WorkPriority,
  WorkRisk,
} from './brain-types.js';

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

// Brain orchestration
export {
  deriveConstraintTexture,
  isCheapLocalIntent,
  isCodingIntent,
  isReviewIntent,
  peerCritiqueReason,
} from './constraint-texture.js';
export type { ConstraintKind, ConstraintTexture, ConstraintTextureOptions, WorkConstraint } from './constraint-texture.js';
export { BrainArbiter, decideArbitration } from './brain-arbiter.js';
export type { ArbiterOptions } from './brain-arbiter.js';
export {
  ACTOR_REGISTRY,
  getActorProfile,
  getDefaultDispatchableActors,
  getPeerCritiqueActors,
  isDispatchableActor,
} from './actor-registry.js';
export type { ActorKind, ActorProfile, ActorRoleTendency, CognitionLevel } from './actor-registry.js';
export {
  pickActorForRole,
  pickActorsForRole,
  rankActorsForRole,
} from './actor-selection-policy.js';
export type { ActorScore, SelectionOptions, SelectionRole } from './actor-selection-policy.js';
export { readActorOutcomeStatsSync } from './actor-outcome-stats.js';
export type { ActorOutcomeStat, ActorOutcomeStats, ActorOutcomeStatsOptions } from './actor-outcome-stats.js';
export { BrainRuntime } from './brain-runtime.js';
export type { BrainActorRun, BrainExecutionInput, BrainRuntimeOptions, BrainRuntimeResult } from './brain-runtime.js';
export {
  appendBrainRunEvent,
  getBrainRunLedgerPath,
  readBrainRunEventsSync,
  readBrainRunStatesSync,
} from './brain-run-ledger.js';
export type { BrainRunEvent, BrainRunEventKind, BrainRunQuery, BrainRunState, BrainRunStatus } from './brain-run-ledger.js';
export {
  getDelegationFailureCode,
  getDelegationFailureGuardPath,
  isDelegationFailureStatus,
  markDelegationFailureDiagnosticCreated,
  readDelegationFailureRecordsSync,
  recordDelegationFailure,
  transitionDelegationFailureStatus,
} from './delegation-failure-guard.js';
export type { DelegationFailureDecision, DelegationFailureRecord, DelegationFailureStatus } from './delegation-failure-guard.js';
export {
  diagnoseDelegationFailure,
  diagnosePendingDelegationFailures,
} from './delegation-failure-diagnostics.js';
export type { DelegationFailureDiagnosis } from './delegation-failure-diagnostics.js';
export { getMyelinStatus } from './myelin-status.js';
export type {
  MyelinDomainHealth,
  MyelinDomainStatus,
  MyelinRuleSummary,
  MyelinStatusSnapshot,
} from './myelin-status.js';
export { getMyelinKnowledgeContext, syncMyelinToKnowledge } from './myelin-kg-sync.js';
export type {
  MyelinKgSyncOptions,
  MyelinKgSyncResult,
  MyelinKgSyncedRule,
  MyelinKnowledgeContextOptions,
} from './myelin-kg-sync.js';
export {
  createSelfResearchPlan,
  formatSelfResearchPlan,
  saveSelfResearchPlan,
} from './self-research-loop.js';
export type {
  ImprovementDomain,
  ImprovementIntervention,
  ImprovementTarget,
  SelfResearchPlanOptions,
  SelfResearchRun,
} from './self-research-loop.js';
export { maybeQueueSelfResearch } from './self-research-autopilot.js';
export type { SelfResearchAutopilotOptions, SelfResearchAutopilotResult } from './self-research-autopilot.js';
export {
  closeResolvedCorrectionTasks,
  ensureCorrectionTask,
  evaluateCorrectionGate,
  isCorrectionTask,
  parseGitStatusPorcelainV2,
} from './correction-gate.js';
export type {
  CorrectionGateSnapshot,
  CorrectionReason,
  CorrectionReasonType,
  HealthBreakdown,
  ShipTruthState,
} from './correction-gate.js';
export { MiddlewareProvider, createDefaultMiddlewareProviders } from './middleware-provider.js';
export type { MiddlewareProviderOptions } from './middleware-provider.js';
export { MiddlewarePeerAgent, createDefaultMiddlewarePeers } from './middleware-peer-agent.js';
export type { MiddlewarePeerAgentOptions } from './middleware-peer-agent.js';
export {
  appendPrReviewClaim,
  applyPrReviewConsensusToHandoffs,
  createPrReviewClaim,
  evaluatePrReviewConsensus,
  getPrReviewClaimsPath,
  parsePrReviewHandoffs,
  readPrReviewClaimsSync,
  runPrReviewConsensus,
} from './pr-review-runner.js';
export type {
  PrReviewClaim,
  PrReviewClaimInput,
  PrReviewConsensus,
  PrReviewConsensusStatus,
  PrReviewHandoff,
  PrReviewVerdict,
} from './pr-review-runner.js';
export { coordinateAsKuro } from './internal-kuro-coordinator.js';
export type { KuroCoordinationInput, KuroCoordinationResult } from './internal-kuro-coordinator.js';
export {
  getCachedAvailableBrainActors,
  getCachedBrainHealthSnapshot,
  isBrainRuntimeDelegationEnabled,
  refreshBrainHealth,
} from './brain-health.js';
export type { BrainActorHealth, BrainHealthSnapshot } from './brain-health.js';

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
