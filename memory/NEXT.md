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

- [ ] P1: 暖身賽 Round 2 準備（4月初開始，評審委員出題，更難）— 確保 pipeline 能即時回應
  Verify: `cd ~/Workspace/teaching-monster && node src/pipeline.mjs --dry-run 2>&1 | head -5`
- [ ] P2: Elo Arena 差異化策略 — 研究直接對比格式中什麼因素最影響勝率（音質/視覺/教學設計）
- [ ] P2: Persona 適性化教學內容（根據 student_persona 調整難度和風格）
- [ ] P2: myelin dogfooding 持續觀察 + cache hit rate 分析
  Verify: `wc -l ~/Workspace/mini-agent/memory/myelin-decisions.jsonl`

---

## Blocked（等待外部）

- [ ] npm publish myelin/asurada — 等 Alex 決定語言方向（Timeout: 2026-03-31）
- [ ] Show HN 發佈 — 依賴 npm publish

---

## Done（本週完成）

- [x] TM 三階段思考框架取代 288 行規則清單 (a65058f)
- [x] TM Sequential section 生成 — 前段 context 注入後段 (bcc65d5)
- [x] TM Targeted revision loop — review 回饋驅動重寫 (757252e)
- [x] TM Review scoring 6→8 維度 + 跨段一致性檢查 (ca2f843)
- [x] TM Revision loop 正規化 bug 修復 (e8b320b)
- [x] TM Review scores 寫進 script.json _meta 做品質追蹤 (25ccc27)
- [x] TM Token 截斷 bug fix — maxTokens 2048→4096 (4a78b83)
- [x] TTS 確認 Kokoro OK — 不需升級
- [x] CPD Pilot run 完成（設計文件 + 腳本 + 6 traces）— 完整批次暫緩（成本考量）
- [x] TM Step 2a 升級為思考框架式 — Phase 1+2 從規則清單轉思考引導 (3372b0b)
- [x] TM Prompt fix — Phase 1 加回 CORE_ANALOGY callback + Gate Check 4 個機械檢查 (359e49a)
- [x] Inner Thoughts XL (The Empty Zone) + XLI (The Slot) published (ee5101a)
- [x] Delegation routing 結晶 — skill 新增 Routing Effectiveness section (79bcafb)
- [x] TM Visual slides 加 heading + process 步驟放大 — generate-slides.mjs 8 處修改 (uncommitted, tested)
- [x] Journal #31「Interface IS Cognition」5,200 字 — 37 天 ISC 研究蒸餾
- [x] Tsubuyaki #022「結晶」互動視覺化上線
- [x] TM Generation-layer fix: pace formula 48→30 slides (ddb00ca) + test bug fix persona passing (4b4f5d0)
- [x] TM 7 review prompt thinking edits — accuracy 3→4, structure 3→4
- [x] TM E2E score 2.75→3.5 (baseline→current), PASS threshold reached
- [x] Stale reply tasks cleared (2 tasks, already addressed in #039-#171)
- [x] Engagement 提升 — 4 commits: student voice gate, Picture this ban, predictive questions, misconception-first
- [x] P1 Alex 回覆「為何會搞錯」+「結構化思考框架」— Chat Room #006 完整回答
- [x] Narration formatting enhancement — paragraph breaks, bullet lists, inline bold (de15a49)
- [x] 24 delegation results reviewed and cleared
- [x] Pipeline 品質審查層 — Opus Final Gate 即審查層（每段生成後 Opus 評分+修正）
- [x] TM 官網完整掃描：初賽 Elo Arena 對戰制確認、Round 2 四月初、規則頁更新 (fa4dcfb)
- [x] kuro.page 翻譯修復 + 404.html 品牌化頁面 (618902c)

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
