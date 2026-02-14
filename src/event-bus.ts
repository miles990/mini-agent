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
  // Actions（agent 行為）
  | 'action:loop'
  | 'action:chat'
  | 'action:memory'
  | 'action:task'
  | 'action:show'
  | 'action:summary'
  | 'action:handoff'
  // Observations（可觀測性）
  | 'log:info'
  | 'log:error'
  | 'log:behavior'
  | 'notification:signal'
  | 'notification:summary'
  | 'notification:heartbeat';

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
  timestamp: Date;
}

type EventPattern = AgentEventType | 'trigger:*' | 'action:*' | 'log:*' | 'notification:*';
type EventHandler = (event: AgentEvent) => void;

// === Event Bus ===

export class AgentEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(20);
  }

  emit(type: AgentEventType, data: Record<string, unknown> = {}): void {
    const event: AgentEvent = { type, data, timestamp: new Date() };
    this.emitter.emit(type, event);
    // Wildcard: prefix:* listeners
    const prefix = type.split(':')[0];
    this.emitter.emit(`${prefix}:*`, event);
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

export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let last = 0;
  return (...args: A): void => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
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
