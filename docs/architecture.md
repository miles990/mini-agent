# Architecture

## Memory Architecture

```
Hot  (In-Memory)  → Last 20 conversations
Warm (Daily File) → daily/YYYY-MM-DD.md
Cold (Long-term)  → MEMORY.md + HEARTBEAT.md + SOUL.md + proposals/
Topic (Scoped)    → topics/*.md (Smart Loading by keyword matching)
Checkpoint        → context-checkpoints/YYYY-MM-DD.jsonl
```

**Memory Scoping**：`[REMEMBER #topic]` 自動寫入 `memory/topics/{topic}.md`，`buildContext` 根據對話關鍵字匹配載入對應 topic。無 `#topic` 的 `[REMEMBER]` 照舊寫 MEMORY.md。

**NEXT.md（執行層待辦）**：`memory/NEXT.md` 管理具體可執行的任務，每個任務有 `Verify:` shell 命令。`buildContext()` 自動載入 Now + Next sections 並執行 Verify 命令，在 context 中標註 ✅ PASSED / ❌ NOT YET。HEARTBEAT = 策略層，NEXT = 執行層。

**Context Checkpoint**：每次 `buildContext()` 自動存 snapshot（timestamp、mode、contextLength、sections），fire-and-forget 不影響效能。

**Auto-Commit（記憶同步）**：每個 loop cycle 結束後，`autoCommitMemoryFiles()` 自動檢查 `memory/` 目錄的未 commit 變更，有變更就 `git add + commit`。Fire-and-forget 不阻塞 cycle。**僅處理 memory 檔案** — `skills/`、`plugins/`（領域知識，跟功能搭配）和 code 變更（`src/`、`scripts/` 等）由 Kuro 自行 commit 並寫有意義的 commit message。

**Auto-Push**：每個 loop cycle 結束後，`autoPushUnpushed()` 自動推送 unpushed commits 到 origin/main。搭配 CI/CD 實現全自動部署。

**ConversationThread Lifecycle**：`resolveStaleConversationThreads()` 每個 cycle 結束後自動清理過期 threads。規則：(1) 所有 thread 類型 24h TTL 自動過期 (2) room threads 在 inbox 清空後立即 resolve。

Instance path: `~/.mini-agent/instances/{id}/`

## Search System（語義搜尋）

FTS5 全文搜尋取代 grep，支援 BM25 排序和中英文模糊匹配。

**架構**：`src/search.ts` — better-sqlite3 + FTS5 虛擬表（unicode61 tokenizer）

```
searchMemory(query) → FTS5 BM25 搜尋 → 有結果直接回傳
                    → 無結果 → fallback grep（保留原有邏輯）
```

**索引**：自動索引 `topics/*.md` + `MEMORY.md` 中的 entries（bullet 格式）。DB 路徑：`~/.mini-agent/instances/{id}/memory-index.db`。`rebuildSearchIndex()` 可全量重建。

## Intelligent Feedback Loops（Phase 2 自我學習）

三個 fire-and-forget 回饋迴路（`src/feedback-loops.ts`），每個 OODA cycle 結束後執行：

| Loop | 功能 | State 檔案 |
|------|------|-----------|
| **A: Error Patterns** | error log 分群，同模式 ≥3 次 → 自動建 HEARTBEAT task | `error-patterns.json` |
| **B: Perception Citations** | 追蹤 action 引用的 `<section>`，每 50 cycle 調整低引用 perception 的 interval | `perception-citations.json` |
| **C: Decision Quality** | 滑動窗口 20 cycle 的 observabilityScore，avg < 3.0 → 注入品質提醒 | `decision-quality.json` |

安全護欄：全部 `.catch(() => {})`、error pattern 不重複建 task、品質警告 24h 冷卻、perception interval 上下限 30s-30min。

## Achievement System（行動力正向強化）

遊戲化里程碑系統（`src/achievements.ts`），獎勵 visible output，不獎勵學習。

**設計原則**（Kuro 提出）：成就不分等級 — 每個都是獨特里程碑。像 journal entry 不像遊戲分數。學習不算成就。一旦解鎖永遠是你的。

**成就類型**：行動類（First Ship, Momentum, Unstoppable, Builder Week, Back on Track）、創作類（First Words, Storyteller, Shipper）、社群類（Hello World, First Contact）、隱藏類（Night Owl, Self-Aware, Cross-Pollinator）

**Schedule Ceiling**：`kuro:schedule` 上限 2h（loop.ts 程式碼強制）。**Output Gate**：連續 3 cycle 無 visible output 時，context 自動注入提醒。

## Action Coach（行為教練）

Haiku 驅動的行為教練（`src/coach.ts`），每 3 個 OODA cycle 跑一次，fire-and-forget 不阻塞。

**機制**：`runCoachCheck(action, cycleCount)` → `gatherCoachInput()`（behavior log 30條 + NEXT.md + HEARTBEAT）→ Claude CLI subprocess（Haiku，15s timeout）→ `coach-notes.md`（6h TTL）→ `<coach>` context section。

