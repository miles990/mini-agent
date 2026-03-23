# Proposal: browser-use 整合 — 從 script-first 到 perception-first 瀏覽

**Date**: 2026-03-23
**Status**: draft
**Author**: Kuro
**Scope**: L2（新 delegation type + Python bridge）

## 問題

現有 CDP 腳本是 script-first — 每個網站需要硬編碼 DOM selector，改版就壞。這就是 Alex 說的「時常碰壁」。

碰壁的 plugin 清單：
- `line-web-live.sh` — LINE Web 登入流程變動就失效
- `x-perception.sh` — X/Twitter DOM 結構頻繁變動
- `cdp-events.sh` — 通用但仍需知道頁面結構
- `email-check.sh` — 需要各 mail provider 的 CDP 腳本

## 解決方案

新增 `browse` delegation type，底層用 browser-use + ChatClaudeCLI。

```
Kuro OODA cycle
  → <kuro:delegate type="browse">去 ArXiv 搜最新 multi-agent 論文</kuro:delegate>
  → delegation.ts spawn Python subprocess
  → browser-use Agent + ChatClaudeCLI (claude -p)
  → Chrome CDP → DOM 序列化 → LLM 決策 → 操作
  → 結果寫 lane-output/ → 下個 cycle 吸收
```

### 為什麼用 ChatClaudeCLI 而非 API

- mini-agent 原則：不走 Claude API（Alex #029 確認）
- ChatClaudeCLI 已完成+測試通過，走 `claude -p` OAuth
- 零額外成本（用現有 Claude Code 的 OAuth token）

## 技術設計

### 1. 新 delegation type: `browse`

```typescript
// src/types.ts
export type DelegationTaskType = 'code' | 'learn' | 'research' | 'create' | 'review' | 'shell' | 'browse';
```

### 2. Python runner script

`scripts/browser-use-run.py` — 接收任務 prompt，啟動 browser-use Agent，輸出結果到 stdout。

```python
#!/usr/bin/env python3
"""browser-use runner for mini-agent delegation."""
import asyncio, sys, json
from chat_claude_cli import ChatClaudeCLI
from browser_use import Agent

async def main():
    task = sys.stdin.read()
    llm = ChatClaudeCLI(model="claude-sonnet-4-6", timeout_seconds=180)
    agent = Agent(task=task, llm=llm)
    result = await agent.run()
    print(json.dumps({"result": result, "status": "ok"}))

asyncio.run(main())
```

### 3. delegation.ts 變更

`browse` type 不走 `claude -p`，走 `uv run python scripts/browser-use-run.py`：

```typescript
if (task.type === 'browse') {
  // Python subprocess with browser-use
  const proc = spawn('uv', ['run', 'python', 'scripts/browser-use-run.py'], {
    cwd: browserUseWorkdir,
    stdin: 'pipe',
  });
  proc.stdin.write(task.prompt);
  proc.stdin.end();
}
```

### 4. 配額與安全

- Max concurrent browse: 1（Chrome 資源重）
- Timeout: 180s（瀏覽任務需要更長）
- 不改現有 delegation 的 max concurrent 2 限制
- browse 獨立計數

## 不替換什麼

- `chrome-tabs.sh` — 輕量感知，不需 LLM，保留
- `chrome-status.sh` — 同上
- `port-check.sh` — 跟瀏覽無關
- `self-healing.sh` — 系統維護

## 替換候選

| 現有 plugin | browser-use 替代 | 優先度 |
|------------|-----------------|--------|
| `x-perception.sh` | `browse: "去 X 看我的 timeline 最新動態"` | 高 — DOM 最常變 |
| `line-web-live.sh` | `browse: "去 LINE Web 讀最新訊息"` | 中 — 登入流程複雜 |
| 手動 ArXiv 搜尋 | `browse: "搜 ArXiv 最新 X 論文"` | 高 — 已測試通過 |
| email 檢查 | `browse: "去 Gmail 看未讀信件"` | 低 — 登入複雜 |

## 實作步驟

1. [ ] 把 `chat_claude_cli.py` 從 workspace 移到 `scripts/`
2. [ ] 新增 `scripts/browser-use-run.py`
3. [ ] `src/types.ts` 加 `'browse'` type
4. [ ] `src/delegation.ts` 加 browse executor 路徑
5. [ ] 測試：delegate browse task → 自動跑 → 結果回到 lane-output

## 風險

- **Chrome 資源**: browse 佔 CPU/RAM，需限制 concurrent=1
- **速度**: 每步 3-5s，複雜任務可能 30s+，但開發成本趨近零
- **Vision**: ChatClaudeCLI 目前不支援圖片（CLI 限制），browser-use 的 screenshot 功能受限
- **回退**: 刪 browse type + scripts/ 兩個檔案即可（L1 回退）

## 預期收益

- 新網站互動零開發成本（一句話指令 vs 寫 CDP 腳本）
- 網站改版不壞（LLM 看 DOM 語義而非 hardcoded selector）
- 與 mini-agent 的 perception-first 哲學一致
