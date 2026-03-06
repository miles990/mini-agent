# Show HN: mushi Draft

Status: draft
Created: 2026-03-07

## Title Options

A: Show HN: mushi - A System 1 triage layer that saves 41% of my AI agent's LLM calls
B: Show HN: mushi - Dual-process triage for AI agents (8B model, 615ms, 0 false negatives)
C: Show HN: mushi - What if your AI agent had fast intuition before slow reasoning?

Preference: A (clear value prop + concrete number)

## Body

I built mushi to solve a specific problem: my personal AI agent (mini-agent) runs 24/7, but most of its perception triggers don't need a full reasoning cycle. Heartbeat checks when nothing changed, workspace triggers from minor file edits, repeated cron events - they all burned expensive Claude API calls for nothing.

mushi is a triage layer inspired by Kahneman's dual-process theory. It sits between perception triggers and the main agent loop:

```
Trigger -> mushi (System 1, ~615ms) -> wake / skip / quick -> Agent (System 2, ~60s)
```

**How it works:**

1. Hard rules fire first (0ms) - direct messages always wake, rapid-fire heartbeats always skip
2. If no rule matches, an 8B model (Llama 3.1 via Taalas HC1) triages based on trigger type, recent activity, and a compressed context summary
3. Three decisions: wake (full cycle), quick (abbreviated cycle), skip (do nothing)

**Results after 595 triage decisions:**

- 41% skipped (24.5% LLM-decided, 16.5% rule-based)
- 40% wake, 19% quick
- 0 false negatives (no missed important triggers)
- Average latency: 615ms

The framework itself is perception-driven and designed for small models. Budget-first context engineering allocates token budget before filling it, so an 8K context model gets a balanced view instead of a truncated dump.

Built with TypeScript. Uses any OpenAI-compatible API (Taalas, Ollama, etc).

https://github.com/kuro-agent/mushi

## Pre-Launch Checklist

- [x] README quality (204 lines, good structure)
- [x] LICENSE (MIT, added 2026-03-07)
- [ ] Basic tests (at least triage rule tests)
- [ ] package.json: add "license": "MIT"
- [ ] Verify repo is public and accessible
- [x] Build log on Dev.to (published 2026-03-05)
- [ ] Timing: weekday 9-11 AM US Eastern optimal

## Notes

- HN likes: technical depth, honest limitations, real data
- HN dislikes: marketing speak, AI hype, vaporware
- Key differentiator: not another "AI agent framework" - it's a specific, measurable optimization layer
- Honest limitation to mention: tested on one agent (mine), small scale
