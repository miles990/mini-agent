/**
 * Perception Analyzer — Haiku-Powered Orient Layer
 *
 * OODA cycle 的 Orient 層：用 Haiku 分析 perception plugin 的原始輸出，
 * 產出結構化洞察，再彙整為 situation report 給決策 LLM。
 *
 * Observe (plugins) → Orient (Haiku via Agent SDK) → Decide+Act (Claude CLI)
 *
 * Auth: 走 Agent SDK subscription，不消耗 API credit。
 * 效率: 所有 perceptions 合併為一次 batched query（1 subprocess spawn, 1 API call）。
 */

import { slog } from './utils.js';
import type { PerceptionResult } from './perception.js';
import type { PerceptionInsight, SituationReport } from './types.js';

// =============================================================================
// Analysis Available Check
// =============================================================================

/** Agent SDK query() 總是可用（走 CLI subscription auth），不依賴 ANTHROPIC_API_KEY */
export function isAnalysisAvailable(): boolean {
  return true;
}

// =============================================================================
// Domain Prompts
// =============================================================================

const ANALYSIS_PROMPTS: Record<string, string> = {
  tasks: 'how many tasks by priority (P0/P1/P2)? Any overdue? Single most important pending task.',
  docker: 'how many containers running/stopped? Any unhealthy or restarting?',
  brew: 'how many outdated packages? Any security-critical updates?',
  ports: 'which monitored services are UP and which are DOWN?',
  'state-changes': 'what changed since last check? Preserve any ALERT markers.',
  chrome: 'is Chrome/CDP available? How many tabs? Notable pages?',
  'git-detail': 'current branch, uncommitted changes count, recent commit topic.',
  disk: 'disk usage percentage and available space.',
  web: 'what web content was fetched and its key finding.',
  learning: 'what learning activity or progress is noted.',
};

// =============================================================================
// Batched Analysis via Agent SDK
// =============================================================================

const GLOBAL_TIMEOUT_MS = 8000;

function buildBatchPrompt(results: PerceptionResult[]): string {
  const sections = results.map(r => {
    const hint = ANALYSIS_PROMPTS[r.name] ?? '';
    return `<perception name="${r.name}"${hint ? ` hint="${hint}"` : ''}>\n${r.output}\n</perception>`;
  });

  return `Analyze each perception output below. For each, write a 1-2 sentence summary.
If anything requires immediate attention, prefix that summary with "URGENT:".

${sections.join('\n\n')}

Output ONLY valid JSON: {"results": {"<name>": "<summary>", ...}}`;
}

function extractJSON(text: string): Record<string, string> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed.results ?? parsed;
  } catch {
    return null;
  }
}

async function batchAnalyze(results: PerceptionResult[]): Promise<Map<string, string>> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GLOBAL_TIMEOUT_MS);
  let resultText = '';

  try {
    for await (const msg of query({
      prompt: buildBatchPrompt(results),
      options: {
        model: 'haiku',
        maxTurns: 1,
        tools: [],
        persistSession: false,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController: controller,
        env: { ANTHROPIC_API_KEY: undefined },
      },
    })) {
      if (msg && typeof msg === 'object' && 'result' in msg) {
        resultText = String((msg as { result: unknown }).result);
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  const parsed = extractJSON(resultText);
  return new Map(Object.entries(parsed ?? {}));
}

/**
 * 分析所有 perception 結果（single batched Agent SDK query）
 */
export async function analyzePerceptions(results: PerceptionResult[]): Promise<SituationReport> {
  const start = Date.now();

  const withOutput = results.filter(r => r.output);
  if (withOutput.length === 0) {
    return { report: '', insights: [], totalMs: 0, totalTokens: { input: 0, output: 0 } };
  }

  try {
    const summaries = await batchAnalyze(withOutput);

    const insights: PerceptionInsight[] = withOutput.map(r => ({
      name: r.name,
      insight: summaries.get(r.name)?.trim() ?? r.output!.slice(0, 200),
      analyzed: summaries.has(r.name),
      analysisMs: Date.now() - start,
    }));

    const analyzedCount = insights.filter(i => i.analyzed).length;
    const totalMs = Date.now() - start;
    slog('PERCEPTION', `${analyzedCount}/${withOutput.length} analyzed via SDK, ${totalMs}ms`);

    return {
      report: formatSituationReport(insights),
      insights,
      totalMs,
      totalTokens: { input: 0, output: 0 },
    };
  } catch (error) {
    slog('PERCEPTION', `SDK analysis error: ${error instanceof Error ? error.message : String(error)}`);
    return buildFallbackReport(results, Date.now() - start);
  }
}

// =============================================================================
// Formatting
// =============================================================================

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
  if (urgent.length > 0) parts.push(`**URGENT:**\n${urgent.join('\n')}`);
  if (status.length > 0) parts.push(`**Status:**\n${status.join('\n')}`);
  return parts.join('\n\n');
}

function buildFallbackReport(results: PerceptionResult[], totalMs: number): SituationReport {
  const insights: PerceptionInsight[] = results
    .filter(r => r.output)
    .map(r => ({ name: r.name, insight: r.output!, analyzed: false, analysisMs: 0 }));

  const report = results
    .filter(r => r.output)
    .map(r => `<${r.name}>\n${r.output}\n</${r.name}>`)
    .join('\n\n');

  return { report, insights, totalMs, totalTokens: { input: 0, output: 0 } };
}
