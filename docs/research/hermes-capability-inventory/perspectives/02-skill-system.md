# Hermes Agent - Skill System Deep Dive

Sources:
- tools/skills_tool.py - read/list tools
- tools/skill_manager_tool.py - create/edit/delete tools
- tools/skills_guard.py - security scanner
- tools/skills_hub.py - remote registry / marketplace
- run_agent.py lines 1740-1860 - nudge loop (background review)

## Skill Format (SKILL.md + directory)

All skills live in ~/.hermes/skills/. Each skill is a directory containing SKILL.md plus optional subdirectories: references/, templates/, scripts/, assets/.

SKILL.md frontmatter fields:
- name (required, max 64 chars, regex ^[a-z0-9][a-z0-9._-]*$)
- description (required, max 1024 chars)
- version (optional)
- platforms (optional, filters by OS: macos/linux/windows)
- required_environment_variables (structured list with name, prompt, help URL)
- setup.collect_secrets (interactive secret collection at skill load time)
- metadata.hermes.tags, metadata.hermes.related_skills

## Progressive Disclosure Architecture

Tier 1 (skills_list): Returns only name + description. Token-efficient survey of what exists.
Tier 2 (skill_view): Full SKILL.md content. Also loads specific supporting files via skill_view("name", "references/file.md").
Tier 3 (implicit): Supporting files loaded on demand by agent.

This is the Anthropic "progressive disclosure" pattern applied to procedural knowledge.

## Skill Creation / Editing (skill_manage tool)

Actions: create, edit (full rewrite), patch (targeted find-and-replace), delete, write_file, remove_file.

Validation:
- Name regex: ^[a-z0-9][a-z0-9._-]*$, max 64 chars
- Category: same regex, single directory segment
- Content: max 100,000 chars (~36k tokens at 2.75 chars/token)
- Supporting files: max 1 MiB each

After every write: _security_scan_skill() runs skills guard scanner on the skill directory.
Agent-created skills use "agent-created" trust level (allows caution verdict, asks on dangerous verdict).

## Skill Security Scanner (tools/skills_guard.py)

Static regex analysis across all files in skill directory.

Categories scanned:
- Exfiltration: curl/wget/fetch/httpx/requests with secret env vars in URL
- Credential store reads: .env, credentials, .netrc, .pgpass, .npmrc, .pypirc
- Persistence: authorized_keys writes, crontab modifications, ~/.bashrc/.zshrc writes
- Prompt injection: "ignore previous instructions", "you are now", "system prompt override", "disregard your rules"
- Destructive: rm -rf /, DROP DATABASE, mkfs, dd with if=
- Network callbacks: reverse shells, nc -e, ngrok, port forwarding
- Obfuscation: base64 decode + eval, chr() tricks, exec(compile(...))

Verdicts: safe / caution / dangerous

Trust-aware install policy (INSTALL_POLICY dict):
- builtin: allow all
- trusted (openai/skills, anthropics/skills): allow safe+caution, block dangerous
- community: allow safe only, block caution+dangerous
- agent-created: allow safe+caution, ask on dangerous

## Skill Nudge Loop - Self-Improvement Trigger

Location: run_agent.py lines ~1100-1107 (config), ~6958-6960 (iteration tracking), ~8888-8916 (trigger + spawn).

Config field: skills.creation_nudge_interval in config.yaml (default 10 tool iterations).
Counter: _iters_since_skill increments each tool-calling iteration. Resets when skill_manage is actually called (line 6112).

After every completed user turn:
  if _iters_since_skill >= _skill_nudge_interval and skill_manage in valid_tool_names:
    _should_review_skills = True
    _iters_since_skill = 0

If _should_review_skills: calls _spawn_background_review(messages_snapshot, review_skills=True).

Background review (_spawn_background_review in run_agent.py line 1770):
1. Picks the appropriate prompt: SKILL_REVIEW_PROMPT, MEMORY_REVIEW_PROMPT, or COMBINED_REVIEW_PROMPT
2. Spawns a background thread
3. Thread creates a forked AIAgent(max_iterations=8, quiet_mode=True) with same model
4. Shared memory/skill stores are injected directly: review_agent._memory_store = self._memory_store
5. Nudge intervals set to 0 on review agent (prevents infinite recursion)
6. Calls review_agent.run_conversation(user_message=prompt, conversation_history=messages_snapshot)
7. Background agent can call skill_manage to write new/updated skills to ~/.hermes/skills/
8. Main agent's conversation is never modified
9. On completion, scans review agent messages for successful tool actions and prints summary

Prompt used for skill review:
"Review the conversation above and consider saving or updating a skill if appropriate.
Focus on: was a non-trivial approach used to complete a task that required trial and error,
or changing course due to experiential findings along the way, or did the user expect or
desire a different method or outcome? If a relevant skill already exists, update it with
what you learned. Otherwise, create a new skill if the approach is reusable.
If nothing is worth saving, just say 'Nothing to save.' and stop."

Combined trigger (both memory and skill nudge fire): uses COMBINED_REVIEW_PROMPT to handle both in one background run.

## Skills Hub (Marketplace)

tools/skills_hub.py + hermes_cli/skills_hub.py

Sources:
- OptionalSkillSource: Bundled optional skills in optional-skills/ (not active by default)
- GitHubSource: Any GitHub repo via Contents API (PAT, gh CLI, or GitHub App auth)
- ClawhHub, Claude Marketplace, LobeHub

Hub state:
- Lock file: ~/.hermes/skills/.hub/lock.json (provenance per skill: repo, commit, hash)
- Audit log: ~/.hermes/skills/.hub/audit.log
- Quarantine dir: ~/.hermes/skills/.hub/quarantine/ (stages downloads before security scan)
- Index cache: ~/.hermes/skills/.hub/index-cache/ (TTL: 1 hour)

Taps system: ~/.hermes/skills/.hub/taps.json - adds additional GitHub repos as skill sources.

Optional skill categories: autonomous-ai-agents, blockchain, communication, creative, devops, email, health, mcp, migration, mlops, productivity, research, security.

Bundled active skill categories: apple, autonomous-ai-agents, creative, data-science, devops, diagramming, dogfood, domain, email, feeds, gaming, gifs, github, inference-sh, leisure, mcp, media, mlops, note-taking, productivity, red-teaming, research, smart-home, social-media, software-development.

## Skill Slash Commands (agent/skill_commands.py)

/skill-name in CLI or gateway invokes agent/skill_commands.py _load_skill_payload(), which loads the skill content and injects it as a user message. Skills run as slash commands without the agent needing to call skill_view first.

## Engineering Quality

- Progressive disclosure: excellent. Cheap survey (names only), then full load on demand.
- Background review nudge: high quality. Forked agent, shared stores, silent thread, zero main-loop impact. Counter-resets on actual use prevent spammy reviews.
- Security scanning: defense-in-depth. Static regex + trust-level policy matrix + dynamic injection detection on memory writes.
- Platform-aware: platforms: field filters by OS. Skills not compatible with current platform are hidden.
- Hub provenance: lock file + audit log + quarantine pattern mirrors secure package management.
- Worth absorbing: nudge loop pattern, background fork pattern, trust-level policy matrix, progressive disclosure architecture.
