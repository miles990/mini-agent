/**
 * myelin-playbook — L2 crystallization layer.
 *
 * L2 crystallizes "how to respond": thinking strategies, source-gathering steps,
 * and response shapes. When a message arrives, L1 (triage) decides whether to
 * wake; L2 decides *how* to think about it — what playbook to follow.
 *
 * Over time, myelin crystallizes the LLM heuristic into zero-cost rules so
 * most messages get an instant playbook match without any LLM call.
 */

import { createMyelin } from 'myelinate';
import type { Myelin, MyelinStats, TriageResult } from 'myelinate';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

/** The action categories — each maps to a distinct thinking strategy. */
export type PlaybookAction =
  | 'status-report'
  | 'link-review'
  | 'debug-flow'
  | 'clarify-intent'
  | 'research-deep'
  | 'quick-reply'
  | 'creative-response'
  | 'task-execute'
  | 'novel';

/** What a matched playbook provides — injected into the agent's prompt. */
export interface PlaybookStrategy {
  id: PlaybookAction;
  name: string;
  thinkingSteps: string[];
  gatherSources: string[];
  responsePattern: string;
  constraints?: string[];
}

// =============================================================================
// Seed Strategies
// =============================================================================

export const STRATEGIES: Record<PlaybookAction, PlaybookStrategy> = {
  'status-report': {
    id: 'status-report',
    name: '進度報告',
    thinkingSteps: [
      '檢查 HEARTBEAT active tasks',
      '檢查 NEXT 排程項目',
      '掃描 behavior log 近期動作',
      '彙整為簡潔報告：完成 / 進行中 / blocked',
    ],
    gatherSources: ['HEARTBEAT.md', 'NEXT.md', 'memory/behavior-log.jsonl'],
    responsePattern: '簡潔列出完成/進行中/blocked，附時間戳',
    constraints: ['不超過 10 行', '用條列式', '標記 blocked 項目'],
  },

  'link-review': {
    id: 'link-review',
    name: '連結閱讀與觀點',
    thinkingSteps: [
      'Fetch URL 內容',
      '閱讀並摘要重點',
      '形成自己的觀點與評價',
      '交叉引用既有 memory 找關聯',
      '將觀點與摘要存入 memory',
    ],
    gatherSources: ['URL content', 'memory/*.md (related topics)'],
    responsePattern: '摘要 → 觀點 → 與既有知識的連結 → 儲存確認',
    constraints: ['先讀完再評論', '觀點要有理由', '標注資料來源'],
  },

  'debug-flow': {
    id: 'debug-flow',
    name: '除錯流程',
    thinkingSteps: [
      '查看相關 log 和錯誤訊息',
      '列出所有可能假設（至少 3 個）',
      '逐一驗證假設，從最可能的開始',
      '找到根因後修復',
      '驗證修復有效',
    ],
    gatherSources: ['error logs', 'source code', 'recent changes (git log)'],
    responsePattern: '症狀 → 假設列表 → 驗證過程 → 根因 → 修復',
    constraints: ['不要猜，要驗證', '修完要確認', '記錄根因供未來參考'],
  },

  'clarify-intent': {
    id: 'clarify-intent',
    name: '釐清意圖',
    thinkingSteps: [
      '偵測訊息中的模糊或多義之處',
      '列出 2-3 種可能的解讀',
      '提供選項讓使用者選擇',
      '根據選擇執行對應動作',
    ],
    gatherSources: ['conversation history', 'user preferences (memory)'],
    responsePattern: '「你的意思是 A 還是 B？」→ 等回覆 → 執行',
    constraints: ['選項不超過 3 個', '每個選項附簡短說明', '不要自己猜著做'],
  },

  'research-deep': {
    id: 'research-deep',
    name: '深度研究',
    thinkingSteps: [
      '拆解研究問題為子問題',
      '多來源搜集資料（web search、memory、papers）',
      '交叉比對不同來源',
      '綜合成結構化報告',
      '標注信心程度與資料缺口',
    ],
    gatherSources: ['web search', 'memory/*.md', 'arXiv/papers', 'existing notes'],
    responsePattern: '背景 → 發現 → 綜合觀點 → 信心程度 → 下一步',
    constraints: ['標注每個論點的來源', '區分事實與推測', '字數 > 500'],
  },

  'quick-reply': {
    id: 'quick-reply',
    name: '快速回覆',
    thinkingSteps: [
      '判斷是否需要額外資訊',
      '直接回答',
    ],
    gatherSources: [],
    responsePattern: '1-2 句直接回答',
    constraints: ['不廢話', '不需要格式'],
  },

  'creative-response': {
    id: 'creative-response',
    name: '創意回應與觀點',
    thinkingSteps: [
      '理解分享/討論的主題',
      '形成自己的觀點或聯想',
      '引用相關經驗或知識',
      '提供有深度的回應',
    ],
    gatherSources: ['memory/*.md (related topics)', 'conversation context'],
    responsePattern: '回應觀點 → 延伸思考 → 可能的連結或啟發',
    constraints: ['要有自己的觀點', '不要只是附和', '可以適度挑戰'],
  },

  'task-execute': {
    id: 'task-execute',
    name: '直接執行',
    thinkingSteps: [
      '確認任務目標',
      '執行動作',
      '回報結果',
    ],
    gatherSources: ['task context'],
    responsePattern: '做了什麼 → 結果 → 完成確認',
    constraints: ['不需要討論，直接做', '做完回報'],
  },

  novel: {
    id: 'novel',
    name: '全新情境',
    thinkingSteps: [
      '沒有匹配的 playbook，啟動完整 LLM 推理',
      '分析意圖與情境',
      '決定最佳回應方式',
    ],
    gatherSources: ['all available context'],
    responsePattern: '依情境自由發揮',
  },
};

