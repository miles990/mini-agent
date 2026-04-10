# Model-Aware Context Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Kuro's context pipeline from "Opus-only 50K soup" to a model-aware pipeline where code handles structural decisions and the LLM only handles cognitive tasks.

**Architecture:** Three shared layers (L0 denoise, L1 pre-digest, L2 instruction isolation) followed by a model-aware gate that adjusts budget/complexity per model tier. All layers run in a new `src/context-pipeline.ts` module, called between buildContext() and the LLM call.

**Tech Stack:** TypeScript, existing buildContext/omlx-gate infrastructure

**Design Principle (Constraint Texture):** Deterministic tasks -> code. Cognitive tasks -> LLM. The pipeline moves structural parsing from "LLM reads XML soup" to "code curates what reaches the LLM."

---

## Current State

```
buildContext() → 18-22K assembled context
  + system prompt 24-28K
  + cycle prompt 8-12K
  = 50-70K total (triggers pre-reduce if >60K)
```

- omlx-gate R1 prunes low-citation perception sections
- omlx-gate R5 selects sections by trigger profile
- Phase 0 optionally compresses perceptions with 0.8B
- NO model-aware budget adjustment
- NO noise filtering (mushi spam, stale inbox)
- NO instruction/data separation

## Target State

```
buildContext() → raw assembled context
  ↓
L0: Denoise (shared) — remove noise all models benefit from removing
  ↓
L1: Pre-digest (shared) — compress verbose sections to summaries
  ↓
L2: Instruction isolation (model-aware) — restructure for model capability
  ↓
Model Gate — budget + complexity per tier
  ↓
Final prompt to LLM
```

Two model tiers:
- **Tier 1 (4B)**: 8-12K context budget, 3 output tags, micro-task prompt
- **Tier 2 (Opus/Sonnet)**: 30-35K context budget, full 15 tags, full OODA prompt

---

## Task 1: L0 — Source-Level Denoising

**Files:**
- Modify: `src/api.ts` (room message handler, ~line 2388-2395)
- Modify: `plugins/chat-room-inbox.sh` (perception plugin output)

### What

Filter noise at the source before it enters any pipeline:

1. **Mushi system events** — `[mushi] Kuro status changed: X → Y` messages flood the inbox. They're system diagnostics, not messages Kuro needs to respond to. The filter at api.ts:2389 already exists for `from === 'mushi' && /^\[mushi\]\s/.test(text)` but it only skips inbox write — the messages still appear in chat-room-inbox.sh perception output.

2. **chat-room-inbox.sh dedup** — The plugin reads `~/.mini-agent/chat-room-inbox.md` and outputs it raw. Add: collapse consecutive identical-source system messages into count.

### Code

**api.ts ~2389** — already filters mushi. Verify it works. No change needed if filter is effective.

**plugins/chat-room-inbox.sh** — Add noise filtering:
```bash
# After reading inbox, before output:
# Collapse consecutive mushi status lines
grep -v '^\- \[.*\] (mushi) \[.*\] \[mushi\]' "$INBOX_PATH"
```

### Verify
- Send test mushi status message, confirm it doesn't appear in `<chat-room-inbox>` section
- Send Alex message, confirm it DOES appear

---

## Task 2: L0 + L1 — Context Pipeline Module

**Files:**
- Create: `src/context-pipeline.ts`

### What

New module that processes buildContext() output. Three functions:

```typescript
// Entry point — called from agent.ts before LLM call
export function processContext(
  rawContext: string,
  modelTier: 'small' | 'large',
  trigger: string | undefined,
): string;

// L0: Remove noise sections, empty tags, duplicate content
function denoise(context: string): string;

// L1: Compress verbose sections to summaries (code-based, no LLM)
function predigest(context: string, budget: number): string;
```

### L0 Denoise Logic

1. **Remove empty XML sections**: `<section>\n</section>` or `<section>\n\n</section>` → delete
2. **Collapse repeated lines**: If same line appears 3+ times consecutively → `[repeated x N]`
3. **Strip stale perception data**: Sections marked `[degraded]` or `[timeout]` → remove content, keep header

### L1 Pre-digest Logic

1. **Inbox summarization**: Parse `<inbox>` section, count by source/priority:
   ```
   Before: 20 lines of individual inbox items
   After:  "3 pending (1 Alex P0, 2 system P2)"
   ```

2. **Chat room summarization**: Parse `<chat-room-recent>`, keep only last 3 messages + count:
   ```
   Before: 15 messages with full text
   After:  "15 recent messages. Last 3: [alex] 切換到 4B / [kuro] 回覆... / [mushi] status"
   ```

3. **Perception digest**: For non-core sections, extract first line only:
   ```
   Before: <github-issues>\n20 lines of issue details\n</github-issues>
   After:  <github-issues>5 open issues (2 needs-triage)</github-issues>
   ```

### Budget-Aware Truncation

After L0+L1, if context exceeds budget:
- Priority order: inbox > soul > heartbeat > chat-room > topics > perceptions > rest
- Truncate from lowest priority first

