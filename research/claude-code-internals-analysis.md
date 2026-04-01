# Claude Code Internals Deep Analysis
## Source: github.com/cablate/claude-code-research (v2.1.88 sourcemap leak, 2026-03-31)

---

## 1. SYSTEM PROMPT ARCHITECTURE

### 1.1 Structure: 17 Sections, Static/Dynamic Split

The system prompt is NOT a single string. It is an **ordered array of string blocks** (`SystemPrompt = readonly string[]`), each with independent cache control.

**Static sections (cacheable globally, before boundary marker):**
1. `getSimpleIntroSection()` -- identity + cyber risk instruction
2. `getSimpleSystemSection()` -- 6 system behavior rules
3. `getSimpleDoingTasksSection()` -- task execution philosophy + code style
4. `getActionsSection()` -- reversibility principle (local=free, shared=confirm)
5. `getUsingYourToolsSection()` -- tool priority (dedicated tools > Bash)
6. `getSimpleToneAndStyleSection()` -- no emoji, file_path:line_number format
7. `getOutputEfficiencySection()` -- conciseness rules

**`__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`** -- marker that splits cache zones

**Dynamic sections (per-session, re-resolved each turn unless cached):**
8. `session_guidance` -- conditional on enabledTools, skills, feature flags
9. `memory` -- MEMORY.md contents + memory system instructions
10. `ant_model_override` -- Anthropic-internal model override
11. `env_info_simple` -- cwd, platform, git status, model name, knowledge cutoff
12. `language` -- user language preference
13. `output_style` -- custom output style config
14. `mcp_instructions` -- **DANGEROUS_uncached** (MCP servers connect/disconnect between turns)
15. `scratchpad` -- scratchpad directory instructions
16. `frc` -- Function Result Clearing
17. `summarize_tool_results` -- tool result summarization

### 1.2 Key Design: DANGEROUS_uncachedSystemPromptSection

```typescript
function DANGEROUS_uncachedSystemPromptSection(name, compute, _reason) {
  return { name, compute, cacheBreak: true }
}
```
The `DANGEROUS_` prefix forces developers to justify why a section must bust cache. The `_reason` parameter is self-documenting (not used at runtime). Only MCP instructions use this -- everything else is cached.

### 1.3 Why Dynamic Boundary Exists

If conditional sections (hasAgentTool, isForkSubagentEnabled, etc.) were placed in the static portion, each boolean would multiply cache prefix variants by 2. N conditions = 2^N variants, destroying cache hit rate. Moving them after the boundary eliminates this.

### 1.4 Prompt Priority Chain

```
overrideSystemPrompt > Coordinator Mode > Proactive+Agent (append) > Agent (replace) > customSystemPrompt > defaultSystemPrompt
```
All non-override paths append `appendSystemPrompt` at the end.

### 1.5 Three Identity Prefixes

| Context | Prefix |
|---------|--------|
| Interactive CLI | `You are Claude Code, Anthropic's official CLI for Claude.` |
| Agent SDK (non-interactive + append) | `...running within the Claude Agent SDK.` |
| Agent SDK (no append) | `You are a Claude agent, built on Anthropic's Claude Agent SDK.` |
| Vertex AI | Always DEFAULT_PREFIX |

### 1.6 ANT vs External User Differences

Internal (ant) users get:
- Proactive bug-spotting ("If you notice a misconception, say so")
- Honest test reporting ("Never claim all tests pass when output shows failures")
- Stricter code style (no comments by default, verify before reporting complete)
- "Communicating with the user" section (inverted pyramid, assume user left)
- Numeric length anchors (25 words between tool calls, 100 words final response)

---

## 2. TOOL SYSTEM: 36 TOOLS

### 2.1 Complete Tool List by Category

| Category | Tools |
|----------|-------|
| SHELL | Bash, PowerShell |
| FILE | Read, Edit, Write, NotebookEdit |
| SEARCH | Glob, Grep, LSP |
| AGENT | Agent, SendMessage, TaskStop |
| TASK | TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate |
| PLAN | EnterPlanMode, ExitPlanMode |
| TEAM | TeamCreate, TeamDelete |
| WEB | WebFetch, WebSearch |
| MCP | MCPTool, ListMcpResources, ReadMcpResource |
| CONFIG | Config |
| SYSTEM | Skill, ToolSearch, Sleep, CronCreate/Delete/List, EnterWorktree, ExitWorktree, RemoteTrigger, AskUserQuestion |
| AGENT UI | SendUserMessage/Brief (KAIROS only) |