// =============================================================================
// Singleton Myelin Instance
// =============================================================================

let _instance: Myelin<PlaybookAction> | null = null;

/** Get or create the singleton playbook myelin instance. */
export function getPlaybookMyelin(): Myelin<PlaybookAction> {
  if (!_instance) {
    _instance = createMyelin<PlaybookAction>({
      llm: async (event) => {
        // Keyword-based heuristic classifier.
        // Over time, myelin will crystallize these into zero-cost rules
        // and this function will be called less and less.
        const ctx = event.context ?? {};
        const message = String(ctx.message ?? '').toLowerCase();
        const hasUrl = Boolean(ctx.hasUrl);

        // URL present → link-review
        if (hasUrl || /https?:\/\//.test(message)) {
          return { action: 'link-review', reason: 'URL detected' };
        }

        // Status / progress keywords
        if (/進度|status|目前|狀態|在做什麼|heartbeat|報告/.test(message)) {
          return { action: 'status-report', reason: 'status keywords detected' };
        }

        // Bug / error / debug keywords
        if (/bug|error|錯誤|壞了|fail|crash|exception|不work|不動|修/.test(message)) {
          return { action: 'debug-flow', reason: 'debug keywords detected' };
        }

        // Research / deep-dive keywords
        if (/研究|research|調查|分析|survey|深入|explore|論文|paper/.test(message)) {
          return { action: 'research-deep', reason: 'research keywords detected' };
        }

        // Task execution keywords
        if (/做|執行|run|deploy|建|寫|create|implement|push|commit|改/.test(message)) {
          return { action: 'task-execute', reason: 'task execution keywords detected' };
        }

        // Short message → quick reply
        if (message.length < 20) {
          return { action: 'quick-reply', reason: 'short message' };
        }

        // Creative / opinion / sharing keywords
        if (/看到|分享|覺得|想法|有趣|cool|opinion|think|感覺|討論/.test(message)) {
          return { action: 'creative-response', reason: 'creative/sharing keywords detected' };
        }

        // Ambiguous / question keywords without clear direction
        if (/\?|？|什麼意思|哪個|怎麼.*好/.test(message)) {
          return { action: 'clarify-intent', reason: 'ambiguous question detected' };
        }

        // Default: novel
        return { action: 'novel', reason: 'no matching keyword pattern' };
      },
      rulesPath: './memory/myelin-playbook-rules.json',
      logPath: './memory/myelin-playbook-decisions.jsonl',
      autoLog: true,
      failOpenAction: 'novel' as PlaybookAction,
      crystallize: {
        minOccurrences: 6,
        minConsistency: 0.85,
      },
    });
    slog('MYELIN-L2', 'Initialized playbook layer — strategy crystallization active');
  }
  return _instance;
}

