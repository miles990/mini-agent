# Hermes Agent - Self-Improvement Loop

Sources:
- run_agent.py lines 1740-1860 (_spawn_background_review, review prompts)
- run_agent.py lines ~1100-1107 (nudge interval config)
- run_agent.py lines ~6723-6733 (memory nudge trigger)
- run_agent.py lines ~6958-6960 (skill nudge counter)
- run_agent.py lines ~8888-8916 (trigger check + spawn)
- tools/skill_manager_tool.py (skill_manage tool)
- tools/memory_tool.py (memory tool)
- agent/trajectory.py (trajectory saving)
- tools/rl_training_tool.py (RL training infrastructure)

## What "Self-Improvement" Means in Hermes

Two distinct mechanisms:
1. Experiential accumulation (memory + skills nudge loop) -- happens automatically
2. Explicit RL training (rl_training_tool) -- human-triggered, trains a model on Tinker-Atropos

## Mechanism 1: Experiential Accumulation (Automatic)

### How it's triggered

Two counters run in parallel:
- _turns_since_memory: increments per user turn. Resets when memory tool is used.
- _iters_since_skill: increments per tool-calling iteration. Resets when skill_manage is used.

Configurable intervals (config.yaml):
- memory.nudge_interval (default 10 user turns)
- skills.creation_nudge_interval (default 10 tool iterations)

After every completed user turn, both counters are checked:
  if _turns_since_memory >= interval: _should_review_memory = True, reset counter
  if _iters_since_skill >= interval: _should_review_skills = True, reset counter

### What gets reviewed

_spawn_background_review() runs in a background thread (daemon):
1. Picks prompt: SKILL_REVIEW_PROMPT, MEMORY_REVIEW_PROMPT, or COMBINED_REVIEW_PROMPT
2. Creates a forked AIAgent(max_iterations=8, quiet_mode=True, same model)
3. Injects shared _memory_store (same object as main agent)
4. Sets review agent nudge intervals to 0 (prevents recursion)
5. Calls review_agent.run_conversation(prompt, conversation_history=snapshot)
6. Review agent has access to: memory tool (to write to MEMORY.md/USER.md) and skill_manage tool (to write skills)

### What gets saved

Memory tool writes: persistent entries in MEMORY.md or USER.md. Visible on next session start (frozen snapshot pattern).

Skill tool writes: new or updated SKILL.md files in ~/.hermes/skills/. Visible immediately via skills_list/skill_view in subsequent calls.

After the background thread completes, the main agent prints a summary line like "Memory updated" or "Skill created: systematic-debugging".

### What the LLM is asked to do

SKILL_REVIEW_PROMPT (verbatim from run_agent.py line 1746):
"Review the conversation above and consider saving or updating a skill if appropriate.
Focus on: was a non-trivial approach used to complete a task that required trial and error,
or changing course due to experiential findings along the way, or did the user expect or
desire a different method or outcome?
If a relevant skill already exists, update it with what you learned.
Otherwise, create a new skill if the approach is reusable.
If nothing is worth saving, just say 'Nothing to save.' and stop."

MEMORY_REVIEW_PROMPT (verbatim from run_agent.py line 1733):
"Review the conversation above and consider if there is anything worth saving to memory.
Focus on: Has the user revealed things about themselves -- their persona, desires, preferences,
or personal details? Has the user expressed expectations about how you should behave, their
work style, or ways they want you to operate?
If something stands out, save it using the memory tool.
If nothing is worth saving, just say 'Nothing to save.' and stop."

COMBINED_REVIEW_PROMPT handles both in one pass.

### Quality of this loop

- Fires automatically without user prompting
- Background thread -- zero latency impact on main conversation
- Shared stores -- writes take effect immediately and persistently
- Recursion-safe: review agent has nudge_interval=0
- Counter-reset on actual use: prevents spamming reviews when the agent is already actively managing skills/memory
- Forked context: review agent sees full conversation snapshot but never modifies main messages
- The agent effectively learns from its own tool-use experience

## Mechanism 2: Trajectory Recording

agent/trajectory.py save_trajectory()

Saves conversations in ShareGPT format to trajectory_samples.jsonl (on success) or failed_trajectories.jsonl (on failure).

batch_runner.py supports bulk collection of trajectories for fine-tuning data generation.

Used to collect training data for the Hermes model itself (dogfood fine-tuning pipeline).

## Mechanism 3: RL Training Infrastructure (tools/rl_training_tool.py)

Not self-improvement of the running agent, but a toolset for the agent to orchestrate RL training of another model.

The agent can:
1. List available training environments (AST-scanned Tinker-Atropos BaseEnv subclasses)
2. Select an environment
3. View/edit training config (locked infra settings protected from mutation)
4. Start a training run (spawns SGLang inference server + Tinker trainer + env server as subprocesses)
5. Monitor training metrics via WandB
6. Stop training, get results, list runs, test inference

This enables a "meta-agent" workflow: Hermes orchestrates training Hermes on new environments.

## Engineering Quality

- Background fork pattern: excellent. No user-visible latency, no main-loop modification.
- Counter-based triggers: simple and effective. Calibrated intervals prevent over-triggering.
- Shared store injection: correct. Avoids serialization/deserialization overhead and race conditions.
- "Nothing to save" escape hatch: prevents unnecessary writes when the conversation has nothing valuable.
- Trajectory recording for fine-tuning: thoughtful dogfood loop. Agent collects its own training data.
- RL toolset: sophisticated meta-agent capability. Most agents can't orchestrate their own training.
- Worth absorbing: background fork pattern with shared store, counter-based nudge triggers, combined review prompt optimization.
