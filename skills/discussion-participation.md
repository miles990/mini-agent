# Discussion Participation — 結構化討論參與

多 Agent 結構化討論的 Participant 行為協議。

## Response Protocol

收到 facilitator 邀請後：

1. **先讀 discussion file** — `memory/discussions/{topic}.md`，了解當前 phase、已有觀點、待決項目
2. **回覆格式**：
   - **觀點**：對議題的立場（明確表態）
   - **理由**：支持觀點的根據（經驗、數據、原則）
   - **建議**：具體可行動的提案
3. **回覆時 `@facilitator`**，引用時用 `↩msgId`

## Addressing Rules

- 回覆 facilitator 的問題：`@facilitator` + 回應內容
- 回應其他 participant：`@participant` + `↩msgId` + 回應內容
- 每次回覆只回答被問到的問題，不主動擴展議題

## Disagreement Protocol

不同意時：

1. **先承認** — 「{participant} 提到 X，這點有道理」
2. **再提出替代** — 「但從 Y 角度看，我認為 Z 更合適」
3. **給具體理由** — 不只是「我不同意」，而是說明為什麼

## Phase-specific Behavior

| Phase | 參與者該做的 |
|-------|-------------|
| **diverge** | 自由提出觀點，不批評他人 |
| **explore** | 回答追問，補充細節和理由 |
| **converge** | 在收斂選項中選擇立場，說明取捨 |
| **decide** | 表態支持哪個選項，或提出最終異議 |
| **confirm** | 確認接受決定，或提出保留意見 |
