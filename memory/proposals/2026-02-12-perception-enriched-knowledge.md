# Proposal: Perception-Enriched Knowledge Loading

## Status: completed (2026-02-14) — contextHint + keyword matching 已在 memory.ts 實作

## TL;DR
感知數據（Chrome 看到什麼、git 改了什麼、Telegram 收到什麼）目前不會影響哪些 skills/topics 被載入。改為從 perception cache 提取關鍵字注入 contextHint，讓「看到什麼」驅動「載入什麼知識」。同時把硬編碼的 keyword mapping 搬到 frontmatter，讓 Kuro 可以 L1 自主調整。

## Problem（現狀問題）

三套獨立的 keyword mapping 系統，都在 `src/memory.ts` 中硬編碼：

```
1. SKILL_KEYWORDS (lines 67-79)    — Skills JIT Loading
2. topicKeywords (lines 825-834)   — Topic Memory
3. pluginRelevance (lines 769-779) — Perception Plugins
```

它們共用同一個 `contextHint` 做匹配，但 contextHint 只來自：
- 用戶訊息 / loop prompt（`hint` 參數）
- 最近 3 則對話（`recentHint`）

**感知數據不參與 contextHint**。

### 具體例子

此刻感知數據：
- **Chrome**: 開著 `hub.docker.com` 和 `github.com/anthropics/claude-agent-sdk`
- **state-changes**: `src/dispatcher.ts` 被修改了
- **telegram-inbox**: Alex 剛傳了「部署有問題嗎？」

AgentLoop 觸發 task mode cycle，prompt = "You are an autonomous Agent running a self-check cycle..."

**現在**：contextHint 只有 prompt 內容 → 載入 `autonomous-behavior` + `project-manager` → 不知道要關注 Docker 和部署

**改完**：perception 提取 "docker", "anthropics", "deploy" 注入 contextHint → 額外載入 `docker-ops` + `self-deploy` + `agent-architecture` topic → Kuro 有知識來處理感知到的狀況

## Goal（目標）

| 指標 | Before | After |
|------|--------|-------|
| 感知→知識連結 | 無 | 自動（perception cache → contextHint） |
| Keyword mapping 編輯 | L2（改 src/*.ts） | L1（改 frontmatter） |
| 跨領域知識連結 | 無 | `related:` transitive loading |
| Token 膨脹風險 | N/A | Budget cap 控制（focused max 4 skills） |

## Proposal（提案內容）

### Phase 1: Perception-Enriched Hints（~50 行，改 memory.ts）

1. 新增 `extractPerceptionKeywords(results: PerceptionResult[]): string[]`
   - `chrome`: URL → domain name（"hub.docker.com" → "docker"）
   - `state-changes`: ALERT 關鍵字（"ALERT: Docker" → "docker", "alert"）
   - `telegram-inbox`: 訊息主題詞
   - `git-detail`: uncommitted/branch 狀態
   - 去重

2. 修改 `buildContext()` enrichment：
   ```typescript
   let contextHint = hint || recentHint;
   if (perceptionStreams.isActive()) {
     const cached = perceptionStreams.getCachedResults();
     const perceptionKw = extractPerceptionKeywords(cached);
     contextHint = [contextHint, ...perceptionKw].join(' ');
   }
   ```

3. 新增 skills budget cap：
   ```typescript
   const MAX_SKILLS_FOCUSED = 4;
   // 匹配後按 keyword hit 數排序，取前 N 個
   ```

### Phase 2: Frontmatter Tags（~80 行 + 16 檔案）

把 `SKILL_KEYWORDS` / `topicKeywords` 搬到 markdown frontmatter：

```yaml
# skills/web-research.md
---
tags: [research, search, url, fetch, curl, cdp, browse, web]
related: [web-learning, autonomous-behavior]
---
# Web Research
[existing content]
```

```yaml
# memory/topics/agent-architecture.md
---
tags: [autogpt, babyagi, langchain, crewai, anthropic, context, framework]
related: [mini-agent, design-philosophy]
---
```

程式碼改動：
1. `parseFrontmatter(content)` — regex 解析 `tags:` 和 `related:`
2. `expandRelated(selected, all)` — transitive loading（depth = 1, max 2 related per item）
3. `getSkillsPrompt(hint)` — 優先 frontmatter，fallback 硬編碼
4. Topic loading — 優先 frontmatter，fallback 硬編碼

遷移策略：漸進式（有 frontmatter 用 frontmatter，沒有 fallback 到硬編碼）

### Token 預算機制

| 場景 | 現在 (JIT) | 加 enrichment + budget | 變化 |
|------|-----------|----------------------|------|
| 簡單問候 "hi" | 0K | 0-1K | +0~1K |
| Task mode loop | ~9.5K | ~9.5K | ±0 |
| Autonomous loop | ~24.5K | ~20K | **-4.5K** |
| Docker ALERT | 0.9K | 1.8K | +0.9K |

Budget cap 確保 enrichment 只讓載入更「精準」，不會更「多」。

## Alternatives Considered

| 方案 | 優點 | 缺點 | 不選原因 |
|------|------|------|---------|
| **本提案** | 最小改動、L1 可編輯、File=Truth | 需維護 frontmatter | — |
| Vector embedding | 語義理解更好 | 違反 No Embedding 原則、加 API 成本 | 個人 agent 不需要 |
| SQLite FTS5 | 全文搜尋 | 違反 No Database 原則 | 過度工程 |
| 獨立 config 檔 | 集中管理 | metadata 與 content 分離 | 違反 File=Truth |

## Pros & Cons

### Pros
- 感知驅動知識載入 — 看到什麼就知道什麼（核心改善）
- L1 可編輯 — Kuro 可以自主調整 keyword mapping
- 跨領域連結 — `related:` 讓知識自然串連
- Budget cap — 不會 token 膨脹
- 向後相容 — CLI 模式、無 frontmatter 時行為不變

### Cons
- Perception keyword extraction 可能加入噪音（mitigation: 只提取高信號關鍵字）
- Frontmatter 需要 16 個檔案修改（mitigation: 漸進式遷移）
- 簡單 regex YAML 解析有邊界案例（mitigation: 格式嚴格定義）

## Effort: Medium
## Risk: Low

## Source（來源）

- Token Optimization JIT Skills 提案的延伸思考
- Reactive Architecture 的 EventBus + Perception Streams 已有基礎設施
- 類似模式：Topic Memory 的 keyword scoring 已驗證可行（memory.ts lines 836-848）
