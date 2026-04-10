# Hermes Agent - Memory System Deep Dive

Sources:
- tools/memory_tool.py - MemoryStore class, injection scanning
- agent/memory_manager.py - MemoryManager orchestrator
- agent/memory_provider.py - MemoryProvider ABC
- agent/builtin_memory_provider.py - builtin provider implementation
- hermes_state.py - SessionDB SQLite state store

## Memory Architecture: Two Tiers

### Tier 1: Curated Bounded Memory (MemoryStore)
File-backed, persistent across sessions. Two stores:
- MEMORY.md: agent personal notes (environment facts, project conventions, tool quirks)
- USER.md: user profile (preferences, communication style, pet peeves, name/role/timezone)

Location: ~/.hermes/memories/MEMORY.md and ~/.hermes/memories/USER.md

Character limits (not tokens -- model-independent):
- MEMORY.md: 2,200 chars
- USER.md: 1,375 chars

Entry delimiter: \n§\n (section sign). Entries can be multiline.

Operations via memory tool:
- add: Append new entry. Rejects exact duplicates. Enforces char limit.
- replace: Find entry by substring match, replace with new content. Rejects ambiguous matches (unless all identical).
- remove: Find entry by substring match, remove.

No "read" action exposed to the LLM -- the memory is always in the system prompt.

### Tier 2: Session Transcript Search (SessionDB)
File: hermes_state.py

SQLite database with FTS5 full-text search. Stores all session messages with metadata.
Searched via session_search tool: FTS5 query -> top N sessions -> auxiliary LLM summarizes -> returns focused summaries.

## Frozen Snapshot Pattern (Critical Design Decision)

In MemoryStore:
- load_from_disk() is called once at session start
- It captures a _system_prompt_snapshot (frozen at load time)
- format_for_system_prompt() returns this frozen snapshot, NEVER the live state
- Mid-session writes update files on disk immediately (durable) but do NOT update the system prompt

Rationale: Keeps the system prompt identical across all turns of a session, which preserves the Anthropic prefix cache. If memory content changed mid-session, the prefix cache would be invalidated on every memory write.

On the next session start, load_from_disk() reads the new state from disk, and the updated memory appears in the new system prompt.

## File Safety

Writes use temp-file + atomic os.replace():
1. Write to .mem_XXXXX.tmp in same directory
2. fsync the temp file
3. os.replace(tmp, target) -- atomic on same filesystem

A separate .lock file is used for flock(LOCK_EX) during read-modify-write sequences. Separate from the data file so the data file can be atomically replaced without interfering with the lock.

Multi-session safety: Each write under lock calls _reload_target() to re-read from disk first, then mutates, then saves. This handles concurrent sessions writing to the same memory files.

## Memory Injection Scanning

Every add/replace call scans the content before accepting it:
_scan_memory_content() in tools/memory_tool.py.

Threat patterns checked:
- Prompt injection: "ignore previous/all/above/prior instructions", "you are now", "do not tell the user", "system prompt override", "disregard your instructions/rules/guidelines", "act as if you have no restrictions"
- Exfiltration: curl/wget with secret env vars ($KEY, $TOKEN, $SECRET, etc.)
- Credential reads: cat .env, cat credentials, cat .netrc, etc.
- Persistence/backdoor: authorized_keys, ~/.ssh, ~/.hermes/.env

Invisible unicode check: blocks zero-width spaces and bidi override characters (U+200B-U+202E, U+FEFF, U+2060).

Returns error string if blocked. The add/replace call fails with a "Blocked:" error message.

## MemoryManager Orchestrator (agent/memory_manager.py)

MemoryManager holds:
- Exactly ONE "builtin" provider (always present, always first)
- At most ONE external (non-builtin) provider (plugin)

External provider examples: Honcho (now removed from toolsets, but still injectable as a plugin), custom providers.

API:
- build_system_prompt(): Collects system prompt blocks from all providers
- prefetch_all(query): Queries all providers for context relevant to user query (pre-turn)
- sync_all(user_content, assistant_content): Syncs completed turn to all providers (post-turn)
- queue_prefetch_all(query): Queues background prefetch for next turn
- handle_tool_call(tool_name, args): Routes memory tool calls to correct provider
- on_turn_start(turn_number, message, **kwargs): Lifecycle hook
- on_session_end(messages): Lifecycle hook
- on_pre_compress(messages): Called before context compression (providers can inject context into compression summary)
- on_memory_write(action, target, content): Notifies external providers when builtin memory tool writes
- on_delegation(task, result, child_session_id): Notifies providers when subagent completes
- initialize_all(session_id, **kwargs): Injects hermes_home into all providers

All provider calls wrapped in try/except -- failures in one provider never block others.

## Memory Nudge Loop (Parallel to Skill Nudge)

Location: run_agent.py lines ~1005-1014 (config), ~6723-6733 (per-turn trigger).

Config: memory.nudge_interval in config.yaml (default 10 user turns).
Counter: _turns_since_memory increments each user turn. Resets when memory tool is used.

Trigger: if _turns_since_memory >= _memory_nudge_interval and memory in valid_tool_names and _memory_store:
  _should_review_memory = True

Then _spawn_background_review() fires with MEMORY_REVIEW_PROMPT:
"Review the conversation above and consider if there is anything worth saving to memory. Focus on: Has the user revealed things about themselves -- their persona, desires, preferences, or personal details? Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate? If something stands out, save it using the memory tool. If nothing is worth saving, just say 'Nothing to save.' and stop."

## Session DB (hermes_state.py)

SQLite database at ~/.hermes/sessions.db.

Tables: sessions, messages (with FTS5 virtual table).
Sessions table: session_id, title, model, platform, created_at, last_active, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, billing_provider, billing_base_url, system_prompt.

System prompt is stored per-session so that on gateway continuation (new AIAgent per message), the exact same system prompt is reloaded to preserve the prefix cache.

Messages table: session_id, role, content, tool_name, tool_calls (JSON), tool_call_id, timestamp, turn_number.

FTS5 search: session_search tool performs full-text search across all messages, groups by session, loads matching sessions, truncates around match positions, sends to auxiliary LLM for summarization.

## Engineering Quality

- Frozen snapshot + prefix cache preservation: sophisticated and correct. Most agents don't do this.
- Atomic writes with fcntl lock: production-quality file safety.
- Injection scanning on memory writes: critical security layer.
- MemoryManager provider abstraction: clean plugin interface, one external provider limit prevents bloat.
- Memory nudge (background review agent): elegant. Never blocks user, writes to shared store, appears in next session.
- FTS5 session search: practical recall pattern. LLM-summarized results keep context window clean.
- Worth absorbing: frozen snapshot pattern, atomic write pattern, injection scanning, provider abstraction with one-external-limit rule.
