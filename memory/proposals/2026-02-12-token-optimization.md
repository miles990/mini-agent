# Proposal: Token Optimization — 不降級的 Context 瘦身

## Status: superseded by: 2026-02-12-token-optimization-jit-skills.md

## TL;DR
每次 Claude CLI 呼叫的 prompt 約 46-60K chars，其中 27K 是 skills（靜態注入 system prompt、每次全載）。透過 **Skills JIT Loading** + **SOUL.md 分層** + **NEXT.md 規則裁剪**，預估可減少 40-55% context size，不影響任何功能。

## Problem（現狀問題）

Alex 反映快到達 Claude Code 額度上限。每次 Claude CLI 呼叫的 prompt 結構：

```
systemPrompt (~27K chars: base prompt ~3K + skills ~24K)
+ context (~20-36K chars: perception + memory + soul + topics + heartbeat + conversations)
= 46-60K chars per call
```

**最大的浪費**：

| Component | 字元 | 問題 |
|-----------|------|------|
| Skills (8 files) | 27,162 | **每次呼叫全部載入**，但大部分 cycle 只用到 1-2 個 |
| SOUL.md | 16,596 | My Thoughts 9 條 × ~500 chars = 4,500 chars，focused mode 也全載 |
| NEXT.md 規則 section | ~800 | 每次都載入規則說明，但規則已內化 |
| Topic Memory (full mode) | 最多 25 entries | full mode 載入所有 topic，每個 5 entries |

**Skills 是最大的問題**：autonomous-behavior(8.7K) + web-learning(6.2K) + action-from-learning(6K) + web-research(3.6K) 合計 24.5K chars，但學習 cycle 不需要 docker-ops/debug-helper，巡檢 cycle 不需要 web-learning。

## Goal（目標）

- **Primary**: 減少 40-55% 每次呼叫的 token（60K → 27-36K chars）
- **Secondary**: 不犧牲任何功能 — 需要的 skill 在需要時一定會被載入
- **Constraint**: 不改變 Agent 行為、不降級回應品質

## Proposal

### 改動 1: Skills JIT Loading（最大收益）

**現狀**: `formatSkillsPrompt()` → 全部 skills 注入 system prompt
**改為**: 根據 trigger/hint 只載入相關 skills

```typescript
// memory.ts — 新增 skill 相關性映射
const SKILL_RELEVANCE: Record<string, string[]> = {
  'autonomous-behavior': [],  // 核心 skill，always load
  'web-research': ['url', 'http', 'fetch', 'cdp', 'chrome', 'web', 'browse', 'search'],
  'web-learning': ['learn', 'study', 'research', 'hacker news', 'article', 'read'],
  'action-from-learning': ['proposal', 'improve', 'action', 'l1', 'l2', 'deploy'],
  'docker-ops': ['docker', 'container', 'image'],
  'debug-helper': ['bug', 'error', 'debug', 'crash', 'fix'],
  'project-manager': ['task', 'heartbeat', 'priority', 'p0', 'p1'],
  'self-deploy': ['deploy', 'commit', 'push', 'ci', 'cd'],
};
```

**dispatcher.ts 改動**：`getSystemPrompt()` 改為 `getSystemPrompt(hint?: string)`，根據 hint 篩選 skills。

**預估節省**: 24K → 9K chars (autonomous-behavior always + 1-2 relevant skills) = **-15K chars**

### 改動 2: SOUL.md Focused Mode 改進

**現狀**: `truncateSoulToIdentity()` 只在 minimal mode 用。focused mode 載入完整 SOUL.md (16.6K)
**改為**: focused mode 也截斷 — 保留 Who I Am + My Traits + When I'm Idle + My Hard Limits，跳過 Learning Interests 詳細內容和 My Thoughts 全文

```
focused mode: ~4K chars (identity core + hard limits)
full mode: ~16.6K chars (unchanged)
```

**預估節省**: focused mode 時 -12K chars

### 改動 3: NEXT.md 規則部分永遠不載入

**現狀**: `extractActiveNext()` 會截斷 `## Later` 和 `## 規則` 以下
**實際**: NEXT.md 目前 Now/Next 都是空的，但規則 section 不會被載入（已有 cutoff）
**確認**: 這項已經正確實作 ✅ 無需改動

### 改動 4: Conversation 截斷加強

**現狀**: `MAX_CONVERSATION_ENTRY_CHARS = 300`，focused mode 只載 10 則
**改為**: focused mode 只載 5 則（OODA cycle 不需要太多對話歷史），entry 截斷到 200 chars

**預估節省**: focused mode 時 ~-1.5K chars

## 效果預估

### AgentLoop Cycle (focused mode, 最頻繁的呼叫)

| Before | After | 節省 |
|--------|-------|------|
| Skills: 27K | Skills: ~9K (JIT) | -18K |
| SOUL: 16.6K | SOUL: ~4K (truncated) | -12.6K |
| Conversations: ~3K | Conversations: ~1K | -2K |
| **Total: ~55K** | **Total: ~22K** | **-33K (60%)** |

### User Message (full mode)

| Before | After | 節省 |
|--------|-------|------|
| Skills: 27K | Skills: ~12K (JIT, 更多 skills) | -15K |
| SOUL: 16.6K | SOUL: 16.6K (unchanged) | 0 |
| **Total: ~60K** | **Total: ~45K** | **-15K (25%)** |

## Alternatives Considered

| 方案 | 優點 | 缺點 | 不選的原因 |
|------|------|------|-----------|
| **本提案 (JIT Skills + SOUL trim)** | 最大收益、零功能損失、可漸進 | 需改 src/ | 收益最大、風險低 |
| 只壓縮 memory 文件 | 不改 src/ | 已試過，會丟失知識 | Alex 反饋壓太狠 |
| 減少 perception plugins | 減少 context | 降低感知能力 | 違反 perception-first |
| 減少 OODA cycle 頻率 | 減少總呼叫次數 | 降低反應速度 | 不符「不降級」要求 |

## Pros & Cons

### Pros
- 每次 focused mode 呼叫省 60% context (55K → 22K)
- 不犧牲任何功能 — 需要的 skill 按需載入
- Skill 映射表容易維護和調整
- 改動範圍小（memory.ts + dispatcher.ts）

### Cons
- 關鍵字匹配可能偶爾漏載 skill（但 autonomous-behavior always load 保底）
- 增加少量 code complexity（skill 篩選邏輯）

## Effort: Small
## Risk: Low

## Source
Alex 在 Telegram 說「緊急任務，要在不降級的情況下先優化 token 使用量，不然有陣子可能沒法上線」。