### 2.2 Tool Orchestration: Read/Write Separation

```typescript
// Each tool declares its own concurrency safety:
interface Tool {
  isConcurrencySafe: (input: ParsedInput) => boolean
}
```

**Partition algorithm:**
- Adjacent `isConcurrencySafe=true` tools merge into one parallel batch
- `isConcurrencySafe=false` tools execute serially, one at a time
- Max concurrency: 10 (configurable via `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`)

**Context modifiers from parallel batch are queued and applied AFTER the batch completes** -- prevents race conditions.

### 2.3 Tool Execution Pipeline (10 Layers)

```
1. Zod schema validation
2. Custom validateInput()
3. Speculative classifier start (Bash only, non-blocking)
4. Input sanitization (_simulatedSedEdit defense-in-depth removal)
5. backfillObservableInput (expanded paths for hooks, original input for tool.call())
6. PreToolUse hooks (can: message, allow/deny, modify input, stop, add context)
7. Permission resolution (hook result > canUseTool > interactive dialog)
8. tool.call() -- actual execution
9. PostToolUse hooks (can modify MCP output, add context)
10. Result processing (>50K chars -> save to file, return preview + path)
```

### 2.4 Tool Result Size Limits

| Constant | Value |
|----------|-------|
| `DEFAULT_MAX_RESULT_SIZE_CHARS` | 50,000 chars |
| `MAX_TOOL_RESULT_TOKENS` | 100,000 tokens (~400KB) |
| `MAX_TOOL_RESULTS_PER_MESSAGE_CHARS` | 200,000 chars (all results in one message) |

### 2.5 Deferred Tool Loading (ToolSearch)

When tool count exceeds threshold, tools split into:
- **Non-deferred**: always in context with full schema
- **Deferred**: only name + one-line description sent; model must call `ToolSearch` to unlock full schema

```typescript
filteredTools = tools.filter(tool =>
  !deferredToolNames.has(tool.name) ||
  tool.name === 'ToolSearch' ||
  discoveredToolNames.has(tool.name)
)
```

If model calls a deferred tool without loading it first, error message tells it: "Call ToolSearch with query 'select:{toolName}', then retry."

---

## 3. AGENT ARCHITECTURE: 6 BUILT-IN AGENTS

### 3.1 Agent Types

| Agent | Model | Tools | Key Constraint |
|-------|-------|-------|----------------|
| **general-purpose** | default subagent | ALL (`*`) | "Don't gold-plate, don't leave half-done" |
| **Explore** | haiku (ext) / inherit (ant) | Read-only (no Edit/Write/Agent) | READ-ONLY, parallel tool calls, min 3 queries, `omitClaudeMd: true` |
| **Plan** | inherit | Read-only (same as Explore) | Software architect role, must output "Critical Files" list |
| **verification** | inherit | Read-only + Bash | Background, red UI, must end with `VERDICT: PASS/FAIL/PARTIAL`, adversarial |
| **claude-code-guide** | haiku | Glob/Grep/Read/WebFetch/WebSearch | `permissionMode: 'dontAsk'`, 3 knowledge domains (CLI/SDK/API) |
| **statusline-setup** | sonnet | Read, Edit only | PS1 parsing + settings.json writing |

### 3.2 Fork vs Spawn

- **Fork**: inherits parent context + prompt cache (cheap, shares cache prefix)
- **Spawn**: fresh empty context (clean, no inherited noise)

Decision matrix from Coordinator Mode:
- Research explored files you need to edit -> **Continue** (SendMessage)
- Research was broad but implementation is narrow -> **Spawn Fresh**
- Fixing a failure -> **Continue** (worker has error context)
- Verifying another worker's code -> **Spawn Fresh** (fresh perspective)

### 3.3 Coordinator Mode

Activated by `COORDINATOR_MODE` feature flag + `CLAUDE_CODE_COORDINATOR_MODE=1`.

Coordinator has only 4 tools: Agent, SendMessage, TaskStop, SyntheticOutput.

