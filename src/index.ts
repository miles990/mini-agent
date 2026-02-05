/**
 * Mini-Agent - Main Entry Point
 *
 * A minimal Personal AI Agent with:
 * - Memory (file-based, no database)
 * - Proactivity (cron-based heartbeat)
 *
 * ~1000 lines total
 */

export { processMessage, runHeartbeat, type Message, type AgentResponse } from './agent.js';
export {
  readMemory,
  appendMemory,
  readDailyNotes,
  appendDailyNote,
  searchMemory,
  readHeartbeat,
  updateHeartbeat,
  buildContext,
  type MemoryEntry,
} from './memory.js';
export {
  startProactive,
  stopProactive,
  triggerHeartbeat,
  type ProactiveConfig,
} from './proactive.js';
export { createApi } from './api.js';
