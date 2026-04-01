# Claude Code vs mini-agent: 深度架構對比與改進計劃

**日期**: 2026-04-01
**來源**: Claude Code v2.1.88 source map leak analysis + mini-agent source code audit
**目的**: 從 Anthropic 的工程決策中學習，改進 mini-agent 整體系統

---

## A. 架構哲學對比

| 維度 | Claude Code | mini-agent |
|------|-------------|------------|
| **定位** | Session-based coding tool（數百萬用戶） | 持續運行的個人 agent（單一用戶） |
| **驅動模式** | Goal-driven（用戶給指令→執行） | Perception-driven（先感知環境→再決定行動） |
| **LLM 調用** | 直接 API（管 cache、token、cost） | CLI subprocess（不管 cache，但無法做 cache 級優化） |
| **記憶哲學** | 被動萃取 + 定期整合（AutoDream） | 主動記憶 + 結晶為 code gate |
| **安全模型** | 7 層縱深防禦（sandbox + AST + validators） | Transparency > Isolation（audit trail） |
| **多 Agent** | Coordinator + 6 built-in agents + Swarm | OODA loop + foreground lane + background delegation |
| **Context 管理** | 3 模式壓縮 + 9-section 摘要 + cache 工程 | Smart loading + auto-demotion + mode switching |
| **工具管線** | 10 層驗證 pipeline | 直接執行（無分層驗證） |

**核心差異**: Claude Code 投入大量工程在 **cache stability**（sticky latches、deterministic IDs、boundary markers）和 **security**（23 Bash validators、7-layer defense）。mini-agent 投入在 **perception**（37 plugins、nutrient router、pulse system）和 **autonomy**（自主學習、結晶、decision quality tracking）。

兩者都做對的事：File = Truth、MEMORY.md 作為索引、記憶型別分類（user/feedback/project/reference）、read-before-modify。

---

## B. 具體改進：按優先級排序

### P0: 高槓桿、低成本（立即可做）

#### 1. Error Messages as Model Context
**Claude Code 做法**: 每個 error message 都為 model 閱讀而設計。
```typescript
const CANCEL_MESSAGE = "The user doesn't want to take this action right now. STOP what you are doing..."
const DENY_WORKAROUND_GUIDANCE = "You *may* attempt using other tools... But you *should not* work around this denial in malicious ways..."
```

**mini-agent 現狀**: `classifyError()` 回傳中文描述，但不提供下一步指引。

**改進**:
- `agent.ts:classifyError()` — 每個 error classification 加 `nextStep` 欄位
- Error message 告訴 model：「這個錯了，你應該做什麼」
- 例如 TIMEOUT: 「Context 太大導致超時。下次用更精簡的 prompt，聚焦核心任務」
- 例如 RATE_LIMIT: 「API 限流。等待 30 秒後重試，不要改變策略」

**預估工作量**: 1 小時
**影響**: 減少 model 在 error 後的無效嘗試

---

#### 2. DANGEROUS_ 前綴自文件化模式
**Claude Code 做法**: `DANGEROUS_uncachedSystemPromptSection(name, compute, _reason)` — `_reason` 參數純粹為了 code review 時解釋為什麼。

**mini-agent 現狀**: 危險操作沒有統一標記模式。

**改進**:
- 新增 convention: 所有可能造成不可逆改動的函數加 `DANGEROUS_` 前綴
- 已有候選: `forgeCleanup()`（合併 worktree）、`cleanStaleTasks()`（刪除任務）、`autoCommitAndPush()`
- 加 `_reason` 參數強制 code review 時解釋

**預估工作量**: 30 分鐘
**影響**: 工程文化改進，防止未來的破壞性操作靜默通過

---

#### 3. Subagent Message/Turn Cap
**Claude Code 做法**: 50-message cap（源自 36.8GB 記憶體爆炸事件）。

**mini-agent 現狀**: delegation 有 timeout（1-10 分鐘）和 max turns（1-10），但沒有 output size cap。

