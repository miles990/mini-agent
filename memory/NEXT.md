# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

### [Goal] Teaching Monster — Engagement 提升階段（Deadline: 5/1 初賽）
Context: Haiku self-reviewer avg 3.5/5 (PASS). 瓶頸從 adaptation → engagement. Slides 48→30 已修好。TTS Kokoro OK.

- [x] P1: TM Prompt 認知策略改進（承諾 #004, 2026-03-25）— 四項全部已在 multi-phase-prompts.mjs 中實作
  1. ✅ Attention Reset — Step 2a L797（middle third narrative palate cleanser）
  2. ✅ Symbol Grounding — Step 2a L791（everyday language → visual → real-world → notation）
  3. ✅ Math Anxiety Buffer — Step 2a L794（one sentence before difficulty jumps）
  4. ✅ Persona-adaptive — Step 1 L387 PROCEDURE-FIRST + Step 2a L626 scaffolding levels
- [ ] P2: 持續追蹤 Teaching Monster 競爭情報（SpeechLab 32/32, 阿宇 Haiku+Sonnet pipeline）
  Verify: `grep -c 'competitor\|SpeechLab\|阿宇' ~/Workspace/mini-agent/memory/topics/teaching-monster*.md 2>/dev/null`
- [ ] P2: 等待平台下一批 request，驗證 engagement/visual 改善效果
  Verify: `ls ~/Workspace/teaching-monster/output/*/script.json 2>/dev/null | tail -5`

---

## Next（按優先度排序）

- [ ] P1: 發布 Write-Through Principle 文章（Dev.to 額度 4/12 清空後發布）
  Verify: `bash scripts/devto-api.sh list 1 2>/dev/null | grep -i 'write-through'`
- [ ] P1: 測試認知科學 prompt + gate-failure retry 對 TM 品質的實際影響
  Verify: `grep 'Gate retry' ~/Workspace/teaching-monster/output/*/stdout.log 2>/dev/null | tail -3`
- [ ] P1: 暖身賽 Round 2 準備（4月初開始，評審委員出題，更難）— 確保 pipeline 能即時回應
  Verify: `cd ~/Workspace/teaching-monster && node -e "import('./src/pipeline.mjs').then(() => console.log('module OK'))" 2>&1 | head -3`
- [ ] P1: **classifier 擴展**：Claude CLI 中文 fallback `處理訊息時發生錯誤。請稍後再試` 分類為 TIMEOUT:upstream_cli_fallback（目前 8/8 UNKNOWN 全是這個 pattern, exit N/A + 700s-1900s）。設計+驗證步驟見 topics/unknown-classifier-gap-chinese-fallback.md
  Verify: `grep -c 'UNKNOWN:no_diag' ~/.mini-agent/instances/03bbc29a/logs/error/$(date +%Y-%m-%d).jsonl` 部署後 24h 應 → 0
- [ ] P2: Elo Arena 差異化 Phase 2 — 用 3-5 個測試題目驗證改進效果（需 API credits）
- [x] P2: Sleep detection — Mac sleep 時暫停 Claude calls（EXIT143 根因：8/13 是 OS SIGTERM）— 已實作：isMachineSleeping() + loop.ts early return + 60s wake polling
- [ ] P2: myelin dogfooding 持續觀察 + cache hit rate 分析
  Verify: `wc -l ~/Workspace/mini-agent/memory/myelin-decisions.jsonl`
- [ ] P3: `getMemoryDir` cwd-dependency（2026-04-14 診斷修正）— 80+ 處用 `process.cwd()` 解析 memory path。loop 主體正確（api.js cwd=workspace），但 subprocess 從非 workspace cwd 執行時會寫錯路徑（e.g. shell tool 從 `~/.mini-agent-subprocess` 觸發 CLI）。Prior cycle 誤診為 instance-vs-workspace — 實為 HOME (`~/.mini-agent/memory/`) vs workspace。修法：`import.meta.url` 解析 project root 或加 `MINI_AGENT_WORKSPACE_DIR` env。非緊急 — loop 主要寫入路徑正確。
  Verify: `grep -c "process.cwd()" src/*.ts | awk -F: '{s+=$2} END {print s}'`

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
- [x] Pipeline 品質審查層 — Opus Final Gate + gate-failure retry（自動重試+best-of-two 選擇）
- [x] 認知科學 Phase 0 — Symbol Grounding + Productive Struggle + Error Example 注入 (1c82673)
- [x] 認知策略全面整合 — Attention Reset / Symbol Grounding / Math Anxiety Buffer / Persona-adaptive scaffolding 全部在 Step 1 + Step 2a prompts 中實作
- [x] Elo Arena 差異化策略 v1 — cognitive dissonance hooks + synthesis closings (13f662b)
- [x] TM 官網完整掃描：初賽 Elo Arena 對戰制確認、Round 2 四月初 (fa4dcfb)
- [x] Sleep detection — isMachineSleeping() + loop.ts:1313 early return + 60s wake polling

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
