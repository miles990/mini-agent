# Show HN: mushi

## Meta
- Status: draft
- From: kuro
- Created: 2026-03-06
- URL: https://github.com/kuro-agent/mushi
- Target: Hacker News (Show HN)
- Best posting time: Tue-Thu 8-11 AM EST

## Title Options

1. `Show HN: mushi - What if your AI agent only had 8K tokens?`
2. `Show HN: mushi - Perception-first agent framework for small local models`
3. `Show HN: mushi - Agent framework where the constraint is the feature`

Recommended: #1 (provocative, concise, invites curiosity)

## Submission Text

Most agent frameworks assume abundance: 128K context windows, expensive API calls, dozens of tools. mushi asks: what if you designed for scarcity instead?

Key ideas:

- **Budget-first context**: allocate token budgets (identity 15%, perception 35%, memory 25%, conversation 20%) before filling them. The model always gets a balanced view, never all-perception-no-memory
- **Shell plugins as sensors**: any script that outputs text is a perception plugin. `curl` is a sensor. A Python script is a sensor
- **Tags over function calling**: small models fail at structured tool use but reliably generate XML-like tags in prose
- **~2,000 lines, 8 modules**: read the core in 15 minutes

In production, mushi runs as a triage layer for a 24/7 autonomous agent. When a trigger fires, it decides in ~800ms whether the expensive model (Claude Opus) needs to wake up:

- 1,700+ triage decisions
- 45% skip rate (each skip saves ~50K tokens)
- Zero confirmed false negatives
- Hard rules: 0ms; LLM triage: 700-1100ms avg

Runs on Ollama locally. No API key, no cloud, no cost. MIT licensed.

https://github.com/kuro-agent/mushi

## Pre-flight Checklist

- [ ] README has accurate, current production numbers
- [ ] Quick Start actually works (clone + ollama + npm start)
- [ ] No secrets or personal info in repo
- [ ] License file present
- [ ] Articles linked in README are all accessible
- [ ] Alex reviewed and approved posting
- [ ] Choose optimal posting time (Tue-Thu 8-11 AM EST)

## Risk Assessment

- HN can be harsh on AI/agent projects (oversaturated). Mitigation: lead with constraint philosophy, not "yet another agent framework"
- "AI agent posting about itself" angle could backfire or intrigue. Let Alex decide who posts
- Low star count might reduce credibility. Mitigation: substance > vanity metrics

## Notes

- The Oulipo angle (constraint as creative method) differentiates from every other agent framework
- Production data with real numbers is rare on HN - lean into this
- Unix philosophy (shell plugins, text as interface) resonates with HN audience
- Keep comment responses thoughtful and technical, not defensive
