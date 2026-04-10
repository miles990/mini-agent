# Hermes Agent — Complete Capability Inventory & Gap Analysis Synthesis

Research date: 2026-04-05
Source codebase: /Users/user/Workspace/mini-agent/_external/hermes-agent/
Analyst: Claude Sonnet 4.6

---

## 1. All Tools (Complete Inventory)

### Web
| Tool | File | Key Params | Notes |
|---|---|---|---|
| web_search | tools/web_tools.py | query, limit | Tavily or SearXNG backend |
| web_extract | tools/web_tools.py | urls (list) | Firecrawl or httpx backend |

### Terminal / OS
| Tool | File | Key Params | Notes |
|---|---|---|---|
| terminal | tools/terminal_tool.py | command, restart_session, timeout | 6 backends: local/Docker/SSH/Modal/Daytona/Singularity. Tirith + dangerous-command approval. |
| process | tools/process_registry.py | action, process_id, command | Background process management (start/status/kill) |

### File System
| Tool | File | Key Params | Notes |
|---|---|---|---|
| read_file | tools/file_tools.py | path, offset, limit | 1-indexed lines |
| write_file | tools/file_tools.py | path, content | Atomic write |
| patch | tools/file_tools.py | path, old_content, new_content | Fuzzy matching, whitespace-tolerant |
| search_files | tools/file_tools.py | pattern, path, type | Ripgrep-backed |

### Vision / Media
| Tool | File | Notes |
|---|---|---|
| vision_analyze | tools/vision_tools.py | Auxiliary vision model (GPT-4o, Claude, Gemini, local) |
| image_generate | tools/image_generation_tool.py | DALL-E 3, Stable Diffusion, FLUX |
| text_to_speech | tools/tts_tool.py | Edge TTS (free), ElevenLabs, OpenAI TTS |

### Skills (Procedural Memory)
| Tool | File | Notes |
|---|---|---|
| skills_list | tools/skills_tool.py | Tier-1 progressive disclosure (names + descriptions only) |
| skill_view | tools/skills_tool.py | Tier-2 (full SKILL.md) or Tier-3 (supporting files) |
| skill_manage | tools/skill_manager_tool.py | create/edit/patch/delete/write_file/remove_file. Security scanned. |

### Browser Automation
| Tool | File | Notes |
|---|---|---|
| browser_navigate | tools/browser_tool.py | Local Chromium or Browserbase cloud |
| browser_snapshot | tools/browser_tool.py | Accessibility tree (ariaSnapshot) |
| browser_click | tools/browser_tool.py | By ref ID (@e5) |
| browser_type | tools/browser_tool.py | |
| browser_scroll | tools/browser_tool.py | |
| browser_back | tools/browser_tool.py | |
| browser_press | tools/browser_tool.py | Keyboard events |
| browser_close | tools/browser_tool.py | |
| browser_get_images | tools/browser_tool.py | |
| browser_vision | tools/browser_tool.py | Screenshot + vision analysis |
| browser_console | tools/browser_tool.py | JS console output |

### Planning & State
| Tool | File | Notes |
|---|---|---|
| todo | tools/todo_tool.py | Persistent task list |
| memory | tools/memory_tool.py | Curated bounded memory (add/replace/remove). Injection scanned. |
| session_search | tools/session_search_tool.py | FTS5 + auxiliary LLM summarization of past sessions |
| clarify | tools/clarify_tool.py | Interactive Q&A (multiple-choice or open-ended) |

### Execution / Delegation
| Tool | File | Notes |
|---|---|---|
| execute_code | tools/code_execution_tool.py | Python PTC sandbox via UDS RPC. Only stdout to LLM. |
| delegate_task | tools/delegate_tool.py | Spawn isolated subagents (single or up to 3 parallel) |
| mixture_of_agents | tools/mixture_of_agents_tool.py | Fan-out to 4 frontier models via OpenRouter, aggregate with Claude |

### Infrastructure
| Tool | File | Notes |
|---|---|---|
| cronjob | tools/cronjob_tools.py | Create/manage scheduled tasks. Prompts security scanned. |
| send_message | tools/send_message_tool.py | Cross-platform outbound messaging (list or send) |

