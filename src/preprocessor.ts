/**
 * Rule-based message preprocessing (zero LLM):
 * - topic detection
 * - intent classification
 * - action task extraction
 * - short-window cluster assignment
 */
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

const TOPIC_RULES: ReadonlyArray<{ keywords: string[]; topic: string }> = [
  {
    keywords: ['競賽', 'teaching monster', 'teaching.monster', 'warm-up', '熱身', '提交影片', 'pipeline', 'speechlab', 'xiao', '教學法'],
    topic: 'teaching-monster',
  },
  { keywords: ['myelin', 'crystallize', 'distill', 'bypass', 'cascade', 'myelinate'], topic: 'myelin' },
  { keywords: ['mushi', 'mushi-kit', 'triage'], topic: 'mushi' },
  { keywords: ['deploy', '部署', 'launchctl', '重啟', 'restart', 'CI/CD', 'ci', 'cd'], topic: 'ops' },
  { keywords: ['memory', '記憶', 'MEMORY.md', 'topic memory', 'FTS5'], topic: 'memory' },
  { keywords: ['asurada', 'framework', 'npm publish', 'npx'], topic: 'asurada' },
  { keywords: ['chat-ui', 'chat room', 'topic badge', 'thread line', 'filter bar'], topic: 'chat-ui' },
  { keywords: ['cycle', 'loop', 'OODA', 'preprocessor', 'sentinel', 'event emission', 'idle sleep'], topic: 'architecture' },
  { keywords: ['slack', '#discussion', '#announcement', '#deprecated'], topic: 'slack' },
  { keywords: ['telegram', 'TG', 'bot'], topic: 'telegram' },
];

const ACTION_START_RE = /^(看(?:一下|看)?|做|改|加|刪|部署|提交|跑|檢查|掃|研究|升級|實作|寫|建|測試|更新|重啟|清理|整理|處理|幫我|請|麻煩)/u;
const ALEX_ACTION_HINT_RE = /(?:你|幫我|去|要|先|趕快|立刻|馬上|現在就|請|麻煩)/u;
const CLAUDE_RELAY_RE = /(?:Alex 的指示|Alex 要求|Alex 問|Alex 說|請|立刻|P0)/u;
const APPROVAL_RE = /^(好|可以|同意|approved|lgtm|核准|通過|ok|approve|收到|沒問題|照做)\b/iu;
const QUESTION_START_RE = /^(怎麼|為什麼|能不能|有沒有|是不是|什麼是|何時|哪裡|誰|如何)/u;
const INFO_START_RE = /^(這是|分享|fyi|看到|剛看到|找到|補充|更新)/iu;
const CJK_RE = /[\u3400-\u9fff]/u;
const TASK_SPLIT_RE = /[，,。；;\n]|(?:並且|並|然後|接著|還有|另外|同時|再來|以及)/u;
const LEADIN_RE = /^(請|麻煩|幫我|你|先|再|也|順便|另外|然後)\s*/u;

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function detectTopic(text: string): string | undefined {
  const lower = normalize(text).toLowerCase();
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      return rule.topic;
    }
  }
  return undefined;
}

export function classifyIntent(text: string, from: string): Intent {
  const trimmed = normalize(text);
  const sender = from.toLowerCase();

  if (ACTION_START_RE.test(trimmed)) return 'action';
  if (sender === 'alex' && ALEX_ACTION_HINT_RE.test(trimmed)) return 'action';
  if (sender === 'claude-code' && CLAUDE_RELAY_RE.test(trimmed)) return 'action';

  if (APPROVAL_RE.test(trimmed)) return 'approval';

  if (/[？?]$/.test(trimmed) || QUESTION_START_RE.test(trimmed)) return 'question';

  if (/https?:\/\//.test(trimmed) || INFO_START_RE.test(trimmed)) return 'info';

  return 'discussion';
}

function cleanTaskTitle(input: string): string {
  return normalize(input).replace(LEADIN_RE, '').slice(0, 120);
}

export function extractTasks(text: string, intent: Intent, msgId: string): ExtractedTask[] {
  if (intent !== 'action') return [];

  const tasks: ExtractedTask[] = [];
  const seen = new Set<string>();
  const source = normalize(text);

  const segments = source.split(TASK_SPLIT_RE);
  for (const seg of segments) {
    const title = cleanTaskTitle(seg);
    if (title.length <= 4) continue;
    if (!CJK_RE.test(title) && title.split(' ').length < 3) continue;
    if (seen.has(title)) continue;

    seen.add(title);
    tasks.push({
      title,
      origin: `room:${msgId}`,
    });

    if (tasks.length >= 10) {
      break;
    }
  }

  if (tasks.length === 0) {
    tasks.push({
      title: cleanTaskTitle(source),
      origin: `room:${msgId}`,
    });
  }

  return tasks;
}

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

  const key = topic.toLowerCase();
  const existing = activeClusterMap.get(key);
  if (existing && ts.getTime() - existing.ts < CLUSTER_WINDOW_MS) {
    existing.ts = ts.getTime();
    return existing.clusterId;
  }

  const clusterId = `cl-${dateStr}-${String(++clusterCounter).padStart(2, '0')}`;
  activeClusterMap.set(key, { clusterId, ts: ts.getTime() });
  return clusterId;
}

/**
 * Preprocesses a room message into deterministic metadata for downstream routing.
 * The function is pure rule-based and does not call any LLM.
 */
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
