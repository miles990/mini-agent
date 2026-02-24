/**
 * Triage — 輕量模型做 pre-cycle 分類
 *
 * 1. triageNextItems(): Sonnet 4.6 分類 NEXT.md 項目（~200 tokens, $0.002）
 * 2. triageCycleIntent(): Haiku 4.5 預判 cycle 意圖（~150 tokens, $0.0003）
 *
 * 無 ANTHROPIC_API_KEY → 跳過，保留預設行為。
 */

import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { slog } from './utils.js';
import { withFileLock } from './filelock.js';
import { NEXT_MD_PATH } from './telegram.js';

const SONNET_MODEL = 'claude-sonnet-4-6-20250514';
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

/**
 * 從 NEXT.md 的 Next section 提取 pending items（未勾選的 checkbox）
 */
export function extractNextItems(content: string): string[] {
  const nextHeader = '## Next(接下來做,按優先度排序)';
  const nextIdx = content.indexOf(nextHeader);
  if (nextIdx === -1) return [];

  const afterHeader = content.indexOf('\n', nextIdx);
  const nextSeparator = content.indexOf('\n---', afterHeader);
  if (nextSeparator === -1) return [];

  const section = content.slice(afterHeader, nextSeparator);
  return section
    .split('\n')
    .filter(line => line.match(/^- \[ \] /))
    .map(line => line.trim());
}

/**
 * 用 Sonnet 4.6 對 NEXT.md 項目做快速 triage（分類 + 排序）
 *
 * 觸發條件：NEXT.md Next section 有 >1 pending items
 * Fallback：無 API key → 跳過，保留原始順序
 */
export async function triageNextItems(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return;

  await withFileLock(NEXT_MD_PATH, async () => {
    try {
      if (!fs.existsSync(NEXT_MD_PATH)) return;
      const content = fs.readFileSync(NEXT_MD_PATH, 'utf-8');
      const items = extractNextItems(content);

      // 只在 >1 items 時 triage（單項不需排序）
      if (items.length <= 1) return;

      const start = Date.now();
      const response = await getClient().messages.create({
        model: SONNET_MODEL,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `你是 Kuro 的任務分類器。以下是待處理項目，請：
1. 分類每項（question/instruction/share/chat/ack）
2. 排序（question > instruction > share > chat > ack）
3. 標記可以直接刪除的（純表情、已過時等）— 輸出時加 [DELETE] 前綴

⚠️ 嚴格規則：
- 每一行必須原封不動輸出（只改變順序，不改寫任何文字）
- 禁止合併項目 — 每條 Alex 的訊息都是獨立的，URL 不可替換或省略
- 只能做：重新排序 + 標記 [DELETE]

輸出格式：每行一項，按優先度排序，保留原始文字不變。
如果標記刪除，該行前加 [DELETE]。

待處理：
${items.join('\n')}`,
        }],
      });

      const elapsed = Date.now() - start;
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      if (!text.trim()) return;

      // Parse sorted items — filter out [DELETE] items
      const sortedItems = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- [ ]'))
        .filter(line => !line.includes('[DELETE]'));

      if (sortedItems.length === 0) return;

      // Replace Next section with sorted items
      const nextHeader = '## Next(接下來做,按優先度排序)';
      const nextIdx = content.indexOf(nextHeader);
      const afterHeader = content.indexOf('\n', nextIdx);
      const nextSeparator = content.indexOf('\n---', afterHeader);

      const updated = content.slice(0, afterHeader) +
        '\n\n' + sortedItems.join('\n') + '\n' +
        content.slice(nextSeparator);

      fs.writeFileSync(NEXT_MD_PATH, updated, 'utf-8');
      slog('TRIAGE', `Sorted ${items.length} → ${sortedItems.length} items (${elapsed}ms)`);
    } catch (err) {
      // Triage failure is non-critical — just skip
      slog('TRIAGE', `Failed: ${err instanceof Error ? err.message : err}`);
    }
  });
}

// =============================================================================
// Cycle Intent Triage — Haiku 快速預判 cycle 意圖
// =============================================================================

export interface CycleIntentResult {
  mode: 'respond' | 'learn' | 'act' | 'reflect' | 'task';
  reason: string;
  focus?: string;
}

/**
 * 用 Haiku 4.5 預判這個 cycle 應該做什麼。
 *
 * 輸入：壓縮的 perception 摘要（前 2000 chars）
 * 輸出：mode + reason + optional focus hint
 * 成本：~150 tokens ≈ $0.0003
 *
 * Fallback：無 API key 或失敗 → 返回 null，使用既有 detectCycleMode()
 */
export async function triageCycleIntent(
  contextSummary: string,
  triggerReason: string | null,
): Promise<CycleIntentResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  // telegram-user always respond — skip triage cost
  if (triggerReason?.startsWith('telegram-user')) return null;

  try {
    const start = Date.now();
    const response = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `你是 Kuro 的前置決策器。根據以下感知摘要，判斷這個 cycle 應該做什麼。

觸發原因：${triggerReason ?? 'heartbeat'}

感知摘要（截斷）：
${contextSummary.slice(0, 2000)}

用一行 JSON 回答（不要其他文字）：
{"mode":"respond|learn|act|reflect|task","reason":"10字內原因","focus":"可選：具體該關注什麼"}`,
      }],
    });

    const elapsed = Date.now() - start;
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    // Parse JSON — tolerant of markdown fencing
    const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr) as CycleIntentResult;

    // Validate mode
    const validModes = ['respond', 'learn', 'act', 'reflect', 'task'];
    if (!validModes.includes(parsed.mode)) return null;

    slog('TRIAGE', `Intent: ${parsed.mode} — ${parsed.reason} (${elapsed}ms)`);
    return parsed;
  } catch {
    // Non-critical — fall back to heuristic detectCycleMode()
    return null;
  }
}