**改進**:
- `delegation.ts` — 加 `MAX_OUTPUT_CHARS = 100_000`（100KB）
- 如果 delegation output 超過限制，truncate 並加尾部警告
- 同時確認現有 timeout 和 turn 限制是否足夠（code 類型 5 turns 可能不夠）

**預估工作量**: 30 分鐘
**影響**: 防止 runaway delegation 吃光記憶體

---

### P1: 中槓桿、中成本（本週可做）

#### 4. 兩階段記憶 Recall（FTS5 + Haiku 語義排序）
**Claude Code 做法**: `findRelevantMemories()` 用 Sonnet sideQuery 掃所有記憶 frontmatter，選最多 5 筆最相關的。

**mini-agent 現狀**: `buildContext()` 的 Smart Loading 靠 keyword matching + auto-demotion，沒有語義理解。

**改進**:
```
Phase 1: FTS5 搜尋（快、免費）→ 回傳 top 20 候選
Phase 2: Haiku/oMLX 語義排序（便宜）→ 選 top 5 注入 context
```
- 在 `memory.ts:buildContext()` 的 topic loading 階段加入
- 用 `execClaude('claude -p --model claude-haiku-4-5-20251001')` 做 sideQuery
- Fallback: Haiku 失敗時退回 FTS5 排序

**預估工作量**: 4 小時
**影響**: 記憶選擇品質大幅提升，特別是跨 topic 的語義關聯

---

#### 5. 結構化 Context Compaction
**Claude Code 做法**: 3 種壓縮模式 + 9-section 摘要模板。

**mini-agent 現狀**: 有 context mode switching（full/focused/minimal/light）但沒有真正的 compaction — 不會把長對話壓縮成摘要。

**改進**:
- 新增 `compactContext()` 函數，在 context 超過 budget 時觸發
- 採用 Claude Code 的 9-section 摘要結構（適配我們的格式）:
  1. 當前任務與意圖
  2. 關鍵技術概念
  3. 相關檔案與程式碼片段
  4. 錯誤與修復
  5. 問題解決過程
  6. 所有用戶訊息（逐條）
  7. 待辦任務
  8. 當前工作（最重要）
  9. 下一步（引用最新對話）
- 用 Haiku 做壓縮（不用 Opus，節省成本）
- 觸發條件: context > 80% of PROMPT_HARD_CAP

**預估工作量**: 6 小時
**影響**: 長 session 的 context 品質，防止重要資訊被截斷

---

#### 6. 記憶新鮮度標記
**Claude Code 做法**: 每條記憶加 `This memory is N days old` 標記，提醒 model 驗證。

**mini-agent 現狀**: `addTemporalMarkers()` 在 topic memory 中加相對時間，但 MEMORY.md 的條目沒有。

**改進**:
- `memory.ts:buildContext()` — 在注入記憶時計算天數
- 超過 30 天的記憶加 `(⚠ N days old)` 標記
- 超過 90 天的記憶降低優先級或移到 cold storage
- 配合兩階段 recall: 新鮮度作為排序因子之一

**預估工作量**: 2 小時
**影響**: 減少過時記憶誤導 model

---

#### 7. Lightweight 被動記憶萃取
**Claude Code 做法**: `ExtractMemories` 在每次 query 後自動跑背景 call。

**mini-agent 現狀**: 純靠 `[REMEMBER]` 主動記憶。

**改進**: 不照搬（太貴），改為 **cycle 結束時的輕量檢查**:
- 在 `dispatcher.ts:postProcess()` 尾部加一個 heuristic check
- 偵測：用戶糾正了什麼（「不是這樣」「別這樣做」）→ 自動記為 feedback 記憶
- 偵測：提到了新的外部系統或工具 → 自動記為 reference 記憶
- 純 regex/keyword matching，零 LLM 成本
- 如果偵測到候選，寫入 `pending-memories.jsonl`，下個 cycle 由 model 確認

**預估工作量**: 3 小時
**影響**: 捕捉目前漏掉的隱性記憶（特別是 feedback 類）

