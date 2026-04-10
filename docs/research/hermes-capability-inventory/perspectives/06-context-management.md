# Hermes Agent - Context Management

Sources:
- agent/context_compressor.py - ContextCompressor class
- agent/prompt_caching.py - Anthropic prefix caching
- agent/model_metadata.py - Model context length lookup
- run_agent.py lines ~1116-1173 (compressor init), ~6755-6771 (cached system prompt)
- tools/memory_tool.py (frozen snapshot for prefix cache stability)

## Context Compression (ContextCompressor)

File: agent/context_compressor.py

### When it fires
Triggered when prompt_tokens >= threshold (default: 50% of model's context length).
Also runs a pre-flight rough estimate check (estimate_messages_tokens_rough) before API calls to catch overflow before it happens.

Configurable via config.yaml [compression]:
- threshold: float (default 0.50)
- enabled: bool (default True)
- summary_model: str (optional override for summarizer model)
- target_ratio: float (default 0.20) -- tail size as fraction of threshold
- protect_last_n: int (default 20) -- minimum messages to always preserve in tail

### Algorithm (5 phases)

Phase 1: Prune old tool results (cheap pre-pass, no LLM call)
  - Walks backward from end, protecting last protect_last_n * 3 messages
  - Old tool result content (>200 chars) replaced with "[Old tool output cleared to save context space]"

Phase 2: Determine boundaries
  - protect_first_n=3: system prompt + first exchange always preserved
  - Tail protection by TOKEN BUDGET: walks backward accumulating token estimates until budget exhausted
    Token budget = summary_target_ratio * threshold_tokens (scales with context window size)
    Never cuts inside a tool_call/result group (boundary alignment helpers)

Phase 3: Generate structured summary via auxiliary LLM
  - Summary template (Goal, Constraints & Preferences, Progress [Done/InProgress/Blocked], Key Decisions, Relevant Files, Next Steps, Critical Context)
  - First compaction: summarize from scratch
  - Subsequent compactions: ITERATIVE UPDATE -- "PREVIOUS SUMMARY: ... NEW TURNS: ... Update the summary..."
  - Summary budget scales: 20% of compressed content tokens, min 2000 tokens, max min(5% of context, 12000) tokens
  - Model: summary_model config override OR auxiliary client auto-selection (cheap/fast)

Phase 4: Assemble compressed message list
  - head messages + summary message + tail messages
  - Summary role chosen to avoid consecutive same-role messages (smart role selection, with merge-into-tail fallback)
  - System prompt gets note added: "[Note: Some earlier conversation turns have been compacted...]"

Phase 5: Sanitize tool_call/tool_result pairs
  - Orphaned tool results (whose call_id was removed) are deleted
  - Orphaned tool calls (whose results were removed) get stub results inserted: "[Result from earlier conversation -- see context summary above]"
  This ensures the API never receives mismatched call_id pairs.

### Iterative summary updates

_previous_summary is stored on the ContextCompressor instance. On the next compaction, the new summary is generated as an UPDATE to the previous one (preserving existing info, adding new progress). This prevents information loss across multiple compressions.

## Anthropic Prefix Caching (agent/prompt_caching.py)

apply_anthropic_cache_control(messages, cache_ttl="5m", native_anthropic=False)

Strategy: system_and_3
- Places cache_control breakpoints on: system prompt + last 3 non-system messages
- Uses 4 breakpoints total (Anthropic max)
- Marker: {"type": "ephemeral"} for 5m TTL, or {"type": "ephemeral", "ttl": "1h"} for 1h

Applied on every API call for Anthropic models. Result: ~75% input token cost reduction on multi-turn conversations.

The frozen snapshot pattern in memory tool (see memory system doc) is directly motivated by this: if memory content changed mid-session, the system prompt prefix would change, invalidating the cache.

## Cached System Prompt per Session

run_agent.py lines ~6755-6771:

_cached_system_prompt is built ONCE per session:
- First turn: build from scratch (_build_system_prompt())
- Continuing sessions (gateway multi-turn): load exact system prompt from SessionDB to ensure prefix cache matches

system_prompt is stored in SessionDB at session creation. Gateway creates a new AIAgent object per message, but reloads the stored system prompt to preserve the cache across process boundaries.

## Smart Model Routing (agent/smart_model_routing.py)

choose_cheap_model_route(user_message, routing_config)

Optional feature. When enabled, routes simple messages to a cheap/fast model:
- Message must be <= 160 chars (configurable max_simple_chars)
- Message must be <= 28 words (configurable max_simple_words)
- No code blocks (``` or backticks)
- No URLs
- No newlines > 1
- No complex keywords (debug, implement, refactor, architecture, analyze, delegate, docker, etc.)

If all pass: returns cheap_model config (provider + model). Otherwise: returns None (use primary model).

## Iteration Budget

run_agent.py: IterationBudget class.

Per-session budget tracking. max_iterations is the main limit. iteration_budget.remaining is checked each loop iteration. When exhausted, prints warning and breaks.

Budget caution threshold at 70%: nudges agent to start wrapping up long tasks.

Delegation: each subagent gets its own fresh iteration budget (not shared with parent).

## Context Length Lookup (agent/model_metadata.py)

get_model_context_length(model, base_url, api_key, config_context_length, provider)

Resolution order:
1. config.yaml explicit override (model.context_length or custom_providers[].models[].context_length)
2. models.dev registry (provider-aware, fetched at runtime)
3. Hardcoded lookup table for known models
4. Default fallback (32768)

estimate_messages_tokens_rough(messages): chars/4 + 10 per message. Fast approximation used for pre-flight checks and compression thresholds.

## Engineering Quality

- Tool result pruning as cheap pre-pass: smart. Eliminates bulk of context cheaply before calling auxiliary LLM.
- Iterative summary updates: excellent. Prevents compounding information loss across multiple compressions.
- Tool pair sanitization: critical correctness. Prevents API rejection on mismatched call_ids after compression.
- Scaled summary budget: context-window-aware. Large-context models get richer summaries.
- Token-budget tail protection: better than fixed message count. Recent context protected proportionally.
- Frozen system prompt + SessionDB storage: enables Anthropic prefix caching across process boundaries (gateway).
- Smart model routing: optional cost optimization without compromising capability.
- Worth absorbing: iterative summary update pattern, tool pair sanitization after compression, token-budget tail protection, frozen system prompt + DB storage for cross-process cache preservation.
