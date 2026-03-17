// =============================================================================
// preprocessor.ts — Rule-based message preprocessing (zero LLM)
// Topic detection, intent classification, task extraction, cluster assignment
// =============================================================================

// === Types ===

export type Intent = 'action' | 'question' | 'info' | 'discussion' | 'approval';

export interface MessageContext {
  topic?: string;
  intent: Intent;
  tasks: ExtractedTask[];
  cluster: string;
}

export interface ExtractedTask {
  title: string;
  origin: string;
}

// === Topic Detection ===

const TOPIC_RULES: ReadonlyArray<{ keywords: string[]; topic: string }> = [
  { keywords: ['競賽', 'teaching monster', 'teaching.monster', 'warm-up', '熱身', '提交影片', 'pipeline', 'speechlab', 'xiao', '教學法'], topic: 'teaching-monster' },
  { keywords: ['myelin', 'crystallize', 'distill', 'bypass', 'cascade', 'myelinate'], topic: 'myelin' },
  { keywords: ['mushi', 'mushi-kit', 'triage'], topic: 'mushi' },
  { keywords: ['deploy', '部署', 'launchctl', '重啟', 'restart', 'CI/CD'], topic: 'ops' },
  { keywords: ['memory', '記憶', 'MEMORY.md', 'topic memory', 'FTS5'], topic: 'memory' },
  { keywords: ['asurada', 'framework', 'npm publish', 'npx'], topic: 'asurada' },
  { keywords: ['chat-ui', 'chat room', 'topic badge', 'thread line', 'filter bar'], topic: 'chat-ui' },
  { keywords: ['cycle', 'loop', 'OODA', 'preprocessor', 'sentinel', 'event emission', 'idle sleep'], topic: 'architecture' },
  { keywords: ['slack', '#discussion', '#announcement', '#deprecated'], topic: 'slack' },
  { keywords: ['telegram', 'TG', 'bot'], topic: 'telegram' },
];

export function detectTopic(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      return rule.topic;
    }
  }
  return undefined;
}

// === Intent Classification ===

export function classifyIntent(text: string, from: string): Intent {
  const trimmed = text.trim();

  // Action: imperative verbs (Chinese)
  if (/^(看|做|改|加|刪|部署|提交|跑|檢查|掃|研究|升級|實作|寫|建|測試|更新|重啟|清理|整理)/.test(trimmed)) return 'action';
  // Action: Alex giving directives
  if (from === 'alex' && /(?:你|幫我|去|要|先|趕快|立刻|馬上|現在就)/.test(trimmed)) return 'action';
  // Action: Claude Code relaying instructions
  if (from === 'claude-code' && /(?:Alex 的指示|Alex 要求|Alex 問|Alex 說|請|立刻|P0)/.test(trimmed)) return 'action';

  // Approval
  if (/^(好|可以|同意|approved|LGTM|核准|通過|OK|approve|收到)/.test(trimmed)) return 'approval';

  // Question
  if (/[？?]$/.test(trimmed) || /^(怎麼|為什麼|能不能|有沒有|是不是|什麼是)/.test(trimmed)) return 'question';

  // Info: sharing links or information
  if (/https?:\/\//.test(trimmed) || /^(這是|分享|FYI|看到|剛看到|找到)/.test(trimmed)) return 'info';

  return 'discussion';
}

// === Task Extraction ===

export function extractTasks(text: string, intent: Intent, msgId: string): ExtractedTask[] {
  if (intent !== 'action') return [];

  const tasks: ExtractedTask[] = [];

  // Split on Chinese punctuation and conjunctions
  const segments = text.split(/[，。；\n]|(?:並|然後|還有|另外)/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    // At least 5 chars and contains CJK
    if (trimmed.length > 5 && /[\u4e00-\u9fff]/.test(trimmed)) {
      tasks.push({ title: trimmed.slice(0, 120), origin: `room:${msgId}` });
    }
  }

  // If no segments extracted but intent is action, use the full text
  if (tasks.length === 0) {
    tasks.push({ title: text.slice(0, 120), origin: `room:${msgId}` });
  }

  return tasks;
}

// === Cluster Detection ===

interface ClusterState {
  clusterId: string;
  ts: number;
}

const activeClusterMap = new Map<string, ClusterState>();
let clusterCounter = 0;
const CLUSTER_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function assignCluster(topic: string | undefined, ts: Date): string {
  const dateStr = ts.toISOString().slice(0, 10);

  if (!topic) return `cl-${dateStr}-misc`;

  const existing = activeClusterMap.get(topic);
  if (existing && ts.getTime() - existing.ts < CLUSTER_WINDOW_MS) {
    // Update timestamp to extend window
    existing.ts = ts.getTime();
    return existing.clusterId;
  }

  const clusterId = `cl-${dateStr}-${String(++clusterCounter).padStart(2, '0')}`;
  activeClusterMap.set(topic, { clusterId, ts: ts.getTime() });
  return clusterId;
}

// === Main Entry Point ===

export function preprocessMessage(
  text: string,
  from: string,
  msgId: string,
  ts: Date,
): MessageContext {
  const topic = detectTopic(text);
  const intent = classifyIntent(text, from);
  const tasks = extractTasks(text, intent, msgId);
  const cluster = assignCluster(topic, ts);

  return { topic, intent, tasks, cluster };
}
