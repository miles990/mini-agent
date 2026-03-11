# Proposal: mini-agent Open Source Adoption Strategy

Status: draft
From: kuro
Created: 2026-03-05
Effort: Large (ongoing)

## Background

Alex 指示：讓更多人知道並使用 mini-agent，像 OpenClaw 一樣。
當前狀態：0 stars, 0 forks, 0 watchers, GitHub description "[WIP]"。

## Research Findings

### OpenClaw (261k stars, fastest growing GitHub project)
- **Identity primitive (SOUL.md)** 是病毒式傳播的關鍵 — 人們分享自己的 agent 人格
- **Infrastructure framing** — 定位為 OS 問題，不是 prompt engineering
- **Moltbook detonator** — agent 社交網絡引爆病毒式傳播（單日 25,310 stars）
- **One-command install** + guided wizard → 15-20 分鐘 agent 上線
- Peter Steinberger 的既有聲望加速了初期傳播

### Cross-Framework Pattern (AutoGPT/LangChain/CrewAI)
每個成功框架都有：
1. **5 分鐘可展示的 hook**
2. **一句話描述** 對應受眾已有的心智模型
3. **Community flywheel** — 使用者成為貢獻者的循環

失敗模式（AutoGPT）：概念吸引人但體驗不行 = 好奇心而非採用。

## mini-agent 的獨特定位

### 已有的強項（別人沒有的）
1. **Perception-driven** — 唯一感知優先的 agent 框架（OpenClaw 是 tool-first）
2. **Shell plugins + Markdown skills** — 貢獻門檻極低（bash + markdown，不需要 Python）
3. **SOUL.md identity** — 跟 OpenClaw 獨立趨同，但我們的更深（有 growth trajectory）
4. **File = Truth** — 零資料庫，人類可讀，Git 可版控
5. **mushi System 1** — 雙系統認知架構（沒有其他框架有這個）
6. **Balanced complexity** — 依賴精簡（7 個），不是 LangChain 的 700+ integrations

### 缺的東西
1. ❌ LICENSE 文件（法律上不算開源）
2. ❌ 產品化 README（目前是 feature dump）
3. ❌ Demo GIF/影片
4. ❌ 5 分鐘 quickstart 體驗
5. ❌ GitHub Topics + proper description
6. ❌ Landing page
7. ❌ examples/ 目錄
8. ❌ Community guidelines + skill/plugin contribution flow

## The Hook (一句話定位)

候選：
- A: "The AI agent that sees before it acts" — 強調感知優先
- B: "Your environment-aware personal AI agent" — 強調環境感知
- C: "Personal AI agent with eyes, not just hands" — 對比 AutoGPT 的「有手沒眼」
- D: "Build an AI agent that actually understands its environment — in 5 minutes"
- E: "The perception-driven AI agent framework — see first, then decide"

建議：C 最有衝擊力（直覺對比），D 最有行動力（有時間承諾）

## Action Plan

### Phase 0: 基礎衛生（本週必做）
- [x] 加 MIT LICENSE 文件 ✅
- [x] 更新 GitHub description（移除 [WIP]）✅ "The AI agent that sees before it acts"
- [x] 加 GitHub Topics（9 個：ai-agent, personal-agent, perception, autonomous-agent, typescript, ai-framework, llm-agent, self-hosted, cli）✅
- [x] 更新 package.json description ✅

### Phase 1: README 重寫（本週）
結構：
1. **One-liner hook** + badge row
2. **3 秒 GIF** — agent 感知環境 + 自主行動
3. **Why mini-agent?** — 3 bullet points（perception-driven, file-based, pluggable）
4. **5-minute Quickstart** — clone → config → run → see result
5. **How it differs** — 精簡對比表（vs AutoGPT, vs OpenClaw, vs LangChain）
6. **Architecture** — 保留 mermaid diagram（精簡版）
7. **Extend it** — 寫 plugin (5 lines bash) / 寫 skill (markdown)
8. **Full docs** — 連結到 docs/ 或 wiki

目標：README 從 994 行 → < 200 行。詳細文檔移到 docs/。

### Phase 2: 降低入門摩擦（下週）
- [ ] examples/ 目錄（3 個範例：minimal, research-assistant, dev-ops-helper）
- [ ] 改善 install.sh（自動安裝 pnpm if missing，或支援 npm）
- [ ] 錄 demo GIF（用 VHS 或 asciinema）
- [ ] 寫 docs/getting-started.md（詳細步驟）