**Four-phase workflow:**
1. **Research** -- Workers explore in parallel (read-only safe)
2. **Synthesis** -- Coordinator reads results, writes precise specs (CRITICAL: coordinator must understand, not delegate understanding)
3. **Implementation** -- Workers execute specs
4. **Verification** -- Workers test changes

Worker results come as `<task-notification>` XML in user-role messages containing task-id, status, summary, result, and usage stats.

### 3.4 Task Types

```
LocalAgentTask      -- local async subagent
RemoteAgentTask     -- CCR remote subagent
InProcessTeammateTask -- same process, AsyncLocalStorage isolation
DreamTask           -- memory consolidation background agent
LocalShellTask      -- shell task
LocalWorkflowTask   -- workflow task
MonitorMcpTask      -- MCP monitoring task
```

### 3.5 50-Message Cap

Subagents have a 50-message cap, introduced after a 36.8GB memory incident.

---

## 4. CONTEXT MANAGEMENT

### 4.1 Effective Capacity Formula

```
effective_capacity = raw_window - max_output_tokens - 20,000
```

| Model | Raw Window | Max Output | Effective |
|-------|-----------|------------|-----------|
| Opus 4.6 (1M) | 1,000,000 | 64,000 | ~916,000 |
| Sonnet 4.6 (200K) | 200,000 | 32,000 | ~148,000 |
| Standard 200K | 200,000 | 4,096 | ~175,904 |

### 4.2 Five Threshold Constants

1. **Autocompact margin**: effective - 13,000 tokens (trigger point)
2. **Warning threshold**: autocompact + 20,000 (yellow UI indicator)
3. **Error threshold**: warning + 20,000 (red UI indicator)
4. **Hard blocking limit**: 3,000 tokens from absolute wall (session frozen)
5. **Circuit breaker**: 3 consecutive compression failures -> stop trying

### 4.3 Three Compaction Modes

| Mode | When | Behavior |
|------|------|----------|
| BASE | Full conversation compress | Entire history -> 9-section summary |
| PARTIAL FROM | Keep old context, summarize recent | Old preserved + new summary |
| PARTIAL UP_TO | Summarize old, keep recent intact | Summary + recent raw messages |

**9 required summary sections:**
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections (with code snippets)
4. Errors and fixes
5. Problem Solving
6. All user messages (listed verbatim)
7. Pending Tasks
8. Current Work (most important)
9. Optional Next Step (must quote latest conversation)

### 4.4 Message Preservation During Compaction

Works backward from last message, preserving either:
- Up to 40,000 tokens, OR
- At least 10,000 tokens with at least 5 text-block messages

Tool call/result pairs must be kept together (no orphans).

### 4.5 `NO_TOOLS_PREAMBLE` Design

Compaction uses cache-sharing fork (inherits full tool set for cache key match), but model sometimes calls tools despite `maxTurns: 1`. Preamble explicitly forbids tool calls to prevent wasted turns.

### 4.6 Messages Normalization Pipeline (14 steps before API)

```
reorderAttachmentsForAPI -> filter isVirtual -> buildStripTargets -> stripTargetedBlockTypes
-> stripSyntheticApiErrors -> mergeUserMessages -> sanitizeThinkingBlocks
-> normalizeToolInputForAPI -> appendMessageTagToUserMessage -> relocateToolReferenceSiblings
-> smooshSystemReminderSiblings -> sanitizeErrorToolResultContent -> send to API
```

### 4.7 Daily Cache Wipe (Original Finding)

The date string `Today's date is 2026-03-27` is concatenated into the same text block as CLAUDE.md contents. At midnight, this changes the byte prefix, invalidating all cached content after the injection point. First session of new day pays 125% cache_write rates.

### 4.8 Compression Chain Reaction

If post-compression token count still exceeds autocompact threshold -> retriggers on next turn. Each link costs: full LLM compression call + 125% cache rebuild + potential next link. Circuit breaker stops after 3 consecutive failures.

**Mitigation**: `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=60-70` triggers compression earlier when context is smaller.

---

## 5. MEMORY SYSTEM: 6 SUBSYSTEMS

### 5.1 Architecture

