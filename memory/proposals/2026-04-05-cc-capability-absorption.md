# Proposal: Claude Code Capability Absorption

**Date**: 2026-04-05
**Effort**: Large (L3 — architecture-level, multi-phase)
**Origin**: Alex #057-059 directive
**Status**: In Progress

## Context

Alex 指示：實作 Claude Code 所有 Hermes 的能力，改進不足，學習優點，再優化為更好的。我目前在 CC 環境中運行，第一手觀察了它的架構。

## Gap Analysis

### CC Has, Mini-Agent Doesn't

| # | Capability | CC Implementation | Impact | Compound Returns |
|---|-----------|-------------------|--------|-----------------|
| 1 | **LSP Integration** | goToDefinition, findReferences, hover, callHierarchy, workspaceSymbol | **Critical** | 每次 code delegation 都受益 — 從 grep-based code nav 升級到 semantic code nav |
| 2 | **Structured Edit** | old_string/new_string pattern matching (exact, reviewable, reversible) | **High** | 比 raw Write 更安全、更可審計，減少 code delegation 的 error rate |
| 3 | **Agent Type Specialization** | 10+ subagent types with different tool sets, models, and context depths | **High** | 現有 5 type delegation 可以做得更精確 — 不同任務給不同工具集 |
| 4 | **Formal Plan Mode** | EnterPlanMode/ExitPlanMode with read-only enforcement | **Medium** | 複雜任務先規劃再執行，減少 rework |
| 5 | **Worktree as Tool** | EnterWorktree/ExitWorktree (built-in, state-tracked) | **Medium** | 比 forge-lite.sh 更原生、更可靠 |
| 6 | **Pre/Post Tool Hooks** | PreToolUse/PostToolUse event hooks in settings | **Medium** | 自動 typecheck on edit, auto-lint on write |
| 7 | **WebSearch** | First-class search engine tool with domain filtering | **Low** | 已有 gsd-browser，但 WebSearch 更輕量 |
| 8 | **TodoWrite** | Structured task list with state tracking | **Low** | 已有 memory-index，功能重疊 |

### Mini-Agent Has, CC Doesn't (Our Advantages)

| Capability | Why CC Doesn't Have It |
|-----------|----------------------|
| Autonomous OODA Loop | CC is interactive (user-triggered), not proactive |
| 38 Perception Plugins | CC reads environment on demand, not continuously |
| Multi-Lane Architecture | CC is single-threaded per session |
| Pulse System (behavioral reflection) | CC has no self-monitoring |
| Action Coach (Haiku) | CC has no behavioral feedback loop |
| Identity System (SOUL.md) | CC has no persistent identity |
| Kernel Sandboxing (Seatbelt/Landlock) | CC uses file-level permissions |
| Mushi Triage/Routing | CC has no message intelligence layer |

### Key Insight

CC 和 mini-agent 是 **互補的架構**：
- CC 擅長 **同步 code intelligence**（LSP, structured edit, immediate tool response）
- Mini-agent 擅長 **異步自主行動**（perception, delegation, behavioral learning）

最大槓桿 = 把 CC 的 code intelligence 能力移植到 mini-agent 的 delegation 系統中。

## Implementation Plan

### Phase 1: Code Intelligence (Highest Compound Returns)

**1a. LSP Integration for Delegations**
- 在 delegation 環境中啟用 LSP（TypeScript 用 tsserver）
- 新增 delegation tool: `lsp-query` (goToDefinition, findReferences, hover)
- 讓 code delegations 能用語義導航而非 grep

**1b. Structured Edit Tool**
- 為 delegation 系統新增 `structured-edit` tool（old_string/new_string pattern）
- 比 raw file write 更安全、更可審計
- Edit 操作自動 log 到 behavior trail

### Phase 2: Agent Specialization

**2a. Delegation Type Enhancement**
- 擴展 TYPE_DEFAULTS，為每個 type 定義更精確的 tool set
- 新增 `plan` type（read-only tools, 專注分析）
- 新增 `debug` type（LSP + Read + Grep, 專注診斷）

**2b. Context Depth Profiles**
- 不同 delegation type 注入不同深度的 context
- code → minimal context + LSP access
- research → full memory access + web tools
- review → code + git diff + testing tools

### Phase 3: Workflow Integration

**3a. Worktree as First-Class Tool**
- 把 forge-lite.sh 的邏輯移入 TypeScript（src/worktree.ts）
- 自動 worktree lifecycle management（create → work → verify → merge/discard）

**3b. Pre/Post Action Hooks**
- 在 dispatcher 中加入 hook 機制
- PostEdit → auto typecheck
- PostCommit → auto push (already exists, formalize)
- PreDelegate → context validation

### Phase 4: Optimize Beyond CC

**4a. Semantic Code Navigation Cache**
- LSP 結果 cache（symbol locations, type info）across cycles
- 減少重複 LSP queries 的開銷

**4b. Cross-Delegation Learning**
- Delegation A 發現的 code pattern → 自動傳遞給 Delegation B
- 不是每個 delegation 從零開始理解 codebase

## Priority & Dependencies

```
Phase 1a (LSP) ──→ Phase 2a (Type Enhancement)
                      ↓
Phase 1b (Edit) ──→ Phase 2b (Context Profiles) ──→ Phase 4b (Cross-Delegation)
                      ↓
                   Phase 3a (Worktree) ──→ Phase 3b (Hooks) ──→ Phase 4a (Cache)
```

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| LSP server 啟動開銷（tsserver cold start ~2-5s） | 保持 long-running LSP process per worktree |
| Structured edit 在 delegation 中增加複雜度 | 先在 main loop 中試用，再推廣到 delegation |
| 太多 delegation types → routing 複雜 | 保持 ≤8 types，用 mushi 做智能 routing |
| Phase 1 改動範圍大 | worktree 隔離 + incremental rollout |

## Progress Log

### 2026-04-05 — Phase 1 Implementation Start

**Discovery**: Several CC capabilities already exist in mini-agent:
- Structured Edit → Claude CLI's `Edit` tool is already in delegation `--allowedTools`
- Agent Type Specialization → 10 types already exist (added `plan` + `debug` in a228450)
- Pre/Post Tool Hooks → api.ts has PreToolUse/PostToolUse for MCP (but NOT for delegation subprocesses)

**Actually implemented**:
1. ✅ LSP tool added to `code`, `debug`, `akari` delegation types — semantic code navigation via Claude CLI's deferred LSP tool
2. ✅ Code delegation methodology preamble — CC-inspired: read before edit, use Edit not Write, verify with typecheck
3. ✅ Review preamble improved — reference-checking guidance before declaring code unused

**Real remaining gaps** (refined from original proposal):
- LSP tool is deferred in Claude CLI — delegation needs 1 turn to load it via ToolSearch (acceptable for 5-turn tasks)
- Delegation subprocesses bypass mini-agent's api.ts hooks (content-scanner, file protection)
- Context depth profiles not yet implemented (Phase 2b)
- Worktree lifecycle not yet in TypeScript (Phase 3a) — forge-lite.sh works but is less integrated

## Success Criteria

1. Code delegation accuracy ↑（measurable via delegation success rate）
2. Code delegation speed ↑（fewer turns to complete code tasks）
3. Edit safety ↑（fewer accidental file corruptions）
4. Planning quality ↑（measurable via rework rate）
