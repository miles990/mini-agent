# Contributing to mini-agent

Thanks for your interest! mini-agent is a perception-driven AI agent framework. Contributions that align with its design philosophy are welcome.

## Quick Overview

mini-agent is:
- **Perception-driven** — sees the environment first, then decides what to do
- **File-based** — Markdown + JSON Lines, no database
- **Composable** — shell scripts as perception, Markdown as skills

## Setup

```bash
git clone https://github.com/miles990/mini-agent.git
cd mini-agent
pnpm install
pnpm build
pnpm typecheck
```

## Good First Contributions

### 1. Write a Perception Plugin (easiest)

A perception plugin is any executable that writes to stdout. The output gets injected into the agent's context as an XML section.

**Create the script:**

```bash
#!/bin/bash
# plugins/my-sensor.sh
# Output becomes <my-sensor>...</my-sensor> in agent context

echo "Status: $(systemctl is-active myservice)"
echo "Queue: $(wc -l < /tmp/queue.txt) items"
echo "Last error: $(tail -1 /var/log/myservice.err)"
```

**Register in `agent-compose.yaml`:**

```yaml
perception:
  custom:
    - name: my-sensor
      script: ./plugins/my-sensor.sh
      # Optional:
      # timeout: 15000        # ms, default 5000
      # output_cap: 2500      # chars, default 4000
      # enabled: false        # disable without removing
```

**Tips:**
- Keep output concise — it's injected into the LLM context every cycle
- Use `output_cap` to limit verbose outputs
- Exit 0 on success; non-zero exits are logged but don't crash the agent
- Test by running `bash plugins/my-sensor.sh` directly

See [plugins/](plugins/) for 34 examples.

### 2. Write a Skill (Markdown module)

Skills are Markdown files injected into the system prompt. They teach the agent *how* to do things.

```markdown
# My Domain Skill

## When to use
When the agent encounters [situation].

## Steps
1. Check [prerequisite]
2. Run `command`
3. If [condition], do X; otherwise do Y

## Rules
- Never do [dangerous thing]
- Always verify [result] before reporting success
```

Register in `agent-compose.yaml`:

```yaml
skills:
  - ./skills/my-domain.md
```

Skills can be loaded conditionally (JIT) based on conversation keywords — add a `keywords` frontmatter:

```markdown
---
keywords: [docker, container, compose]
---
# Docker Operations Skill
...
```

### 3. Bug Reports

Open an issue with:
1. What happened vs. what you expected
2. Steps to reproduce
3. Environment (OS, Node version, `mini-agent status` output)

### 4. Code Changes

1. Fork and branch (`git checkout -b fix/description`)
2. Make changes
3. Run `pnpm typecheck` and `pnpm test`
4. Open a PR with a clear description

## Project Structure

```
src/           # TypeScript source (~29K lines)
plugins/       # Perception plugins (shell scripts)
skills/        # Markdown knowledge modules
scripts/       # Utility scripts
memory/        # Agent memory (Markdown + JSONL)
```

Key files: `src/agent.ts` (core), `src/loop.ts` (OODA cycle), `src/perception.ts` (plugin runner), `src/compose.ts` (config loader), `src/dispatcher.ts` (response parser).

## Code Conventions

- TypeScript strict mode
- Field names consistent across endpoints, plugins, and types
- HTML files making API calls must be served via HTTP (not `file://`)
- No unnecessary abstractions — three similar lines > premature helper

## Design Constraints

All changes should pass these checks:

| Constraint | Ask yourself |
|------------|-------------|
| **Quality-First** | Does this make the agent think better, not just faster? |
| **Token Economy** | Does this make context more precise, not just smaller? |
| **Transparency** | Does any tracking add <5% cycle time? |
| **Reversibility** | Can this be reverted in <1 minute? |
| **No Dead Code** | Are there paths that never execute? |

## Communication

- **Issues** — Bug reports, feature proposals, questions
- **PRs** — Code, plugins, skills, docs

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