| Subsystem | Trigger | Storage | Purpose |
|-----------|---------|---------|---------|
| **Auto Memory (memdir)** | Session start / model writes | `~/.claude/projects/{proj}/memory/` | Cross-session permanent memory |
| **ExtractMemories** | After each query turn | Same as above | Background auto-extraction |
| **Session Memory** | Context reaches threshold | `~/.claude/session-memory/{id}.md` | Current session snapshot |
| **MagicDocs** | Conversation idle | In-repo `.md` files with `# MAGIC DOC:` header | Auto-maintained docs |
| **Team Memory** | Session start / file changes | `memory/team/` subdirectory | Cross-user shared memory |
| **AutoDream** | Periodic (24h + 5 sessions) | Consolidates into MEMORY.md | Cross-session memory consolidation |

### 5.2 MEMORY.md Design

- **Index file, not memory itself** -- each entry: `- [Title](file.md) -- one-line hook`
- Max 200 lines, 25,000 bytes
- Truncation: line-based first, then byte-based (natural boundaries)
- `skipIndex` mode (`tengu_moth_copse` flag): skip MEMORY.md, write directly

### 5.3 Memory File Format

```yaml
---
name: {{memory name}}
description: {{specific description for relevance matching}}
type: user | feedback | project | reference
---
{{content with Why: and How to apply: structure}}
```

### 5.4 Four Memory Types

| Type | Scope | Content |
|------|-------|---------|
| `user` | Private | User role, goals, knowledge background |
| `feedback` | Private-first | Correction guidelines, success confirmations |
| `project` | Team-first | Project goals, decisions, events |
| `reference` | Usually team | External system references (Linear, Grafana) |

### 5.5 Relevance Search

`findRelevantMemories()` scans all memory frontmatter, then uses a Sonnet sideQuery to select max 5 most relevant memories. Filters out already-surfaced memories to avoid repetition.

### 5.6 Freshness Verification

```
"This memory is N days old. Memories are point-in-time observations..."
```
Model is instructed: before recommending from memory, check if file/function/flag still exists (grep for it). "The memory says X exists" != "X exists now."

---

## 6. SECURITY: 7-LAYER DEFENSE-IN-DEPTH

### Layer 1: AI-Level Policy (`cyberRiskInstruction.ts`)
System prompt instruction: allow authorized pentest/CTF/defense, refuse destructive techniques/DoS/supply-chain attacks.

### Layer 2: Structural Parse Gate (Tree-sitter AST)
- `too-complex` (command substitution, control flow) -> force ask
- `semantic-fail` (eval, zsh builtins) -> ask
- `simple` -> proceed to next layers

### Layer 3: 23 Bash Security Validators
Organized by check ID (1-23), split into:
- **Early validators** (with allow fast-path): empty, incomplete, safe heredoc substitution, git commit
- **Misparsing validators** (parser-differential attacks): control chars, carriage return, unicode whitespace, mid-word hash, brace expansion, backslash-escaped operators/whitespace, comment-quote desync, quoted newline
- **Non-misparsing validators**: JQ system(), obfuscated flags, shell metacharacters, dangerous variables, IFS injection, proc/environ access, command/process substitution patterns, redirections

