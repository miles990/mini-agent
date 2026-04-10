# Hermes Agent - Multi-Agent & Delegation Architecture

Sources:
- tools/delegate_tool.py - delegate_task tool
- tools/code_execution_tool.py - execute_code tool (PTC sandbox)
- tools/mixture_of_agents_tool.py - MoA fan-out

## delegate_task: Subagent Delegation

### What it does
Spawns child AIAgent instances with isolated context, fresh conversation, and restricted toolsets. Parent blocks until all children complete (or timeout). Only the final summary is returned to the parent -- intermediate tool calls never enter parent's context.

### Single vs Batch mode
- Single: provide goal (+ optional context, toolsets)
- Batch: provide tasks array, up to 3 items. All run concurrently via ThreadPoolExecutor(max_workers=3).

### Child agent properties
- Fresh conversation (no parent history)
- Own task_id (own terminal session, file ops cache)
- Restricted toolset (intersection of requested toolsets AND parent's enabled toolsets -- subagent cannot gain tools the parent lacks)
- Focused system prompt: "You are a focused subagent working on a specific delegated task."
- skip_memory=True, skip_context_files=True
- No clarify_callback (can't interact with user)
- Own iteration budget (default 50 iterations per subagent, configurable via delegation.max_iterations)

### Blocked tools (DELEGATE_BLOCKED_TOOLS)
- delegate_task (no recursive delegation -- MAX_DEPTH=2 enforced)
- clarify (no user interaction)
- memory (no writes to shared MEMORY.md)
- send_message (no cross-platform side effects)
- execute_code (subagents should reason step-by-step)

### Provider/model overrides for delegation
Optional config.yaml delegation section:
- delegation.provider: route subagents to a different provider:model pair
- delegation.base_url + delegation.api_key: direct endpoint override
- delegation.model: model override

Uses _resolve_delegation_credentials() to resolve full credential bundle via same runtime provider system as CLI startup.

### Progress relay to parent display
_build_child_progress_callback(): two paths:
- CLI (spinner present): prints tree-view lines above the spinner ("├─ tool_name preview")
- Gateway (parent_cb present): batches tool names, flushes every 5 calls to parent's progress callback

Batch mode: prints per-task completion lines with duration + status (checkmark/x). Updates spinner with "N tasks remaining" count.

### Tool name global restoration
Critical detail: AIAgent construction mutates model_tools._last_resolved_tool_names (process global) to the child's toolset. Before batch construction, the parent's tool names are saved. Each child gets _delegate_saved_tool_names set. After each child run (in finally block), the global is restored from the saved value. Explicit final restore after all children built.

### Return value
JSON with:
- results: array per task with status, summary, api_calls, duration_seconds, model, exit_reason, tokens (input/output), tool_trace (per-tool call with args_bytes and result_bytes/status)
- total_duration_seconds

### Depth limiting
_delegate_depth attribute on AIAgent. MAX_DEPTH=2. Parent (0) -> Child (1) -> Grandchild rejected (2). Returns error JSON immediately if depth limit reached.

### Memory provider notification
After all subagents complete, notifies parent's memory provider via on_delegation(task, result, child_session_id). Allows external memory providers to record delegation outcomes.

## execute_code: Programmatic Tool Calling (PTC)

### What it does
Lets the LLM write a Python script that calls Hermes tools via RPC. Collapses multi-step tool chains (e.g. read 20 files, process, write results) into a single LLM inference turn. Only stdout is returned to LLM -- intermediate tool results never enter the context window.

### Architecture: Two transports

Local backend (UDS):
1. Parent generates hermes_tools.py stub module with UDS RPC functions
2. Parent opens Unix domain socket, starts RPC listener thread
3. Parent spawns child process running the LLM's script
4. Tool calls travel over UDS back to parent for dispatch

Remote backends (file-based RPC):
1. Parent generates hermes_tools.py with file-based RPC stubs
2. Parent ships both files to remote environment (Docker/SSH/Modal/Daytona etc.)
3. Script runs inside the terminal backend
4. Tool calls written as request files; polling thread on parent reads and dispatches
5. Script polls for response files

### Allowed tools in sandbox
Only 7 tools: web_search, web_extract, read_file, write_file, search_files, patch, terminal.
(Intersection with session's enabled tools determines which stubs are generated.)

### Resource limits
- Timeout: 5 minutes (configurable code_execution.timeout)
- Max tool calls: 50 (configurable code_execution.max_tool_calls)
- Max stdout: 50 KB
- Max stderr: 10 KB

### Platform restriction
Disabled on Windows (requires POSIX for Unix domain sockets).

## mixture_of_agents: MoA Fan-Out

### What it does
Sends a query to 4 frontier models in parallel via OpenRouter:
- anthropic/claude-opus-4.6
- google/gemini-3-pro-preview
- openai/gpt-5.4-pro
- deepseek/deepseek-v3.2

Each model generates an independent response (temperature=0.6 for diversity).
Then aggregates all responses with claude-opus-4.6 (temperature=0.4 for focused synthesis).

Aggregator system prompt (from MoA paper): "You have been provided with a set of responses from various open-source models... Your task is to synthesize these responses into a single, high-quality response. It is crucial to critically evaluate the information provided... recognizing that some of it may be biased or incorrect."

MIN_SUCCESSFUL_REFERENCES=1: proceeds as long as at least one reference model responds.

### Use case
Specialized for extremely difficult problems requiring intense reasoning: coding, math, complex analytical tasks. Overkill for simple queries.

### API dependency
Requires OPENROUTER_API_KEY.

## Engineering Quality

- Subagent isolation: excellent. Fresh context, no memory writes, no user interaction, blocked recursive delegation.
- Parallel batch execution: ThreadPoolExecutor with max_workers=3. Clean future-based collection. Sort by task_index for deterministic ordering.
- Global state restoration: careful. _last_resolved_tool_names saved before batch construction, restored in finally blocks per child and after all children.
- Tool trace in results: valuable. Parent can see what tools each subagent called and sizes. Useful for debugging and cost analysis.
- execute_code PTC: clever. Reduces N inference turns to 1 for mechanical multi-step work. UDS + file-based dual transport covers local and remote environments.
- Depth limit with clear error message: pragmatic. Prevents runaway recursion, communicates the limit to the LLM.
- Delegation credentials: flexible. Subagents can run on a completely different provider:model pair, enabling cost-tier routing.
- MoA: sophisticated but niche. Requires OpenRouter. Better than single-model for genuinely hard problems.
- Worth absorbing: subagent isolation pattern (especially no memory writes), parallel batch with fixed concurrency, tool trace in results, depth limiting with explicit error, dual-transport RPC for execute_code.
