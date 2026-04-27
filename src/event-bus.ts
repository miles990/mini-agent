import { EventEmitter } from 'node:events';

// === Event Types ===

export type AgentEventType =
  // Triggers（驅動 loop cycle）
  | 'trigger:workspace'
  | 'trigger:telegram'
  | 'trigger:cron'
  | 'trigger:alert'
  | 'trigger:heartbeat'
  | 'trigger:mobile'
  | 'trigger:chat'
  | 'trigger:room'
  | 'trigger:telegram-user'
  | 'trigger:sense'
  | 'trigger:continuation'
  // Actions（agent 行為）
  | 'action:loop'
  | 'action:chat'
  | 'action:memory'
  | 'action:task'
  | 'action:show'
  | 'action:summary'
  | 'action:handoff'
  | 'action:room'
  | 'action:activity'
  | 'action:delegation-start'
  | 'action:delegation-complete'
  | 'action:agora'
  | 'action:tool'       // Tool registry execution (pre/post)
  | 'action:scheduler'  // Scheduler decision (pick/switch/preempt/discovery)
  | 'action:process'    // Process state transition
  | 'action:budget'     // Context budget pressure change
  // Lifecycle Hooks（configurable lifecycle events）
  | 'hook:cycle-start'
  | 'hook:cycle-end'
  | 'hook:perception-complete'
  | 'hook:pre-llm'
  | 'hook:post-llm'
  | 'hook:pre-dispatch'
  | 'hook:post-dispatch'
  | 'hook:delegation-start'
  | 'hook:delegation-complete'
  | 'hook:error'
  // Security
  | 'security:threat'
  // Observations（可觀測性）
  | 'log:info'
  | 'log:warn'
  | 'log:error'
  | 'log:behavior'
  | 'log:stall'       // Streaming stall detection: thinking → stalled → recovered
  | 'log:progress'    // Debounced streaming progress: token count, tool activity, duration
  | 'notification:signal'
  | 'notification:summary'
  | 'notification:heartbeat'
  // Knowledge Bus
  | 'kb:observe';

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
  timestamp: Date;
  /** Producer-assigned priority hint */
  priority?: 'P0' | 'P1' | 'P2';
  /** Source layer (reflex/autonomic/filter/conscious) */
  source?: string;
}

type EventPattern = AgentEventType | 'trigger:*' | 'action:*' | 'log:*' | 'notification:*';
type EventHandler = (event: AgentEvent) => void;

// === Event Bus ===

export class AgentEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(20);
  }

  emit(type: AgentEventType, data: Record<string, unknown> = {}, meta?: { priority?: 'P0' | 'P1' | 'P2'; source?: string }): void {
    const event: AgentEvent = {
      type, data, timestamp: new Date(),
      ...(meta?.priority ? { priority: meta.priority } : {}),
      ...(meta?.source ? { source: meta.source } : {}),
    };
    // Layer A (2026-04-17, Constraint Texture): defer listener execution to next
    // macrotask so emit() returns immediately and listeners don't chain-block the
    // event loop. Observed p99 loop lag max=160s during cycle — sync listener
    // chains with embedded fs.appendFileSync / eventBus re-emit caused
    // microtask cascade. setImmediate yields to I/O phase (HTTP handler accept).
    //
    // Breaks sync-order expectations (listeners no longer run before emit returns).
    // None of the 131 emit call sites use `await emit` or depend on sync order;
    // opt-out via DEFER_EMIT=false if regression found.
    if (process.env.DEFER_EMIT === 'false') {
      this.emitter.emit(type, event);
      const prefix = type.split(':')[0];
      this.emitter.emit(`${prefix}:*`, event);
      return;
    }
    setImmediate(() => {
      this.emitter.emit(type, event);
      const prefix = type.split(':')[0];
      this.emitter.emit(`${prefix}:*`, event);
    });
  }

  on(pattern: EventPattern, handler: EventHandler): this {
    this.emitter.on(pattern, handler);
    return this;
  }

  off(pattern: EventPattern, handler: EventHandler): this {
    this.emitter.off(pattern, handler);
    return this;
  }

  once(pattern: EventPattern, handler: EventHandler): this {
    this.emitter.once(pattern, handler);
    return this;
  }

  removeAllListeners(pattern?: EventPattern): this {
    if (pattern) {
      this.emitter.removeAllListeners(pattern);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }
}

// Singleton
export const eventBus = new AgentEventBus();

// === Reactive Primitives ===

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: A): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  debounced.cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

export function distinctUntilChanged<T>(
  hashFn: (value: T) => string,
): (value: T) => boolean {
  let lastHash: string | null = null;
  return (value: T): boolean => {
    const hash = hashFn(value);
    if (hash !== lastHash) {
      lastHash = hash;
      return true;
    }
    return false;
  };
}