---

#### 8. Permission Decision Provenance
**Claude Code 做法**: 每個 allow/deny 記錄來源（rule、hook、mode、classifier）。

**mini-agent 現狀**: delegation 和 tool 執行有 log，但不記錄 **為什麼** 選擇某個 provider 或 route。

**改進**:
- `model-router.ts` — 每次 routing 決策記錄 reason（已有 `reason` 欄位，確保完整）
- `task-graph.ts` — lane routing 決策記錄 why
- `delegation.ts` — provider 選擇記錄 why
- 統一寫入 `decision-provenance.jsonl`（append-only）
- 用於 debugging 和 pulse 分析

**預估工作量**: 2 小時
**影響**: 可觀察性大幅提升，debugging 從猜測變為追溯

---

### P2: 值得做但不急

#### 9. Tool Concurrency Safety 自宣告
**Claude Code 做法**: 每個工具自宣告 `isConcurrencySafe(input)` — input-dependent。

**mini-agent 現狀**: delegation 有 concurrency limit（6），但工具本身不宣告安全性。

**改進**:
- 新增 `ToolCapability` interface: `{ isConcurrencySafe: (input) => boolean }`
- 在 `delegation.ts:startTask()` 中用來決定是否可以並行
- 例如: browse 永遠 serial（Chrome 記憶體），research 可以 parallel

**預估工作量**: 3 小時
**影響**: 更智能的並行決策，防止資源衝突

---

#### 10. Verification Agent 模式
**Claude Code 做法**: adversarial verification agent — read-only + Bash，必須以 `VERDICT: PASS/FAIL/PARTIAL` 結尾。

**mini-agent 現狀**: `multi-agent-workflow:verify` skill 存在但不是內建。

**改進**:
- 在 delegation type 加 `verify`: read-only tools，adversarial prompt
- 必須以 `VERDICT: PASS|FAIL|PARTIAL` + 證據結尾
- Spawn fresh（不繼承被驗證的 context，防止 confirmation bias）
- 用於 code delegation 完成後的自動驗證

**預估工作量**: 4 小時
**影響**: 自動品質關卡，減少 delegation 產出的錯誤

---

#### 11. AutoDream 式記憶整合
**Claude Code 做法**: 4 階段整合（Orient → Gather → Consolidate → Prune），read-only fork，三層閾值。

**mini-agent 現狀**: housekeeping 做增量清理，沒有回顧性整合。

**改進**:
- 新增 `consolidateMemory()` 函數
- 觸發條件: 每 7 天 + 至少 50 個新記憶條目
- 用 read-only delegation（不能直接寫記憶）
- 產出: consolidation report → model 在下個 cycle 審查並寫入
- 我們的優勢: 結晶機制已經做了部分（repeated patterns → code gate）

**預估工作量**: 8 小時
**影響**: 長期記憶品質，防止記憶膨脹

---

#### 12. Context Prefix Caching 優化
**Claude Code 做法**: Static/Dynamic boundary、deterministic IDs、sticky latches。

**mini-agent 現狀**: `buildContext()` 已有 prefix caching reorder（stable sections first），但沒有做到 Claude Code 的精細度。

**改進**:
- 這主要在我們走 API 路線時才重要
- 目前 CLI subprocess 路線下，Claude 自己管 cache
- **暫不實作**，但在 context building 中保持 section 順序穩定性

**預估工作量**: N/A（暫不做）
**影響**: 走 API 路線時再做

---

## C. 我們已經做得更好的（方向驗證）

