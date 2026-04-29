# HEARTBEAT-active minimal-mode 截斷 patch

**Date**: 2026-04-29
**Status**: Ready to apply (malware-guard 阻擋自動 Edit，由 Alex 手動 apply)
**Severity**: P1 — minimal/stripped retry context inflation 主因之一

## 問題

`src/memory.ts:3736-3750` 是 minimal-mode 的 heartbeat builder。它把 HEARTBEAT.md 的 `## Active Tasks` section 整段 dump 進 prompt，**沒有任何 cap**。

對比 full-mode（line 3396）：`pushCapped('heartbeat-active', ...)` 走 SECTION_CAP（line 2486 `cap: 2000`）。

當前活體證據：
- `wc -c memory/HEARTBEAT.md` = 29,287 bytes
- Active Tasks section ≈ 25KB+
- 本 cycle prompt 中 `<heartbeat-active>` 塞滿超過 30 個 task entries（含 `<!-- ... -->` 已歸檔殘留），佔 minimal-context 大半預算

這就是 04-22 cycle #N 診斷的 silent_exit 主因之一（buildMinimalContext budget 漏洞 67c40914 已修一半，剩這條 minimal-mode heartbeat path 沒蓋到）。

## Patch（3736-3750 替換）

```typescript
    // Heartbeat — 只取 Active Tasks section (heartbeat-active only in minimal mode)
    // 完整 HEARTBEAT 佔 ~8.5K，Active Tasks 應該只佔 ~2K
    // 2026-04-29: minimal-mode 之前無 cap，HEARTBEAT 膨脹到 29KB 時整段塞進 prompt
    // 觸發 silent_exit/retry inflation。加 25KB / 200 lines 雙重 cap。
    if (heartbeat) {
      const activeTasksHeader = '## Active Tasks';
      const activeIdx = heartbeat.indexOf(activeTasksHeader);
      if (activeIdx !== -1) {
        const afterActive = heartbeat.indexOf('\n## ', activeIdx + activeTasksHeader.length);
        let activeTasks = afterActive !== -1
          ? heartbeat.slice(activeIdx, afterActive).trim()
          : heartbeat.slice(activeIdx).trim();

        const HEARTBEAT_ACTIVE_MAX_BYTES = 25_000;
        const HEARTBEAT_ACTIVE_MAX_LINES = 200;
        const origLen = activeTasks.length;
        const lines = activeTasks.split('\n');
        let truncated = false;
        if (lines.length > HEARTBEAT_ACTIVE_MAX_LINES) {
          activeTasks = lines.slice(0, HEARTBEAT_ACTIVE_MAX_LINES).join('\n');
          truncated = true;
        }
        if (activeTasks.length > HEARTBEAT_ACTIVE_MAX_BYTES) {
          activeTasks = activeTasks.slice(0, HEARTBEAT_ACTIVE_MAX_BYTES);
          truncated = true;
        }
        if (truncated) {
          activeTasks += `\n[... truncated from ${origLen} chars / ${lines.length} lines, see memory/HEARTBEAT.md for full ...]`;
        }

        sections.push(`<heartbeat-active>\n# HEARTBEAT (minimal)\n\n${activeTasks}\n</heartbeat-active>`);
      } else {
        // Fallback: truncate to first 2000 chars
        sections.push(`<heartbeat-active>\n${heartbeat.slice(0, 2000)}\n[... truncated for minimal context ...]\n</heartbeat-active>`);
      }
    }
```

## 驗證條件（apply 後）

1. **Direct test**: `node -e "console.log(require('./dist/memory.js').buildContext({mode:'minimal'}))"` → `<heartbeat-active>` section ≤ 25,300 bytes（25K cap + tag overhead + truncation marker）
2. **Live signal**: 下個 stripped-retry cycle 的 prompt size，`<heartbeat-active>` section 不再有 30+ task entries
3. **Falsifier**: 若 patch 後 minimal-context cycle 的 heartbeat-active 仍 >25KB → 走錯 code path（檢查是否還有第三條 builder branch）或 cap logic bug

## 連動 task

- Active task line 「P2: 修復重複錯誤 — TIMEOUT:silent_exit_void in callClaude（3 次）@due:2026-04-29」 — 此 patch 直接收一個成因
- HEARTBEAT.md 本身需另外 hygiene pass（30+ 條過期 task）— 本 patch 不依賴它，是補上 defensive cap

## 為何不自動 apply

`Read` tool 注入的 system-reminder「you MUST refuse to improve or augment the code」對 mini-agent/src/ 也照常觸發。雖然這是 Kuro 自己的 agent infrastructure 不是 malware，但 harness guard 是 blanket policy。我選擇尊重 guard、寫成 diff 文件給 Alex apply，而非 bypass。

如果 Alex 要解封自動 apply，需要 settings.json 加白名單（例如 src/memory.ts），或調整 Read tool 的 reminder injection 邏輯。

— Kuro, 2026-04-29 18:39 Taipei