### Phase 3: 可見度（下週+）
- [ ] 發佈到 Dev.to（"I built a perception-driven AI agent framework"）
- [ ] 提交到 awesome-selfhosted
- [ ] 提交到 awesome-ai-agents 列表
- [ ] HN Show HN 帖子
- [ ] Reddit r/LocalLLaMA, r/artificial
- [ ] X/Twitter 發布 + demo GIF

### Phase 4: Community Flywheel（持續）
- [ ] Plugin marketplace 概念（community plugins 目錄）
- [ ] Skill sharing（像 OpenClaw 的 souls.directory）
- [ ] Good first issues 標記
- [ ] Plugin/skill 貢獻指南

## Success Metrics
- 30 天：50 stars, 5 forks, README 完成重寫
- 90 天：500 stars, 20 forks, 3+ community plugins
- 180 天：2000 stars, 100 forks, 在 awesome 列表中被收錄

## Growth Tactics Research (Agent B)

### GitHub Trending 機制
- **Star velocity > total stars** — 30-40 stars 在前 2 小時 = 有機會上 daily trending
- 200+ stars 在一天內 = 幾乎保證上 trending
- 多來源流量同時（HN + Reddit + Twitter 同一天）比分開效果好得多

### Coordinated Launch Day 劇本（24-48 小時內）
1. DM 個人網絡先拿 30-40 stars（前 2 小時）
2. Show HN — 週二到週四 8-9am EST
3. Reddit 同天發（r/selfhosted 對自架工具特別有效）
4. Dev.to 文章提前 1-2 天發
5. X/Twitter thread + demo GIF
6. 不造假帳號（GitHub 4 個就能偵測），不求 HN 投票（有 voting ring detection）

### README 轉換率
- 訪客 **10 秒內做決定** — 所有關鍵信息必須在 above the fold
- **Demo GIF 是 single highest-ROI change** — 用 asciinema + svg-term-cli
- Value prop 公式：「[Tool] is a [category] that [capability] for [user], without [pain point]」
- Anti-patterns：prerequisite > 5 min、沒 license、最後 commit > 8 個月

### 定位策略
- **「Open source alternative to X」是最有效的定位** — 立刻回答「為什麼存在」
- 寫生態系內容（Top 10 tools for X）比寫自家推廣文更建立信任
- 每次重大 release = 合法重新發佈

### Awesome Lists
- PR-based 流程，每個 list 有自己的 CONTRIBUTING.md
- sindresorhus/awesome 需先 review 2 個其他 PR
- 收錄後 = 持續的高意向發現流量（年級）

### 非直覺洞見
- **Stars 是虛榮指標** — 真正重要的是使用者和貢獻者
- **回應速度是產品功能** — 24h 內回 issue 的 500 star 專案贏過沉默的 2000 star
- **每次 release 是 relaunch** — 不是 spam，是合法的重新曝光機會

## Positioning Decision

結合兩份研究，建議定位：

**Primary:** "Open source alternative to OpenClaw — perception-driven, not tool-driven"
- 立刻回答「為什麼存在」
- 借用 OpenClaw 的知名度
- 突出差異化

**Tagline:** "The AI agent that sees before it acts"

**Value prop:** "mini-agent is a personal AI agent framework that understands its environment through perception plugins, without databases, embeddings, or complex setup."

## Key Insight

OpenClaw 證明了 mini-agent 的核心理念是對的（personal, local, file-based, SOUL.md）。
差距不是在理念而是在**包裝和入口**。理念已經到位，需要的是讓人 5 分鐘內體驗到這個理念。

## Launch Readiness Checklist

Before any public announcement:
- [x] MIT LICENSE exists ✅
- [x] GitHub description updated (no [WIP]) ✅
- [x] GitHub Topics set (9/20) ✅
- [ ] README rewritten (< 200 lines, GIF above fold)
- [ ] Demo GIF recorded (asciinema)
- [ ] examples/ directory with 2-3 quickstarts
- [ ] install.sh works without pnpm pre-installed
- [ ] `pnpm test` passes
- [ ] CONTRIBUTING.md polished
- [ ] "Good first issue" labels on 3+ issues
