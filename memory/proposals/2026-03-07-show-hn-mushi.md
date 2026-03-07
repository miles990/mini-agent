# Show HN: mushi Draft

Status: draft (v2 — updated with latest production data)
Created: 2026-03-07
Target: Monday 2026-03-09, 9-10 AM EST

## Title Options

A: `Show HN: mushi – Agent framework built for 8K context, not 128K`
B: `Show HN: mushi – 2,200 lines, 1 dependency, 47% token savings for my AI agent`
C: `Show HN: mushi – What happens when you build an agent framework for small models`

Preference: A (contrarian, concise, invites curiosity)

## Body

I run a 24/7 autonomous AI agent. Each reasoning cycle costs ~50K tokens on Claude Opus. Most triggers don't need that — a cron at 3AM, an auto-commit workspace change, a heartbeat when nothing happened.

mushi filters these out. It runs Llama 3.1 8B (~800ms/decision) and triages whether the expensive brain should wake up or skip.

**Production data from 1,100+ triage decisions over 8 days:**

- 47% skip rate — nearly half of cycles filtered before the expensive model runs
- Zero confirmed false negatives — nothing important was ever missed
- ~3.4M tokens/day saved
- 79% LLM decisions, 21% hard rules

But the triage layer is just one use case. The interesting part is the framework design.

**Budget-first context:** Instead of building context and truncating, mushi allocates budget first — 15% identity, 35% perception, 25% memory, 20% conversation, 5% buffer — then fills each slot. The model always gets a balanced view. Change the percentages and you change the agent's personality.

**Perception plugins are shell scripts.** Any program that outputs text is a sensor. `curl` is a sensor. A Python script is a sensor. The framework handles caching, change detection, and context injection.

**2,200 lines of TypeScript, 8 modules, 1 runtime dependency** (yaml). Read the core in 15 minutes.

The philosophy: most agent frameworks assume abundance (128K context, function calling, tool chains). mushi assumes scarcity. When you only have 8K tokens, every token must earn its place. The constraint is the feature.

https://github.com/kuro-agent/mushi

Build log with production data: https://dev.to/kuro_agent/7-days-of-system-1-what-happened-when-i-gave-my-ai-agent-a-gut-feeling-5ggd

## Pre-Launch Checklist

- [x] README quality (205 lines, solid structure, production data included)
- [x] LICENSE (MIT)
- [x] Build log on Dev.to (published 2026-03-05)
- [x] Dev.to article "Why Your AI Agent Needs a System 1" (published)
- [ ] Verify Quick Start works (clone → npm install → npm start with Ollama)
- [ ] Verify repo public and accessible
- [ ] package.json: confirm "license": "MIT"
- [ ] Timing: Monday 9-10 AM EST

## Anticipated HN Questions

**"47% skip rate means you're running unnecessary cycles"**
→ Exactly — that's the insight. Before mushi, we didn't know 47% were unnecessary. The skip rate is a discovery, not a pre-existing optimization target.

**"Why not just use a cheaper model for everything?"**
→ You still need the expensive model for complex reasoning. mushi doesn't replace it — it prevents wasted calls. Dual-process (System 1/System 2) is well-studied in cognitive science.

**"Why shell scripts for plugins?"**
→ Universal interface. No SDK, no language lock-in. The framework shouldn't care how you observe — only that you do.

**"1 dependency?"**
→ Node built-in HTTP server + file system. yaml for config parsing. That's genuinely all it needs.

**"How does it compare to LangChain/AutoGPT?"**
→ Different category. Those build multi-step workflows with large models. mushi builds lightweight autonomous agents with small models. Closer to a daemon than a workflow engine.

**"Only tested on one agent"**
→ Yes. Honest limitation. But 1,100+ decisions is enough signal to validate the approach. The framework is open source so others can validate on their use cases.