// =============================================================================
// Playbook Matching
// =============================================================================

/**
 * Match a message to a playbook strategy via myelin triage.
 * Returns the strategy and the raw triage result.
 * Fire-and-forget safe — never throws.
 */
export async function matchPlaybook(event: {
  message: string;
  source: string;
  hasUrl?: boolean;
  context?: Record<string, unknown>;
}): Promise<{ strategy: PlaybookStrategy; result: TriageResult<PlaybookAction> }> {
  try {
    const myelin = getPlaybookMyelin();

    const result = await myelin.triage({
      type: event.source,
      source: event.source,
      context: {
        message: event.message.slice(0, 500),
        hasUrl: event.hasUrl ?? false,
        messageLength: event.message.length,
        ...event.context,
      },
    });

    const strategy = STRATEGIES[result.action];
    const marker = result.method === 'rule' ? 'RULE' : 'LLM';
    slog('MYELIN-L2', `[${marker}] ${event.source}: "${event.message.slice(0, 50)}..." -> ${result.action} (${result.latencyMs}ms)`);

    return { strategy, result };
  } catch (err) {
    // Fire-and-forget: return novel strategy on any error
    slog('MYELIN-L2', `Error in matchPlaybook: ${err instanceof Error ? err.message : 'unknown'}`);
    return {
      strategy: STRATEGIES.novel,
      result: {
        action: 'novel',
        reason: 'error fallback',
        method: 'llm',
        latencyMs: 0,
      },
    };
  }
}

// =============================================================================
// Prompt Injection Formatter
// =============================================================================

/**
 * Format a playbook strategy as XML for prompt injection.
 * Returns empty string if strategy is 'novel' or confidence is too low.
 */
export function formatPlaybookForPrompt(strategy: PlaybookStrategy, confidence: number): string {
  if (strategy.id === 'novel' || confidence < 0.7) {
    return '';
  }

  const steps = strategy.thinkingSteps
    .map((step, i) => `${i + 1}. ${step}`)
    .join('\n');

  const sources = strategy.gatherSources.length > 0
    ? `\n參考來源：${strategy.gatherSources.join('、')}`
    : '';

  const constraints = strategy.constraints && strategy.constraints.length > 0
    ? `\n限制：${strategy.constraints.join('、')}`
    : '';

  return `<playbook name="${strategy.name}" confidence="${confidence.toFixed(2)}">
建議思考步驟：
${steps}
回應模式：${strategy.responsePattern}${sources}${constraints}
</playbook>`;
}

// =============================================================================
// Stats & Distillation
// =============================================================================

/** Get playbook myelin stats for observability. */
export function getPlaybookStats(): MyelinStats {
  return getPlaybookMyelin().stats();
}

/**
 * Run distillation on the playbook myelin — crystallize patterns into rules.
 * Returns a summary of rules and templates produced.
 * Fire-and-forget safe — never throws.
 */
export function distillPlaybooks(): { rules: number; templates: number } {
  try {
    const myelin = getPlaybookMyelin();
    const result = myelin.distill();
    slog('MYELIN-L2', `Distill: ${result.rules.length} rules, ${result.templates.length} templates`);
    return { rules: result.rules.length, templates: result.templates.length };
  } catch (err) {
    slog('MYELIN-L2', `Distill error: ${err instanceof Error ? err.message : 'unknown'}`);
    return { rules: 0, templates: 0 };
  }
}
