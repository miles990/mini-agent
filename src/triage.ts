/**
 * Triage — Sonnet 4.6 快速分類 NEXT.md 項目
 *
 * 每個 cycle 開始前，如果 NEXT.md 有 >1 pending items，
 * 用 Sonnet 4.6 快速分類、排序、合併。
 *
 * 無 ANTHROPIC_API_KEY → 跳過 triage，保留原始順序。
 * 成本：~200 tokens/call ≈ $0.002
 */

import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { slog } from './utils.js';
import { withFileLock } from './filelock.js';
import { NEXT_MD_PATH } from './telegram.js';

const SONNET_MODEL = 'claude-sonnet-4-6-20250514';

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
3. 合併相似項目（例如同一話題的連續訊息）
4. 標記可以直接刪除的（純表情、已過時等）— 輸出時加 [DELETE] 前綴

輸出格式：每行一項，按優先度排序，保留原始格式（- [ ] P{N}: ...）
如果合併了項目，用合併後的描述。
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
