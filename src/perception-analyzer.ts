/**
 * Perception Analyzer — Haiku-Powered Orient Layer
 *
 * OODA cycle 的 Orient 層：用 Haiku 並行分析每個 perception plugin 的原始輸出，
 * 產出結構化洞察，再彙整為 situation report 給決策 LLM。
 *
 * Observe (plugins) → Orient (Haiku) → Decide+Act (Claude CLI)
 *
 * 無 ANTHROPIC_API_KEY 時完全 fallback 到現有行為。
 */

import Anthropic from '@anthropic-ai/sdk';
import { slog } from './utils.js';
import type { PerceptionResult } from './perception.js';
import type { PerceptionInsight, SituationReport } from './types.js';

// =============================================================================
// Client Management
// =============================================================================

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/** 檢查 ANTHROPIC_API_KEY 是否存在 */
export function isAnalysisAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// =============================================================================
// Domain Prompts
// =============================================================================

const ANALYSIS_PROMPTS: Record<string, string> = {
  'telegram-inbox': 'Summarize: how many pending messages? Who sent the most recent/urgent one and what is the topic? Reply in 1-2 sentences. If there are messages needing reply, start with "URGENT:".',
  tasks: 'Summarize: how many tasks by priority (P0/P1/P2)? Any overdue? What is the single most important pending task? Reply in 1-2 sentences. If there are overdue P0 tasks, start with "URGENT:".',
  docker: 'Summarize: how many containers running/stopped? Any unhealthy or restarting? Reply in 1-2 sentences. If any container is unhealthy or crashed, start with "URGENT:".',
  brew: 'Summarize: how many outdated packages? Any security-critical updates? Reply in 1-2 sentences. Just the count and whether any are security-related.',
  ports: 'Summarize: which monitored services are UP and which are DOWN? Reply in 1-2 sentences. If any critical service is DOWN, start with "URGENT:".',
  'state-changes': 'Summarize: what changed since last check? Preserve any ALERT markers. Reply in 1-2 sentences. If there are ALERTs, start with "URGENT:".',
  chrome: 'Summarize: is CDP available? How many tabs open? Any notable pages? Reply in 1 sentence.',
  'git-detail': 'Summarize: current branch, uncommitted changes count, recent commit topic. Reply in 1 sentence.',
  disk: 'Summarize: disk usage percentage and available space. Reply in 1 sentence. If usage > 90%, start with "URGENT:".',
  web: 'Summarize: what web content was fetched and its key finding. Reply in 1 sentence.',
  learning: 'Summarize: what learning activity or progress is noted. Reply in 1 sentence.',
};

const FALLBACK_PROMPT = 'Summarize the key information in 1-2 sentences. If anything requires immediate attention, start with "URGENT:".';

// =============================================================================
// Analysis
// =============================================================================

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 150;
const GLOBAL_TIMEOUT_MS = 3000;

/**
 * 分析單一 perception plugin 輸出
 * 失敗時回退到 truncated raw output
 */
async function analyzeOne(result: PerceptionResult): Promise<PerceptionInsight> {
  const start = Date.now();

  // 無輸出的 plugin 直接跳過
  if (!result.output) {
    return {
      name: result.name,
      insight: '',
      analyzed: false,
      analysisMs: 0,
    };
  }

  try {
    const prompt = ANALYSIS_PROMPTS[result.name] ?? FALLBACK_PROMPT;
    const userMessage = `<raw_output plugin="${result.name}">\n${result.output}\n</raw_output>\n\n${prompt}`;

    const response = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    return {
      name: result.name,
      insight: text.trim(),
      analyzed: true,
      analysisMs: Date.now() - start,
      tokens: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  } catch (error) {
    // 單個失敗 → 回退到 truncated raw
    const truncated = result.output.length > 200
      ? result.output.slice(0, 200) + '...'
      : result.output;
    return {
      name: result.name,
      insight: truncated,
      analyzed: false,
      analysisMs: Date.now() - start,
    };
  }
}

/**
 * 並行分析所有 perception 結果（含 3s 全局 timeout）
 */
export async function analyzePerceptions(results: PerceptionResult[]): Promise<SituationReport> {
  const start = Date.now();

  // 過濾有輸出的 results
  const withOutput = results.filter(r => r.output);
  if (withOutput.length === 0) {
    return {
      report: '',
      insights: [],
      totalMs: 0,
      totalTokens: { input: 0, output: 0 },
    };
  }

  try {
    // Promise.all + race timeout
    const analysisPromise = Promise.all(withOutput.map(r => analyzeOne(r)));
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), GLOBAL_TIMEOUT_MS)
    );

    const insights = await Promise.race([analysisPromise, timeoutPromise]);

    if (insights === null) {
      // 全局 timeout → 全部 fallback
      slog('PERCEPTION', `Analysis timeout (${GLOBAL_TIMEOUT_MS}ms), falling back to raw`);
      return buildFallbackReport(results, Date.now() - start);
    }

    const totalTokens = insights.reduce(
      (acc, i) => ({
        input: acc.input + (i.tokens?.input ?? 0),
        output: acc.output + (i.tokens?.output ?? 0),
      }),
      { input: 0, output: 0 },
    );

    const analyzedCount = insights.filter(i => i.analyzed).length;
    const totalMs = Date.now() - start;
    slog('PERCEPTION', `${analyzedCount}/${withOutput.length} analyzed, ${totalTokens.input + totalTokens.output} tokens, ${totalMs}ms`);

    return {
      report: formatSituationReport(insights),
      insights,
      totalMs,
      totalTokens,
    };
  } catch (error) {
    slog('PERCEPTION', `Analysis error: ${error instanceof Error ? error.message : String(error)}`);
    return buildFallbackReport(results, Date.now() - start);
  }
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * 將洞察格式化為 situation report（URGENT 在前）
 */
function formatSituationReport(insights: PerceptionInsight[]): string {
  const urgent: string[] = [];
  const status: string[] = [];

  for (const insight of insights) {
    if (!insight.insight) continue;

    if (insight.insight.startsWith('URGENT:')) {
      urgent.push(`- [${insight.name}] ${insight.insight.replace('URGENT: ', '').replace('URGENT:', '')}`);
    } else {
      status.push(`- [${insight.name}] ${insight.insight}`);
    }
  }

  const parts: string[] = [];
  if (urgent.length > 0) {
    parts.push(`**URGENT:**\n${urgent.join('\n')}`);
  }
  if (status.length > 0) {
    parts.push(`**Status:**\n${status.join('\n')}`);
  }

  return parts.join('\n\n');
}

/**
 * Fallback: API 不可用時回退到原始 XML 格式
 */
function buildFallbackReport(results: PerceptionResult[], totalMs: number): SituationReport {
  const insights: PerceptionInsight[] = results
    .filter(r => r.output)
    .map(r => ({
      name: r.name,
      insight: r.output!,
      analyzed: false,
      analysisMs: 0,
    }));

  // 使用原始 XML 格式
  const report = results
    .filter(r => r.output)
    .map(r => `<${r.name}>\n${r.output}\n</${r.name}>`)
    .join('\n\n');

  return {
    report,
    insights,
    totalMs,
    totalTokens: { input: 0, output: 0 },
  };
}