---

## Task 3: L2 — Model-Aware Prompt Builder

**Files:**
- Modify: `src/prompt-builder.ts` (add small model prompt builder)

### What

Add `buildSmallModelPrompt()` — a drastically simplified prompt for 4B:

```typescript
export function buildSmallModelPrompt(
  trigger: string | undefined,
  inboxSummary: string,
  taskHint: string | null,
): string {
  return `You are Kuro, an AI agent.

${taskHint ? `TASK: ${taskHint}` : 'Decide what to do based on the context below.'}

RULES:
1. If there's a message to reply to, reply with <reply>your response</reply>
2. If there's a task to do, do it and report with <action>what you did</action>  
3. To remember something, use <remember>content</remember>
4. Start with: ## Decision\nchose: what you're doing

CONTEXT is provided below between <context> tags. Read it, then respond.`;
}
```

Key differences from Opus prompt:
- ~500 chars instruction vs ~3K
- 3 output tags vs 15
- No cycle guide (7 phases → none)
- No rumination material, background lane hints, delegation review gates
- Task framed as single clear directive

### Existing Prompt (Opus)

Keep `buildPromptFromConfig()` and `buildFallbackAutonomousPrompt()` unchanged — they work for Opus.

---

## Task 4: Model-Aware Gate

**Files:**
- Modify: `src/omlx-gate.ts` (add model tier detection + budget config)
- Modify: `src/agent.ts` (integrate pipeline before LLM call)

### What

Add model tier system to omlx-gate:

```typescript
export type ModelTier = 'small' | 'large';

export interface ModelTierConfig {
  contextBudget: number;     // max context chars
  maxTags: number;           // output tag complexity
  promptStyle: 'micro' | 'full';
  predigestLevel: 'aggressive' | 'light';
}

const MODEL_TIERS: Record<ModelTier, ModelTierConfig> = {
  small: {
    contextBudget: 10_000,
    maxTags: 3,
    promptStyle: 'micro',
    predigestLevel: 'aggressive',
  },
  large: {
    contextBudget: 35_000,
    maxTags: 15,
    promptStyle: 'full',
    predigestLevel: 'light',
  },
};

export function detectModelTier(provider: string, modelName?: string): ModelTier {
  if (provider === 'local') {
    // 4B and smaller → small tier
    if (!modelName || /\b[0-4]B\b/i.test(modelName)) return 'small';
    // 9B+ → large tier
    return 'large';
  }
  // Claude API → always large
  return 'large';
}
```

### Integration in agent.ts

In `callClaude()` (~line 1328), before building fullPrompt:

```typescript
const tier = detectModelTier(provider, modelName);
const tierConfig = getModelTierConfig(tier);

// Use pipeline to process context
const processedContext = processContext(rawContext, tier, trigger);

// Use appropriate prompt
const prompt = tier === 'small'
  ? buildSmallModelPrompt(trigger, inboxSummary, taskHint)
  : existingPrompt;
```

### Tag Post-Processing for Small Models

In `dispatcher.ts postProcess()`, when model is small tier:
- Map `<reply>` → `<kuro:chat>`
- Map `<action>` → `<kuro:action>`
- Map `<remember>` → `<kuro:remember>`
- Ignore/strip unknown tags (4B may hallucinate tags)

---

## Task 5: L1 Light — Opus Denoising

**Files:**
- Modify: `src/context-pipeline.ts` (add light mode)

### What

Even for Opus, apply L0 (denoise) and light L1:
- Remove empty sections
- Collapse repeated lines
- **Keep full section content** (no summarization)
- Budget: 35K (vs current 18-23K effective)

The main Opus benefit is noise removal, not compression.

---

## Task 6: Wire Everything Together

**Files:**
- Modify: `src/loop.ts` (pass model tier info through)
- Modify: `src/agent.ts` (call pipeline)
- Modify: `src/dispatcher.ts` (tag mapping for small models)

### Integration Points

1. **loop.ts runCycle()**: Pass provider info to callClaude
2. **agent.ts callClaude()**: Insert pipeline between context assembly and LLM call
3. **agent.ts callClaude()**: Select prompt based on tier
4. **dispatcher.ts postProcess()**: Map simplified tags back to kuro:* tags
5. **loop.ts executeForegroundCall()**: Same pipeline for foreground lane

### Rollback

- Feature flag: `model-aware-pipeline` (default: on for local, off for claude)
- Flag off → bypass pipeline entirely, use existing flow
- All changes are additive — existing functions untouched

---

## Execution Order

1. Task 1 (L0 source denoising) — standalone, zero risk
2. Task 2 (context-pipeline.ts) — new file, no existing code changed
3. Task 3 (small model prompt) — new function, no existing code changed  
4. Task 4 (model gate + agent integration) — wire it together
5. Task 5 (Opus light mode) — extend pipeline
6. Task 6 (full integration) — connect all pieces

Each task is independently committable and testable.