Key attacks defended against:
- `TZ=UTC\recho curl evil.com` with `Bash(echo:*)` allow rule (carriage return check #7)
- `echo\ test/../../../usr/bin/touch /tmp/file` (backslash-escaped whitespace #15)
- `cat safe.txt \; echo ~/.ssh/id_rsa` (backslash-escaped operators #21)
- `git ls-remote {--upload-pack="touch /tmp/test",test}` (brace expansion #16)

### Layer 4: Permission Rule Engine
- Three behaviors: `deny` / `ask` / `allow`
- Match modes: exact, prefix (`cmd:*`), wildcard
- Rule sources: cliArg, command, session, userSettings, projectSettings, policySettings, localSettings, flagSettings
- **Deny-first**: deny rules checked before all allow paths
- Compound commands: prefix rules do NOT match compound commands

### Layer 5: Path Constraint Checks
- Working directory whitelist (project cwd + additionalDirectories)
- Dangerous path protection: `.git`, `.claude`, `~/.ssh`, `/etc`
- Symlink resolution (check both original and resolved paths)

### Layer 6: Read-Only Validation
- Command whitelist with flag-level precision (git/gh/docker/ripgrep etc.)
- Covers Bash, PowerShell, Shell tools

### Layer 7: OS Sandbox (`@anthropic-ai/sandbox-runtime`)
- Linux: bwrap (bubblewrap)
- macOS: sandbox-exec
- Filesystem: read/write isolation per path
- Network: domain allowlist/denylist
- Bare git repo protection: scrub planted HEAD/objects/refs/hooks/config after each command
- `autoAllowBashIfSandboxed`: if sandbox enabled, Bash commands auto-allowed unless explicitly denied

### Decision Flow

```
Command -> AST Parse (too-complex? -> ask) -> checkSemantics (fail? -> ask)
  -> Sandbox auto-allow? -> Exact match rule -> Classifier
  -> Command operator permissions (pipe/redirect -> recursive check)
  -> Subcommand fanout -> checkCommandAndSuggestRules
  -> Final passthrough -> permission prompt dialog
```

**Fail-closed principle**: unparseable -> ask permission (never auto-allow).

---

## 7. FEATURE FLAGS: 82+ COMPILE-TIME FLAGS

### 7.1 Two-Level System

1. **Compile-time** (`feature()` from `bun:bundle`): dead code elimination, 82 flags
2. **Runtime** (GrowthBook `tengu_*`): ~52 feature values, ~656 total event/flag names

### 7.2 Key Flag Categories

| Category | Notable Flags |
|----------|--------------|
| Agent modes | COORDINATOR_MODE, PROACTIVE, KAIROS (6 sub-flags), FORK_SUBAGENT |
| Memory | EXTRACT_MEMORIES, TEAMMEM, KAIROS_DREAM, AGENT_MEMORY_SNAPSHOT |
| Context mgmt | CONTEXT_COLLAPSE, REACTIVE_COMPACT, CACHED_MICROCOMPACT, TOKEN_BUDGET |
| Security | BASH_CLASSIFIER, ANTI_DISTILLATION_CC, NATIVE_CLIENT_ATTESTATION |
| Remote | CCR_AUTO_CONNECT, BRIDGE_MODE, SSH_REMOTE, SELF_HOSTED_RUNNER, DAEMON |
| UI | BUDDY, VOICE_MODE, ULTRAPLAN, ULTRATHINK, TERMINAL_PANEL |
| Tools | MCP_SKILLS, EXPERIMENTAL_SKILL_SEARCH, WEB_BROWSER_TOOL, CHICAGO_MCP |

### 7.3 KAIROS Mode (6 Flags)

KAIROS is an autonomous long-running agent mode with: dream (memory consolidation), brief (summaries), channels, GitHub webhooks, push notifications. Combined with DAEMON + UDS_INBOX + BG_SESSIONS, this points toward a background service that receives and processes tasks without user interaction.

### 7.4 Anti-Distillation

`ANTI_DISTILLATION_CC` + `tengu_anti_distill_fake_tool_injection` -- injects fake data into tool schemas/results to prevent third-party models from learning Claude Code's behavior through distillation.

---

## 8. PROMPT CACHE ENGINEERING

### 8.1 Cache Cost Impact

| Event | Cost |
|-------|------|
| Cache write (new) | 125% of standard input token price |
| Cache read (hit) | 10% of standard input token price |

A 100K token cache hit saves ~$0.27 per call (Sonnet pricing).

### 8.2 Sticky Latch Pattern

To prevent mid-session header changes from busting server-side cache keys:

```typescript
let fastModeHeaderLatched = getFastModeHeaderLatched()
if (!fastModeHeaderLatched && isFastMode) {
  fastModeHeaderLatched = true
  setFastModeHeaderLatched(true) // persisted, never unset during session
}
```

Four sticky latches: afkMode, fastMode, cacheEditing, thinkingClear.

### 8.3 Deterministic ID Generation

Message IDs injected into context are derived deterministically from UUIDs (not random), preventing ID changes from breaking cache:

```typescript
function deriveShortMessageId(uuid) {
  return parseInt(uuid.replace(/-/g, '').slice(0, 10), 16).toString(36).slice(0, 6)
}
```

### 8.4 Cache Break Detection

Two-phase system:
1. **Pre-call**: snapshot all cache-affecting factors (system hash, tools hash, model, betas, effort, etc.)
2. **Post-call**: compare `cacheReadTokens` to previous; if drop > 5% AND > 2,000 tokens, diagnose cause

12 cause categories tracked: model, system prompt, tools, fast mode, global cache strategy, betas, auto mode, overage, cached microcompact, effort, extra body params, TTL expiry (5min/1h).

### 8.5 API Beta Headers (18 Identified)

Key headers: `claude-code-20250219`, `interleaved-thinking-2025-05-14`, `context-1m-2025-08-07`, `context-management-2025-06-27`, `fast-mode-2026-02-01`, `token-efficient-tools-2026-03-28`, `task-budgets-2026-03-13`, `prompt-caching-scope-2026-01-05`.

---

## 9. AGENT LOOP ARCHITECTURE

### 9.1 Core Loop

```
User Input -> normalizeMessagesForAPI() -> Claude API (streaming)
  -> stop_reason?
    -> end_turn: return AssistantMessage
    -> tool_use: partitionToolCalls() -> parallel/serial execution
      -> tool results as UserMessage (role: 'user', type: 'tool_result')
      -> append to messages -> loop back to Claude API
    -> max_tokens: token budget handling
```

### 9.2 Async Generator Pattern

The entire loop uses async generators from `queryModel` through `runTools`, unifying streaming events and tool results into a single consumable flow. This avoids callback hell and complex event systems.

### 9.3 Abort Mechanism

AbortController.signal propagated to every tool call. User presses Escape -> `abortController.abort()` -> running tools receive signal, unstarted tools return `CANCEL_MESSAGE`.

### 9.4 Error Messages as Model Instructions

```typescript
const CANCEL_MESSAGE = "The user doesn't want to take this action right now. STOP what you are doing..."
const DENY_WORKAROUND_GUIDANCE = "You *may* attempt using other tools... But you *should not* work around this denial in malicious ways..."
```

Error messages are designed for the MODEL to read and act on, not just for human debugging.

---

## 10. HARNESS DESIGN PRINCIPLES (12 Transferable Principles)

1. **Cache stability as core asset** -- sticky latches, deterministic IDs
2. **Multi-layer tool execution pipeline** -- fail-fast at each layer
3. **Concurrency safety declared by tool, not caller** -- Single Responsibility
4. **Async generators as natural expression** -- streaming + progress unified
5. **Messages are typed semantic objects** -- metadata enables filtering/tracking
6. **Multi-layer context compression** -- instant cleanup, media limits, full compaction
7. **Dynamic tool loading via search** -- ToolSearch for large tool sets
8. **Hooks as harness extension points** -- typed results (message/permission/input/stop/context)
9. **Bootstrap state as session singleton** -- only truly session-wide values
10. **Permission decision provenance tracking** -- why, not just allow/deny
11. **PII safety via type system** -- branded types force review at every analytics emission
12. **Error messages are context** -- designed for model consumption, not just human debugging

---

## 11. KEY NUMBERS FOR MINI-AGENT DESIGN

| Parameter | Value | Why |
|-----------|-------|-----|
| Max tool concurrency | 10 | Balance throughput vs resource usage |
| Tool result size limit | 50,000 chars | Prevent context explosion; save to file if larger |
| Per-message tool results | 200,000 chars | Budget across parallel tool results |
| Context buffer | 20,000 tokens | Always reserved from effective window |
| Autocompact margin | 13,000 tokens | Additional headroom above buffer |
| Preserved messages | 10K-40K tokens | Recent conversation kept verbatim post-compaction |
| Min preserved messages | 5 text-block messages | Ensure continuity |
| Cache TTL awareness | 5 min / 1 hour | Sleep/activity planning for autonomous mode |
| Subagent message cap | 50 messages | Prevent runaway agents (36.8GB incident) |
| Memory index max | 200 lines / 25KB | MEMORY.md size limit |
| Memory frontmatter scan | First 30 lines | Quick header extraction |
| Max relevant memories | 5 | Per-query relevance search limit |
| Security validators | 23 | Bash command safety checks |
| Max tracked cache sources | 10 | Memory protection for cache break detection |
| Deferred tool threshold | Dynamic | Based on total tool count |