### Smart Home
| Tool | File | Notes |
|---|---|---|
| ha_list_entities | tools/homeassistant_tool.py | |
| ha_get_state | tools/homeassistant_tool.py | |
| ha_list_services | tools/homeassistant_tool.py | |
| ha_call_service | tools/homeassistant_tool.py | |

### RL Training (Tinker-Atropos)
| Tool | File | Notes |
|---|---|---|
| rl_list_environments | tools/rl_training_tool.py | AST-scanned BaseEnv subclasses |
| rl_select_environment | tools/rl_training_tool.py | |
| rl_get_current_config | tools/rl_training_tool.py | |
| rl_edit_config | tools/rl_training_tool.py | Locked infra settings protected |
| rl_start_training | tools/rl_training_tool.py | Spawns SGLang + Tinker trainer + env server |
| rl_check_status | tools/rl_training_tool.py | WandB metrics |
| rl_stop_training | tools/rl_training_tool.py | |
| rl_get_results | tools/rl_training_tool.py | |
| rl_list_runs | tools/rl_training_tool.py | |
| rl_test_inference | tools/rl_training_tool.py | |

### Voice
| Tool | File | Notes |
|---|---|---|
| transcription | tools/transcription_tools.py | Whisper audio-to-text |
| voice_mode | tools/voice_mode.py | Multi-turn voice interaction loop |

### MCP (Dynamic)
All tools exposed by configured MCP servers. Discovered at runtime. Auto-deregistered/re-registered on list_changed notifications. Supports stdio and HTTP transports.

Total: approximately 60+ registered tools (excluding MCP dynamic tools).

---

## 2. Skill System Summary

- Format: SKILL.md (YAML frontmatter + Markdown body) in ~/.hermes/skills/
- Progressive disclosure: skills_list (tier-1, metadata only) -> skill_view (tier-2, full content) -> supporting files (tier-3)
- Creation/editing: skill_manage tool (create/edit/patch/delete)
- Security: trust-level policy matrix (builtin/trusted/community/agent-created) + static regex scanner (9 threat categories)
- Self-improvement nudge: every 10 tool iterations, background forked agent reviews conversation and optionally creates/updates skills
- Hub/marketplace: GitHub-sourced + official bundles + optional-skills. Lock file + quarantine + audit log.
- Slash command activation: /skill-name injects skill content as user message

---

## 3. Memory System Summary

- Two curated stores: MEMORY.md (agent notes, 2200 chars) and USER.md (user profile, 1375 chars)
- Entry delimiter: \n§\n. Entries can be multiline.
- CRUD via memory tool: add/replace/remove (no read -- memory is always in system prompt)
- FROZEN SNAPSHOT PATTERN: memory loaded once at session start, system prompt never changes mid-session. Preserves Anthropic prefix cache.
- File safety: atomic writes (temp file + os.replace), fcntl file locking for multi-session safety
- Injection scanning on every write: 13 threat patterns + invisible unicode check
- Session transcript recall: session_search tool with FTS5 + auxiliary LLM summarization
- Memory nudge: every 10 user turns, background agent reviews conversation for memory-worthy facts
- MemoryManager: orchestrates builtin provider + at most 1 external plugin provider

---

## 4. Security Architecture

9 distinct layers:
1. Tirith binary pre-exec scanner (tirith_security.py) -- content-level command threats. Auto-installed with SHA-256 + optional cosign verification.
2. Dangerous command pattern detection (approval.py) -- regex + per-session approval state + smart LLM approval
3. Memory injection scanning (memory_tool.py) -- 13 patterns + invisible unicode
4. Cron prompt scanning (cronjob_tools.py) -- critical patterns at job creation
5. Skill installation scanner (skills_guard.py) -- static regex + trust-level policy matrix
6. SSRF protection (url_safety.py) -- private IP blocks + CGNAT range + fail-closed DNS
7. Website policy blocklist (website_policy.py) -- user-configured domain blocklist with 30s cache
8. MCP environment filtering (mcp_tool.py) -- credential stripping for stdio subprocesses
9. Subagent capability isolation (delegate_tool.py) -- blocked tools + parent toolset intersection

---

## 5. Self-Improvement Loop

Two automatic mechanisms:
- Memory nudge: every 10 user turns -> background forked agent -> MEMORY_REVIEW_PROMPT -> writes to MEMORY.md/USER.md
- Skill nudge: every 10 tool iterations -> background forked agent -> SKILL_REVIEW_PROMPT -> writes to ~/.hermes/skills/
- Combined prompt optimization: if both fire simultaneously, one background run handles both
- Background fork: forked AIAgent(max_iterations=8, quiet_mode=True), shared memory/skill stores, zero main-loop impact

