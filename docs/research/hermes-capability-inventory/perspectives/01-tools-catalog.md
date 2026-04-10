# Hermes Agent - Complete Tools Catalog

Source: /Users/user/Workspace/mini-agent/_external/hermes-agent/tools/
Registry: tools/registry.py
Toolsets: toolsets.py

## Registration Architecture

Every tool is registered at module import time via tools/registry.py ToolRegistry.register(). Registry is a module-level singleton. Each tool file calls registry.register() at the bottom of its file. model_tools.py imports all tool modules to trigger registration, then queries the registry.

Key ToolEntry fields: name, toolset, schema (OpenAI function format), handler, check_fn (availability gate), requires_env, is_async, emoji.

Dispatch path: registry.dispatch(name, args, **kwargs). Async handlers bridged via _run_async(). All exceptions caught and returned as {"error": "..."}.

## Core Tool Set (_HERMES_CORE_TOOLS)

### Web Tools (tools/web_tools.py)
- web_search: Search via Tavily or SearXNG. Params: query, limit
- web_extract: Scrape URLs via Firecrawl or httpx. Params: urls (list)

### Terminal / Process (tools/terminal_tool.py, tools/process_registry.py)
- terminal: Execute shell commands; backends: local/Docker/SSH/Modal/Daytona/Singularity. Params: command, restart_session, timeout
- process: Manage long-running background processes. Params: action, process_id, command

Security gate: every command goes through tirith_security.check_command_security() AND approval.detect_dangerous_command(). Dangerous commands require explicit user approval.

### File Tools (tools/file_tools.py)
- read_file: Read file with line offset/limit, 1-indexed. Params: path, offset, limit
- write_file: Write/create file (atomic). Params: path, content
- patch: Fuzzy find-and-replace within file (handles whitespace drift). Params: path, old_content, new_content
- search_files: Ripgrep-style content search + filename glob. Params: pattern, path, type

### Vision / Image
- vision_analyze (tools/vision_tools.py): Analyze images via auxiliary vision model
- image_generate (tools/image_generation_tool.py): Generate images via DALL-E 3 / Stable Diffusion / FLUX

### Skills Tools
- skills_list (tools/skills_tool.py): List all skills with metadata (tier-1 progressive disclosure)
- skill_view (tools/skills_tool.py): Load full SKILL.md (tier-2). Params: name, file
- skill_manage (tools/skill_manager_tool.py): Create/edit/patch/delete skills. Params: action, name, content, category

### Browser Tools (tools/browser_tool.py)
Local Chromium or Browserbase cloud backend.
Tools: browser_navigate, browser_snapshot, browser_click, browser_type, browser_scroll, browser_back, browser_press, browser_close, browser_get_images, browser_vision, browser_console

### Planning / Memory
- todo (tools/todo_tool.py): Persistent task list (add/complete/list/clear)
- memory (tools/memory_tool.py): Curated key-value memory store (add/replace/remove) with injection scanning

### Session / Context
- session_search (tools/session_search_tool.py): FTS5 search past sessions; summarizes via auxiliary LLM
- clarify (tools/clarify_tool.py): Ask user clarifying questions (multiple-choice or open-ended)

### Code Execution / Delegation
- execute_code (tools/code_execution_tool.py): Run Python that calls tools via UDS RPC; only stdout returned to LLM. Allowed tools: web_search, web_extract, read_file, write_file, search_files, patch, terminal
- delegate_task (tools/delegate_tool.py): Spawn isolated sub-agent(s) with fresh context; up to 3 parallel via ThreadPoolExecutor

### Scheduling (tools/cronjob_tools.py)
- cronjob: Create/list/update/pause/resume/remove/trigger scheduled tasks. Prompts security-scanned at creation.

### Messaging (tools/send_message_tool.py)
- send_message: Send text/media to Telegram, Discord, Slack, Signal, SMS, etc. Also lists available channels.

### Home Assistant (tools/homeassistant_tool.py)
- ha_list_entities, ha_get_state, ha_list_services, ha_call_service

### Mixture of Agents (tools/mixture_of_agents_tool.py)
- mixture_of_agents: Fan-out to 4 frontier models (Claude Opus, Gemini Pro, GPT-4, DeepSeek) via OpenRouter in parallel, aggregate with Claude Opus

### TTS (tools/tts_tool.py)
- text_to_speech: Edge TTS (free), ElevenLabs, or OpenAI TTS

### RL Training (tools/rl_training_tool.py)
Tools: rl_list_environments, rl_select_environment, rl_get_current_config, rl_edit_config, rl_start_training, rl_check_status, rl_stop_training, rl_get_results, rl_list_runs, rl_test_inference

Manages Tinker-Atropos RL training: spawns SGLang inference server + Tinker trainer + environment server as subprocesses. WandB metrics monitoring.

### MCP Tools (tools/mcp_tool.py)
Dynamically registered from config.yaml mcp_servers. Supports stdio and HTTP/StreamableHTTP transports. Auto-reconnects. Supports server-initiated LLM sampling requests. Tools deregistered and re-registered on notifications/tools/list_changed.

## Toolset System (toolsets.py)

Named groups of tools. Resolved recursively (diamond-dependency safe).
- hermes-cli / hermes-telegram / hermes-discord / hermes-slack / hermes-signal / hermes-whatsapp / etc: all map to _HERMES_CORE_TOOLS
- hermes-acp: editor integration (no clarify, no TTS, no messaging)
- hermes-api-server: HTTP API mode (no clarify, no send_message)
- hermes-gateway: union of all platform toolsets
- debugging: terminal + web + file
- safe: web + vision + MoA (no terminal)

Custom toolsets creatable at runtime via create_custom_toolset().

## Engineering Quality

Registry pattern: excellent. Singleton with collision detection, check_fn gating, deregister support. Circular-import safe.
Tool file structure: consistent. Each file registers at bottom. Schema + handler + check_fn + emoji.
Error handling: uniform. All dispatch errors returned as JSON error - never crash agent loop.
Async bridging: _run_async() bridges async handlers into sync dispatch path.
Availability gating: check_fn per toolset - queried once per schema generation.
