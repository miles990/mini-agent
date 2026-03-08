# Proposal: CLAUDE.md JIT Loading

**Status**: approved (Alex via Claude Code #424)
**Effort**: M (2-3h)
**Level**: L2 (src/*.ts)

## Problem

CLAUDE.md (712 lines, ~23K chars) is loaded fully every OODA cycle by Claude CLI subprocess. Most sections are irrelevant to any given cycle — e.g. Mobile Perception docs aren't needed when doing GitHub triage.

## Solution

Keyword-based JIT loading, same pattern as existing skill JIT (500+ cycles, 70% reduction, zero miss).

### Architecture

```
CLAUDE.md (unchanged, still 712 lines)
  ↓ parsed at startup
  ↓ split by ## headings into sections
  ↓
Core sections (~170 lines) — always loaded
JIT sections (~500 lines) — loaded when keywords match prompt+context
  ↓
getSystemPrompt() includes matched sections
  +
execClaude() uses isolated cwd (no CLAUDE.md) + --add-dir for file access
```

### Section Classification

**Core (always load, ~170 lines):**
- Header + 設計理念 + 核心原則 + 三層架構
- 學以致用閉環 + Key Files
- 進化核心約束 (Meta-Constraints)
- Commands + Environment + Deploy + Deployment
- Code Conventions + Workflow
- 詳細文件

**JIT (keyword-matched, ~500 lines, 27 sections):**
- Memory Architecture, Search System, Feedback Loops, Achievement, Coach
- GitHub Workflow, Multi-Lane, Cognitive Mesh, Forge, Reactive Architecture
- Mobile, Library, Chat Room, Auditory, Observability
- Agent Tags, Telegram, Status API, MCP Server
- 協作模型, Handoff, 行為準則, Debugging, 自主解決問題
- kuro-sense, Account Switch, mushi

### Keyword Matching Rules

1. **Conservative**: any keyword match → load section (寧多載不少載)
2. **Fallback**: no JIT sections matched → load everything
3. **Hint source**: prompt + context passed to getSystemPrompt()

### Expected Impact

- Core: ~170 lines (always)
- Typical match: 2-4 JIT sections (~40-80 lines)
- Total per cycle: ~210-250 lines vs 712 original
- **Savings: ~60-65% of CLAUDE.md tokens**

### Files Changed

1. **New**: `src/claudemd-jit.ts` — section parser + keyword matcher
2. **Edit**: `src/dispatcher.ts` — include JIT sections in getSystemPrompt()
3. **Edit**: `src/agent.ts` — subprocess cwd isolation

### Rollback

L2: git revert (single commit). CLAUDE.md itself is unchanged.

### Verification

- `pnpm typecheck` passes
- Run 2-3 cycles, check context length reduction in logs
- Verify no "missing info" in cycle outputs