RL training infrastructure (for meta-agent use):
- rl_training_tool: orchestrate Tinker-Atropos training runs
- Trajectory recording: save_trajectory() to JSONL for fine-tuning data collection

---

## 6. Context Management

- Context compressor: 5-phase algorithm (prune old tool results -> determine boundaries -> generate structured summary -> assemble -> sanitize tool pairs)
- Iterative summary updates: _previous_summary preserved across compressions. Each new compaction updates rather than replaces.
- Anthropic prefix caching: system_and_3 strategy (system prompt + last 3 messages = 4 breakpoints). ~75% input cost reduction.
- System prompt frozen per session: cached once, never rebuilt mid-session. Stored in SessionDB for cross-process (gateway) restoration.
- Smart model routing: optional cheap-model routing for simple short queries
- Token-budget tail protection: tail size proportional to context window size

---

## 7. Multi-Agent / Delegation

- delegate_task: single or batch (up to 3 parallel) subagents. Isolated context, restricted toolsets, fresh terminal sessions.
- Depth limit: MAX_DEPTH=2. Grandchildren blocked.
- Blocked tools in subagents: delegate_task, clarify, memory, send_message, execute_code
- execute_code: Python PTC via UDS RPC. Only stdout to LLM. 7 allowed tools. 5-minute timeout.
- mixture_of_agents: 4-model fan-out + aggregation via OpenRouter
- Progress relay: tree-view display in CLI, batched tool names for gateway

---

## 8. Communication Channels

17 channels: CLI, Telegram, Discord, Slack, WhatsApp, Signal, Email (IMAP/SMTP), Mattermost, Matrix, DingTalk, Feishu/Lark, WeCom, SMS (Twilio), Webhooks, Home Assistant, VS Code/Zed/JetBrains (ACP), OpenAI-compatible API server.

All platforms use the same AIAgent core. Platform-specific toolsets. send_message enables cross-platform outbound from any context.

---

## 9. Engineering Patterns Worth Absorbing

Priority ranked:

CRITICAL (unique capabilities we likely lack):

1. FROZEN SNAPSHOT PATTERN for memory (tools/memory_tool.py lines 119-135, 335-346)
   Load memory once at session start. Never rebuild system prompt mid-session. Store system prompt in DB for multi-process restoration. Directly enables Anthropic prefix caching to function correctly.

2. BACKGROUND REVIEW FORK PATTERN (run_agent.py lines 1770-1860)
   Counter-triggered background thread spawns forked agent with conversation snapshot. Shared stores. Zero user impact. This IS the self-improvement loop.

3. INJECTION SCANNING ON MEMORY/CRON WRITES (tools/memory_tool.py lines 60-97, tools/cronjob_tools.py lines 36-63)
   Memory content gets injected into system prompt. Without scanning, any web page could persist malicious prompts. Invisible unicode blocking is often missed.

4. TOOL PAIR SANITIZATION AFTER COMPRESSION (agent/context_compressor.py lines 392-450)
   After compressing conversation, fix orphaned tool_call/tool_result pairs. Critical for API correctness. Easy to forget.

5. ITERATIVE SUMMARY UPDATES (agent/context_compressor.py lines 265-304)
   Each compaction updates the previous summary rather than starting fresh. Prevents compounding information loss.

HIGH VALUE (engineering quality improvements):

6. REGISTRY SINGLETON with check_fn gating (tools/registry.py)
   All tools register at import time. Availability checked once per schema generation. Clean dispatch with uniform error format. Deregister support for MCP dynamic tools.

7. TRUST-LEVEL POLICY MATRIX for external content (tools/skills_guard.py INSTALL_POLICY)
   Different rules for builtin/trusted/community/agent-created content. Simple table drives complex policy.

8. PROGRESSIVE DISCLOSURE for skills (tools/skills_tool.py)
   Cheap survey (metadata only) -> full content on demand -> supporting files on further demand. Prevents token bloat.

9. DUAL-TRANSPORT RPC for execute_code (tools/code_execution_tool.py)
   UDS for local, file-based polling for remote (Docker/SSH/Modal). Same LLM-facing interface for both.

