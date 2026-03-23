# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

### [Goal] Teaching Monster — Engagement 提升階段（Deadline: 5/1 初賽）
Context: Haiku self-reviewer avg 3.5/5 (PASS). 瓶頸從 adaptation → engagement. Slides 48→30 已修好。TTS Kokoro OK.

- [ ] P2: 持續追蹤 Teaching Monster 競爭情報（SpeechLab 32/32, 阿宇 Haiku+Sonnet pipeline）
  Verify: `grep -c 'competitor\|SpeechLab\|阿宇' ~/Workspace/mini-agent/memory/topics/teaching-monster*.md 2>/dev/null`
- [ ] P2: 等待平台下一批 request，驗證 engagement/visual 改善效果
  Verify: `ls ~/Workspace/teaching-monster/output/*/script.json 2>/dev/null | tail -5`

---

## Next（按優先度排序）

- [ ] P1: 認知科學 Phase 0 — 純 prompt 改動提升 engagement（Alex 核准後開始）
  內容：(a) monitoring checkpoints (b) 符號接地協議 (c) productive struggle (d) 對話式語氣
  Verify: `grep -c 'monitoring\|grounding\|productive struggle' ~/Workspace/teaching-monster/src/multi-phase-prompts.mjs`
- [ ] P1: 暖身賽 Round 2 準備（4月初開始，評審委員出題，更難）— 確保 pipeline 能即時回應
  Verify: `cd ~/Workspace/teaching-monster && node src/pipeline.mjs --dry-run 2>&1 | head -5`
- [ ] P2: Elo Arena 差異化 Phase 2 — 用 3-5 個測試題目驗證改進效果（需 API credits）
- [ ] P2: myelin dogfooding 持續觀察 + cache hit rate 分析
  Verify: `wc -l ~/Workspace/mini-agent/memory/myelin-decisions.jsonl`

---

## Blocked（等待外部）

- [ ] npm publish myelin/asurada — 等 Alex 決定語言方向（Timeout: 2026-03-31）
- [ ] Show HN 發佈 — 依賴 npm publish

---

## Done（本週完成）

- [x] 認知科學 × TM 深度研究 — 21 個實證發現 + 14 設計原則 + 4 Phase 執行計劃
- [x] browser-use 整合 Phase 1-2 完成 — browse delegation E2E 可用 (84f7f3e)
- [x] kuro.page Journal Preview 區段上線 (abfaf6e)
- [x] TM E2E score 2.75→3.5 (baseline→current), PASS threshold reached
- [x] Engagement 提升 — 4 commits: student voice gate, predictive questions, misconception-first
- [x] Pipeline 品質審查層 — Opus Final Gate（每段生成後 Opus 評分+修正）
- [x] Elo Arena 差異化策略 v1 — cognitive dissonance hooks + synthesis closings (13f662b)
- [x] TM 官網完整掃描：初賽 Elo Arena 對戰制確認、Round 2 四月初 (fa4dcfb)

---

## Later（有空再做）

- [ ] P3: 創作 — inner voice 衝動持續累積，定期表達
  Verify: `ls kuro-portfolio/content/draft-fragile-constraints.md`

---

## 規則

### 1. 優先度規則
- **P0**: 緊急且重要（影響系統運作）
- **P1**: 重要不緊急（本週應該推進）
- **P2**: 一般優先度（有空再做）
- **P3**: 低優先度（想法備忘）

### 2. 動態調整
- 每次 OODA cycle 檢視 "Now" 和 "Next" sections
- 根據當前狀況重新排序
- "Now" 空了就從 "Next" 挑最高優先度的開始

### 3. 完成即刪除
- 完成的任務從清單移除
- 重要成果記錄到 MEMORY.md 或 topics/*.md

### 4. 保持簡短
- **Now**: 最多 1 個（專注）
- **Next**: 最多 5 個
- **Later**: 不限但定期清理

### 5. 完成標準必須嚴格
- 每個 Done when 要有可驗證的產出
- 必須附 Verify 命令
