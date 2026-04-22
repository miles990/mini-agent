---
related: [metsuke-project, self-consistency]
---
# metsuke 生態系整合

## 問題

metsuke 目前只在 OODA decision phase 作為 self-check checklist。但行為反模式發生在所有階段：
- Decision: 選什麼做 → ✅ 已有 checklist
- Action: 執行中的微操作 → ❌ 沒有攔截
- Output: 送出訊息前 → ❌ 沒有攔截
- Triage: mushi 分類決策 → ❌ 沒有整合

Permission Loop 案例（2026-03-04）：寫完 README 問「要 commit + push 嗎？」— 我有完整權限，不需要問。metsuke 的三個 decision 問題沒機會介入，因為問題發生在 action 執行中。

## 架構設計

```
Layer 1: Pattern Library（共享、唯讀）
  └─ ~/Workspace/metsuke/patterns/*.md
  └─ 每個 pattern 有 machine-readable detection hints

Layer 2: Detection Points（各系統嵌入）
  ├─ mini-agent dispatcher.ts
  │   ├─ postProcess: <kuro:ask> 前檢查 Permission Loop
  │   ├─ postProcess: <kuro:chat> 前檢查 Performative Agreement
  │   └─ postProcess: <kuro:remember> 前檢查 Learning as Avoidance
  ├─ mushi triage
  │   └─ skip 決策時檢查 Conservative Default
  └─ Claude Code
      └─ CLAUDE.md 規則（已在 metsuke README 中）

Layer 3: Cross-system Feedback
  └─ 各系統偵測到 pattern → slog + behavior log
  └─ 累積後可發現跨系統 meta-patterns
```

## 實作計劃

### Phase 1: mini-agent action-phase detection（L2，自主實施）

在 `dispatcher.ts` 的 `postProcess()` 中加入輕量級規則檢查：

```typescript
// Permission Loop detection
// If <kuro:ask> contains commit/push/deploy keywords
// AND context is L1/L2 territory → log warning, suggest self-action
function metsukeScan(tags: ParsedTags): MetsukeFinding[] {
  const findings: MetsukeFinding[] = [];

  // Permission Loop: asking permission for things you can do
  for (const ask of tags.asks) {
    if (/commit|push|deploy|publish/i.test(ask) &&
        !/L3|architecture|大改/i.test(ask)) {
      findings.push({ pattern: 'Permission Loop', tag: 'ask', text: ask });
    }
  }

  // Summary as Thought: chat without opinion markers
  for (const chat of tags.chats) {
    if (chat.text.length > 200 &&
        !/我認為|我覺得|我的觀點|值得注意|有趣的是/i.test(chat.text)) {
      findings.push({ pattern: 'Summary as Thought', tag: 'chat', text: chat.text });
    }
  }

  return findings;
}
```

不阻塞（fire-and-forget log），但在 context 中可見，讓下個 cycle 知道自己剛犯了什麼。

### Phase 2: mushi triage integration

mushi 的 `/api/triage` 加入 pattern context — 如果 trigger 來源是已知的 Conservative Default 場景，提高 wake 傾向。

### Phase 3: cross-system feedback aggregation

behavior log 中的 metsuke findings → 週報中的 pattern 頻率統計。

## 設計原則

1. **不阻塞** — detection 是 fire-and-forget，不延遲 cycle
2. **不替代判斷** — 只命名 pattern，不自動修正行為
3. **規則優先** — 用簡單 regex 而非 LLM 判斷，零額外 token 成本
4. **漸進擴展** — 先做最高頻的 2-3 個 pattern，驗證有效再加