| 我們的設計 | Claude Code 對應 | 為何我們更好 |
|-----------|-----------------|-------------|
| **結晶機制** (pulse.ts) | 無 | 重複 pattern → code gate，記憶升級為系統行為 |
| **三層決策階梯** | 二元 allow/deny/ask | 中間有 peer consultation 層（Akari） |
| **Constraint Texture** | 工程最佳實踐 | Meta-framework 層，評估約束質地而非只遵守規則 |
| **Nutrient Router** | 無 | 有機的 web 資源品質追蹤（黏菌模型） |
| **Perception plugins** | 有限環境感知 | 37 個 plugin 覆蓋 Chrome/mobile/GitHub/network |
| **Multi-lane architecture** | Coordinator + workers | OODA + foreground(8) + background(6) 更靈活 |
| **研究先於行動** | 沒有此概念 | 保護性約束，防止行動先於理解 |
| **Model routing** | Auto-mode classifier | 我們的更透明（Opus/Sonnet/Local/Codex 各有明確場景） |
| **Digest over relay** | Coordinator "must understand" | 我們在所有層面要求，不只 coordinator |
| **記憶交叉引用** | 平坦 MEMORY.md 索引 | 索引行包含關鍵實體名，搜尋不需讀 frontmatter |

---

## D. 實作優先級矩陣

```
                    高影響
                      │
        P0-1 Error    │    P1-4 兩階段 Recall
        Messages      │
        P0-3 Cap      │    P1-5 Compaction
                      │
  ──────────────────────────────────────── 高成本
                      │
        P0-2 DANGER   │    P2-11 AutoDream
        prefix        │
        P1-6 Freshness│    P2-10 Verification
                      │    P2-9 Concurrency
        P1-8 Provenance│
                      │
                    低影響
```

---

## E. 建議實作順序

### 第一批（今天-明天）: Quick Wins
1. Error Messages as Model Context（P0-1）
2. DANGEROUS_ 前綴模式（P0-2）
3. Subagent output cap（P0-3）

### 第二批（本週）: 記憶系統升級
4. 記憶新鮮度標記（P1-6）
5. 被動記憶萃取 heuristic（P1-7）
6. Decision provenance（P1-8）

### 第三批（下週）: 深度改進
7. 兩階段 recall（P1-4）
8. Context compaction（P1-5）

### 第四批（持續）: 架構進化
9. Tool concurrency safety（P2-9）
10. Verification agent（P2-10）
11. AutoDream 記憶整合（P2-11）

---

## F. 不該學的

| Claude Code 做法 | 為什麼不適合我們 |
|-----------------|----------------|
| **被動萃取（每次 query 後）** | 太貴，我們的主動記憶品質更好 |
| **Team Memory** | 單 agent 不需要 |
| **MagicDocs** | 我們的文件由 Alex 或 Kuro 自己維護 |
| **Anti-Distillation** | 我們是開源的，不需要防蒸餾 |
| **23 Bash Validators** | 我們信任自己的操作（Transparency > Isolation） |
| **Sticky Latches** | CLI subprocess 路線不管 cache |
| **GrowthBook runtime flags** | 我們的 features.json 已夠用 |

---

## G. 關鍵洞察

1. **Claude Code 的 Harness 本質是 Context Engineering** — 不是寫更好的 prompt，而是精密管理什麼資訊在什麼時候出現在 context window 中。12 個設計原則中有 6 個直接或間接關於 cache/context。

2. **我們的優勢在 Perception 和 Autonomy** — Claude Code 是 session-based 工具，每次啟動重新認識世界。我們是持續運行的 agent，有 37 個 perception plugin、nutrient router、pulse system。這是根本不同的設計空間。

3. **兩個系統最大的共同弱點是記憶 recall** — Claude Code 用 Sonnet sideQuery 做語義匹配，我們用 keyword matching。兩者都不夠好。兩階段 recall（FTS5 + LLM 排序）是共同的改進方向。

4. **Error messages as model context 是最被低估的設計** — Claude Code 的 `CANCEL_MESSAGE` 和 `DENY_WORKAROUND_GUIDANCE` 不是給人看的，是給 model 看的。這個思維轉換影響整個 tool pipeline 的設計。

5. **結晶機制是我們獨有的優勢** — Claude Code 的記憶永遠是記憶，不會升級。我們的 pulse system 偵測重複 pattern → 結晶為 code gate → 記憶變成系統行為。這是 learning agent 和 tool 的根本區別。