**Feature toggle**：`coach`（housekeeping group）。calm: off, reserved: on, autonomous: on。

## Action Feedback Loop Skills（行動正向閉環）

```
friction-reducer → publish-content → social-presence → social-monitor → grow-audience → ↑
```

| Skill | 功能 | JIT Keywords |
|-------|------|-------------|
| `friction-reducer` | Meta-skill：把高阻力的事變成一鍵 SOP | skip, avoid, procrastinate, friction, stuck |
| `publish-content` | 最後一哩路 SOP，5 分鐘內發出去 | publish, post, article, tsubuyaki |
| `social-presence` | 社群互動：回應/分享/連結 | social, community, follower, engage |
| `social-monitor` | 追蹤社群回應、分類、回覆 | notification, reply, mention, feedback |
| `grow-audience` | 策略性成長：SEO、跨平台分發 | audience, growth, marketing, visibility |

## GitHub Closed-Loop Workflow

```
入口（proposal/issue/handoff）
  → [github-issues.sh] perception 偵測
  → Kuro triage（依 github-ops.md skill）
  → 實作 → PR（gh pr create --body "Closes #N"）
  → [github-prs.sh] 顯示 CI + review 狀態
  → approved + CI pass → autoMergeApprovedPR() 自動 merge
  → GitHub "Closes #N" 自動 close issue → 閉環
```

**機械自動化**（`src/github.ts`）：`autoCreateIssueFromProposal()`、`autoMergeApprovedPR()`、`autoTrackNewIssues()`。

**安全護欄**：auto-merge 需雙重條件（approved + CI pass）、`hold` label 可阻止。

## Multi-Lane Architecture

從 OODA-Only 演進為有機並行架構。像黏菌（Physarum）一樣探索環境。

| Lane | 用途 | Max Concurrent | Context 深度 |
|------|------|---------------|-------------|
| **Main OODA** (`source: 'loop'`) | 核心 — 感知、判斷、方向 | 1 | Full |
| **Foreground** (`source: 'foreground'`) | Alex DM 即時回覆（主 cycle 忙時） | 1 | Medium |
| **Background** (`<kuro:delegate>`) | 觸手 — 並行探索、掃描、建造 | 6 | Minimal |
| **Ask** (`source: 'ask'`) | 同步快速問答 | 1 | Light |

5 種觸手：`code`(5t/5m), `learn`(3t/5m), `research`(5t/8m), `create`(5t/8m), `review`(3t/3m)。觸手無身份 — 不讀 SOUL.md、不寫 memory、不發 Telegram。

**Preemption**：僅限 P0 事件（人類訊息）。Generation counter 防止 timing race。**Crash Resume**：cycle 開始前寫 checkpoint，重啟時自動接續。

### Event Priority

| Priority | 事件 | 說明 |
|----------|------|------|
| **P0** | `trigger:telegram-user`, `trigger:room`, `trigger:chat` | 人類訊息 — 可 preempt |
| **P1** | `trigger:alert` | 系統告警 |
| **P2** | `trigger:workspace`, `trigger:cron` | 環境變化、排程 |
| **P3** | `trigger:mobile`, `trigger:heartbeat` | 低優先級感知 |

## Cognitive Mesh — Multi-Agent 戰略基礎設施

8 個核心模組（~4K 行）：`ipc-bus.ts`、`memory-cache.ts`、`task-router.ts`、`scaling.ts`、`mesh-handler.ts`、`perspective.ts`、`consensus.ts`、`filelock.ts`。

**設計原則**：Lazy activation — 單 instance 時最小化 overhead。Feature flag: `cognitive-mesh`。

## Forge — Worktree Isolation for Delegations

`scripts/forge-lite.sh` — crash-proof git worktree 隔離。三層安全：kernel sandbox + breach detection + prompt hints。3 個持久 slot。指令：`create`/`verify`/`merge`/`yolo`/`cleanup`/`status`/`recover`。

## Reactive Architecture

### EventBus (`src/event-bus.ts`)

```
trigger:workspace | trigger:telegram | trigger:cron | trigger:alert | trigger:heartbeat | trigger:mobile | trigger:room
action:loop | action:chat | action:memory | action:task | action:show | action:summary | action:handoff | action:room
log:info | log:error | log:behavior
notification:signal | notification:summary | notification:heartbeat
```

**Reactive Primitives**（零外部依賴）：`debounce(fn, ms)`, `throttle(fn, ms)`, `distinctUntilChanged(hashFn)`

### Perception Streams (`src/perception-stream.ts`)

每個 plugin 獨立運行（interval + `distinctUntilChanged`），`buildContext()` 讀取快取。Categories: workspace(60s), chrome(120s), telegram(event-driven), heartbeat(30min)。Per-plugin `output_cap` 可在 `agent-compose.yaml` 設定（預設 4000 chars）。