10. STRUCTURED COMPACTION SUMMARY TEMPLATE
    Goal / Constraints & Preferences / Progress (Done/InProgress/Blocked) / Key Decisions / Relevant Files / Next Steps / Critical Context. Much better than free-form summaries.

NICE TO HAVE:

11. SOUL.md personality file (hermes_cli/default_soul.py)
    User-editable plain markdown. Clean separation from config.

12. SSRF protection with CGNAT range (tools/url_safety.py)
    100.64.0.0/10 is not covered by standard is_private. Easy to miss.

13. PROFILE ISOLATION (hermes_cli/profiles.py)
    Independent skills/memory/sessions per profile. Useful for work/personal separation.

14. SKILL NUDGE COUNTER RESET on actual use (run_agent.py line ~6112)
    Counter resets when skill_manage IS used, not just when nudge fires. Prevents spammy triggers when agent is already active.

15. SESSION SEARCH with auxiliary LLM summarization (tools/session_search_tool.py)
    FTS5 finds sessions -> LLM summarizes. Returns focused context not raw transcripts.

---

## Gap Analysis vs Mini-Agent (Items to Investigate)

Based on this analysis, mini-agent likely lacks these Hermes capabilities:

ALMOST CERTAINLY MISSING:
- Frozen snapshot pattern for memory (most agents don't implement this)
- Background review fork for self-improvement nudge
- Injection scanning on memory/cron writes
- Tool pair sanitization after context compression
- Iterative summary updates in context compressor
- Skills system (procedural memory) with progressive disclosure
- execute_code PTC sandbox (UDS RPC approach)
- 17-channel platform support
- Tirith binary security scanner with cosign verification
- SOUL.md personality file
- Per-profile isolation
- RL training toolset

POSSIBLY MISSING:
- Skill security scanner with trust-level policy matrix
- Structured compaction summary template
- Smart model routing (cheap-model for simple queries)
- Token-budget tail protection (vs fixed message count)
- Hub/marketplace for skills
- SSRF protection with CGNAT range
- MCP client with sampling support

LIKELY PRESENT IN SOME FORM:
- Basic memory tool
- Web search/extract
- Terminal tool
- File tools
- Browser automation
- Context compression (basic form)
- Delegation/subagents
- Anthropic prefix caching
- Session persistence

---

## File Index (Key Files for Follow-up)

| Capability | Primary File | Lines of Interest |
|---|---|---|
| Tool registry | tools/registry.py | Full file (276 lines) |
| Toolset definitions | toolsets.py | Lines 31-377 |
| Memory store + injection scanning | tools/memory_tool.py | Lines 60-97 (scanning), 100-436 (MemoryStore) |
| Skill tool (list/view) | tools/skills_tool.py | Lines 1-150 (format), rest (implementation) |
| Skill manager (create/edit) | tools/skill_manager_tool.py | Full file |
| Skill security scanner | tools/skills_guard.py | Lines 82-250 (patterns + policy) |
| Subagent delegation | tools/delegate_tool.py | Full file (808 lines) |
| PTC sandbox | tools/code_execution_tool.py | Lines 1-100 (architecture), rest (implementation) |
| MoA | tools/mixture_of_agents_tool.py | Lines 1-100 (config + approach) |
| Context compressor | agent/context_compressor.py | Full file (677 lines) |
| Prompt caching | agent/prompt_caching.py | Full file (73 lines) |
| Memory manager | agent/memory_manager.py | Full file (336 lines) |
| Tirith security | tools/tirith_security.py | Full file (671 lines) |
| Dangerous command approval | tools/approval.py | Lines 68-120 (patterns) |
| SSRF protection | tools/url_safety.py | Full file |
| Self-improvement nudge | run_agent.py | Lines 1733-1860, 6723-6733, 8888-8916 |
| Background review prompts | run_agent.py | Lines 1733-1768 |
| Config structure | hermes_cli/config.py | Lines 1-100 (overview) |
| Plugin system | hermes_cli/plugins.py | Lines 54-61 (hooks), rest (discovery) |
| Smart model routing | agent/smart_model_routing.py | Full file |
| Session insights | agent/insights.py | Full file |
| Gateway runner | gateway/run.py | Lines 1-100 (architecture) |
| Skills hub | tools/skills_hub.py | Lines 1-100 (sources) |
