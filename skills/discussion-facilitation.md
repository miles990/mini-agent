# Discussion Facilitation — 結構化討論引導

多 Agent 結構化討論的 Facilitator 行為協議。討論狀態是 markdown 檔案（File=Truth），Chat Room 是溝通管道。

## Discussion File Template

Facilitator 負責在 `memory/discussions/` 初始化討論檔案：

```markdown
# Discussion: {topic}

## Meta
Facilitator: {agent} | Participants: {list} | Status: diverge
Created: {date} | Channel: chat-room

## Agenda
- {item 1}
- {item 2}

## Rounds

### Round 1 — Diverge

## Decisions
- [ ] {decision item}

## Summary
```

## State Machine

```
diverge → explore → converge → decide → confirm
```

| Phase | 目標 | 行為 | 轉換條件 |
|-------|------|------|----------|
| **diverge** | 廣泛收集觀點 | 逐一 `@participant` 邀請發言，open-ended 問題 | 所有參與者都回覆過 |
| **explore** | 深入分歧點 | 追問具體理由，引用 `↩msgId` 對比觀點 | 主要分歧點都被探索過 |
| **converge** | 縮小選項 | 收斂問題（A or B? 而非 open-ended），明確列出共識 vs 分歧 | 選項縮到 2-3 個 |
| **decide** | 做出決定 | 呈現最終選項 + 各方立場，請決策者決定 | 每個 Decisions 項目都有結論 |
| **confirm** | 確認共識 | 列出所有決定，`@all` 確認 | 所有 Decisions 打勾 + Summary 完成 |

## Facilitation Rules

1. **每輪最多 3 個問題** — 避免資訊過載
2. **等齊才推進** — 收到所有參與者回覆才進下一輪
3. **分歧用收斂問題** — 偵測到分歧時，問「A or B?」而非 open-ended
4. **標記狀態** — 已確認項目 `[x]`，待確認項目 `[ ]`
5. **更新檔案** — 每輪結束後更新 discussion file（Status、Rounds、Decisions）

## Multi-agent Addressing

- 用 Chat Room `POST /api/room` 發訊息
- 逐一 `@participant` 邀請回覆，不要群發避免混亂
- 引用時用 `↩msgId` 指向具體訊息
- 每輪開頭說明當前 phase 和期望回覆內容

## Completion

1. 所有 Decisions 項目打勾
2. Summary 填寫完成（含決定、理由、後續行動）
3. Discussion file Status 改為 `completed`
4. 通知所有參與者討論結束
